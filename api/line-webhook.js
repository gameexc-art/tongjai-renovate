// api/line-webhook.js
//
// LINE Messaging API webhook for the NONEAICE receipt-capture bot
// (project: tongjai-renovate). Runs as a Vercel Node serverless function.
//
// Flow:
//   image message  → download slip → Groq vision OCR → Flex "ใบเสร็จ" card
//                    + step-1 buttons (👤 บุคคล / 🏢 บริษัท)
//   postback s=1   → step-2 buttons (📦 ค่าของ / 💼 ค่าแรง)
//   postback s=2   → persist ledger (KV if set) → "✅ บันทึกเป็นใบรับรองแทนแล้วครับ"
//   follow         → friendly Thai greeting
//   text / other   → short usage hint
//
// Security & correctness:
//   - x-line-signature verified over the EXACT raw body BEFORE JSON.parse.
//   - Always returns HTTP 200 quickly (LINE treats non-2xx as failure & retries),
//     except a 401 on signature mismatch.
//   - Idempotent: the in-memory seen-set + KV-layer SET-NX dedupe stop double
//     records, while still letting a redelivered persist step retry safely.
//   - Reply token is single-use & short-lived → replyOrPush falls back to push.
//   - Secrets read from process.env only; values are NEVER logged.
//
// We use the Web Handler signature (export GET/POST) because on Vercel
// `await request.text()` returns the byte-exact raw body required for HMAC,
// while still giving us the full Node runtime (node:crypto, Buffer, fetch).

import {
  verifySignature,
  replyOrPush,
  getMessageContent,
} from "./_lib/line.js";
import { parseSlip } from "./_lib/ocr.js";
import { saveRecord, kvEnabled } from "./_lib/store.js";
import {
  receiptFlex,
  categoryFlex,
  confirmFlex,
  textMessage,
  decodeState,
} from "./_lib/flex.js";

// Hobby max is 300s; a synchronous Groq vision call fits comfortably.
export const config = { maxDuration: 60 };

// In-memory dedupe of webhookEventIds. Instances are reused under Fluid compute
// so this catches most fast redeliveries; deliveryContext.isRedelivery is the
// authoritative guard. (Best-effort — not a durable store by design.)
const seenEventIds = new Set();
const SEEN_LIMIT = 500;

// ---- health check ----------------------------------------------------------
export async function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// ---- webhook ---------------------------------------------------------------
export async function POST(request) {
  const env = process.env;

  // 1) RAW body — required for signature verification (do NOT parse first).
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  // 2) Verify signature over the exact bytes. Reject forged/unsigned requests.
  if (!verifySignature(rawBody, signature, env.LINE_CHANNEL_SECRET)) {
    return new Response("invalid signature", { status: 401 });
  }

  // 3) Parse AFTER verifying. The Verify button sends events: [].
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const events = Array.isArray(body.events) ? body.events : [];

  // 4) Handle events CONCURRENTLY so each event's reply-token clock starts
  //    immediately (a webhook can batch several images; serial OCR would push
  //    later receipts past their ~60s reply window). allSettled isolates each
  //    failure so one bad event never breaks the batch (or the 200).
  const results = await Promise.allSettled(
    events.map((event) => handleEvent(event, env))
  );
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      // Non-sensitive marker only — never the error payload (could echo data).
      console.error("event handler error:", events[i] && events[i].type);
    }
  }

  // 5) Always 200 so LINE marks the webhook healthy.
  return new Response("OK", { status: 200 });
}

// ============================================================================
// Event dispatch
// ============================================================================
async function handleEvent(event, env) {
  if (!event || typeof event !== "object") return;

  const redelivered = event.deliveryContext && event.deliveryContext.isRedelivery;
  const id = event.webhookEventId;
  const isPersistStep =
    event.type === "postback" &&
    decodeState((event.postback && event.postback.data) || "").s === "2";

  // Idempotency. The persist step (postback s=2) is the only event with a
  // durable side effect, and it dedupes at the KV layer (SET NX keyed by the
  // record). So we deliberately LET ITS REDELIVERIES THROUGH — a transient KV
  // blip on the first delivery would otherwise lose the record forever, since
  // the redelivery is LINE's only retry. For every other event type a
  // redelivery is pure noise and is skipped.
  if (redelivered && !isPersistStep) return;

  // The in-memory seen-set guards against fast double-delivery within a warm
  // instance. We skip it for the persist step (KV SET NX is the real guard there
  // and must remain reachable so a failed first save can be retried).
  if (id && !isPersistStep) {
    if (seenEventIds.has(id)) return;
    rememberEvent(id);
  }

  switch (event.type) {
    case "message":
      return handleMessage(event, env);
    case "postback":
      return handlePostback(event, env);
    case "follow":
      return handleFollow(event, env);
    default:
      // join / unfollow / leave / etc. — acknowledged by returning 200; no reply.
      return;
  }
}

// ---- message events --------------------------------------------------------
async function handleMessage(event, env) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = event.source && event.source.userId;
  const replyToken = event.replyToken;
  const msg = event.message || {};

  if (msg.type === "image") {
    return handleImage(msg.id, replyToken, userId, env, token);
  }

  if (msg.type === "text") {
    return replyOrPush({
      replyToken,
      userId,
      token,
      messages: [
        textMessage(
          "ส่งรูปสลิป/ใบเสร็จมาได้เลยครับ แล้วผมจะอ่านยอด ผู้รับ วันที่ และเลขอ้างอิงให้อัตโนมัติ 📸"
        ),
      ],
    });
  }

  // Other message types (sticker, location, file…) — gentle nudge.
  return replyOrPush({
    replyToken,
    userId,
    token,
    messages: [textMessage("ส่งรูปสลิป/ใบเสร็จมาได้เลยครับ 📸")],
  });
}

