// api/_lib/store.js
//
// Ledger persistence with two interchangeable backends, no SDK:
//   1) Vercel KV (Upstash Redis REST API)  — KV_REST_API_URL + KV_REST_API_TOKEN
//   2) Vercel Blob (private store)         — BLOB_READ_WRITE_TOKEN
// KV wins when both are configured. Everything degrades gracefully: with
// neither configured the interactive bot still works — we simply skip
// persistence and the dashboard reads an empty list.
//
// KV storage model: a single Redis list "ledger:all" of JSON-stringified
// records, newest pushed to the head (LPUSH); read back with LRANGE.
//
// Blob storage model: one immutable private JSON blob PER RECORD at
// "ledger/rec/<dedupeKey>.json". Nothing is ever overwritten or deleted, so
// CDN caching can never serve a stale ledger state. Writes are atomic AND
// idempotent in a single request: PUT with x-allow-overwrite:0 — the origin
// rejects an existing pathname with an "already exists" error, which IS the
// duplicate detection (no read-modify-write, no race window at all).
// Reads: the LIST API (origin, immediately consistent — verified) enumerates
// ledger/rec/*, then each immutable record blob is fetched.
// (Protocol verified against api-version 12 on the live store.)
//
// Idempotency (both backends): every record carries a content-derived
// dedupe key. It prefers the slip's `slipId` (a short hash of the LINE
// image messageId carried through the postback flow) so BOTH a LINE
// redelivery AND a user re-tapping the confirm button map to the same key
// and cannot double-record one slip. Records without a slipId (old
// in-flight postbacks) fall back to webhookEventId, then to a hash of the
// load-bearing fields.
//
// Every network call is bounded by an AbortController timeout so a slow
// upstream can never hold the webhook open past the reply-token window.

import crypto from "node:crypto";

const LEDGER_KEY = "ledger:all";
const BLOB_REC_PREFIX = "ledger/rec/";
const BLOB_API = "https://blob.vercel-storage.com";
const MAX_RECORDS = 1000; // keep the ledger bounded for the dashboard
const DEDUPE_PREFIX = "ledger:seen:";
const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — long enough for retries
const STORE_TIMEOUT_MS = 5000;
const READ_CONCURRENCY = 10; // parallel record fetches for the dashboard read

/** True when the KV env vars are present. */
export function kvEnabled(env) {
  return Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
}

