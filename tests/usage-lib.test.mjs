// tests/usage-lib.test.mjs — unit tests for api/_lib/usage.js
import test from "node:test";
import assert from "node:assert";

// No env needed at import time (the module takes env as a parameter),
// but keep the env-before-import discipline anyway.
const usage = await import("../api/_lib/usage.js");
const {
  usageKeywords,
  isUsageTriggerText,
  isUsageTriggerPostback,
  humanizeSeconds,
  resetsInSeconds,
  barColor,
  buildUsageFlex,
  fetchUsageSnapshot,
} = usage;

// ---- usageKeywords ----------------------------------------------------------

test("usageKeywords: default set", () => {
  assert.deepStrictEqual(usageKeywords({}), [
    "usage",
    "เช็ค",
    "/status",
    "status",
    "ยอดใช้",
  ]);
});

test("usageKeywords: env override (trimmed, lowercased, empties dropped)", () => {
  assert.deepStrictEqual(
    usageKeywords({ USAGE_KEYWORDS: "Foo, BAR ,,  baz  " }),
    ["foo", "bar", "baz"]
  );
});

// ---- isUsageTriggerText -----------------------------------------------------

test("isUsageTriggerText: trigger words match", () => {
  const env = {};
  for (const text of ["usage", "USAGE  ", "เช็ค", "status", "/status", "ยอดใช้"]) {
    assert.strictEqual(isUsageTriggerText(text, env), true, `expected trigger: ${JSON.stringify(text)}`);
  }
});

test("isUsageTriggerText: non-triggers do not match", () => {
  const env = {};
  for (const text of ["help", "", null, "usagex"]) {
    assert.strictEqual(isUsageTriggerText(text, env), false, `expected non-trigger: ${JSON.stringify(text)}`);
  }
});

// ---- isUsageTriggerPostback -------------------------------------------------

test("isUsageTriggerPostback: usage postbacks match", () => {
  const env = {};
  for (const data of ["usage", "action=usage&x=1", "เช็ค"]) {
    assert.strictEqual(isUsageTriggerPostback(data, env), true, `expected trigger: ${JSON.stringify(data)}`);
  }
});

test("isUsageTriggerPostback: unrelated postback data does not match", () => {
  assert.strictEqual(isUsageTriggerPostback("s=2&a=100", {}), false);
});

// ---- humanizeSeconds --------------------------------------------------------

test("humanizeSeconds", () => {
  assert.strictEqual(humanizeSeconds(null), "—"); // em dash —
  assert.strictEqual(humanizeSeconds(0), "now");
  assert.strictEqual(humanizeSeconds(-5), "now");
  assert.strictEqual(humanizeSeconds(59), "0m");
  assert.strictEqual(humanizeSeconds(3700), "1h 1m");
  assert.strictEqual(humanizeSeconds(90000), "1d 1h");
});

// ---- resetsInSeconds --------------------------------------------------------

test("resetsInSeconds: recomputes from future resets_at (±5s)", () => {
  const horizon = 3600; // 1h out
  const w = { resets_at: new Date(Date.now() + horizon * 1000).toISOString() };
  const got = resetsInSeconds(w);
  assert.ok(typeof got === "number", `expected a number, got ${got}`);
  assert.ok(Math.abs(got - horizon) <= 5, `expected ~${horizon}s, got ${got}`);
});

test("resetsInSeconds: falls back to resets_in_seconds", () => {
  assert.strictEqual(resetsInSeconds({ resets_in_seconds: 123 }), 123);
});

test("resetsInSeconds: empty object → null", () => {
  assert.strictEqual(resetsInSeconds({}), null);
});

// ---- barColor ---------------------------------------------------------------

test("barColor thresholds", () => {
  assert.strictEqual(barColor(50), "#3B82F6");
  assert.strictEqual(barColor(80), "#F59E0B");
  assert.strictEqual(barColor(94.9), "#F59E0B");
  assert.strictEqual(barColor(95), "#EF4444");
});

// ---- buildUsageFlex ---------------------------------------------------------

test("buildUsageFlex: altText carries session/weekly/sonnet percentages", () => {
  const msg = buildUsageFlex({
    session: { pct: 42 },
    weekly: { pct: 63 },
    weekly_sonnet: { pct: 12 },
  });
  assert.strictEqual(msg.type, "flex");
  assert.strictEqual(msg.altText, "Usage — session 42% / weekly 63% / sonnet 12%");
});

