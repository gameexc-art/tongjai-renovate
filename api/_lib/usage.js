// api/_lib/usage.js
//
// "พ่วง usage bot" — Claude Code usage inside the NONEAICE chatbot.
//
// The usage data lives in the apartment-dashboard deployment: a local sync
// agent (line-usage-bot/sync_to_vercel.py) uploads snapshots of the machine's
// Claude Code logs to that app, which re-serves the latest one at
// GET /api/usage/snapshot. This module fetches that snapshot (URL configured
// via USAGE_SNAPSHOT_URL) and renders the same dark Flex dashboard card the
// standalone usage bot sends — so one LINE OA (NONEAICE) answers both
// "ส่งสลิป" and "usage".
//
// Zero-cost guarantees are inherited: this never calls Claude/Anthropic (it
// reads a stored snapshot) and is only ever sent as a reply/push through the
// existing NONEAICE delivery path.
//
// The card mirrors apartment-dashboard/server/lineUsage.js (which mirrors
// line-usage-bot/flex.py) so all three surfaces look identical.

// Trigger keywords (comma-separated, case-insensitive). Override via env
// USAGE_KEYWORDS. "ยอดใช้" is a NONEAICE addition on top of the usage bot's set.
const DEFAULT_KEYWORDS = "usage,เช็ค,/status,status,ยอดใช้";

// Bar color thresholds (percent of limit) — same defaults as the usage bot.
const WARN_THRESHOLD = 80;
const CRIT_THRESHOLD = 95;

// Dark-dashboard theme (identical to lineUsage.js LINE_THEME).
const THEME = {
  bg: "#0F1419", card: "#1A2027", track: "#2A313A",
  text: "#E6EDF3", muted: "#8B949E",
  ok: "#3B82F6", warn: "#F59E0B", crit: "#EF4444",
};

const SNAPSHOT_TIMEOUT_MS = 5000;

/** Parse the trigger keyword list from env (with the NONEAICE default set). */
export function usageKeywords(env) {
  return String((env && env.USAGE_KEYWORDS) || DEFAULT_KEYWORDS)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True when a text message should get the usage card instead of the slip nudge. */
export function isUsageTriggerText(text, env) {
  return usageKeywords(env).includes(String(text || "").trim().toLowerCase());
}

/** True when a postback is a usage request (e.g. from a rich menu button). */
export function isUsageTriggerPostback(data, env) {
  const d = String(data || "").toLowerCase();
  if (d === "usage" || d.includes("action=usage")) return true;
  // Also honor a configured keyword as raw postback data.
  return usageKeywords(env).includes(d.trim());
}

/**
 * Fetch the latest usage snapshot from USAGE_SNAPSHOT_URL.
 * Returns { ok:true, payload } or { ok:false, error } — never throws.
 * A payload must carry `session` and `weekly` objects to count as valid.
 */
export async function fetchUsageSnapshot(env) {
  const url = env && env.USAGE_SNAPSHOT_URL;
  if (!url) return { ok: false, error: "not configured" };

  // One timer bounds the WHOLE round-trip (headers AND body): res.json() reads
  // the body under the same abort signal, so an upstream that returns 200
  // headers then stalls the stream can't hold the webhook open past the
  // reply-token window.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);
  let payload;
  try {
    let res;
    try {
      res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (!res.ok) return { ok: false, error: `upstream ${res.status}` };
    try {
      payload = await res.json();
    } catch {
      return { ok: false, error: "bad json" };
    }
  } finally {
    clearTimeout(timer);
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.session !== "object" ||
    payload.session === null ||
    typeof payload.weekly !== "object" ||
    payload.weekly === null
  ) {
    return { ok: false, error: "invalid snapshot" };
  }
  return { ok: true, payload };
}

/**
 * The LINE message for a usage request: the Flex card when the snapshot is
 * available, otherwise a graceful Thai text explaining what is missing.
 * Never throws.
 */
export async function buildUsageMessage(env) {
  if (!env || !env.USAGE_SNAPSHOT_URL) {
    return {
      type: "text",
      text:
        "ยังไม่ได้เชื่อมข้อมูล Claude usage ครับ 🙏\n" +
        "ตั้งค่า USAGE_SNAPSHOT_URL ใน Vercel ให้ชี้ไปที่ /api/usage/snapshot " +
        "ของ apartment-dashboard ก่อน แล้วลองใหม่อีกครั้งครับ",
    };
  }
  const snap = await fetchUsageSnapshot(env);
  if (!snap.ok) {
    return {
      type: "text",
      text: "ดึงข้อมูล usage ไม่สำเร็จ ลองใหม่อีกครั้งนะครับ 🙏",
    };
  }
  return buildUsageFlex(snap.payload);
}

// ---- card internals (ported 1:1 from server/lineUsage.js) -------------------

export function barColor(pct) {
  if (pct >= CRIT_THRESHOLD) return THEME.crit;
  if (pct >= WARN_THRESHOLD) return THEME.warn;
  return THEME.ok;
}

export function humanizeSeconds(sec) {
  if (sec == null) return "—";
  if (sec <= 0) return "now";
  let h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 24) { const d = Math.floor(h / 24); h %= 24; return `${d}d ${h}h`; }
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

// Recompute the reset countdown fresh from the absolute reset timestamp so the
// card isn't stale between syncs; fall back to the snapshot's seconds value.
export function resetsInSeconds(w) {
  if (w && w.resets_at) {
    const ms = new Date(w.resets_at).getTime() - Date.now();
    if (Number.isFinite(ms)) return Math.max(0, Math.round(ms / 1000));
  }
  return w && w.resets_in_seconds != null ? w.resets_in_seconds : null;
}

function progressBar(pct) {
  const fill = Math.max(0, Math.min(pct, 100));
  return {
    type: "box", layout: "horizontal",
    backgroundColor: THEME.track, cornerRadius: "6px", height: "12px",
    contents: [{
      type: "box", layout: "vertical", backgroundColor: barColor(pct),
      cornerRadius: "6px", width: `${Math.round(fill)}%`,
      contents: [{ type: "filler" }],
    }],
  };
}

function kvRow(label, value) {
  return {
    type: "box", layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "xs", color: THEME.muted, flex: 5 },
      { type: "text", text: value, size: "xs", color: THEME.text, align: "end", flex: 5 },
    ],
  };
}

