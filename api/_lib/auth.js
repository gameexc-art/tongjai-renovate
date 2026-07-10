// api/_lib/auth.js
//
// Shared DASHBOARD_TOKEN auth + CORS helpers for the browser-facing endpoints
// (/api/transactions, /api/parse-slip, /api/record). One implementation so the
// security posture can't drift between routes:
//   - constant-time token compare (never throws on length mismatch),
//   - token from `Authorization: Bearer …` or the `x-dashboard-token` header,
//   - fails CLOSED: with DASHBOARD_TOKEN unset the route is disabled (503),
//     never open,
//   - CORS echoes only the explicitly configured DASHBOARD_ORIGIN — never "*";
//     with none set, same-origin only.

import crypto from "node:crypto";

export function corsHeaders(env, methods) {
  const origin = env.DASHBOARD_ORIGIN;
  const headers = {
    "Access-Control-Allow-Methods": methods || "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-dashboard-token",
    Vary: "Origin",
  };
  // Only echo an explicit, configured origin — never "*". With no
  // DASHBOARD_ORIGIN set, omit the header entirely (same-origin only).
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/** Constant-time string compare that never throws on length mismatch. */
export function safeEqual(a, b) {
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
export function presentedToken(request) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const x = request.headers.get("x-dashboard-token");
  return x ? x.trim() : "";
}

/**
 * Gate a request behind DASHBOARD_TOKEN. Returns null when authorized, or a
 * ready-to-return JSON Response (503 not configured / 401 unauthorized).
 */
export function requireDashboardToken(request, env, cors) {
  const expected = env.DASHBOARD_TOKEN;
  const headers = { ...cors, "content-type": "application/json; charset=utf-8" };
  // Fail closed: if no token is configured, the endpoint is disabled, not open.
  if (!expected) {
    return new Response(
      JSON.stringify({ ok: false, error: "dashboard endpoint not configured" }),
      { status: 503, headers }
    );
  }
  if (!safeEqual(presentedToken(request), expected)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers,
    });
  }
  return null;
}
