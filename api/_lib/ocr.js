// api/_lib/ocr.js
//
// Slip / receipt OCR via Groq's vision API (OpenAI-compatible) — no SDK, just fetch.
// POST https://api.groq.com/openai/v1/chat/completions
//   headers: Authorization: Bearer <GROQ_API_KEY>, content-type: application/json
//   body: { model, messages:[{role:"user", content:[
//            {type:"text", text}, {type:"image_url", image_url:{url:"data:<mime>;base64,<b64>"}}
//          ]}], response_format:{type:"json_object"} }
//   response: choices[0].message.content (a JSON string)
//
// Default model meta-llama/llama-4-scout-17b-16e-instruct (free, multimodal vision).
// Override with env PARSE_MODEL (e.g. "qwen/qwen3.6-27b") for a different model — no code change.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// Hard cap on the OCR round-trip. The LINE reply token lives ~60s; keeping OCR
// well under that leaves room to still reply (or push) the graceful error within
// the window instead of letting a hung call ride up to maxDuration and miss both.
const OCR_TIMEOUT_MS = 20000;

// Groq vision accepts the common web image types; anything else → default jpeg.
const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const PROMPT = [
  "Read this Thai bank-transfer slip / receipt.",
  "Return ONLY a JSON object, no markdown, no code fences, no prose, with EXACTLY these keys:",
  '  "amount"  : number  — the transfer/total amount, no currency symbol, no commas (e.g. 1500.00).',
  '  "currency": string  — currency code, e.g. "THB". Default "THB" if unclear.',
  '  "merchant": string  — the payee / recipient name or destination bank/account name.',
  '  "date"    : string  — transaction date as "YYYY-MM-DD" in the Gregorian (Christian-era) calendar.',
  '              If the slip shows a Buddhist-era year (พ.ศ., e.g. 2569), subtract 543 to convert to ค.ศ.',
  '  "ref"     : string  — the transaction reference / เลขที่อ้างอิง / รหัสอ้างอิง.',
  '  "rawText" : string  — all text you can read from the slip.',
  "If any field is unreadable use null. Output the JSON object and NOTHING else.",
].join("\n");

/**
 * Run the Groq vision OCR and return a normalized, validated record.
 *
 * @param {Buffer} buffer       raw image bytes
 * @param {string} contentType  actual media type from LINE (e.g. image/png)
 * @param {object} env          { GROQ_API_KEY, PARSE_MODEL? }
 * @returns {Promise<{ok:boolean, data?:object, error?:string}>}
 *   data = { amount, currency, merchant, date, ref, rawText }
 */
export async function parseSlip(buffer, contentType, env) {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, error: "missing GROQ_API_KEY" };

  // Groq's base64 image cap is 4 MB; LINE slips are tiny, this is a safety net.
  if (buffer.length > 4 * 1024 * 1024) {
    return { ok: false, error: "image too large" };
  }

  const media_type = ALLOWED_MEDIA.has(contentType) ? contentType : "image/jpeg";
  const model = env.PARSE_MODEL || DEFAULT_MODEL;
  const dataUrl = `data:${media_type};base64,${buffer.toString("base64")}`;

  // Bound the call so a slow/hung Groq response can't consume the whole reply-token
  // window. On timeout the AbortController aborts and we return {ok:false} fast,
  // leaving time to send the graceful Thai error.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0,
        // JSON mode — the prompt mentions "JSON", which Groq requires for this.
        // extractJson() below is still the safety net if the model strays.
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    // AbortError (timeout) and genuine network errors both land here.
    const error = e && e.name === "AbortError" ? "groq timeout" : "groq network error";
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return { ok: false, error: `groq ${res.status}` };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: "groq bad json envelope" };
  }

  const content =
    json &&
    json.choices &&
    json.choices[0] &&
    json.choices[0].message &&
    json.choices[0].message.content;
  if (typeof content !== "string") {
    return { ok: false, error: "groq no content" };
  }

  const parsed = extractJson(content);
  if (!parsed) return { ok: false, error: "could not parse model JSON" };

  return { ok: true, data: normalize(parsed) };
}

/**
 * Defensively extract a JSON object from model text:
 *   1) strip ```json fences
 *   2) slice from the first "{" to the last "}"
 *   3) JSON.parse inside try/catch
 * Returns the parsed object or null.
 */
export function extractJson(text) {
  if (!text) return null;
  let t = text.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = t.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * Coerce / validate every field so downstream code can trust the shape.
 * amount → number, date → YYYY-MM-DD (with B.E.→C.E. safety), strings defaulted.
 */
export function normalize(p) {
  // amount: strip Thai formatting (฿, commas, spaces) → Number.
  let amount = 0;
  if (p && p.amount != null) {
    const n = Number(String(p.amount).replace(/[^0-9.]/g, ""));
    amount = Number.isFinite(n) ? n : 0;
  }

  const currency =
    p && typeof p.currency === "string" && p.currency.trim()
      ? p.currency.trim().toUpperCase().slice(0, 8)
      : "THB";

  const merchant =
    p && typeof p.merchant === "string" && p.merchant.trim()
      ? p.merchant.trim()
      : "-";

  // date: accept only YYYY-MM-DD; convert Buddhist-era year if it slipped through.
  let date = "";
  if (p && typeof p.date === "string") {
    const m = p.date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      let year = Number(m[1]);
      if (year > 2400) year -= 543; // B.E. → C.E. safety coercion
      date = `${String(year).padStart(4, "0")}-${m[2]}-${m[3]}`;
    }
  }

  const ref =
    p && typeof p.ref === "string" && p.ref.trim() ? p.ref.trim() : "";

  const rawText =
    p && typeof p.rawText === "string" ? p.rawText.trim() : "";

  return { amount, currency, merchant, date, ref, rawText };
}
