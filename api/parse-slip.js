// api/parse-slip.js
//
// POST /api/parse-slip — OCR a slip/receipt image for the LIVE web chat
// (Screen B). The browser sends the raw image bytes (content-type: image/*);
// we run the exact same Groq vision OCR the LINE bot uses and return the
// parsed fields plus a content-derived slipId the client carries through the
// two-step flow into POST /api/record (making re-records of the same slip
// idempotent, just like LINE redeliveries).
//
// AUTH: this endpoint spends Groq quota and feeds the real ledger flow, so it
// is gated by the same DASHBOARD_TOKEN passcode as the dashboard
// (Authorization: Bearer …, constant-time compare, fails closed when unset).
//
// Responses:
//   401/503        auth (see _lib/auth.js)
//   405            non-POST
//   415            body is not an image
//   413            image larger than the OCR cap (3 MB raw)
//   422 { ok:false, error:"ocr failed" }   Groq couldn't read the slip
//   200 { ok:true, slipId, data:{ amount, currency, merchant, date, ref } }

import crypto from "node:crypto";
import { parseSlip } from "./_lib/ocr.js";
import { corsHeaders, requireDashboardToken } from "./_lib/auth.js";

// Keep parity with the LINE image path: OCR fits well inside this.
export const config = { maxDuration: 60 };

// Raw-byte cap, matching _lib/ocr.js (Groq's 4 MB base64 cap → 3 MB raw).
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

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

  // Server misconfiguration is 503, NOT 422 — otherwise a missing Groq key
  // renders as "อ่านสลิปไม่สำเร็จ" and blames the user's photo forever.
  if (!env.GROQ_API_KEY) {
    return json(503, { ok: false, error: "ocr not configured" }, cors);
  }

  const contentType = (request.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!contentType.startsWith("image/")) {
    return json(415, { ok: false, error: "send raw image bytes with an image/* content-type" }, cors);
  }

  let buffer;
  try {
    buffer = Buffer.from(await request.arrayBuffer());
  } catch {
    return json(400, { ok: false, error: "unreadable body" }, cors);
  }
  if (buffer.length === 0) {
    return json(400, { ok: false, error: "empty body" }, cors);
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return json(413, { ok: false, error: "image too large (max 3 MB)" }, cors);
  }

  const result = await parseSlip(buffer, contentType, env);
  if (!result.ok) {
    // Never echo upstream error details to the browser; they're not actionable
    // there and could leak infra specifics. 422 = "the slip couldn't be read".
    return json(422, { ok: false, error: "ocr failed" }, cors);
  }

  // Content-derived dedupe identity: the same image re-uploaded (double-click,
  // retry, back-button) maps to the same slipId → same ledger dedupe key.
  const slipId = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 10);

  const { amount, currency, merchant, date, ref } = result.data;
  return json(200, { ok: true, slipId, data: { amount, currency, merchant, date, ref } }, cors);
}
