# TONGJAI RENOVATE — mobile ops app

A mobile-first, PWA-feel operations app for a Thai construction & renovation contractor.
Three surfaces inside one phone frame, switched by a top segmented control:

- **A · การเงินโครงการ** — project finance ledger (summary cards, filters, transaction list)
- **B · แชทบอท (NONEAICE)** — dark LINE/Telegram-style receipt-capture bot. **LIVE when served
  from Vercel** (same Groq OCR + same ledger as the LINE bot, plus the Claude Code usage card);
  a scripted demo when the file is opened offline
- **C · แผนงาน** — project plan / Gantt progress tracker with a "ล่าช้า / behind" state

## Files

| File | What it is |
|---|---|
| `index.html` | Single, fully self-contained standalone page. Pure HTML/CSS/JS, no build step, no external resources. **Double-click to open offline.** Every control works: filter pills filter the ledger, the Gantt month switcher (6/26 · 7/26) swaps windows, the แผนงาน/ความก้าวหน้า/รายงาน tabs switch views, Excel exports a real CSV (UTF-8 BOM), and logout shows a demo toast. Opened as a file (`file://`) Screen B's chat is a scripted demo; **served from Vercel it is LIVE** — attach a slip → the same Groq OCR → the same 2-step record into the same ledger (appears on `/dashboard`), and typing `usage` returns the Claude Code usage card. Passcode = `DASHBOARD_TOKEN`, held in the same `sessionStorage` key as `/dashboard` (unlock once, both work). |
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
4. confirms **"✅ บันทึกเป็นใบรับรองแทนแล้วครับ"** and records the expense —
   including the payee name (merchant), carried through the postback flow on a
   best-effort budget (trimmed first if the 300-char postback limit is tight).

Saving is idempotent per slip: a LINE redelivery **or** re-tapping the confirm
button maps to the same content identity (a short hash of the image messageId
rides in the postback data), so one slip can never be recorded twice. The bot
also answers correctly inside group/room chats — push fallbacks go back to the
same conversation, not to the sender's private chat.

Vercel serves `index.html` at the root and routes `/api/*` to the functions. Opened
offline (`file://`) the page stays a 100 % self-contained demo — but served from
Vercel, Screen B upgrades itself into the **real** bot:

### Screen B บนเว็บ — LIVE web chat

Over http/https the chat swaps its scripted demo for the live pipeline (the demo
stays fully intact for the offline file):

1. **+ (แนบสลิป)** → pick an image → the browser posts the raw bytes to
   `POST /api/parse-slip` — the **exact same Groq vision OCR** the LINE bot runs
   (oversized/exotic images are first re-encoded client-side to JPEG, max 1600 px,
   to fit the 3 MB cap).
2. The bot renders the same **"ใบเสร็จ"** card, then walks the same two steps —
   **👤 บุคคล / 🏢 บริษัท** → **📦 ค่าของ / 💼 ค่าแรง** — and `POST /api/record`
   persists into the **same ledger** the LINE bot writes (record tagged
   `channel:"web"`), so it shows up on `/dashboard` immediately.
3. Re-uploading the same image (double-click, retry) is idempotent: `/api/parse-slip`
   derives a `slipId` from the image bytes, and `/api/record` answers
   `{ ok:true, duplicate:true }` → "รายการนี้ถูกบันทึกไว้แล้วครับ ✅" instead of a
   second row.
4. Typing `usage` / `เช็ค` / `/status` / `status` / `ยอดใช้` answers with the
   **Claude Code usage card** (see the next section) via the public `GET /api/usage`
   proxy. Any other text gets the same slip-nudge reply the LINE bot gives.

The first slip action asks for the **passcode = `DASHBOARD_TOKEN`** in an inline
chat bubble (validated read-only against `GET /api/transactions`) and keeps it in
the same `sessionStorage` key `dashboard.html` uses — unlocking the chat unlocks
`/dashboard` in that tab and vice-versa; nothing is ever hard-coded in the page.
A later `401` (token rotated) re-gates and retries the action once. All
server-provided strings are rendered with `textContent` (never `innerHTML`), and
every fetch is timeout-bounded.

## Claude Code usage — พ่วง usage bot

NONEAICE doubles as a **Claude Code usage bot**: send `usage` / `เช็ค` / `/status` /
`status` / `ยอดใช้` to the LINE OA (or a rich-menu/quick-reply postback whose data is
`usage` or `action=usage`) — or type the same words into the live web chat — and it
answers with the dark **usage dashboard Flex card**: three bars (Current session 5h ·
Weekly all models · Weekly Sonnet only), blue → amber at ≥ 80 % → red at ≥ 95 %, a
reset countdown recomputed live from the snapshot's `resets_at` (so it doesn't go
stale between syncs), burn-rate/ETA rows only when the snapshot estimates them, and a
`● live` / `● estimate` badge. The slip nudge and the follow greeting hint at it
('หรือพิมพ์ "usage" …').

