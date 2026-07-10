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

import { listRecords } from "./_lib/store.js";
import { corsHeaders, requireDashboardToken } from "./_lib/auth.js";

/** Strip PII (lineUserId) and internal fields before sending to the dashboard. */
function sanitize(record) {
  if (!record || typeof record !== "object") return record;
  const { lineUserId, dedupeKey, ...rest } = record;
  return rest;
}

// CORS preflight.
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders(process.env) });
}

export async function GET(request) {
  const env = process.env;
  const cors = corsHeaders(env);

  const denied = requireDashboardToken(request, env, cors);
  if (denied) return denied;

  let transactions = [];
  try {
    transactions = await listRecords(env);
  } catch {
    transactions = null;
  }
  // null = the storage backend FAILED (timeout/outage). Surface it as an error
  // instead of an empty ledger, so the dashboard never silently shows ฿0.
  if (transactions === null) {
    return new Response(
      JSON.stringify({ ok: false, error: "ledger read failed" }),
      {
        status: 502,
        headers: { ...cors, "content-type": "application/json; charset=utf-8" },
      }
    );
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