/** True when the Vercel Blob token is present. */
export function blobEnabled(env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

/** True when any persistence backend is configured. */
export function storageEnabled(env) {
  return kvEnabled(env) || blobEnabled(env);
}

/**
 * Content-derived dedupe identity for a record. Prefers slipId (stable across
 * redeliveries AND re-taps of the same slip), then webhookEventId (stable
 * across redeliveries only), then a hash of the load-bearing fields.
 *
 * The slip basis deliberately EXCLUDES lineUserId: slipId is a hash of the
 * slip image bytes on every channel (LINE bot and web chat), so the same
 * physical slip recorded twice — by two people, from two devices, or once via
 * LINE and once via the web — converges on one ledger row instead of
 * double-counting the payment.
 */
export function dedupeKeyFor(record) {
  const r = record || {};
  const basis = r.slipId
    ? ["slip", r.amount, r.date, r.ref, r.entity, r.category, r.slipId]
    : r.webhookEventId
      ? ["evt", r.webhookEventId]
      : ["raw", r.lineUserId, r.amount, r.date, r.ref, r.entity, r.category];
  return crypto.createHash("sha256").update(basis.join("|")).digest("hex").slice(0, 32);
}

/** KV key for a record's dedupe claim. */
export function idempotencyKey(record) {
  return DEDUPE_PREFIX + dedupeKeyFor(record);
}

/**
 * Append one ledger record. No-op (ok:false, skipped:true) when no backend is
 * configured. Idempotent: a redelivery or confirm-button re-tap of the same
 * slip returns {ok:true, duplicate:true} without writing a second copy.
 *
 * @param {object} record  the expense record to persist
 * @param {object} env     process.env
 * @returns {Promise<{ok:boolean, skipped?:boolean, duplicate?:boolean}>}
 */
export async function saveRecord(record, env) {
  if (kvEnabled(env)) return saveRecordKv(record, env);
  if (blobEnabled(env)) return saveRecordBlob(record, env);
  return { ok: false, skipped: true };
}

/**
 * Read all ledger records (newest first). Returns [] when no backend is
 * configured or the ledger is genuinely empty, and null when the configured
 * backend FAILED — so the dashboard can show an error instead of silently
 * rendering an empty ledger during an outage.
 *
 * @param {object} env  process.env
 * @returns {Promise<object[]|null>}
 */
export async function listRecords(env) {
  if (kvEnabled(env)) return listRecordsKv(env);
  if (blobEnabled(env)) return listRecordsBlob(env);
  return [];
}

/** Drop transport-only fields (idempotency carriers) before persisting. */
function stripInternal(record) {
  if (!record || typeof record !== "object") return record;
  const { webhookEventId, slipId, ...rest } = record;
  return rest;
}

/** fetch() with a hard timeout. Always clears the timer. Throws on abort. */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Backend 1 — Vercel KV (Upstash Redis REST)
// ============================================================================

async function saveRecordKv(record, env) {
  try {
    // Claim the idempotency key first. SET key 1 NX EX <ttl> returns "OK" only
    // when it was newly set; a null result means we've already saved this record.
    // Known window: a crash BETWEEN the claim and the LPUSH leaves the claim
    // set but no record, so LINE's redelivery would be deduped away. The Blob
    // backend has no such window (dedupe scan + write are one CAS unit) and is
    // the backend this deployment runs on.
    const key = idempotencyKey(record);
    const claim = await kvCommand(
      ["SET", key, "1", "NX", "EX", String(DEDUPE_TTL_SECONDS)],
      env
    );
    if (!claim.ok) return { ok: false }; // KV error — let the caller surface it.
    if (claim.result === null) {
      // Already persisted by a prior (successful) delivery — treat as success.
      return { ok: true, duplicate: true };
    }

    // LPUSH ledger:all <json>  — pipeline-free single command via REST.
    const r = await kvCommand(
      ["LPUSH", LEDGER_KEY, JSON.stringify(persistShape(record))],
      env
    );
    if (!r.ok) {
      // The write failed after we claimed the key. Release the claim so a retry
      // (redelivery) can re-attempt the LPUSH rather than being deduped away.
      await kvCommand(["DEL", key], env).catch(() => {});
      return { ok: false };
    }
    // Trim to the most recent MAX_RECORDS so the list never grows unbounded.
    await kvCommand(["LTRIM", LEDGER_KEY, "0", String(MAX_RECORDS - 1)], env);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function listRecordsKv(env) {
  try {
    const r = await kvCommand(["LRANGE", LEDGER_KEY, "0", "-1"], env);
    if (!r.ok) return null; // backend outage — distinguishable from empty
    if (!Array.isArray(r.result)) return [];
    return r.result
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return null; // timeout / network error — distinguishable from empty
  }
}

/**
 * Execute a Redis command via the Upstash REST API (timeout-bounded).
 * Body is the command as a JSON array, e.g. ["LPUSH","ledger:all","{...}"].
 * Response shape: { result: ... } (success) or { error: ... }.
 */
async function kvCommand(command, env) {
  let res;
  try {
    res = await fetchWithTimeout(
      env.KV_REST_API_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.KV_REST_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
      },
      STORE_TIMEOUT_MS
    );
  } catch {
    return { ok: false }; // timeout / network error
  }
  if (!res.ok) return { ok: false };
  const data = await res.json().catch(() => ({}));
  if (data && Object.prototype.hasOwnProperty.call(data, "error")) {
    return { ok: false };
  }
  return { ok: true, result: data.result };
}

// ============================================================================
// Backend 2 — Vercel Blob (private store, one immutable blob per record)
// ============================================================================

/**
 * Persist a record as ledger/rec/<dedupeKey>.json with overwriting DISABLED.
 * The origin's "already exists" rejection doubles as atomic duplicate
 * detection: a LINE redelivery or a confirm re-tap of the same slip maps to
 * the same pathname and comes back {ok:true, duplicate:true}.
 */
async function saveRecordBlob(record, env) {
  const pathname = BLOB_REC_PREFIX + dedupeKeyFor(record) + ".json";
  let res;
  try {
    res = await fetchWithTimeout(
      `${BLOB_API}/?pathname=${encodeURIComponent(pathname)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${env.BLOB_READ_WRITE_TOKEN}`,
          "x-api-version": "12",
          "x-vercel-blob-access": "private",
          "x-content-type": "application/json",
          "x-add-random-suffix": "0",
          "x-allow-overwrite": "0", // reject existing pathname = dedupe
        },
        body: JSON.stringify(persistShape(record)),
      },
      STORE_TIMEOUT_MS
    );
  } catch {
    return { ok: false }; // timeout / network error
  }
  if (res.ok) return { ok: true };
  const body = await res.text().catch(() => "");
  if (res.status === 400 && body.includes("already exists")) {
    return { ok: true, duplicate: true };
  }
  return { ok: false };
}