The data is **relayed from the apartment-dashboard deployment**: a local sync agent
uploads Claude Code usage snapshots there, and this repo fetches the latest one from
that app's public `GET /api/usage/snapshot` (5 s timeout, payload validated to carry
`session` + `weekly`). Point `USAGE_SNAPSHOT_URL` at it, e.g.
`https://apartment-dashboard-seven.vercel.app/api/usage/snapshot`.

- **Zero-token / zero-quota guarantees inherited:** answering never calls
  Claude/Anthropic — it reads a stored snapshot of usage *percentages* (no tokens,
  no PII) and replies through the existing NONEAICE delivery path.
- **Graceful degradation, never a webhook failure:** with `USAGE_SNAPSHOT_URL` unset
  the bot explains (in Thai) what to configure; an unreachable/invalid upstream gets
  "ดึงข้อมูล usage ไม่สำเร็จ ลองใหม่อีกครั้งนะครับ 🙏".
- **Keywords overridable** via `USAGE_KEYWORDS` (comma-separated, case-insensitive,
  exact match on the trimmed message) — this affects the LINE bot; the web chat's
  word list is the default set baked into the page.

## หน้าการเงิน (live dashboard)

`dashboard.html` is a **live** sibling of Screen A ("การเงินโครงการ"): it closes the loop by
reading the **real** ledger the bot has recorded and rendering it in the same TONGJAI BLUEPRINT
look (summary cards, filter pills, ledger rows).

- **URL:** <https://tongjai-renovate.vercel.app/dashboard>
- **Passcode-gated:** on load it asks for a password and calls `GET /api/transactions` with
  `Authorization: Bearer <passcode>`. The passcode **is** the `DASHBOARD_TOKEN` env value. On
  success the token is held only in `sessionStorage` (cleared when the tab closes, or via the
  **ออกจากระบบ** button) — it is never hard-coded in the page. The key is shared with Screen B's
  live web chat, so unlocking either surface unlocks both in that tab.
