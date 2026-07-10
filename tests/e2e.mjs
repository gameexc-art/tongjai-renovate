// tests/e2e.mjs
//
// Playwright end-to-end test for the TONGJAI RENOVATE live chat + dashboard,
// driven against tests/dev-server.mjs (real /api handlers, mocked upstreams).
//
// Runs with playwright-core resolved from PW_MODULE_DIR (a scratch dir where
// `npm i playwright-core` was run) and a system chromium binary at
// PW_CHROMIUM (default /opt/pw-browsers/chromium). The repo itself stays
// dependency-free.
//
//   PW_MODULE_DIR=/path/to/scratch PW_CHROMIUM=/opt/pw-browsers/chromium \
//     node tests/e2e.mjs
//
// Exit code 0 only when every scenario passes. Prints a PASS/FAIL table.

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(__dirname, "fixtures", "slip.png");
const TOKEN = "test-passcode-123";
const PORT = Number(process.env.E2E_PORT) || 4372;
const BASE = "http://127.0.0.1:" + PORT;

// ---------------------------------------------------------------------------
// playwright-core + chromium resolution
// ---------------------------------------------------------------------------
// Resolve playwright-core from (in order): PW_MODULE_DIR, the repo root, this
// tests/ dir, or a plain `import` resolution — so `npm i playwright-core`
// anywhere reasonable works and no machine-specific path is baked in.
function resolvePlaywright() {
  const dirs = [process.env.PW_MODULE_DIR, ROOT, __dirname].filter(Boolean);
  for (const dir of dirs) {
    try {
      return createRequire(path.join(dir, "package.json"))("playwright-core");
    } catch { /* try the next location */ }
  }
  throw new Error(
    "playwright-core not found — run `npm i playwright-core` in the repo root " +
    "(or elsewhere and point PW_MODULE_DIR at it)"
  );
}
const { chromium } = resolvePlaywright();

function resolveChromium() {
  let p = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";
  const st = fs.statSync(p); // throws if missing — fail loudly
  if (st.isFile()) return p;
  // A directory (e.g. /opt/pw-browsers/chromium-1194): find the real binary.
  for (const cand of ["chrome-linux/chrome", "chrome", "chromium"]) {
    const full = path.join(p, cand);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  throw new Error("cannot find chromium binary under " + p);
}

// ---------------------------------------------------------------------------
// dev server child process
// ---------------------------------------------------------------------------
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "dev-server.mjs")], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let buf = "";
    const timer = setTimeout(() => {
      reject(new Error("dev server did not print READY within 15s"));
      child.kill("SIGKILL");
    }, 15000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      if (buf.includes("READY")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("dev server exited early with code " + code));
    });
  });
}

