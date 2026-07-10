// tests/parse-slip.test.mjs
//
// Tests for POST /api/parse-slip (api/parse-slip.js).
// Groq is stubbed via globalThis.fetch; no network, no npm deps.
//
// Run: cd /workspace/tongjai-renovate && node --test tests/parse-slip.test.mjs

import test from "node:test";
import assert from "node:assert";

const TOKEN = "test-dashboard-token";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// --- env BEFORE importing the module under test -----------------------------
process.env.DASHBOARD_TOKEN = TOKEN;
process.env.GROQ_API_KEY = "gsk_test_key";
delete process.env.PARSE_MODEL;
delete process.env.DASHBOARD_ORIGIN;

// --- fetch stub --------------------------------------------------------------
// Installed once; each test resets `calls` and sets `handler`.
const realFetch = globalThis.fetch;
let calls = [];
let handler = () => {
  throw new Error("unexpected fetch call — test did not configure a handler");
};
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts });
  return handler(String(url), opts);
};
test.after(() => {
  globalThis.fetch = realFetch;
});

function resetStub(fn) {
  calls = [];
  handler =
    fn ||
    (() => {
      throw new Error("unexpected fetch call");
    });
}

function groqOk(fields) {
  const content = JSON.stringify({
    amount: 1250.5,
    currency: "THB",
    merchant: "ร้านวัสดุก่อสร้างทองใจ",
    date: "2026-07-10",
    ref: "REF123456",
    rawText: "โอนเงินสำเร็จ 1,250.50 บาท",
    ...fields,
  });
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

// --- request helpers ----------------------------------------------------------
const URL_ = "https://example.test/api/parse-slip";

function makeRequest({ token = TOKEN, tokenHeader = "bearer", contentType = "image/png", body } = {}) {
  const headers = {};
  if (token !== null) {
    if (tokenHeader === "bearer") headers.authorization = `Bearer ${token}`;
    else headers["x-dashboard-token"] = token;
  }
  if (contentType !== null) headers["content-type"] = contentType;
  const init = { method: "POST", headers };
  if (body !== undefined) {
    init.body = body;
    init.duplex = "half"; // required by Node when a Request has a body
  }
  return new Request(URL_, init);
}

const IMAGE_BYTES = Buffer.from("fake-png-bytes-for-slip-one");
const OTHER_BYTES = Buffer.from("different-image-bytes-slip-two");

// --- module under test --------------------------------------------------------
const { POST, OPTIONS } = await import("../api/parse-slip.js");

// -------------------------------------------------------------------------------
// Auth
// -------------------------------------------------------------------------------

test("DASHBOARD_TOKEN unset → 503 (fails closed), Groq never called", async () => {
  resetStub();
  const saved = process.env.DASHBOARD_TOKEN;
  delete process.env.DASHBOARD_TOKEN;
  try {
    const res = await POST(makeRequest({ body: IMAGE_BYTES }));
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.strictEqual(calls.length, 0, "Groq must not be called when auth is unconfigured");
  } finally {
    process.env.DASHBOARD_TOKEN = saved;
  }
});

test("wrong Bearer token → 401, Groq never called", async () => {
  resetStub();
  const res = await POST(makeRequest({ token: "wrong-token", body: IMAGE_BYTES }));
  assert.strictEqual(res.status, 401);
  const body = await res.json();
  assert.deepStrictEqual(body, { ok: false, error: "unauthorized" });
  assert.strictEqual(calls.length, 0);
});

test("missing token entirely → 401", async () => {
  resetStub();
  const res = await POST(makeRequest({ token: null, body: IMAGE_BYTES }));
  assert.strictEqual(res.status, 401);
});

test("x-dashboard-token header is accepted (200 happy path)", async () => {
  resetStub(() => groqOk());
  const res = await POST(makeRequest({ tokenHeader: "x", body: IMAGE_BYTES }));
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
});

// -------------------------------------------------------------------------------
// Body validation
// -------------------------------------------------------------------------------

test("content-type text/plain → 415, Groq never called", async () => {
  resetStub();
  const res = await POST(makeRequest({ contentType: "text/plain", body: IMAGE_BYTES }));
  assert.strictEqual(res.status, 415);
  const body = await res.json();
  assert.strictEqual(body.ok, false);
  assert.strictEqual(calls.length, 0);
});

test("empty body → 400", async () => {
  resetStub();
  const res = await POST(makeRequest({})); // no body at all
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.strictEqual(body.ok, false);
  assert.strictEqual(calls.length, 0);
});

test("body > 3MB → 413 WITHOUT calling Groq", async () => {
  resetStub();
  const big = Buffer.alloc(3 * 1024 * 1024 + 1);
  const res = await POST(makeRequest({ body: big }));
  assert.strictEqual(res.status, 413);
  const body = await res.json();
  assert.strictEqual(body.ok, false);
  assert.strictEqual(calls.length, 0, "oversize body must be rejected before OCR");
});

// -------------------------------------------------------------------------------
// Groq happy path
// -------------------------------------------------------------------------------

test("Groq 200 → 200 {ok, slipId 10-hex, data} with NO rawText", async () => {
  resetStub(() => groqOk());
  const res = await POST(makeRequest({ body: IMAGE_BYTES }));
  assert.strictEqual(res.status, 200);
  const body = await res.json();

  assert.strictEqual(body.ok, true);
  assert.match(body.slipId, /^[0-9a-f]{10}$/, "slipId must be 10 lowercase hex chars");
  assert.deepStrictEqual(body.data, {
    amount: 1250.5,
    currency: "THB",
    merchant: "ร้านวัสดุก่อสร้างทองใจ",
    date: "2026-07-10",
    ref: "REF123456",
  });
  assert.strictEqual("rawText" in body.data, false, "rawText must never reach the browser");

  // The intercepted upstream call really was the Groq OCR request.
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, GROQ_URL);
  assert.strictEqual(calls[0].opts.method, "POST");
  assert.strictEqual(calls[0].opts.headers.authorization, "Bearer gsk_test_key");
  const sent = JSON.parse(calls[0].opts.body);
  assert.deepStrictEqual(sent.response_format, { type: "json_object" });
  assert.strictEqual(sent.model, "meta-llama/llama-4-scout-17b-16e-instruct");
});

