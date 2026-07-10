// tests/record.test.mjs
//
// Tests for POST /api/record (api/record.js) against the KV (Upstash REST)
// storage backend. All network I/O is intercepted by stubbing globalThis.fetch
// for the KV host; any other outbound fetch fails the test loudly.

import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

const TOKEN = "test-dash-token";
const KV_URL = "https://kv.example.test";

// Env must be in place BEFORE the module under test is imported.
process.env.DASHBOARD_TOKEN = TOKEN;
process.env.KV_REST_API_URL = KV_URL;
process.env.KV_REST_API_TOKEN = "kvtok";
delete process.env.BLOB_READ_WRITE_TOKEN; // force the KV backend

// ---------------------------------------------------------------------------
// fetch stub — routes Upstash REST commands (["SET",...], ["LPUSH",...], ...)
// ---------------------------------------------------------------------------

const kvCalls = []; // { command, headers } per intercepted KV request

function defaultKvRoute(command) {
  switch (command[0]) {
    case "SET":
      return { status: 200, body: { result: "OK" } };
    case "LPUSH":
      return { status: 200, body: { result: 1 } };
    case "LTRIM":
      return { status: 200, body: { result: "OK" } };
    case "DEL":
      return { status: 200, body: { result: 1 } };
    default:
      throw new Error("unexpected KV command: " + command[0]);
  }
}

let kvRoute = defaultKvRoute;

globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.startsWith(KV_URL)) {
    const command = JSON.parse(options.body);
    kvCalls.push({ command, headers: options.headers || {} });
    const { status, body } = kvRoute(command);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error("unexpected outbound fetch in test: " + u);
};

const { POST } = await import("../api/record.js");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeRequest(body, { token = TOKEN, raw } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  return new Request("https://app.example.test/api/record", {
    method: "POST",
    headers,
    body: raw !== undefined ? raw : JSON.stringify(body),
    duplex: "half",
  });
}

function validBody(extra = {}) {
  return {
    amount: 123.45,
    date: "2026-07-01",
    merchant: "ร้านวัสดุ",
    ref: "REF001",
    entity: "person",
    category: "expense",
    ...extra,
  };
}

function commandsSent() {
  return kvCalls.map((c) => c.command[0]);
}

function resetKv() {
  kvCalls.length = 0;
  kvRoute = defaultKvRoute;
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

test("auth: DASHBOARD_TOKEN unset -> 503 (fails closed)", async () => {
  resetKv();
  const saved = process.env.DASHBOARD_TOKEN;
  delete process.env.DASHBOARD_TOKEN;
  try {
    const res = await POST(makeRequest(validBody(), { token: "" }));
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.strictEqual(kvCalls.length, 0, "no storage call before auth");
  } finally {
    process.env.DASHBOARD_TOKEN = saved;
  }
});

test("auth: wrong token -> 401", async () => {
  resetKv();
  const res = await POST(makeRequest(validBody(), { token: "wrong-token" }));
  assert.strictEqual(res.status, 401);
  const body = await res.json();
  assert.deepStrictEqual(body, { ok: false, error: "unauthorized" });
  assert.strictEqual(kvCalls.length, 0, "no storage call before auth");
});

// ---------------------------------------------------------------------------
// validation 400s
// ---------------------------------------------------------------------------

test("400: malformed JSON body", async () => {
  resetKv();
  const res = await POST(makeRequest(null, { raw: "{not valid json" }));
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.strictEqual(body.ok, false);
  assert.strictEqual(kvCalls.length, 0);
});

test("400: entity 'alien' rejected", async () => {
  resetKv();
  const res = await POST(makeRequest(validBody({ entity: "alien" })));
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).ok, false);
  assert.strictEqual(kvCalls.length, 0);
});

test("400: category 'food' rejected", async () => {
  resetKv();
  const res = await POST(makeRequest(validBody({ category: "food" })));
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).ok, false);
  assert.strictEqual(kvCalls.length, 0);
});

test("400: amount 'abc' rejected", async () => {
  resetKv();
  const res = await POST(makeRequest(validBody({ amount: "abc" })));
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).ok, false);
  assert.strictEqual(kvCalls.length, 0);
});

test("400: amount -5 rejected", async () => {
  resetKv();
  const res = await POST(makeRequest(validBody({ amount: -5 })));
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).ok, false);
  assert.strictEqual(kvCalls.length, 0);
});

// ---------------------------------------------------------------------------
// storage not configured
// ---------------------------------------------------------------------------

test("503: storage not configured (only DASHBOARD_TOKEN set)", async () => {
  resetKv();
  const savedUrl = process.env.KV_REST_API_URL;
  const savedKvTok = process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    // Fresh module instance with only DASHBOARD_TOKEN in the environment.
    const { POST: freshPOST } = await import("../api/record.js?fresh=no-storage");
    const res = await freshPOST(makeRequest(validBody()));
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.deepStrictEqual(body, { ok: false, error: "storage not configured" });
    assert.strictEqual(kvCalls.length, 0);
  } finally {
    process.env.KV_REST_API_URL = savedUrl;
    process.env.KV_REST_API_TOKEN = savedKvTok;
  }
});

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