function section(title, w, exact) {
  const pct = Number(w.pct) || 0;
  const rows = [
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: title, size: "sm", weight: "bold", color: THEME.text, flex: 7 },
      { type: "text", text: `${Math.min(pct, 100).toFixed(0)}% used`, size: "sm",
        weight: "bold", color: barColor(pct), align: "end", flex: 5 },
    ] },
    progressBar(pct),
    // Live API gives an exact reset clock; the local-estimate fallback marks it "~".
    kvRow(exact ? "Resets" : "Resets ~", humanizeSeconds(resetsInSeconds(w))),
  ];
  // Burn rate / ETA only exist in the local-token estimate — the live usage API
  // returns percentages only, so omit these rows rather than show 0.0%/hr and "—".
  if (w.burn_pct_per_hour != null) {
    rows.push(kvRow("Burn rate", `${(Number(w.burn_pct_per_hour) || 0).toFixed(1)}%/hr`));
  }
  if (w.eta_seconds != null) {
    rows.push(kvRow("ETA to limit", humanizeSeconds(w.eta_seconds)));
  }
  return {
    type: "box", layout: "vertical",
    backgroundColor: THEME.card, cornerRadius: "10px", paddingAll: "14px", spacing: "8px",
    contents: rows,
  };
}

/**
 * Build the Flex Message from a usage snapshot payload
 * ({ session, weekly, weekly_sonnet?, estimated?, note?, synced_at? }).
 */
export function buildUsageFlex(payload) {
  const estimated = payload.estimated !== false;
  const exact = !estimated;
  const note = payload.note || (estimated ? "estimated from local logs" : "live · Claude usage API");
  // synced_at passes snapshot validation unchecked, so guard the Date round-trip:
  // toISOString() throws RangeError on an unparseable value, which would break
  // buildUsageMessage's never-throws contract and silently drop the LINE reply.
  const syncedAt = payload.synced_at || payload.updated_at || "";
  let stamp = "";
  if (syncedAt) {
    const t = new Date(syncedAt);
    stamp = Number.isNaN(t.getTime())
      ? String(syncedAt).slice(0, 19)
      : t.toISOString().replace("T", " ").slice(0, 19);
  }
  const session = payload.session || {};
  const weekly = payload.weekly || {};
  const weeklySonnet = payload.weekly_sonnet || {};

  const bubble = {
    type: "bubble", size: "mega",
    body: {
      type: "box", layout: "vertical", backgroundColor: THEME.bg,
      paddingAll: "16px", spacing: "12px",
      contents: [
        { type: "box", layout: "horizontal", contents: [
          { type: "text", text: "Claude Code Usage", size: "lg", weight: "bold",
            color: THEME.text, flex: 8 },
          { type: "text", text: exact ? "● live" : "● estimate", size: "xs",
            color: exact ? THEME.ok : THEME.muted, align: "end", flex: 4 },
        ] },
        section("Current session (5h)", session, exact),
        section("Weekly (All models)", weekly, exact),
        section("Weekly (Sonnet only)", weeklySonnet, exact),
        { type: "box", layout: "vertical", contents: [
          { type: "text", text: `Synced ${stamp}`, size: "xxs", color: THEME.muted },
          { type: "text", text: note, size: "xxs", color: THEME.muted },
        ] },
      ],
    },
  };

  const s = Math.min(Number(session.pct) || 0, 100).toFixed(0);
  const w = Math.min(Number(weekly.pct) || 0, 100).toFixed(0);
  const sn = Math.min(Number(weeklySonnet.pct) || 0, 100).toFixed(0);
  return {
    type: "flex",
    altText: `Usage — session ${s}% / weekly ${w}% / sonnet ${sn}%`,
    contents: bubble,
  };
}