/**
 * Enumerate ledger/rec/* via the LIST API (origin — immediately consistent,
 * verified against the live store), then fetch each immutable record blob.
 * Any failed page or record read makes the whole call return null (outage),
 * never a silently partial ledger.
 */
async function listRecordsBlob(env) {
  const auth = { Authorization: `Bearer ${env.BLOB_READ_WRITE_TOKEN}` };
  try {
    // Page through the listing (bounded by MAX_RECORDS).
    const entries = [];
    let cursor = "";
    do {
      const qs = new URLSearchParams({
        prefix: BLOB_REC_PREFIX,
        limit: String(Math.min(1000, MAX_RECORDS - entries.length)),
      });
      if (cursor) qs.set("cursor", cursor);
      const res = await fetchWithTimeout(
        `${BLOB_API}/?${qs}`,
        { headers: { ...auth, "x-api-version": "12" } },
        STORE_TIMEOUT_MS
      );
      if (!res.ok) return null;
      const page = await res.json();
      if (!page || !Array.isArray(page.blobs)) return null;
      entries.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : "";
    } while (cursor && entries.length < MAX_RECORDS);

    // Fetch the record blobs with bounded concurrency. A unique query string
    // forces an edge-cache MISS (verified: x-vercel-cache goes MISS → origin):
    // records are immutable, but a DELETED-then-recreated pathname can serve a
    // cached 404 tombstone for up to a minute — origin reads sidestep that.
    const records = new Array(entries.length);
    let next = 0;
    let failed = false;
    async function worker() {
      while (!failed) {
        const i = next++;
        if (i >= entries.length) return;
        const res = await fetchWithTimeout(
          `${entries[i].url}?_fresh=${crypto.randomUUID()}`,
          { headers: auth },
          STORE_TIMEOUT_MS
        );
        if (res.status === 404) {
          // Deleted between LIST and GET (or a delete-tombstone) — that one
          // record is legitimately gone; skip it rather than fail the ledger.
          records[i] = null;
          continue;
        }
        if (!res.ok) {
          failed = true; // real outage (5xx/auth) — surface as null upstream
          return;
        }
        records[i] = await res.json().catch(() => null);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(READ_CONCURRENCY, entries.length) }, worker)
    );
    if (failed) return null;

    // Newest first for the dashboard (createdAt is an ISO string).
    return records
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  } catch {
    return null; // backend outage — distinguishable from empty
  }
}

// ============================================================================
// Shared record shaping
// ============================================================================

/** What actually gets persisted: public fields + the dedupe identity. */
function persistShape(record) {
  return { ...stripInternal(record), dedupeKey: dedupeKeyFor(record) };
}
