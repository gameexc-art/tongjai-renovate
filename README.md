# TONGJAI RENOVATE — mobile ops app

A mobile-first, PWA-feel operations app for a Thai construction & renovation contractor.
Three surfaces inside one phone frame, switched by a top segmented control:

- **A · การเงินโครงการ** — project finance ledger (summary cards, filters, transaction list)
- **B · แชทบอท (NONEAICE)** — dark LINE/Telegram-style receipt-capture bot
- **C · แผนงาน** — project plan / Gantt progress tracker with a "ล่าช้า / behind" state

## Files

| File | What it is |
|---|---|
| `index.html` | Single, fully self-contained standalone page. Pure HTML/CSS/JS, no build step, no external resources. **Double-click to open offline.** |
| `dashboard.html` | **LIVE** finance dashboard — passcode-gated page that reads the real recorded ledger from `GET /api/transactions` and renders it in Screen A's exact look. Served at `/dashboard`. |
| `_widget.html` | The same UI as an embeddable fragment (no `<!doctype>`/`<html>`/`<head>`/`<body>`). All CSS is scoped under `.tjr-root`, outer background is transparent. Inject directly into a host `<div>`. |
| `App.jsx` | React + Tailwind + lucide-react version. Single default-export component. |
| `README.md` | This file. |

## LINE bot — NONEAICE (บอทบันทึกใบเสร็จ)

Screen B's NONEAICE chat is backed by a **real LINE Messaging API bot**, shipped as
Vercel serverless functions in this same repo (under `/api`). Send a bank-transfer
slip / receipt image to the LINE Official Account and the bot:

1. downloads the image, OCRs it with **Groq vision** (amount, payee, date, ref),
2. replies with a polished Flex **"ใบเสร็จ"** card,
3. walks you through two postback choices — **👤 บุคคล / 🏢 บริษัท**, then
   **📦 ค่าของ (บันทึกเป็นรายจ่าย) / 💼 ค่าแรง (หัก ณ ที่จ่าย)**,
4. confirms **"✅ บันทึกเป็นใบรับรองแทนแล้วครับ"** and records the expense.

The static UI above is **unaffected** — Vercel serves `index.html` at the root and
routes `/api/*` to the functions.

## หน้าการเงิน (live dashboard)

`dashboard.html` is a **live** sibling of Screen A ("การเงินโครงการ"): it closes the loop by
reading the **real** ledger the bot has recorded and rendering it in the same TONGJAI BLUEPRINT
look (summary cards, filter pills, ledger rows).

- **URL:** <https://tongjai-renovate.vercel.app/dashboard>
- **Passcode-gated:** on load it asks for a password and calls `GET /api/transactions` with
  `Authorization: Bearer <passcode>`. The passcode **is** the `DASHBOARD_TOKEN` env value. On
  success the token is held only in `sessionStorage` (cleared when the tab closes, or via
  **ออกจากระบบ/เปลี่ยนรหัส**) — it is never hard-coded in the page.
- **Needs `DASHBOARD_TOKEN`** set in Vercel (the passcode), and **Vercel KV** for real rows —
  without KV the endpoint authenticates fine but returns an empty list and the page shows the
  "ยังไม่มีรายการ — ส่งสลิปเข้าบอท LINE NONEAICE" empty state. See **ขั้นที่ 4** in
  [`LINE_SETUP.md`](LINE_SETUP.md) to enable KV (Vercel → Storage → Create Database → KV).
- Income (รายรับ) is always `฿0.00` because the bot records **expenses only**; รายจ่ายสุทธิ is
  the sum of all amounts and กำไร/ขาดทุน = `0 − รายจ่าย` (shown negative, red, ▼).
- The page is same-origin only and HTML-escapes every server-provided string (merchant / ref /
  date originate from OCR of user-uploaded images and are treated as untrusted).

### Endpoints
| Route | Purpose |
|---|---|
| `GET /api/line-webhook` | health check → `ok` |
| `POST /api/line-webhook` | LINE webhook (signature-verified) |
| `GET /api/transactions` | recorded ledger (JSON) for the dashboard — **auth required** (`Authorization: Bearer $DASHBOARD_TOKEN`); `[]` if KV unset, `503` if `DASHBOARD_TOKEN` unset |
| `GET /dashboard` | live passcode-gated finance dashboard page (`dashboard.html`); reads `/api/transactions` |

### Environment variables (set in Vercel → Settings → Environment Variables)
| Name | Required | Purpose |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | LINE reply/push/content auth |
| `LINE_CHANNEL_SECRET` | ✅ | verify `x-line-signature` |
| `GROQ_API_KEY` | ✅ | Groq vision OCR |
| `DASHBOARD_TOKEN` | required to read ledger | shared secret for `GET /api/transactions` (`Authorization: Bearer …`). Until set, that endpoint returns `503` (fails closed, never open) |
| `PARSE_MODEL` | optional | override model (default `meta-llama/llama-4-scout-17b-16e-instruct`) |
| `DASHBOARD_ORIGIN` | optional | exact origin allowed to read `/api/transactions` from a browser (CORS). Omit for same-origin only — never `*` |
| `KV_REST_API_URL` | optional | Vercel KV — persist ledger for the dashboard |
| `KV_REST_API_TOKEN` | optional | Vercel KV token |

