// tests/auth.test.mjs
//
// Tests for api/_lib/auth.js (shared dashboard auth + CORS helpers) plus an
// integration check that api/transactions.js still uses the shared gate after
// the refactor. Node built-in test runner, zero dependencies:
//   node --test tests/auth.test.mjs

import test from "node:test";
import assert from "node:assert";

// Pin the environment BEFORE importing the modules under test. transactions.js
// reads process.env at request time; keep it deterministic either way.
process.env.DASHBOARD_TOKEN = "test-dashboard-secret";
process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
delete process.env.KV_REST_API_URL; // Blob backend must win in the integration test
delete process.env.KV_REST_API_TOKEN;
delete process.env.DASHBOARD_ORIGIN; // default CORS posture: same-origin only

const { safeEqual, presentedToken, corsHeaders, requireDashboardToken } =
  await import("../api/_lib/auth.js");
const transactions = await import("../api/transactions.js");

/** Build a GET Request with the given headers. */
function req(headers) {
  return new Request("http://localhost/api/transactions", {
    method: "GET",
    headers: headers || {},
  });
}

// ============================================================================
// safeEqual — constant-time compare that never throws
// ============================================================================

test("safeEqual: equal strings → true", () => {
  assert.strictEqual(safeEqual("secret-token", "secret-token"), true);
});

test("safeEqual: different strings of same length → false", () => {
  assert.strictEqual(safeEqual("aaaa", "aaab"), false);
});

test("safeEqual: different lengths → false (and does not throw)", () => {
  assert.strictEqual(safeEqual("short", "much-longer-token"), false);
});

test("safeEqual: non-string inputs → false", () => {
  assert.strictEqual(safeEqual(123, "123"), false);
  assert.strictEqual(safeEqual("abc", null), false);
  assert.strictEqual(safeEqual(undefined, undefined), false);
  assert.strictEqual(safeEqual(null, null), false);
  assert.strictEqual(safeEqual(Buffer.from("x"), "x"), false);
});

test("safeEqual: empty string vs empty string → true", () => {
  assert.strictEqual(safeEqual("", ""), true);
});

// ============================================================================
// presentedToken — Authorization: Bearer first, x-dashboard-token fallback
// ============================================================================

test("presentedToken: Authorization: Bearer abc → 'abc'", () => {
  assert.strictEqual(presentedToken(req({ authorization: "Bearer abc" })), "abc");
});

test("presentedToken: 'bearer abc' scheme is case-insensitive", () => {
  assert.strictEqual(presentedToken(req({ authorization: "bearer abc" })), "abc");
  assert.strictEqual(presentedToken(req({ authorization: "BEARER abc" })), "abc");
});

test("presentedToken: x-dashboard-token fallback", () => {
  assert.strictEqual(
    presentedToken(req({ "x-dashboard-token": "fallback-token" })),
    "fallback-token"
  );
});

test("presentedToken: Bearer wins when both headers are present", () => {
  const r = req({
    authorization: "Bearer from-bearer",
    "x-dashboard-token": "from-header",
  });
  assert.strictEqual(presentedToken(r), "from-bearer");
});

test("presentedToken: no token headers → ''", () => {
  assert.strictEqual(presentedToken(req({})), "");
});

// ============================================================================
// corsHeaders — never '*' unless explicitly configured; same-origin by default
// ============================================================================

test("corsHeaders: no DASHBOARD_ORIGIN → no Allow-Origin key, Vary: Origin, default methods", () => {
  const headers = corsHeaders({});
  assert.strictEqual("Access-Control-Allow-Origin" in headers, false);
  assert.strictEqual(headers.Vary, "Origin");
  assert.strictEqual(headers["Access-Control-Allow-Methods"], "GET, OPTIONS");
});

