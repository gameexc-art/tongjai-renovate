// api/_lib/flex.js
//
// LINE message builders for the NONEAICE receipt bot + the compact postback
// state codec. The interactive flow is STATELESS: the few parsed fields are
// carried forward inside postback.data (hard cap 300 chars), so no DB is needed
// for the conversation — KV is only for the final ledger.
//
// Design follows the app's "TONGJAI BLUEPRINT" tokens (see README): green money
// accent #178045 / #18753F, brand blue #1E5FCC, warm ink #15181E / #646B75,
// brick-red expense #C8322B. The Flex "ใบเสร็จ" card mirrors Screen B.

// ---- Brand tokens (kept in sync with index.html design system) -------------
const C = {
  green: "#178045",
  greenDeep: "#18753F",
  blue: "#1E5FCC",
  ink: "#15181E",
  ink2: "#3C424C",
  ink3: "#646B75",
  line: "#EAE7DF",
  amber: "#9C520B",
  paper: "#FFFFFF",
};

// ============================================================================
// Postback state codec  —  compact querystring, asserted ≤ 300 chars.
// Short keys: s=step, t=entity(p|c), c=category(o|l), a=amount, d=date, r=ref,
//             m=slipId (short hash of the LINE image messageId — the dedupe
//             identity that makes redeliveries AND confirm re-taps idempotent),
//             n=merchant (payee name, best-effort: URL-encoded Thai is ~9 chars
//             per character, so it is the FIRST field dropped on overflow).
// rawText is NEVER carried.
// ============================================================================

/**
 * Encode forward state into a postback data string, asserted ≤ 300 chars.
 * Mandatory fields (step, entity, category, amount, date, slipId) always fit
 * (~55 chars worst case). The two long tails — ref (ledger identity) first,
 * then merchant (display nicety) — each get TRUNCATED to the remaining budget
 * at an encoded-character boundary rather than silently dropped outright, so
 * a long Thai ref still lands in the ledger, just shortened.
 *
 * @param {object} st  { s, t?, c?, amount?, date?, ref?, slipId?, merchant? }
 * @returns {string}
 */
export function encodeState(st) {
  const parts = [`s=${st.s}`];
  if (st.t) parts.push(`t=${st.t}`); // p = person(บุคคล), c = company(บริษัท)
  if (st.c) parts.push(`c=${st.c}`); // o = ค่าของ(expense), l = ค่าแรง(withholding)
  if (st.amount != null) parts.push(`a=${encodeURIComponent(String(st.amount))}`);
  if (st.date) parts.push(`d=${encodeURIComponent(st.date)}`);
  if (st.slipId) parts.push(`m=${encodeURIComponent(String(st.slipId).slice(0, 16))}`);
  let data = parts.join("&");
  if (st.ref) {
    const fitted = fitEncoded(String(st.ref).slice(0, 40), 300 - data.length - 3);
    if (fitted) data += `&r=${fitted}`;
  }
  if (st.merchant && st.merchant !== "-") {
    const fitted = fitEncoded(String(st.merchant).slice(0, 40), 300 - data.length - 3);
    if (fitted) data += `&n=${fitted}`;
  }
  return data;
}

/**
 * URL-encode `raw` one character at a time, stopping before the encoded
 * length would exceed `budget`. Always cuts at a whole-character boundary so
 * the result decodes cleanly (Thai chars encode to 9 chars each).
 */
function fitEncoded(raw, budget) {
  if (budget <= 0) return "";
  let out = "";
  for (const ch of raw) {
    const enc = encodeURIComponent(ch);
    if (out.length + enc.length > budget) break;
    out += enc;
  }
  return out;
}

// Short wire key → state field. Keeps postback data compact (≤300 chars) while
// decoding back to readable field names.
const KEY_MAP = {
  s: "s",
  t: "t",
  c: "c",
  a: "amount",
  d: "date",
  r: "ref",
  m: "slipId",
  n: "merchant",
};

/**
 * Decode a postback data string back into state.
 * @param {string} data
 * @returns {object} { s, t, c, amount, date, ref, slipId, merchant }  (all strings)
 */
export function decodeState(data) {
  const out = { s: "", t: "", c: "", amount: "", date: "", ref: "", slipId: "", merchant: "" };
  if (!data) return out;
  for (const pair of data.split("&")) {
    const i = pair.indexOf("=");
    if (i === -1) continue;
    const wireKey = pair.slice(0, i);
    const field = KEY_MAP[wireKey];
    if (!field) continue;
    const raw = pair.slice(i + 1);
    // decodeURIComponent throws URIError on malformed percent-encoding. Degrade
    // gracefully to the raw substring so one bad pair never aborts the handler.
    try {
      out[field] = decodeURIComponent(raw);
    } catch {
      out[field] = raw;
    }
  }
  return out;
}

// ---- formatting helpers ----------------------------------------------------

