// api/record.js
//
// POST /api/record — persist one expense record from the LIVE web chat
// (Screen B), completing the same two-step flow the LINE bot runs via
// postbacks. Writes to the SAME ledger (KV/Blob via _lib/store.js), so web
// records appear on /dashboard next to LINE records.
//
// AUTH: DASHBOARD_TOKEN, same as /api/transactions (constant-time, fails
// closed). Without it anyone could write junk into the ledger.
//
// Body (application/json):
//   { amount, date?, ref?, merchant?, entity: "person"|"company",
//     category: "expense"|"withholding", slipId? }
//
// Idempotency: slipId (from /api/parse-slip — a hash of the image bytes)
// flows into the store layer's dedupe key, so re-submitting the same slip
// returns { ok:true, duplicate:true } instead of double-recording.
//
// Responses:
//   401/503(auth)   see _lib/auth.js
//   400             invalid body / fields
//   503 { ok:false, error:"storage not configured" }   no KV/Blob backend
//   502 { ok:false, error:"save failed" }              backend write failed
//   200 { ok:true, duplicate?:true }

import { saveRecord, storageEnabled } from "./_lib/store.js";
import { corsHeaders, requireDashboardToken } from "./_lib/auth.js";

const ENTITIES = new Set(["person", "company"]);
const CATEGORIES = new Set(["expense", "withholding"]);

function json(status, body, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// CORS preflight (same-origin default; see _lib/auth.js).
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(process.env, "POST, OPTIONS"),
  });
}

export async function POST(request) {
  const env = process.env;
  const cors = corsHeaders(env, "POST, OPTIONS");

  const denied = requireDashboardToken(request, env, cors);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "invalid json" }, cors);
  }
  if (!body || typeof body !== "object") {
    return json(400, { ok: false, error: "invalid body" }, cors);
  }

  const entity = String(body.entity || "");
  const category = String(body.category || "");
  if (!ENTITIES.has(entity)) {
    return json(400, { ok: false, error: "entity must be person|company" }, cors);
  }
  if (!CATEGORIES.has(category)) {
    return json(400, { ok: false, error: "category must be expense|withholding" }, cors);
  }

  const n = Number(body.amount);
  if (!Number.isFinite(n) || n < 0) {
    return json(400, { ok: false, error: "amount must be a non-negative number" }, cors);
  }
  const amount = n;

  // date: accept YYYY-MM-DD only (same rule the OCR normalizer enforces).
  let date = "";
  if (typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date.trim())) {
    date = body.date.trim();
  }

  // Free-text fields come from OCR of a user image — cap lengths to the same
  // budgets the LINE postback flow uses; they are stored, then HTML-escaped by
  // the dashboard on render.
  const merchant = typeof body.merchant === "string" ? body.merchant.trim().slice(0, 40) : "";
  const ref = typeof body.ref === "string" ? body.ref.trim().slice(0, 40) : "";

  // slipId: short hex hash from /api/parse-slip. Anything else is ignored
  // (the store then dedupes on the record's field hash instead).
  const slipId =
    typeof body.slipId === "string" && /^[0-9a-f]{4,16}$/.test(body.slipId)
      ? body.slipId
      : "";

  if (!storageEnabled(env)) {
    // Unlike the LINE flow (which is useful interactively without storage),
    // this endpoint's only job is persisting — so surface the missing backend.
    return json(503, { ok: false, error: "storage not configured" }, cors);
  }

  const record = {
    amount,
    currency: "THB",
    merchant: merchant === "-" ? "" : merchant,
    date,
    ref,
    entity, // person | company
    category, // expense | withholding
    channel: "web", // vs. records from the LINE bot (which carry no channel)
    lineUserId: "", // web records have no LINE identity
    createdAt: new Date().toISOString(),
    slipId, // transport-only; stripped on persist (drives the dedupe key)
  };

  const saved = await saveRecord(record, env);
  if (!saved.ok) {
    return json(502, { ok: false, error: "save failed" }, cors);
  }
  return json(200, saved.duplicate ? { ok: true, duplicate: true } : { ok: true }, cors);
}