test("same bytes → same slipId (content-derived, deterministic)", async () => {
  resetStub(() => groqOk());
  const res1 = await POST(makeRequest({ body: Buffer.from(IMAGE_BYTES) }));
  const body1 = await res1.json();
  resetStub(() => groqOk());
  const res2 = await POST(makeRequest({ body: Buffer.from(IMAGE_BYTES) }));
  const body2 = await res2.json();
  assert.strictEqual(res1.status, 200);
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(body1.slipId, body2.slipId);
});

test("different bytes → different slipId", async () => {
  resetStub(() => groqOk());
  const res1 = await POST(makeRequest({ body: IMAGE_BYTES }));
  const body1 = await res1.json();
  resetStub(() => groqOk());
  const res2 = await POST(makeRequest({ body: OTHER_BYTES }));
  const body2 = await res2.json();
  assert.match(body1.slipId, /^[0-9a-f]{10}$/);
  assert.match(body2.slipId, /^[0-9a-f]{10}$/);
  assert.notStrictEqual(body1.slipId, body2.slipId);
});

// -------------------------------------------------------------------------------
// Groq failure modes → 422 {ok:false, error:"ocr failed"}
// -------------------------------------------------------------------------------

test("Groq 500 → 422 ocr failed", async () => {
  resetStub(() => new Response("internal error", { status: 500 }));
  const res = await POST(makeRequest({ body: IMAGE_BYTES }));
  assert.strictEqual(res.status, 422);
  const body = await res.json();
  assert.deepStrictEqual(body, { ok: false, error: "ocr failed" });
});

test("fetch throws (network error) → 422 ocr failed", async () => {
  resetStub(() => {
    throw new TypeError("fetch failed");
  });
  const res = await POST(makeRequest({ body: IMAGE_BYTES }));
  assert.strictEqual(res.status, 422);
  const body = await res.json();
  assert.deepStrictEqual(body, { ok: false, error: "ocr failed" });
});

test("Groq 200 with unparseable content → 422 ocr failed", async () => {
  resetStub(
    () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "sorry, I cannot read this slip" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
  const res = await POST(makeRequest({ body: IMAGE_BYTES }));
  assert.strictEqual(res.status, 422);
  const body = await res.json();
  assert.deepStrictEqual(body, { ok: false, error: "ocr failed" });
});

// -------------------------------------------------------------------------------
// CORS preflight
// -------------------------------------------------------------------------------

test("OPTIONS → 204 with allowed methods", async () => {
  resetStub();
  const res = await OPTIONS();
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.strictEqual(calls.length, 0);
});

// -------------------------------------------------------------------------------
// Server misconfiguration (missing Groq key) — must be 503, never a user-blaming 422
// -------------------------------------------------------------------------------

test("GROQ_API_KEY unset → 503 'ocr not configured', Groq never called", async () => {
  resetStub();
  const saved = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    const res = await POST(makeRequest({ body: IMAGE_BYTES }));
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.deepStrictEqual(body, { ok: false, error: "ocr not configured" });
    assert.strictEqual(calls.length, 0);
  } finally {
    process.env.GROQ_API_KEY = saved;
  }
});