test("200: happy path persists the web-shaped record via LPUSH", async () => {
  resetKv();
  const merchant60 = "M".repeat(60);
  const ref60 = "R".repeat(60);
  const res = await POST(
    makeRequest(
      validBody({ merchant: merchant60, ref: ref60, slipId: "ab12cd34ef" })
    )
  );
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { ok: true });

  // SET NX (dedupe claim) -> LPUSH (write) -> LTRIM (bound the list)
  assert.deepStrictEqual(commandsSent(), ["SET", "LPUSH", "LTRIM"]);
  assert.strictEqual(
    kvCalls[1].headers.Authorization,
    "Bearer kvtok",
    "KV request carries the KV token"
  );

  const lpush = kvCalls[1].command;
  assert.strictEqual(lpush[1], "ledger:all");
  const persisted = JSON.parse(lpush[2]);

  assert.strictEqual(persisted.channel, "web");
  assert.strictEqual(persisted.lineUserId, "");
  assert.strictEqual(typeof persisted.dedupeKey, "string");
  assert.ok(persisted.dedupeKey.length > 0, "dedupeKey present");
  assert.ok(!("slipId" in persisted), "slipId is transport-only, never persisted");
  assert.strictEqual(persisted.merchant, "M".repeat(40), "merchant capped at 40");
  assert.strictEqual(persisted.ref, "R".repeat(40), "ref capped at 40");
  assert.strictEqual(persisted.date, "2026-07-01");
  assert.strictEqual(persisted.amount, 123.45);
  assert.strictEqual(persisted.currency, "THB");
  assert.strictEqual(persisted.entity, "person");
  assert.strictEqual(persisted.category, "expense");
});

test("200: non-YYYY-MM-DD date '01/07/2026' is dropped to ''", async () => {
  resetKv();
  const res = await POST(makeRequest(validBody({ date: "01/07/2026" })));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { ok: true });
  const lpush = kvCalls.find((c) => c.command[0] === "LPUSH");
  assert.ok(lpush, "record was persisted");
  const persisted = JSON.parse(lpush.command[2]);
  assert.strictEqual(persisted.date, "");
});

// ---------------------------------------------------------------------------
// duplicate
// ---------------------------------------------------------------------------

test("200 duplicate: SET NX returns null -> {ok:true,duplicate:true}, no LPUSH", async () => {
  resetKv();
  kvRoute = (command) => {
    if (command[0] === "SET") return { status: 200, body: { result: null } };
    return defaultKvRoute(command);
  };
  try {
    const res = await POST(makeRequest(validBody({ slipId: "ab12cd34ef" })));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true, duplicate: true });
    assert.deepStrictEqual(commandsSent(), ["SET"], "no LPUSH after a dedupe hit");
  } finally {
    kvRoute = defaultKvRoute;
  }
});

// ---------------------------------------------------------------------------
// backend failure
// ---------------------------------------------------------------------------

test("502: KV SET error -> {ok:false,error:'save failed'}", async () => {
  resetKv();
  kvRoute = (command) => {
    if (command[0] === "SET") return { status: 200, body: { error: "boom" } };
    return defaultKvRoute(command);
  };
  try {
    const res = await POST(makeRequest(validBody()));
    assert.strictEqual(res.status, 502);
    assert.deepStrictEqual(await res.json(), { ok: false, error: "save failed" });
    assert.ok(!commandsSent().includes("LPUSH"), "no write after a failed claim");
  } finally {
    kvRoute = defaultKvRoute;
  }
});

// ---------------------------------------------------------------------------
// invalid slipId is ignored
// ---------------------------------------------------------------------------

test("200: invalid slipId 'ZZZZ' ignored; dedupeKey computed from raw basis", async () => {
  resetKv();
  const res = await POST(makeRequest(validBody({ slipId: "ZZZZ" })));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { ok: true });

  const lpush = kvCalls.find((c) => c.command[0] === "LPUSH");
  assert.ok(lpush, "record was persisted");
  const persisted = JSON.parse(lpush.command[2]);
  assert.ok(!("slipId" in persisted));

  // With the bogus slipId dropped, the dedupe key must come from the raw
  // field basis: ["raw", lineUserId, amount, date, ref, entity, category].
  const rawBasis = ["raw", "", 123.45, "2026-07-01", "REF001", "person", "expense"];
  const expectedKey = crypto
    .createHash("sha256")
    .update(rawBasis.join("|"))
    .digest("hex")
    .slice(0, 32);
  assert.strictEqual(persisted.dedupeKey, expectedKey);
});
