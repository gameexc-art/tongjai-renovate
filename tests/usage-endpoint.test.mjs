// tests/usage-endpoint.test.mjs
//
// Tests for GET /api/usage (api/usage.js) — the same-origin proxy over
// USAGE_SNAPSHOT_URL.
//
//   - USAGE_SNAPSHOT_URL unset  -> 503 { ok:false, error:"usage source not configured" }
//   - upstream 200 valid        -> 200 { ok:true, usage:{...} } passthrough (incl synced_at)
//   - upstream 500              -> 502 { ok:false, error:"usage source unavailable" }
//   - upstream network throw    -> 502
//   - upstream 200 invalid body -> 502

import test from "node:test";
import assert from "node:assert";

const SNAPSHOT_URL = "https://apartment-dashboard.example.test/api/usage/snapshot";

// Env must be shaped before the module under test is imported.
delete process.env.USAGE_SNAPSHOT_URL;

const { GET } = await import("../api/usage.js");

const realFetch = globalThis.fetch;

/** Install a fetch stub that records calls and returns/throws per `impl`. */
function stubFetch(impl) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    return impl(url, opts);
  };
  return calls;
}

function restore() {
  globalThis.fetch = realFetch;
  delete process.env.USAGE_SNAPSHOT_URL;
}

test("GET /api/usage -> 503 when USAGE_SNAPSHOT_URL is unset (and never fetches)", async (t) => {
  t.after(restore);
  delete process.env.USAGE_SNAPSHOT_URL;
  const calls = stubFetch(() => {
    throw new Error("must not fetch when not configured");
  });

  const res = await GET();
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-type"), /application\/json/);
  const body = await res.json();
  assert.deepStrictEqual(body, { ok: false, error: "usage source not configured" });
  assert.strictEqual(calls.length, 0);
});

test("GET /api/usage -> 200 passthrough of a valid snapshot (incl synced_at)", async (t) => {
  t.after(restore);
  process.env.USAGE_SNAPSHOT_URL = SNAPSHOT_URL;

  const snapshot = {
    session: { pct: 42, resets_in_seconds: 1200 },
    weekly: { pct: 81, resets_at: "2026-07-12T00:00:00Z" },
    weekly_sonnet: { pct: 10 },
    estimated: false,
    note: "live · Claude usage API",
    synced_at: "2026-07-10T09:30:00Z",
  };
  const calls = stubFetch(() =>
    new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );

  const res = await GET();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(body.usage, snapshot);
  assert.strictEqual(body.usage.synced_at, "2026-07-10T09:30:00Z");

  // The proxy fetched exactly the configured URL, asking for JSON,
  // with an abort signal (timeout-bounded).
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, SNAPSHOT_URL);
  assert.strictEqual(calls[0].opts.headers.accept, "application/json");
  assert.ok(calls[0].opts.signal instanceof AbortSignal);
});

test("GET /api/usage -> 502 when upstream returns 500", async (t) => {
  t.after(restore);
  process.env.USAGE_SNAPSHOT_URL = SNAPSHOT_URL;
  stubFetch(() => new Response("boom", { status: 500 }));

  const res = await GET();
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.deepStrictEqual(body, { ok: false, error: "usage source unavailable" });
});

test("GET /api/usage -> 502 when upstream fetch throws (network error)", async (t) => {
  t.after(restore);
  process.env.USAGE_SNAPSHOT_URL = SNAPSHOT_URL;
  stubFetch(() => {
    throw new TypeError("fetch failed");
  });

  const res = await GET();
  assert.strictEqual(res.status, 502);
  const body = await res.json();
  assert.deepStrictEqual(body, { ok: false, error: "usage source unavailable" });
});

test("GET /api/usage -> 502 when upstream 200 body is invalid (missing session)", async (t) => {
  t.after(restore);
  process.env.USAGE_SNAPSHOT_URL = SNAPSHOT_URL;
  stubFetch(() =>
    new Response(JSON.stringify({ weekly: { pct: 5 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );

  const res = await GET();
  assert.strictEqual(res.status, 502);
  const body = await res.json();
  assert.deepStrictEqual(body, { ok: false, error: "usage source unavailable" });
});
