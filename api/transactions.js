// api/transactions.js
//
// Read-only ledger endpoint for the finance dashboard.
//   GET /api/transactions  → { ok, count, transactions: [...] }  (newest first)
//
// AUTH: this endpoint exposes the persisted ledger, so it is protected by a
// shared secret. Set DASHBOARD_TOKEN in the Vercel env and send it as
//   Authorization: Bearer <DASHBOARD_TOKEN>
// (or the `x-dashboard-token` header). Requests without the right token get 401.
// The compare is constant-time. If DASHBOARD_TOKEN is NOT set the endpoint is
// disabled (503) rather than open — it never serves the ledger unauthenticated.
//
// PII: each stored record carries a `lineUserId` (a stable identifier that is
// also a valid push target). It is NEVER returned to the dashboard — it is
// stripped server-side before serialization.
//
// CORS is restricted to the configured dashboard origin (DASHBOARD_ORIGIN),
// defaulting to same-origin only (no `*`), so a browser on an attacker page
// cannot read the response even if it somehow had the token.

import crypto from "node:crypto";
import { listRecords } from "./_lib/store.js";

function corsHeaders(env) {
  const origin = env.DASHBOARD_ORIGIN;
  const headers = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-dashboard-token",
    Vary: "Origin",
  };
  // Only echo an explicit, configured origin — never "*". With no
  // DASHBOARD_ORIGIN set, omit the header entirely (same-origin only).
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/** Pull the presented dashboard token from Authorization: Bearer or header. */
function presentedToken(request) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const x = request.headers.get("x-dashboard-token");
  return x ? x.trim() : "";
}

/** Strip PII (lineUserId) before sending records to the dashboard. */
function sanitize(record) {
  if (!record || typeof record !== "object") return record;
  const { lineUserId, ...rest } = record;
  return rest;
}

// CORS preflight.
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders(process.env) });
}

export async function GET(request) {
  const env = process.env;
  const cors = corsHeaders(env);
  const expected = env.DASHBOARD_TOKEN;

  // Fail closed: if no token is configured, the endpoint is disabled, not open.
  if (!expected) {
    return new Response(
      JSON.stringify({ ok: false, error: "dashboard endpoint not configured" }),
      {
        status: 503,
        headers: { ...cors, "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  if (!safeEqual(presentedToken(request), expected)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "content-type": "application/json; charset=utf-8" },
    });
  }

  let transactions = [];
  try {
    transactions = await listRecords(env);
  } catch {
    transactions = [];
  }
  const safe = transactions.map(sanitize);
  return new Response(
    JSON.stringify({ ok: true, count: safe.length, transactions: safe }),
    {
      status: 200,
      headers: {
        ...cors,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}
