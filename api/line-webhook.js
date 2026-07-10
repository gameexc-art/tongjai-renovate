// api/line-webhook.js
//
// LINE Messaging API webhook for the NONEAICE receipt-capture bot
// (project: tongjai-renovate). Runs as a Vercel Node serverless function.
//
// Flow:
//   image message  → download slip → Groq vision OCR → Flex "ใบเสร็จ" card
//                    + step-1 buttons (👤 บุคคล / 🏢 บริษัท)
//   postback s=1   → step-2 buttons (📦 ค่าของ / 💼 ค่าแรง)
//   postback s=2   → persist ledger (KV or Blob if set) → "✅ บันทึกเป็นใบรับรองแทนแล้วครับ"
//   follow         → friendly Thai greeting
//   text "usage"/"เช็ค"/"status" → Claude Code usage Flex card (see _lib/usage.js —
//                    snapshot relayed from the apartment-dashboard deployment)
//   text / other   → short usage hint
//
// Security & correctness:
//   - x-line-signature verified over the EXACT raw body BEFORE JSON.parse.
//   - Always returns HTTP 200 quickly (LINE treats non-2xx as failure & retries),
//     except a 401 on signature mismatch.
//   - Idempotent: the in-memory seen-set + store-layer dedupe (KV SET-NX or
//     Blob dedupeKey scan, both keyed by the slip's content identity) stop
//     double records — from redeliveries AND from a user re-tapping the
//     confirm button — while still letting a redelivered persist step retry.
//   - Reply token is single-use & short-lived → replyOrPush falls back to push.
//   - Secrets read from process.env only; values are NEVER logged.
//
// We use the Web Handler signature (export GET/POST) because on Vercel
// `await request.text()` returns the byte-exact raw body required for HMAC,
// while still giving us the full Node runtime (node:crypto, Buffer, fetch).

import crypto from "node:crypto";
import {
  verifySignature,
  replyOrPush,
  getMessageContent,
} from "./_lib/line.js";
import { parseSlip } from "./_lib/ocr.js";
import { saveRecord, storageEnabled } from "./_lib/store.js";
import {
  receiptFlex,
  categoryFlex,
  confirmFlex,
  textMessage,
  decodeState,
} from "./_lib/flex.js";
import {
  isUsageTriggerText,
  isUsageTriggerPostback,
  buildUsageMessage,
} from "./_lib/usage.js";

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
  // durable side effect, and it dedupes at the store layer (keyed by the slip's
  // content identity). So we deliberately LET ITS REDELIVERIES THROUGH — a
  // transient storage blip on the first delivery would otherwise lose the
  // record forever, since the redelivery is LINE's only retry. For every other
  // event type a redelivery is pure noise and is skipped.
  if (redelivered && !isPersistStep) return;

  // The in-memory seen-set guards against fast double-delivery within a warm
  // instance. We skip it for the persist step (the store-layer dedupe is the
  // real guard there and must remain reachable so a failed first save can be
  // retried).
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

/**
 * Where a push-fallback should go: back to the SAME conversation the event
 * came from. In a group/room that is the group/room id — pushing to the
 * sender's userId would land the bot's answer in their private chat (or
 * nowhere, if they never added the bot as a friend).
 */
function pushTarget(source) {
  if (!source) return "";
  return source.groupId || source.roomId || source.userId || "";
}

