// tests/webhook-usage.test.mjs
//
// Integration tests for api/line-webhook.js POST — the "usage" trigger path
// (text keywords, postbacks, upstream failure, unconfigured snapshot URL) and
// the signature gate. Node's built-in test runner; zero dependencies.
//
// Run: cd /workspace/tongjai-renovate && node --test tests/webhook-usage.test.mjs

import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

// ---- env MUST be set before the module under test is imported ---------------
process.env.LINE_CHANNEL_SECRET = "shh";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok";
process.env.USAGE_SNAPSHOT_URL = "https://usage.example.test/snap";

// ---- fetch stub --------------------------------------------------------------
// Intercepts every upstream host the webhook touches:
//   usage.example.test  → controllable snapshot endpoint (default: valid payload)
//   api.line.me /reply  → captured; returns 200 {}
//   api.line.me /push   → captured; returns 200 {} (fallback path — should stay quiet)
const VALID_SNAPSHOT = {
  session: { pct: 10 },
  weekly: { pct: 20 },
  weekly_sonnet: { pct: 5 },
  estimated: true,
  synced_at: "2026-07-10T00:00:00Z",
};

const state = {
  usageStatus: 200, // set to 500 to simulate upstream failure
  replyCalls: [], // { url, authorization, body }
  pushCalls: [],
};

globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.startsWith("https://usage.example.test/")) {
    if (state.usageStatus !== 200) {
      return new Response("upstream error", { status: state.usageStatus });
    }
    return new Response(JSON.stringify(VALID_SNAPSHOT), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (u === "https://api.line.me/v2/bot/message/reply") {
    state.replyCalls.push({
      url: u,
      authorization: options.headers && options.headers.Authorization,
      body: JSON.parse(options.body),
    });
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (u === "https://api.line.me/v2/bot/message/push") {
    state.pushCalls.push({ url: u, body: JSON.parse(options.body) });
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error("unexpected fetch in test: " + u);
};

// Import AFTER env + fetch stub are in place.
const webhook = await import(new URL("../api/line-webhook.js", import.meta.url));

// ---- helpers -----------------------------------------------------------------
function sign(rawBody) {
  return crypto
    .createHmac("sha256", "shh")
    .update(rawBody, "utf8")
    .digest("base64");
}

// The webhook's in-memory dedupe set persists across this single import —
// every event needs a fresh webhookEventId.
let eventCounter = 0;
function makeEvent(overrides) {
  eventCounter += 1;
  return {
    type: "message",
    mode: "active",
    timestamp: Date.now(),
    webhookEventId: "evt-usage-test-" + eventCounter,
    deliveryContext: { isRedelivery: false },
    source: { type: "user", userId: "Utest" + eventCounter },
    replyToken: "rt-" + eventCounter,
    ...overrides,
  };
}

function textEvent(text) {
  return makeEvent({ message: { type: "text", id: "m" + eventCounter, text } });
}

function postbackEvent(data) {
  return makeEvent({ type: "postback", message: undefined, postback: { data } });
}

function signedRequest(rawBody, signature) {
  return new Request("https://bot.example.test/api/line-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-line-signature": signature === undefined ? sign(rawBody) : signature,
    },
    body: rawBody,
    duplex: "half",
  });
}

/** POST one event through the given module; return { res, reply } where
 *  reply is the single new reply call captured during this request (or null). */
async function postEvent(mod, event, { signature } = {}) {
  const rawBody = JSON.stringify({ destination: "Udest", events: [event] });
  const before = state.replyCalls.length;
  const res = await mod.POST(signedRequest(rawBody, signature));
  const newCalls = state.replyCalls.slice(before);
  return { res, reply: newCalls.length ? newCalls[newCalls.length - 1] : null, newCalls };
}

// ---- tests -------------------------------------------------------------------

test('text "usage" → 200 + usage Flex card reply', async () => {
  const event = textEvent("usage");
  const { res, reply, newCalls } = await postEvent(webhook, event);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(newCalls.length, 1, "exactly one reply call");
  assert.strictEqual(reply.authorization, "Bearer tok");
  assert.strictEqual(reply.body.replyToken, event.replyToken);

  const msg = reply.body.messages[0];
  assert.strictEqual(msg.type, "flex");
  assert.ok(
    msg.altText.startsWith("Usage —"),
    `altText should start with 'Usage —', got: ${msg.altText}`
  );
});

test('text "เช็ค" (Thai keyword) → usage Flex card reply', async () => {
  const { res, reply } = await postEvent(webhook, textEvent("เช็ค"));

  assert.strictEqual(res.status, 200);
  assert.ok(reply, "reply endpoint was called");
  const msg = reply.body.messages[0];
  assert.strictEqual(msg.type, "flex");
  assert.ok(msg.altText.startsWith("Usage —"));
});

test('text "สวัสดี" (non-keyword) → slip nudge text that also mentions usage', async () => {
  const { res, reply } = await postEvent(webhook, textEvent("สวัสดี"));

  assert.strictEqual(res.status, 200);
  assert.ok(reply, "reply endpoint was called");
  const msg = reply.body.messages[0];
  assert.strictEqual(msg.type, "text");
  assert.ok(msg.text.includes("ส่งรูปสลิป"), "nudge mentions sending a slip");
  assert.ok(msg.text.includes("usage"), "nudge advertises the usage keyword");
});

test('postback data "usage" → usage Flex card reply', async () => {
  const { res, reply } = await postEvent(webhook, postbackEvent("usage"));

  assert.strictEqual(res.status, 200);
  assert.ok(reply, "reply endpoint was called");
  const msg = reply.body.messages[0];
  assert.strictEqual(msg.type, "flex");
  assert.ok(msg.altText.startsWith("Usage —"));
});

test('postback data "s=1&t=p&a=100" → category card, NOT the usage flex', async () => {
  const { res, reply } = await postEvent(webhook, postbackEvent("s=1&t=p&a=100"));

  assert.strictEqual(res.status, 200);
  assert.ok(reply, "reply endpoint was called");
  const msg = reply.body.messages[0];
  assert.strictEqual(msg.type, "flex");
  assert.strictEqual(msg.altText, "เลือกประเภทค่าจ่าย");
  assert.ok(!msg.altText.startsWith("Usage"), "must not be the usage card");
});

test("usage upstream 500 → graceful Thai TEXT reply", async (t) => {
  state.usageStatus = 500;
  t.after(() => {
    state.usageStatus = 200;
  });

  const { res, reply } = await postEvent(webhook, textEvent("usage"));

  assert.strictEqual(res.status, 200);
  assert.ok(reply, "reply endpoint was called");
  const msg = reply.body.messages[0];
  assert.strictEqual(msg.type, "text", "failure path must be a text message, not flex");
  assert.ok(
    msg.text.includes("ดึงข้อมูล usage ไม่สำเร็จ"),
    `expected the Thai failure copy, got: ${msg.text}`
  );
});

test("USAGE_SNAPSHOT_URL unset (fresh import) → reply names the missing env var", async (t) => {
  delete process.env.USAGE_SNAPSHOT_URL;
  t.after(() => {
    process.env.USAGE_SNAPSHOT_URL = "https://usage.example.test/snap";
  });

  // Fresh module instance (query-string cache-bust) so nothing captured at the
  // first import can leak in; env is re-read on this request.
  const freshWebhook = await import(
    new URL("../api/line-webhook.js?fresh-no-usage-url", import.meta.url)
  );

  const { res, reply } = await postEvent(freshWebhook, textEvent("usage"));

  assert.strictEqual(res.status, 200);
  assert.ok(reply, "reply endpoint was called");
  const msg = reply.body.messages[0];
  assert.strictEqual(msg.type, "text");
  assert.ok(
    msg.text.includes("USAGE_SNAPSHOT_URL"),
    `not-configured reply should mention USAGE_SNAPSHOT_URL, got: ${msg.text}`
  );
});

test("bad signature → 401 and no LINE API call at all", async () => {
  const repliesBefore = state.replyCalls.length;
  const pushesBefore = state.pushCalls.length;

  const { res } = await postEvent(webhook, textEvent("usage"), {
    signature: "definitely-not-a-valid-signature",
  });

  assert.strictEqual(res.status, 401);
  assert.strictEqual(state.replyCalls.length, repliesBefore, "no reply call");
  assert.strictEqual(state.pushCalls.length, pushesBefore, "no push call");
});