- **Needs `DASHBOARD_TOKEN`** set in Vercel (the passcode) and a storage backend for real
  rows. This deployment uses **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`, already provisioned —
  store `tongjai-ledger`, private); Vercel KV (`KV_REST_API_*`) is also supported and wins
  when both are configured. With neither, the endpoint authenticates fine but returns an
  empty list and the page shows the "ยังไม่มีรายการ" empty state.
- Income (รายรับ) is always `฿0.00` because the bot records **expenses only**; รายจ่ายสุทธิ is
  the sum of all amounts and กำไร/ขาดทุน = `0 − รายจ่าย` (shown negative, red, ▼ — but neutral,
  not red, while the ledger is still empty at ฿0.00).
- The page is same-origin only and HTML-escapes every server-provided string (merchant / ref /
  date originate from OCR of user-uploaded images and are treated as untrusted).

### Endpoints
| Route | Purpose |
|---|---|
| `GET /api/line-webhook` | health check → `ok` |
| `POST /api/line-webhook` | LINE webhook (signature-verified) |
| `GET /api/transactions` | recorded ledger for the dashboard — **auth required** (`Authorization: Bearer $DASHBOARD_TOKEN`, or the `x-dashboard-token` header). Responds `{ ok, count, transactions }`; `transactions` is `[]` when no storage backend is configured, `503` if `DASHBOARD_TOKEN` unset (fails closed), `502` if the storage backend itself fails (never masked as an empty ledger) |
| `POST /api/parse-slip` | OCR a slip for the web chat — **auth required** (same `DASHBOARD_TOKEN`). Body = raw image bytes with an `image/*` content-type. `415` non-image, `400` empty body, `413` over the **3 MB** cap, `422 { ok:false, error:"ocr failed" }` when Groq can't read it, `503 { ok:false, error:"ocr not configured" }` when `GROQ_API_KEY` is unset (misconfiguration is never blamed on the photo); `200 { ok, slipId, data:{ amount, currency, merchant, date, ref } }`. `slipId` = first 10 hex chars of SHA-256 of the image bytes — the LINE bot derives the same identity from the same bytes, so one slip recorded through both channels converges on one ledger row |
| `POST /api/record` | persist one expense from the web chat — **auth required**. JSON `{ amount, entity:"person"\|"company", category:"expense"\|"withholding", date?, ref?, merchant?, slipId? }` (date must be `YYYY-MM-DD`; merchant/ref capped at 40 chars; malformed `slipId` ignored). Writes the **same ledger** as the LINE bot (record carries `channel:"web"`), so it appears on `/dashboard`. Idempotent per `slipId` → `{ ok:true, duplicate:true }` on re-submits. `400` invalid body, `503 { ok:false, error:"storage not configured" }` with no KV/Blob backend, `502 { ok:false, error:"save failed" }` on a backend write failure |
| `GET /api/usage` | Claude Code usage snapshot for the web chat — **public** (usage percentages only — no tokens, no PII), `cache-control: no-store`. A same-origin proxy that only ever fetches the one configured `USAGE_SNAPSHOT_URL` (not an open proxy). `503 { ok:false, error:"usage source not configured" }` until `USAGE_SNAPSHOT_URL` is set; `502 { ok:false, error:"usage source unavailable" }` when the upstream fails or returns an invalid snapshot; `200 { ok:true, usage:{ session, weekly, weekly_sonnet?, estimated?, note?, synced_at? } }` |
| `GET /dashboard` | live passcode-gated finance dashboard page (`dashboard.html`); reads `/api/transactions` |

### Environment variables (set in Vercel → Settings → Environment Variables)
| Name | Required | Purpose |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | LINE reply/push/content auth |
| `LINE_CHANNEL_SECRET` | ✅ | verify `x-line-signature` |
| `GROQ_API_KEY` | ✅ | Groq vision OCR |
| `DASHBOARD_TOKEN` | required for ledger + web chat | shared secret (`Authorization: Bearer …` or `x-dashboard-token`) for `GET /api/transactions`, `POST /api/parse-slip` and `POST /api/record` — it doubles as the passcode of `/dashboard` and of Screen B's live chat. Until set, those endpoints return `503` (fails closed, never open) |
| `BLOB_READ_WRITE_TOKEN` | ✅ (set) | Vercel Blob — persists the ledger (private store `tongjai-ledger`, one immutable blob per record under `ledger/rec/`). Injected automatically when the store is connected to the project |
| `PARSE_MODEL` | optional | override the OCR model. **Must be a Groq VISION-capable model** (the default `meta-llama/llama-4-scout-17b-16e-instruct` is) — a text-only model will fail every slip |
| `DASHBOARD_ORIGIN` | optional | exact origin allowed to read `/api/transactions` from a browser (CORS). Omit for same-origin only — never `*` |
| `USAGE_SNAPSHOT_URL` | optional | source of the Claude Code usage card — the apartment-dashboard deployment's snapshot endpoint, e.g. `https://apartment-dashboard-seven.vercel.app/api/usage/snapshot`. Until set, the usage feature is **off**: `GET /api/usage` returns `503` and the bot answers `usage` with a graceful Thai fallback instead of the card |
| `USAGE_KEYWORDS` | optional | comma-separated, case-insensitive trigger words for the usage card on LINE. Default `usage,เช็ค,/status,status,ยอดใช้` |
| `KV_REST_API_URL` | optional | Vercel KV / Upstash Redis — alternative ledger backend (wins over Blob when both are set) |
| `KV_REST_API_TOKEN` | optional | Vercel KV token |

The interactive flow works **without any storage backend** (state is carried in the
≤300-char postback data); storage only persists the final ledger. Secrets are read from
`process.env` and never logged. The ledger endpoint is **not public**: it requires
`DASHBOARD_TOKEN` and never returns each record's `lineUserId` (PII / push target) —
that field is stripped server-side, along with the internal `dedupeKey`. The payee name
(`merchant`) IS carried through the postback flow and persisted, so the dashboard shows
real payees; when a very long Thai ref + merchant would overflow the 300-char postback
budget, merchant is trimmed first, then ref — both at clean character boundaries.

**Full setup walkthrough (Thai):** see [`LINE_SETUP.md`](LINE_SETUP.md). Webhook URL:
`https://tongjai-renovate.vercel.app/api/line-webhook`.

## Tests

Dependency-free, built on `node:test` — no real network is ever touched (every
outbound fetch is answered by in-memory fakes):

```bash
cd tongjai-renovate
node --test tests/*.test.mjs   # unit + endpoint tests (parse-slip, record, usage, webhook)
```

Browser E2E: `tests/dev-server.mjs` emulates the Vercel deployment in-process —
it serves the static pages (with `cleanUrls`, so `/dashboard` works) and dispatches
`/api/*` to the **real** handlers in `api/`, with Groq/LINE/Blob/usage-snapshot
faked in memory. Then `tests/e2e.mjs` drives the live web chat against it:

```bash
npm i playwright-core          # one-time, repo root (or set PW_MODULE_DIR to a dir that has it)
node tests/e2e.mjs             # spawns the dev server itself, drives the chat in Chromium
node tests/dev-server.mjs      # (optional) run the emulated deployment by hand on $PORT/4173
```

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
npm install tailwindcss @tailwindcss/vite lucide-react
```

Tailwind v4 has no `init`/PostCSS step — register the Vite plugin in `vite.config.js`:

```js
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({ plugins: [react(), tailwindcss()] });
```

and make `src/index.css` a single import:

```css
@import "tailwindcss";
```

(On a legacy Tailwind v3 project the old `@tailwind base/components/utilities`
directives + `npx tailwindcss init -p` still work — the component itself doesn't care.)

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
