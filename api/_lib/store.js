// api/_lib/store.js
//
// Optional ledger persistence via Vercel KV (Upstash Redis REST API), no SDK.
// Everything degrades gracefully: if KV_REST_API_URL / KV_REST_API_TOKEN are not
// set, the interactive bot still works — we simply skip persistence and the
// dashboard reads an empty list.
//
// Storage model: a single Redis list "ledger:all" of JSON-stringified records,
// newest pushed to the head (LPUSH). transactions.js reads it back with LRANGE.
//
// Idempotency: saveRecord first claims a per-record key with SET NX (keyed by an
// idempotency token derived from the record). If the key already exists the
// write is treated as an already-persisted success and the LPUSH is skipped, so
// a LINE redelivery (or a retry on another instance) can safely re-attempt the
// save without duplicating the entry.

import crypto from "node:crypto";

const LEDGER_KEY = "ledger:all";
const MAX_RECORDS = 1000; // keep the list bounded for the dashboard
const DEDUPE_PREFIX = "ledger:seen:";
const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — long enough for retries

/** True when both KV env vars are present. */
export function kvEnabled(env) {
  return Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
}

/**
 * Stable idempotency key for a record. Prefers an explicit webhookEventId; falls
 * back to a hash of the load-bearing fields so two distinct expenses never
 * collide but a redelivery of the same one does.
 */
export function idempotencyKey(record) {
  if (record && record.webhookEventId) {
    return DEDUPE_PREFIX + String(record.webhookEventId);
  }
  const basis = [
    record && record.lineUserId,
    record && record.amount,
    record && record.date,
    record && record.ref,
    record && record.entity,
    record && record.category,
  ].join("|");
  const hash = crypto.createHash("sha256").update(basis).digest("hex").slice(0, 32);
  return DEDUPE_PREFIX + hash;
}

/**
 * Append one ledger record. No-op (ok:false, skipped:true) when KV is not set.
 * Idempotent: a redelivery of the same record returns {ok:true, duplicate:true}
 * without writing a second copy.
 *
 * @param {object} record  the expense record to persist
 * @param {object} env     process.env
 * @returns {Promise<{ok:boolean, skipped?:boolean, duplicate?:boolean}>}
 */
export async function saveRecord(record, env) {
  if (!kvEnabled(env)) return { ok: false, skipped: true };
  try {
    // Claim the idempotency key first. SET key 1 NX EX <ttl> returns "OK" only
    // when it was newly set; a null result means we've already saved this record.
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
      ["LPUSH", LEDGER_KEY, JSON.stringify(stripInternal(record))],
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

/** Drop transport-only fields (idempotency carrier) before persisting. */
function stripInternal(record) {
  if (!record || typeof record !== "object") return record;
  const { webhookEventId, ...rest } = record;
  return rest;
}

/**
 * Read all ledger records (newest first). Returns [] when KV is not configured.
 *
 * @param {object} env  process.env
 * @returns {Promise<object[]>}
 */
export async function listRecords(env) {
  if (!kvEnabled(env)) return [];
  try {
    const r = await kvCommand(["LRANGE", LEDGER_KEY, "0", "-1"], env);
    if (!r.ok || !Array.isArray(r.result)) return [];
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
    return [];
  }
}

/**
 * Execute a Redis command via the Upstash REST API.
 * Body is the command as a JSON array, e.g. ["LPUSH","ledger:all","{...}"].
 * Response shape: { result: ... } (success) or { error: ... }.
 */
async function kvCommand(command, env) {
  const res = await fetch(env.KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) return { ok: false };
  const data = await res.json().catch(() => ({}));
  if (data && Object.prototype.hasOwnProperty.call(data, "error")) {
    return { ok: false };
  }
  return { ok: true, result: data.result };
}
