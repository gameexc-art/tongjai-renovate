// api/_lib/line.js
//
// Thin, dependency-free helpers around the LINE Messaging API.
// All calls use the built-in global `fetch` (Node 18+ on Vercel) — no SDK.
//
// Endpoints used (verified against developers.line.biz, June 2026):
//   reply   POST https://api.line.me/v2/bot/message/reply
//   push    POST https://api.line.me/v2/bot/message/push
//   content GET  https://api-data.line.me/v2/bot/message/{id}/content   (NOTE: api-DATA host)
//
// Signature: x-line-signature = Base64( HMAC-SHA256( rawBody, channelSecret ) ).
// We verify over the EXACT raw bytes before any JSON.parse.
//
// Every network call is bounded by an AbortController timeout so a slow upstream
// can never hold the function open long enough to blow the (~1 min) reply-token
// window or hit the Vercel maxDuration.

import crypto from "node:crypto";

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const CONTENT_HOST = "https://api-data.line.me";

// Network budgets. LINE API calls are fast; keep them short so a hung upstream
// surfaces well inside the reply-token window. The content download is bounded
// too (images are small) and capped at MAX_CONTENT_BYTES.
const LINE_API_TIMEOUT_MS = 5000;
const CONTENT_TIMEOUT_MS = 10000;
const MAX_CONTENT_BYTES = 10 * 1024 * 1024; // 10 MB — matches the OCR cap.

/**
 * fetch() with a hard timeout via AbortController. Always clears the timer.
 * Throws on timeout (AbortError) or network error — callers decide how to handle.
 */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the x-line-signature header against the raw request body.
 * Constant-time compare; never throws (length-guarded), returns boolean.
 *
 * @param {string} rawBody  exact request body bytes as a string
 * @param {string|null} signature  value of the x-line-signature header
 * @param {string|undefined} channelSecret  LINE_CHANNEL_SECRET
 * @returns {boolean}
 */
export function verifySignature(rawBody, signature, channelSecret) {
  if (!channelSecret || !signature) return false;
  try {
    const expected = crypto
      .createHmac("sha256", channelSecret)
      .update(rawBody, "utf8")
      .digest("base64");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on length mismatch — guard explicitly.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Reply to a webhook event. Reply token is single-use and short-lived (~1 min).
 * Returns the LINE API HTTP status so the caller can fall back to push on failure.
 *
 * @param {string} replyToken
 * @param {object[]} messages  up to 5 LINE message objects
 * @param {string} token  LINE_CHANNEL_ACCESS_TOKEN
 * @returns {Promise<{ok:boolean, status:number}>}
 */
export async function reply(replyToken, messages, token) {
  return postJson(
    REPLY_URL,
    { replyToken, messages: messages.slice(0, 5) },
    token
  );
}

/**
 * Push messages to a user (fallback when the reply token may be expired/used,
 * e.g. on redelivery or after a slow OCR call).
 *
 * @param {string} to  userId from event.source.userId
 * @param {object[]} messages  up to 5 LINE message objects
 * @param {string} token  LINE_CHANNEL_ACCESS_TOKEN
 * @returns {Promise<{ok:boolean, status:number}>}
 */
export async function push(to, messages, token) {
  if (!to) return { ok: false, status: 0 };
  return postJson(PUSH_URL, { to, messages: messages.slice(0, 5) }, token);
}

/**
 * Reply, and if the reply fails (expired/used token, network), fall back to push.
 * This is the resilient path used for every bot response.
 *
 * @param {object} args
 * @param {string=} args.replyToken
 * @param {string=} args.userId
 * @param {object[]} args.messages
 * @param {string} args.token
 */
export async function replyOrPush({ replyToken, userId, messages, token }) {
  if (replyToken) {
    const r = await reply(replyToken, messages, token);
    if (r.ok) return r;
  }
  // Reply failed or no token — fall back to push if we know the user.
  const p = await push(userId, messages, token);
  if (!p.ok) {
    // Both delivery paths failed — the user got nothing. Log a non-sensitive
    // marker (statuses only, never message content) so this is diagnosable.
    console.error(
      "delivery failed: reply+push both unsuccessful",
      `replyToken=${replyToken ? "yes" : "no"}`,
      `userId=${userId ? "yes" : "no"}`,
      `pushStatus=${p.status}`
    );
  }
  return p;
}

/**
 * Download a message's binary content (image slip) from the api-DATA host.
 * Returns the raw bytes as a Buffer plus the reported content-type.
 *
 * Bounded by a timeout, a Content-Length pre-check, and a hard byte cap so a
 * misbehaving/over-large content response can't force unbounded allocation or
 * hold the function open. LINE returns HTTP 202 ("content not ready yet") for
 * larger images while it finishes processing — that is surfaced as a typed
 * `contentNotReady` error so the caller can ask the user to resend.
 *
 * @param {string} messageId
 * @param {string} token  LINE_CHANNEL_ACCESS_TOKEN
 * @returns {Promise<{buffer:Buffer, contentType:string}>}
 */
export async function getMessageContent(messageId, token) {
  const res = await fetchWithTimeout(
    `${CONTENT_HOST}/v2/bot/message/${encodeURIComponent(messageId)}/content`,
    { headers: { Authorization: `Bearer ${token}` } },
    CONTENT_TIMEOUT_MS
  );

  // 202 = accepted but not ready yet (large image still processing). It is a
  // 2xx, so res.ok is true — handle it explicitly instead of reading a non-image
  // body. Typed so handleImage can reply a "resend in a moment" message.
  if (res.status === 202) {
    const err = new Error("LINE content not ready (202)");
    err.code = "contentNotReady";
    throw err;
  }

  if (!res.ok) {
    throw new Error(`LINE content fetch failed: ${res.status}`);
  }

  const rawType = (res.headers.get("content-type") || "").split(";")[0].trim();

  // Reject obviously non-image bodies (e.g. a JSON error/notice) before reading.
  if (rawType && !rawType.startsWith("image/")) {
    const err = new Error(`LINE content not an image: ${rawType}`);
    err.code = "contentNotReady";
    throw err;
  }

  // Pre-check the advertised size and reject before buffering when it is over cap.
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_CONTENT_BYTES) {
    throw new Error(`LINE content too large: ${len} bytes`);
  }

  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_CONTENT_BYTES) {
    throw new Error(`LINE content too large: ${ab.byteLength} bytes`);
  }
  const buffer = Buffer.from(ab);
  // Use the ACTUAL type LINE reports (jpeg/png/…); fall back to jpeg.
  const contentType = rawType || "image/jpeg";
  return { buffer, contentType };
}

/**
 * Internal: POST a JSON body to a LINE endpoint with the bearer token.
 * Never throws on non-2xx (or on timeout) — returns {ok,status} so callers can
 * branch. A timeout/abort surfaces as {ok:false, status:0}.
 */
async function postJson(url, body, token) {
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      LINE_API_TIMEOUT_MS
    );
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