test("corsHeaders: custom methods honored", () => {
  const headers = corsHeaders({}, "POST, OPTIONS");
  assert.strictEqual(headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
});

test("corsHeaders: DASHBOARD_ORIGIN echoed exactly, never widened to '*'", () => {
  const headers = corsHeaders({ DASHBOARD_ORIGIN: "https://dash.example.com" });
  assert.strictEqual(headers["Access-Control-Allow-Origin"], "https://dash.example.com");
  assert.notStrictEqual(headers["Access-Control-Allow-Origin"], "*");
  assert.strictEqual(headers.Vary, "Origin");
});

test("corsHeaders: '*' only when the operator configured it as such", () => {
  const headers = corsHeaders({ DASHBOARD_ORIGIN: "*" });
  assert.strictEqual(headers["Access-Control-Allow-Origin"], "*");
});

// ============================================================================
// requireDashboardToken — fails closed, constant-time gate
// ============================================================================

test("requireDashboardToken: DASHBOARD_TOKEN unset → 503 Response (fails closed)", async () => {
  const env = {};
  const denied = requireDashboardToken(
    req({ authorization: "Bearer anything" }),
    env,
    corsHeaders(env)
  );
  assert.ok(denied instanceof Response);
  assert.strictEqual(denied.status, 503);
  assert.strictEqual(denied.headers.get("Vary"), "Origin");
  assert.match(denied.headers.get("content-type"), /application\/json/);
  const body = await denied.json();
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, "dashboard endpoint not configured");
});

test("requireDashboardToken: wrong token → 401", async () => {
  const env = { DASHBOARD_TOKEN: "right-token" };
  const denied = requireDashboardToken(
    req({ authorization: "Bearer wrong-token" }),
    env,
    corsHeaders(env)
  );
  assert.ok(denied instanceof Response);
  assert.strictEqual(denied.status, 401);
  const body = await denied.json();
  assert.deepStrictEqual(body, { ok: false, error: "unauthorized" });
});

test("requireDashboardToken: right token → null (authorized)", () => {
  const env = { DASHBOARD_TOKEN: "right-token" };
  const ok = requireDashboardToken(
    req({ authorization: "Bearer right-token" }),
    env,
    corsHeaders(env)
  );
  assert.strictEqual(ok, null);
  // Same via the x-dashboard-token header.
  const okHeader = requireDashboardToken(
    req({ "x-dashboard-token": "right-token" }),
    env,
    corsHeaders(env)
  );
  assert.strictEqual(okHeader, null);
});

// ============================================================================
// Integration — api/transactions.js still uses the shared gate + store
// ============================================================================

test("GET /api/transactions: right token + empty Blob store → 200 {ok:true,count:0}", async () => {
  const originalFetch = globalThis.fetch;
  const intercepted = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    intercepted.push({ url: u, options });
    if (u.startsWith("https://blob.vercel-storage.com/")) {
      // Blob LIST API: empty ledger, no more pages.
      return new Response(JSON.stringify({ blobs: [], hasMore: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("unexpected fetch in test: " + u);
  };
  try {
    const res = await transactions.GET(
      req({ authorization: "Bearer test-dashboard-secret" })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.deepStrictEqual(body, { ok: true, count: 0, transactions: [] });

    // The store was really consulted: exactly one LIST call against the Blob
    // API, scoped to the ledger prefix and carrying the Blob token.
    assert.strictEqual(intercepted.length, 1);
    const listUrl = new URL(intercepted[0].url);
    assert.strictEqual(listUrl.origin, "https://blob.vercel-storage.com");
    assert.strictEqual(listUrl.searchParams.get("prefix"), "ledger/rec/");
    assert.strictEqual(
      intercepted[0].options.headers.Authorization,
      "Bearer test-blob-token"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/transactions: wrong token → 401 and no storage call", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    throw new Error("storage must not be reached for unauthorized requests");
  };
  try {
    const res = await transactions.GET(
      req({ authorization: "Bearer not-the-token" })
    );
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.deepStrictEqual(body, { ok: false, error: "unauthorized" });
    assert.strictEqual(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