The interactive flow works **without KV** (state is carried in the ≤300-char postback
data); KV only persists the final ledger. Secrets are read from `process.env` and never
logged. The ledger endpoint is **not public**: it requires `DASHBOARD_TOKEN` and never
returns each record's `lineUserId` (PII / push target) — that field is stripped
server-side. Note: the persisted ledger omits the payee name (`merchant`), which is
display-only on the receipt card and intentionally not carried in the postback data.

**Full setup walkthrough (Thai):** see [`LINE_SETUP.md`](LINE_SETUP.md). Webhook URL:
`https://tongjai-renovate.vercel.app/api/line-webhook`.

## How to open `index.html`

Just double-click it, or:

```bash
# optional local server
npx serve .
# then open http://localhost:3000/index.html
```

It works offline — fonts fall back to the system Thai stack, no network needed.

## How to use `App.jsx` in a Vite + Tailwind project

```bash
npm create vite@latest my-app -- --template react
cd my-app
npm install
npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p
npm install lucide-react
```

Add Tailwind to `src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Then drop `App.jsx` in `src/` and render it:

```jsx
import App from "./App";
// in main.jsx: <App />
```

The component leans on inline styles for the design tokens, so it renders correctly on a
stock Tailwind install with **no `tailwind.config.js` changes required**. `lucide-react`
supplies the icons. An optional `window.sendPrompt(text)` hook is called by the action
buttons so the host can wire up live behavior.

## `_widget.html` embedding

```html
<div id="host"></div>
<script>
  fetch("_widget.html").then(r => r.text()).then(html => {
    document.getElementById("host").innerHTML = html;
    // re-run inline scripts if your host strips them on innerHTML:
    document.querySelectorAll("#host script").forEach(old => {
      const s = document.createElement("script");
      s.textContent = old.textContent;
      old.replaceWith(s);
    });
  });
</script>
```

The fragment paints its own phone frame on a transparent background, so the host container
supplies the surrounding page background.

---

## Design system — "TONGJAI BLUEPRINT" (token summary)

**Color is meaning.** Green / red / orange touch **only** money and status. One structural
blue does **all** navigational/temporal work; everything else is warm graphite. A glance
answers "what's my money state?" before a word is read.

- **Brand mark** (never recolored): red `#E23B33` · blue `#2667D6` · orange `#F08A24` · green `#2FA45A` — four rounded squares, 2×2 grid rotated 45°.
- **Structural accent** (the one app blue): `#1E5FCC`, tint `#EAF1FC`, border `#BFD6F4`.
- **Paper / neutrals**: canvas `#F6F6F2` (warm drafting paper) · surface `#FFFFFF` · zebra `#FBFAF7` · lines `#EAE7DF` / `#DBD9D1` · ink `#15181E` / `#3C424C` / `#646B75` (muted floor) / `#9AA0A8` (placeholder only).
- **Money / status (value-only)**: income `#18753F` / button `#178045` · expense `#C8322B` (brick-red, "unmistakable not alarmist") / button `#E23B33` · planned/temporal `#1E5FCC` · count/admin amber `#9C520B`.
- **Category badges** (low-sat, bordered, ≥5:1): materials slate · labor blue · transport teal · advance violet.
- **Dark chat**: bg `#0F1217` · bot bubble `#1A1F27` · white slip `#FFFFFF` floating on `0 12px 32px rgba(21,24,30,.14)` · success `#143524`/`#1F6E42`/`#7FE3AA` · money on dark `#FFFFFF`.

**Typography.** Thai-first stack: `"LINE Seed Sans TH","IBM Plex Sans Thai","Noto Sans Thai","Anuphan",system-ui,…`
with a Latin/number companion `"IBM Plex Sans","Inter",…` (`tabular-nums` on all money/dates/%).
Thai rule: line-height **1.65** on body, **zero/positive** tracking on Thai runs; **negative**
tracking confined to Latin/number runs and the wordmark. Weights 400–800; 800 reserved for the
wordmark and hero figures. Money: `฿` glyph at `0.78em` ink-3 prefix, comma-grouped, always 2
decimals, minus before symbol (`-฿1,500.00`).

**Spacing / radius / elevation.** 4px base, 8px rhythm. 16px gutters, 24px section gap, 64px list
rows, 44px min tap targets. Radii: 6 / 10 / 14 / 20 / 18(bubble) / pill; mark squares 2.4px.
Near-flat: the **only** pronounced shadow is the active segmented-control thumb; semantic 3px
accent bars (top on Finance, left on Gantt KPIs) carry the elevation signature.

**Signature details.** Pinwheel mark in pure SVG · warm blueprint paper with a faint 24px dotted
grid behind the Gantt only · true ledger column (hard-right, tabular, `฿` prefix, minus-before-symbol)
· count-up tally on the finance figures · structurally-encoded behind-state (overdue Gantt segments
switch from filled-blue to **hollow red-outline**, left of a dashed breathing "today" plumb line —
red + ▼ + the word **ล่าช้า**, never color alone) · deliberate light→dark context shift on the chat
with a real white receipt + faux-QR (three real finder eyes).

**Accessibility.** All primary data ≥5:1 (sunlight-tuned). Status never encoded by color alone
(glyph + caption + word). `prefers-reduced-motion` collapses everything to opacity-only; count-up
snaps to final. Focus ring `rgba(30,95,204,.30)`. Thai `lang` set for correct SR pronunciation.
