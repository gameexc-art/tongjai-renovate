// api/usage.js
//
// GET /api/usage — Claude Code usage snapshot for the web chat (Screen B).
//
// A same-origin proxy over USAGE_SNAPSHOT_URL (the apartment-dashboard
// deployment's GET /api/usage/snapshot). The browser can't call that origin
// directly (CORS), and proxying keeps the source URL out of the page. The
// upstream endpoint is public JSON of usage *percentages* (no tokens, no PII),
// so this proxy is public too; it only ever fetches the one configured URL —
// it is not an open proxy.
//
//   503 { ok:false, error:"usage source not configured" }  USAGE_SNAPSHOT_URL unset
//   502 { ok:false, error:"usage source unavailable" }     upstream failed/invalid
//   200 { ok:true,  usage:{ session, weekly, weekly_sonnet?, estimated?, note?, synced_at? } }

import { fetchUsageSnapshot } from "./_lib/usage.js";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET() {
  const env = process.env;
  if (!env.USAGE_SNAPSHOT_URL) {
    return json(503, { ok: false, error: "usage source not configured" });
  }
  const snap = await fetchUsageSnapshot(env);
  if (!snap.ok) {
    return json(502, { ok: false, error: "usage source unavailable" });
  }
  return json(200, { ok: true, usage: snap.payload });
}
