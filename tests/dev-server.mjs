// tests/dev-server.mjs
//
// Dependency-free, in-process emulation of the Vercel deployment for E2E
// testing. It serves the static files from the repo root (with cleanUrls, so
// /dashboard → dashboard.html) and dispatches /api/* to the REAL handlers in
// ../api/*.js — the same web-standard (Request → Response) functions Vercel
// runs — while every outbound fetch is intercepted by hostname and answered
// from in-memory fakes. No real network is ever touched: an unmocked host
// throws.
//
// Usage:
//   node tests/dev-server.mjs          # listens on $PORT or 4173
//   import { createServer } from "./dev-server.mjs"  // programmatic
//
// Exposed test seams:
//   lineCalls  — every call the handlers made to api.line.me / api-data.line.me
//   blobStore  — the in-memory Vercel Blob store (pathname → Buffer)

// ---------------------------------------------------------------------------
// 1) Test environment — MUST be in place before the api handlers are imported
//    (they are dynamically imported below, after this block and the fetch
//    patch). KV_* is deliberately absent so the Blob backend is exercised.
// ---------------------------------------------------------------------------
process.env.DASHBOARD_TOKEN = "test-passcode-123";
process.env.BLOB_READ_WRITE_TOKEN = "fake-blob-token";
process.env.GROQ_API_KEY = "fake-groq-key";
process.env.USAGE_SNAPSHOT_URL = "https://usage.example.test/api/usage/snapshot";
process.env.LINE_CHANNEL_SECRET = "test-line-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "fake-line-token";
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE_PNG = fs.readFileSync(path.join(__dirname, "fixtures", "slip.png"));

// ---------------------------------------------------------------------------
// 2) fetch router — intercepts by hostname, throws on anything unmocked
// ---------------------------------------------------------------------------

/** Every call the handlers made to LINE endpoints: {host, path, method, body}. */
export const lineCalls = [];

/** In-memory Vercel Blob store: pathname → Buffer of the stored body. */
export const blobStore = new Map();

const BLOB_HOST = "https://blob.vercel-storage.com";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Normalize whatever fetch was given into a body Buffer. */
async function fetchBodyBuffer(input, init) {
  const b = init && init.body;
  if (b != null) {
    if (typeof b === "string") return Buffer.from(b);
    if (b instanceof ArrayBuffer) return Buffer.from(b);
    if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    // Blob / ReadableStream / URLSearchParams — let Request normalize it.
    const r = new Request("http://body.local/", { method: "POST", body: b, duplex: "half" });
    return Buffer.from(await r.arrayBuffer());
  }
  if (input instanceof Request && input.method !== "GET" && input.method !== "HEAD") {
    return Buffer.from(await input.clone().arrayBuffer());
  }
  return Buffer.alloc(0);
}

function mockGroq() {
  return jsonResponse(200, {
    choices: [
      {
        message: {
          content: JSON.stringify({
            amount: 1250.5,
            currency: "THB",
            merchant: "บจก. วัสดุไทยรุ่งเรือง",
            date: "2026-07-01",
            ref: "TX1234567890",
            rawText: "demo",
          }),
        },
      },
    ],
  });
}

function mockUsage() {
  return jsonResponse(200, {
    session: { pct: 42, resets_at: new Date(Date.now() + 2 * 3600e3).toISOString() },
    weekly: { pct: 63, resets_in_seconds: 86400 * 3 },
    weekly_sonnet: { pct: 12, resets_in_seconds: 86400 * 5 },
    estimated: true,
    note: "estimated from local logs",
    synced_at: new Date().toISOString(),
  });
}

function blobUrlFor(pathname) {
  return BLOB_HOST + "/fake/" + encodeURIComponent(pathname);
}