// ---- image → OCR → receipt card -------------------------------------------
async function handleImage(messageId, replyToken, userId, env, token) {
  try {
    const { buffer, contentType } = await getMessageContent(messageId, token);
    const result = await parseSlip(buffer, contentType, env);

    if (!result.ok) {
      return replyOrPush({
        replyToken,
        userId,
        token,
        messages: [
          textMessage("อ่านสลิปไม่สำเร็จ ลองส่งรูปที่ชัดขึ้นอีกครั้งนะครับ 🙏"),
        ],
      });
    }

    // Reply with the polished "ใบเสร็จ" Flex card + step-1 buttons.
    return replyOrPush({
      replyToken,
      userId,
      token,
      messages: [receiptFlex(result.data)],
    });
  } catch (err) {
    // LINE 202 / non-image body = the (often large) image is still processing.
    // Ask the user to resend in a moment rather than showing a generic error.
    if (err && err.code === "contentNotReady") {
      return replyOrPush({
        replyToken,
        userId,
        token,
        messages: [
          textMessage("รูปกำลังประมวลผลอยู่ ลองส่งใหม่อีกครั้งในอีกสักครู่นะครับ 🙏"),
        ],
      });
    }
    // Content fetch / network failure — graceful Thai error, still 200 upstream.
    return replyOrPush({
      replyToken,
      userId,
      token,
      messages: [
        textMessage("เกิดข้อผิดพลาดในการอ่านสลิป ลองส่งใหม่อีกครั้งนะครับ 🙏"),
      ],
    });
  }
}

// ---- postback events (the stateless two-step flow) -------------------------
async function handlePostback(event, env) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = event.source && event.source.userId;
  const replyToken = event.replyToken;
  const st = decodeState((event.postback && event.postback.data) || "");

  // Step 1 done (entity chosen) → ask for category (step 2 buttons).
  if (st.s === "1") {
    return replyOrPush({
      replyToken,
      userId,
      token,
      messages: [categoryFlex(st)],
    });
  }

  // Step 2 done (category chosen) → persist + confirm.
  if (st.s === "2") {
    const record = buildRecord(st, userId, event.webhookEventId);
    // Persist only if KV configured; otherwise gracefully skipped.
    const saved = await saveRecord(record, env);

    // Only confirm "saved" when the entry is actually safe: either KV is
    // intentionally not configured (interactive-only mode), or the write
    // succeeded / was already persisted. If KV is on but the write FAILED,
    // tell the user it didn't save so they can retry — never lie about it.
    if (kvEnabled(env) && !saved.ok) {
      return replyOrPush({
        replyToken,
        userId,
        token,
        messages: [
          textMessage("บันทึกไม่สำเร็จ ลองกดยืนยันอีกครั้งนะครับ 🙏"),
        ],
      });
    }

    return replyOrPush({
      replyToken,
      userId,
      token,
      messages: [confirmFlex()],
    });
  }

  // Unknown/stale postback — no-op (still 200).
  return;
}

// ---- follow event ----------------------------------------------------------
async function handleFollow(event, env) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = event.source && event.source.userId;
  const replyToken = event.replyToken;
  return replyOrPush({
    replyToken,
    userId,
    token,
    messages: [
      textMessage(
        "สวัสดีครับ ผม NONEAICE บอทบันทึกใบเสร็จ 🤖\n\nส่งรูปสลิป/ใบเสร็จมาได้เลย ผมจะอ่านยอดเงิน ผู้รับ วันที่ และเลขอ้างอิงให้ แล้วช่วยบันทึกเป็นรายจ่าย/หัก ณ ที่จ่ายให้อัตโนมัติครับ ✅"
      ),
    ],
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build the ledger record from decoded postback state.
 *
 * `entity` / `category` map from the compact wire codes to a small allowlist;
 * `amount` is coerced to a finite, non-negative number. webhookEventId is
 * carried as a transport-only field so the KV layer can dedupe redeliveries —
 * it is stripped before the record is persisted.
 */
function buildRecord(st, userId, webhookEventId) {
  const entity = st.t === "c" ? "company" : "person"; // p|c
  const category = st.c === "l" ? "withholding" : "expense"; // o|l
  const n = Number(st.amount);
  const amount = Number.isFinite(n) && n >= 0 ? n : 0;
  return {
    amount,
    currency: "THB",
    merchant: "", // merchant is display-only; not carried in postback data
    date: st.date || "",
    ref: st.ref || "",
    entity, // person | company
    category, // expense | withholding
    lineUserId: userId || "",
    createdAt: new Date().toISOString(),
    webhookEventId: webhookEventId || "", // transport-only; stripped on persist
  };
}

/** Bounded in-memory dedupe set. */
function rememberEvent(id) {
  seenEventIds.add(id);
  if (seenEventIds.size > SEEN_LIMIT) {
    // Drop the oldest entry to keep the set bounded.
    const first = seenEventIds.values().next().value;
    seenEventIds.delete(first);
  }
}