function fmtBaht(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function ellipsize(s, max) {
  if (!s) return "-";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ============================================================================
// Message builders
// ============================================================================

/**
 * The parsed "ใบเสร็จ" receipt Flex card.
 * Header: green title bar. Body: amount hero + payee/date/ref rows.
 * Footer: step-1 postback buttons 👤 บุคคล / 🏢 บริษัท.
 *
 * @param {object} d  normalized slip data { amount, currency, merchant, date, ref }
 * @param {string=} slipId  short hash of the LINE image messageId (dedupe identity)
 * @returns {object}  LINE flex message object
 */
export function receiptFlex(d, slipId) {
  const dateText = d.date || "-";
  const refText = d.ref ? ellipsize(d.ref, 28) : "-";
  const merchantText = ellipsize(d.merchant, 40);

  // step-1 state carried into both buttons (entity chosen on click).
  const baseState = {
    s: 1,
    amount: d.amount,
    date: d.date,
    ref: d.ref,
    slipId,
    merchant: d.merchant,
  };

  return {
    type: "flex",
    altText: `ใบเสร็จ ฿${fmtBaht(d.amount)}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "horizontal",
        backgroundColor: C.green,
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: "ใบเสร็จ",
            color: "#FFFFFF",
            weight: "bold",
            size: "lg",
            flex: 1,
            gravity: "center",
          },
          {
            type: "text",
            text: "✓",
            color: "#FFFFFF",
            weight: "bold",
            size: "lg",
            align: "end",
            gravity: "center",
            flex: 0,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "md",
        contents: [
          // amount hero
          {
            type: "box",
            layout: "baseline",
            contents: [
              {
                type: "text",
                text: "฿",
                color: C.ink3,
                size: "lg",
                weight: "bold",
                flex: 0,
              },
              {
                type: "text",
                text: fmtBaht(d.amount),
                color: C.greenDeep,
                size: "3xl",
                weight: "bold",
                margin: "sm",
              },
            ],
          },
          { type: "separator", margin: "lg", color: C.line },
          // payee / date / ref rows
          kvRow("🏢 ผู้รับเงิน", merchantText),
          kvRow("📅 วันที่", dateText),
          kvRow("🔖 อ้างอิง", refText),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "14px",
        contents: [
          {
            type: "text",
            text: "บันทึกในนามของใคร?",
            color: C.ink3,
            size: "sm",
            margin: "none",
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              postbackButton(
                "👤 บุคคล",
                encodeState({ ...baseState, t: "p" }),
                "บุคคล",
                "primary",
                C.blue
              ),
              postbackButton(
                "🏢 บริษัท",
                encodeState({ ...baseState, t: "c" }),
                "บริษัท",
                "primary",
                C.green
              ),
            ],
          },
        ],
      },
      styles: { footer: { separator: true } },
    },
  };
}

/**
 * Step-2 prompt bubble: "เลือกประเภทค่าจ่าย:" with two stacked postback buttons
 *   📦 ค่าของ (บันทึกเป็นรายจ่าย)   →  expense
 *   💼 ค่าแรง (หัก ณ ที่จ่าย)        →  withholding
 *
 * @param {object} st  decoded state from step 1 (has t, amount, date, ref, slipId, merchant)
 * @returns {object} LINE flex message object
 */
export function categoryFlex(st) {
  const carry = {
    s: 2,
    t: st.t,
    amount: st.amount,
    date: st.date,
    ref: st.ref,
    slipId: st.slipId,
    merchant: st.merchant,
  };
  return {
    type: "flex",
    altText: "เลือกประเภทค่าจ่าย",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "เลือกประเภทค่าจ่าย:",
            weight: "bold",
            color: C.ink,
            size: "md",
          },
          postbackButton(
            "📦 ค่าของ (บันทึกเป็นรายจ่าย)",
            encodeState({ ...carry, c: "o" }),
            "ค่าของ",
            "primary",
            C.green
          ),
          postbackButton(
            "💼 ค่าแรง (หัก ณ ที่จ่าย)",
            encodeState({ ...carry, c: "l" }),
            "ค่าแรง",
            // primary (filled) so the amber gives a white label solid contrast;
            // secondary would put dark-amber text on a light fill (low contrast).
            "primary",
            C.amber
          ),
        ],
      },
    },
  };
}

/**
 * Final confirmation bubble — exact Thai string, verbatim per spec.
 * "✅ บันทึกเป็นใบรับรองแทนแล้วครับ"
 */
export function confirmFlex() {
  return {
    type: "flex",
    altText: "✅ บันทึกเป็นใบรับรองแทนแล้วครับ",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#143524",
        paddingAll: "18px",
        contents: [
          {
            type: "text",
            text: "✅ บันทึกเป็นใบรับรองแทนแล้วครับ",
            color: "#7FE3AA",
            weight: "bold",
            size: "md",
            wrap: true,
            align: "center",
          },
        ],
      },
    },
  };
}

/** Plain text message helper. */
export function textMessage(text) {
  return { type: "text", text };
}

// ---- low-level component helpers -------------------------------------------

function kvRow(label, value) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, color: C.ink3, size: "sm", flex: 4 },
      {
        type: "text",
        text: value || "-",
        color: C.ink2,
        size: "sm",
        flex: 6,
        align: "end",
        wrap: true,
      },
    ],
  };
}

function postbackButton(label, data, displayText, style, color) {
  return {
    type: "button",
    style: style || "primary",
    color,
    height: "sm",
    action: {
      type: "postback",
      label,
      data,
      displayText,
    },
  };
}