function mockBlob(url, method, headers, body) {
  // PUT /?pathname=<X>  — store; x-allow-overwrite:0 rejects an existing key
  // with the exact "already exists" 400 the real origin sends (= dedupe).
  if (method === "PUT") {
    const pathname = url.searchParams.get("pathname") || "";
    if (!pathname) return new Response("missing pathname", { status: 400 });
    const allowOverwrite = (headers.get("x-allow-overwrite") || "0") !== "0";
    if (blobStore.has(pathname) && !allowOverwrite) {
      return new Response("blob already exists", { status: 400 });
    }
    blobStore.set(pathname, body);
    return jsonResponse(200, { url: blobUrlFor(pathname), pathname });
  }
  // GET /fake/<encoded pathname>[?...]  — fetch one stored blob (query ignored,
  // matching the immutable-blob-with-?_fresh= read the store layer performs).
  if (method === "GET" && url.pathname.startsWith("/fake/")) {
    let key;
    try {
      key = decodeURIComponent(url.pathname.slice("/fake/".length));
    } catch {
      return new Response("bad pathname", { status: 400 });
    }
    const stored = blobStore.get(key);
    if (stored === undefined) return new Response("not found", { status: 404 });
    return new Response(stored, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  // GET /?prefix=...  — LIST API page ({blobs:[{url}...], hasMore:false}).
  if (method === "GET" && url.searchParams.has("prefix")) {
    const prefix = url.searchParams.get("prefix");
    const blobs = [...blobStore.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => ({ url: blobUrlFor(k), pathname: k }));
    return jsonResponse(200, { blobs, hasMore: false, cursor: "" });
  }
  return new Response("unsupported blob operation", { status: 400 });
}

function mockLine(url, method, body) {
  const call = { host: url.hostname, path: url.pathname, method };
  try {
    call.body = JSON.parse(body.toString("utf8"));
  } catch {
    call.body = null;
  }
  lineCalls.push(call);
  // Message-content download (api-data.line.me) → the fixture slip image.
  if (url.hostname === "api-data.line.me" && method === "GET") {
    return new Response(FIXTURE_PNG, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }
  return jsonResponse(200, {});
}

globalThis.fetch = async function routedFetch(input, init) {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : input instanceof URL ? input.href : String(input));
  const method = ((init && init.method) || (req && req.method) || "GET").toUpperCase();
  const headers = new Headers((init && init.headers) || (req && req.headers) || {});

  switch (url.hostname) {
    case "api.groq.com":
      return mockGroq();
    case "blob.vercel-storage.com":
      return mockBlob(url, method, headers, await fetchBodyBuffer(input, init));
    case "usage.example.test":
      return mockUsage();
    case "api.line.me":
    case "api-data.line.me":
      return mockLine(url, method, await fetchBodyBuffer(input, init));
    default:
      throw new Error("dev-server: outbound network disabled (unmocked host: " + url.hostname + ")");
  }
};

// ---------------------------------------------------------------------------
// 3) The REAL api handlers — dynamically imported AFTER env + fetch are staged
// ---------------------------------------------------------------------------
const API_ROUTES = {
  "/api/transactions": await import("../api/transactions.js"),
  "/api/usage": await import("../api/usage.js"),
  "/api/parse-slip": await import("../api/parse-slip.js"),
  "/api/record": await import("../api/record.js"),
  "/api/line-webhook": await import("../api/line-webhook.js"),
};

// ---------------------------------------------------------------------------
// 4) HTTP server — static files (cleanUrls) + /api dispatch
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

// Hop-by-hop / transport headers that must not be copied into a Request.
const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "expect",
  "proxy-connection",
  "content-length", // recomputed from the actual body buffer
]);

async function handleApi(mod, req, res, url) {
  const method = (req.method || "GET").toUpperCase();
  const handler = mod[method];
  if (typeof handler !== "function") {
    const allow = ["GET", "POST", "OPTIONS", "HEAD"].filter(
      (m) => typeof mod[m] === "function"
    );
    res.statusCode = 405;
    res.setHeader("allow", allow.join(", "));
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
    return;
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bodyBuf = Buffer.concat(chunks);

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (SKIP_REQUEST_HEADERS.has(k)) continue;
    if (Array.isArray(v)) for (const vv of v) headers.append(k, vv);
    else if (v != null) headers.set(k, v);
  }

  const request = new Request(url.href, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : bodyBuf,
    duplex: "half",
  });

  const response = await handler(request);
  res.statusCode = response.status;
  for (const [k, v] of response.headers) res.setHeader(k, v);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function serveStatic(pathname, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return notFound(res);
  }
  if (decoded === "/") decoded = "/index.html";
  // No dotfiles (.git, .env, …) and no traversal out of the repo root.
  if (decoded.split("/").some((seg) => seg.startsWith(".") && seg !== "")) {
    return notFound(res);
  }
  const resolved = path.normalize(path.join(ROOT, decoded));
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    return notFound(res);
  }

  let file = resolved;
  if (!isFile(file) && !path.extname(file) && isFile(file + ".html")) {
    file = file + ".html"; // cleanUrls: /dashboard → dashboard.html
  }
  if (!isFile(file)) return notFound(res);

  res.statusCode = 200;
  res.setHeader("content-type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  res.end(fs.readFileSync(file));
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end("not found");
}

/** Build (but do not start) the emulation server. */
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://" + (req.headers.host || "127.0.0.1"));
      const mod = API_ROUTES[url.pathname];
      if (mod) {
        await handleApi(mod, req, res, url);
        return;
      }
      serveStatic(url.pathname, res);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify({ ok: false, error: "dev server error" }));
    }
  });
}

// ---------------------------------------------------------------------------
// 5) Direct run
// ---------------------------------------------------------------------------
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const port = Number(process.env.PORT) || 4173;
  createServer().listen(port, "127.0.0.1", () => {
    console.log("DEV SERVER READY on http://127.0.0.1:" + port);
  });
}