test("buildUsageFlex: body has 5 top-level contents", () => {
  const msg = buildUsageFlex({ session: { pct: 1 }, weekly: { pct: 2 } });
  assert.strictEqual(msg.contents.body.contents.length, 5);
});

test("buildUsageFlex: estimated by default → '● estimate' badge", () => {
  const msg = buildUsageFlex({ session: {}, weekly: {} });
  const header = msg.contents.body.contents[0];
  assert.strictEqual(header.contents[1].text, "● estimate");
});

test("buildUsageFlex: estimated:false → '● live' badge", () => {
  const msg = buildUsageFlex({ session: {}, weekly: {}, estimated: false });
  const header = msg.contents.body.contents[0];
  assert.strictEqual(header.contents[1].text, "● live");
});

test("buildUsageFlex: pct > 100 clamps to 100 in altText", () => {
  const msg = buildUsageFlex({
    session: { pct: 150 },
    weekly: { pct: 101.7 },
    weekly_sonnet: { pct: 12 },
  });
  assert.strictEqual(msg.altText, "Usage — session 100% / weekly 100% / sonnet 12%");
});

test("buildUsageFlex: missing weekly_sonnet does not throw", () => {
  let msg;
  assert.doesNotThrow(() => {
    msg = buildUsageFlex({ session: { pct: 10 }, weekly: { pct: 20 } });
  });
  assert.strictEqual(msg.altText, "Usage — session 10% / weekly 20% / sonnet 0%");
});

// ---- fetchUsageSnapshot (stubbed fetch) --------------------------------------

const SNAP_URL = "https://apartment-dashboard.example.test/api/usage/snapshot";

/** Install a fetch stub for the duration of one test; records calls. */
function stubFetch(t, impl) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return impl(url, opts);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("fetchUsageSnapshot: no URL configured → ok:false (fetch never called)", async (t) => {
  const calls = stubFetch(t, () => jsonResponse({ session: {}, weekly: {} }));
  const res = await fetchUsageSnapshot({});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(calls.length, 0);
});

test("fetchUsageSnapshot: 200 with valid payload → ok:true, payload passthrough", async (t) => {
  const payload = {
    session: { pct: 42, resets_in_seconds: 60 },
    weekly: { pct: 63 },
    weekly_sonnet: { pct: 12 },
    estimated: false,
    note: "live · Claude usage API",
  };
  const calls = stubFetch(t, () => jsonResponse(payload));
  const res = await fetchUsageSnapshot({ USAGE_SNAPSHOT_URL: SNAP_URL });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.payload, payload);
  // The stub must have been hit with the configured URL.
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(String(calls[0].url), SNAP_URL);
});

test("fetchUsageSnapshot: 200 but missing weekly → ok:false", async (t) => {
  stubFetch(t, () => jsonResponse({ session: { pct: 1 } }));
  const res = await fetchUsageSnapshot({ USAGE_SNAPSHOT_URL: SNAP_URL });
  assert.strictEqual(res.ok, false);
});

test("fetchUsageSnapshot: upstream 500 → ok:false", async (t) => {
  stubFetch(t, () => jsonResponse({ session: {}, weekly: {} }, 500));
  const res = await fetchUsageSnapshot({ USAGE_SNAPSHOT_URL: SNAP_URL });
  assert.strictEqual(res.ok, false);
});

test("fetchUsageSnapshot: fetch throws → ok:false", async (t) => {
  stubFetch(t, () => {
    throw new TypeError("network down");
  });
  const res = await fetchUsageSnapshot({ USAGE_SNAPSHOT_URL: SNAP_URL });
  assert.strictEqual(res.ok, false);
});

test("buildUsageFlex: malformed synced_at never throws (never-throws contract)", () => {
  for (const bad of ["not-a-date", "None", "10/07/2569 14:00", { nested: 1 }, "1752130000"]) {
    let msg;
    assert.doesNotThrow(() => {
      msg = buildUsageFlex({ session: { pct: 10 }, weekly: { pct: 20 }, synced_at: bad });
    }, `synced_at=${JSON.stringify(bad)} threw`);
    assert.strictEqual(msg.type, "flex");
  }
  // a VALID synced_at still renders the ISO-style stamp
  const ok = buildUsageFlex({ session: {}, weekly: {}, synced_at: "2026-07-10T12:00:00Z" });
  const footer = JSON.stringify(ok.contents.body.contents[4]);
  assert.ok(footer.includes("Synced 2026-07-10 12:00:00"), footer);
});