// ---- message events --------------------------------------------------------
async function handleMessage(event, env) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = pushTarget(event.source);
  const replyToken = event.replyToken;
  const msg = event.message || {};

  if (msg.type === "image") {
    return handleImage(msg.id, replyToken, userId, env, token);
  }

  if (msg.type === "text") {
    // "usage" / "เช็ค" / "status" → the Claude Code usage dashboard card
    // (relayed from the apartment-dashboard snapshot; graceful text otherwise).
    if (isUsageTriggerText(msg.text, env)) {
      return replyOrPush({
        replyToken,
        userId,
        token,
        messages: [await buildUsageMessage(env)],
      });
    }
    return replyOrPush({
      replyToken,
      userId,
      token,
      messages: [
        textMessage(
          "ส่งรูปสลิป/ใบเสร็จมาได้เลยครับ แล้วผมจะอ่านยอด ผู้รับ วันที่ และเลขอ้างอิงให้อัตโนมัติ 📸\n" +
            'หรือพิมพ์ "usage" เพื่อเช็คการใช้งาน Claude Code'
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

    // Reply with the polished "ใบเสร็จ" Flex card + step-1 buttons. The slipId
    // (short hash of the image BYTES) rides along in the postback state so
    // the final save can dedupe confirm re-taps of this same slip — and, since
    // /api/parse-slip hashes the same way, a slip recorded via LINE and via the
    // web chat converges on the same ledger row.
    return replyOrPush({
      replyToken,
      userId,
      token,
      messages: [receiptFlex(result.data, slipIdFor(buffer))],
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
  // Push fallback goes to the conversation; the RECORD keeps the tapping
  // user's own id (who confirmed this expense), never a group id.
  const userId = pushTarget(event.source);
  const recordUserId = event.source && event.source.userId;
  const replyToken = event.replyToken;
  const data = (event.postback && event.postback.data) || "";

  // Usage request from a rich-menu / quick-reply postback ("usage" or
  // "action=usage") — handled before the receipt-state codec, which would
  // otherwise read it as an unknown/stale postback and drop it.
  if (isUsageTriggerPostback(data, env)) {
    return replyOrPush({
      replyToken,
      userId,
      token,
      messages: [await buildUsageMessage(env)],
    });
  }

  const st = decodeState(data);

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
    const record = buildRecord(st, recordUserId, event.webhookEventId);
    // Persist only if a storage backend (KV or Blob) is configured.
    const saved = await saveRecord(record, env);

    // Only confirm "saved" when the entry is actually safe: either storage is
    // intentionally not configured (interactive-only mode), or the write
    // succeeded / was already persisted. If storage is on but the write FAILED,
    // tell the user it didn't save so they can retry — never lie about it.
    if (storageEnabled(env) && !saved.ok) {
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
  const userId = pushTarget(event.source);
  const replyToken = event.replyToken;
  return replyOrPush({
    replyToken,
    userId,
    token,
    messages: [
      textMessage(
        "สวัสดีครับ ผม NONEAICE บอทบันทึกใบเสร็จ 🤖\n\nส่งรูปสลิป/ใบเสร็จมาได้เลย ผมจะอ่านยอดเงิน ผู้รับ วันที่ และเลขอ้างอิงให้ แล้วช่วยบันทึกเป็นรายจ่าย/หัก ณ ที่จ่ายให้อัตโนมัติครับ ✅\n\nพิมพ์ \"usage\" เพื่อเช็คการใช้งาน Claude Code ได้ด้วยนะครับ 📊"
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
 * `amount` is coerced to a finite, non-negative number. webhookEventId and
 * slipId are carried as transport-only fields so the store layer can dedupe
 * redeliveries AND confirm-button re-taps — both are stripped before the
 * record is persisted (the store keeps only a derived dedupeKey hash).
 */
function buildRecord(st, userId, webhookEventId) {
  const entity = st.t === "c" ? "company" : "person"; // p|c
  const category = st.c === "l" ? "withholding" : "expense"; // o|l
  const n = Number(st.amount);
  const amount = Number.isFinite(n) && n >= 0 ? n : 0;
  return {
    amount,
    currency: "THB",
    merchant: st.merchant || "", // best-effort; dropped from postback only on overflow
    date: st.date || "",
    ref: st.ref || "",
    entity, // person | company
    category, // expense | withholding
    lineUserId: userId || "",
    createdAt: new Date().toISOString(),
    webhookEventId: webhookEventId || "", // transport-only; stripped on persist
    slipId: st.slipId || "", // transport-only; stripped on persist
  };
}

/**
 * Short, stable dedupe identity for one slip image (safe for postback data).
 * Hashes the image BYTES — the same identity /api/parse-slip derives for web
 * uploads — so cross-channel re-records of one slip dedupe to one ledger row.
 */
function slipIdFor(imageBuffer) {
  return crypto
    .createHash("sha256")
    .update(imageBuffer)
    .digest("hex")
    .slice(0, 10);
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