// ---------------------------------------------------------------------------
// tiny assertion helpers
// ---------------------------------------------------------------------------
function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + msg);
}
async function getTransactions() {
  const res = await fetch(BASE + "/api/transactions", {
    headers: { Authorization: "Bearer " + TOKEN },
  });
  assert(res.status === 200, "/api/transactions status " + res.status);
  return res.json();
}

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------
const results = [];
async function scenario(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("  PASS  " + name);
  } catch (err) {
    results.push({ name, ok: false, detail: String(err && err.message || err) });
    console.log("  FAIL  " + name + "\n        " + (err && err.stack || err));
    throw err; // scenarios build on each other — stop the chain
  }
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromium(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    // ---- S1: chat tab shows the LIVE welcome, not the demo transcript ----
    await scenario("S1 chat tab → live welcome (no demo transcript)", async () => {
      await page.goto(BASE + "/", { waitUntil: "load" });
      await page.click("#segTab1");
      const welcome = page.locator("#screenB .chat-body .bubble", {
        hasText: "สวัสดีครับ ผม NONEAICE",
      });
      await welcome.waitFor();
      // Demo Starbucks transcript must be gone in live mode.
      const demoSlips = await page.locator("#screenB .slip-merchant").count();
      assert(demoSlips === 0, "demo Starbucks transcript still present (" + demoSlips + " slips)");
      const bodyText = await page.locator("#screenB .chat-body").innerText();
      assert(!bodyText.includes("Starbucks"), "chat body still mentions Starbucks");
      assert(pageErrors.length === 0, "page errors: " + pageErrors.join(" | "));
    });

    // ---- S2: 'usage' → usage card ----
    await scenario("S2 'usage' + Enter → usage card (42% used, Synced)", async () => {
      await page.fill("#chatField", "usage");
      await page.press("#chatField", "Enter");
      const card = page.locator("#screenB .bubble.usagecard");
      await card.waitFor();
      const text = await card.innerText();
      assert(text.includes("Claude Code Usage"), "missing 'Claude Code Usage' in card");
      assert(text.includes("42% used"), "missing '42% used' in card");
      assert(text.includes("Synced"), "missing 'Synced' in card");
    });

    // ---- S3: attach → gate (wrong then right pass) → slip → record flow ----
    await scenario("S3 attach + passcode gate + slip OCR + record", async () => {
      await page.click("#screenB .ci-attach");
      const gateForm = page.locator("#screenB .gate-form");
      await gateForm.waitFor();

      // wrong passcode → inline error
      await gateForm.locator(".gate-input").fill("nope");
      await gateForm.locator("button[type=submit]").click();
      const err = gateForm.locator(".gate-err.show");
      await err.waitFor();
      const errText = (await err.innerText()).trim();
      assert(errText.length > 0, "gate error text empty");

      // correct passcode → unlock; the picker is offered as an explicit tap
      // (a programmatic click after the async unlock would be blocked by the
      // browser's user-activation rules), and tapping it opens the chooser.
      await gateForm.locator(".gate-input").fill(TOKEN);
      await gateForm.locator("button[type=submit]").click();
      await page
        .locator("#screenB .chat-body .bubble", { hasText: "ปลดล็อกแล้ว" })
        .waitFor();
      const pickBtn = page
        .locator("#screenB .cbtn", { hasText: "เลือกรูปสลิป" })
        .last();
      await pickBtn.waitFor();
      const chooserPromise = page.waitForEvent("filechooser");
      await pickBtn.click();
      const chooser = await chooserPromise;
      await chooser.setFiles(FIXTURE);

      // OCR receipt card
      const receipt = page.locator("#screenB .bubble.receipt").last();
      await receipt.waitFor();
      const rText = await receipt.innerText();
      assert(rText.includes("1,250.50"), "receipt missing amount 1,250.50: " + rText);
      assert(rText.includes("บจก. วัสดุไทยรุ่งเรือง"), "receipt missing merchant: " + rText);

      // step 1: entity
      await receipt.locator("button", { hasText: "บุคคล" }).click();
      const prompt = page
        .locator("#screenB .chat-body .bubble", { hasText: "เลือกประเภทค่าจ่าย" })
        .last();
      await prompt.waitFor();

      // step 2: category → success
      await prompt.locator("button", { hasText: "ค่าของ" }).click();
      await page
        .locator("#screenB .success", { hasText: "✅ บันทึกเป็นใบรับรองแทนแล้วครับ" })
        .waitFor();
    });

    // ---- S4: server-side ledger has exactly the web record ----
    await scenario("S4 /api/transactions → 1 sanitized web record", async () => {
      const data = await getTransactions();
      assert(data.ok === true, "ok !== true");
      assert(data.count === 1, "count is " + data.count + ", want 1");
      const tx = data.transactions[0];
      assert(tx.amount === 1250.5, "amount is " + tx.amount);
      assert(tx.entity === "person", "entity is " + tx.entity);
      assert(tx.category === "expense", "category is " + tx.category);
      assert(tx.channel === "web", "channel is " + tx.channel);
      assert(!("lineUserId" in tx), "lineUserId leaked to the dashboard payload");
    });

    // ---- S5: same slip again → duplicate message, count stays 1 ----
    await scenario("S5 duplicate slip → duplicate message, count still 1", async () => {
      const chooserPromise = page.waitForEvent("filechooser");
      await page.click("#screenB .ci-attach"); // token cached → straight to chooser
      const chooser = await chooserPromise;
      await chooser.setFiles(FIXTURE);

      const receipts = page.locator("#screenB .bubble.receipt");
      await receipts.nth(1).waitFor(); // the second receipt card
      const receipt = receipts.last();
      await receipt.locator("button", { hasText: "บุคคล" }).click();
      const prompt = page
        .locator("#screenB .chat-body .bubble", { hasText: "เลือกประเภทค่าจ่าย" })
        .last();
      await prompt.waitFor();
      await prompt.locator("button", { hasText: "ค่าของ" }).click();

      await page
        .locator("#screenB .success", { hasText: "รายการนี้ถูกบันทึกไว้แล้วครับ ✅" })
        .waitFor();

      const data = await getTransactions();
      assert(data.count === 1, "count after duplicate is " + data.count + ", want 1");
    });

    // ---- S6: reload stays live; /dashboard gate + ledger row ----
    await scenario("S6 reload stays live; /dashboard shows the ledger row", async () => {
      await page.reload({ waitUntil: "load" });
      await page.click("#segTab1");
      await page
        .locator("#screenB .chat-body .bubble", { hasText: "สวัสดีครับ ผม NONEAICE" })
        .waitFor();

      const dash = await ctx.newPage();
      dash.setDefaultTimeout(10000);
      await dash.goto(BASE + "/dashboard", { waitUntil: "load" });
      await dash.locator("#gate:not([hidden])").waitFor();
      await dash.fill("#pw", TOKEN);
      await dash.click("#gateBtn");
      const row = dash.locator(".txrow", { hasText: "1,250.50" });
      await row.waitFor();
      const rowText = await row.innerText();
      assert(rowText.includes("บจก. วัสดุไทยรุ่งเรือง"), "row missing merchant: " + rowText);
      await dash.close();
    });

    // ---- S7: file:// keeps the scripted demo, zero /api traffic ----
    await scenario("S7 file:// → demo transcript, canned reply, toast, no /api", async () => {
      const demo = await ctx.newPage();
      demo.setDefaultTimeout(10000);
      const apiHits = [];
      demo.on("request", (req) => {
        if (/https?:\/\/[^/]+\/api\//.test(req.url()) || req.url().includes("/api/")) {
          apiHits.push(req.method() + " " + req.url());
        }
      });
      await demo.goto(pathToFileURL(path.join(ROOT, "index.html")).href, {
        waitUntil: "load",
      });
      await demo.click("#segTab1");

      // demo transcript intact
      await demo
        .locator("#screenB .slip-merchant", { hasText: "Starbucks Coffee" })
        .waitFor();

      // typing gets the canned reply
      await demo.fill("#chatField", "สวัสดี");
      await demo.press("#chatField", "Enter");
      await demo
        .locator("#screenB .chat-body .bubble", {
          hasText: "ส่งรูปสลิป/ใบเสร็จมาได้เลยครับ",
        })
        .waitFor();

      // attach shows the demo toast
      await demo.click("#screenB .ci-attach");
      const toast = demo.locator("#toastEl.show");
      await toast.waitFor();
      const toastText = await toast.innerText();
      assert(toastText.includes("เดโม"), "toast is not the demo toast: " + toastText);

      assert(apiHits.length === 0, "file:// page hit /api: " + apiHits.join(", "));
      await demo.close();
    });
  } finally {
    await browser.close().catch(() => {});
    server.kill("SIGKILL");
  }
}

main()
  .catch(() => {})
  .then(() => {
    // per-scenario table
    console.log("\n================ E2E RESULTS ================");
    let allOk = results.length === 7;
    for (const r of results) {
      console.log((r.ok ? "PASS" : "FAIL") + "  " + r.name + (r.ok ? "" : "  — " + r.detail));
      if (!r.ok) allOk = false;
    }
    if (results.length < 7) {
      console.log("(only " + results.length + "/7 scenarios ran — earlier failure aborted the chain)");
    }
    console.log("=============================================");
    process.exit(allOk ? 0 : 1);
  });
