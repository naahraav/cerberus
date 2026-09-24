// Tusk AI proxy for Cerberus AI
//
// Why this exists: the Tusk model API at new.tusksearch.com is keyless but
// only accepts requests that carry an Origin/Referer of its own site, and it
// sends no CORS headers. A browser page therefore cannot call it directly.
// This proxy adds those headers and relays the stream back to the browser.
//
// It is a transparent forwarder. It stores nothing, needs no API key, and only
// exposes three routes. Run it locally next to the Cerberus page.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The upstream base URL is overridable only so tests can point at a stub.
// The Origin/Referer the upstream expects is always the real Tusk origin, even
// when the base URL is redirected to a local stub.
const UPSTREAM_BASE = process.env.UPSTREAM_ORIGIN || "https://new.tusksearch.com";
const ORIGIN = "https://new.tusksearch.com";
const CREATE_CONVERSATION_URL = `${UPSTREAM_BASE}/api/v2/chat/conversations`;
const SEND_MESSAGE_URL = `${UPSTREAM_BASE}/api/V2/Chat`;
const UPSTREAM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const PORT = Number(process.env.PORT || 8787);
// Bind all interfaces by default so a hosted container is reachable. Local dev
// can set HOST=127.0.0.1 to keep it loopback-only.
const HOST = process.env.HOST || "0.0.0.0";

// CORS: a comma-separated allow-list of site origins, or "*" to reflect any
// origin. Set ALLOW_ORIGIN to your live site (for example
// "https://cerberus.example.com") so only your page can spend the upstream.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const ALLOWED_ORIGINS = ALLOW_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean);

const log = (...args) => {
  if (process.env.QUIET !== "1") console.error("[tusk-proxy]", ...args);
};

function upstreamHeaders() {
  return {
    Origin: ORIGIN,
    Referer: `${ORIGIN}/`,
    "User-Agent": UPSTREAM_UA,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
  };
}

// Work out the Access-Control-Allow-Origin for a request. With "*" we echo "*";
// with an allow-list we echo the request Origin only when it is permitted, and
// fall back to the first configured origin otherwise.
function allowOriginFor(req) {
  if (ALLOWED_ORIGINS.length === 1 && ALLOWED_ORIGINS[0] === "*") {
    return "*";
  }
  const origin = req && req.headers ? req.headers.origin : "";
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    return origin;
  }
  return ALLOWED_ORIGINS[0] || "*";
}

function corsHeaders(req) {
  return {
    "Access-Control-Allow-Origin": allowOriginFor(req),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "Retry-After",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function sendJson(res, status, payload, req, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...corsHeaders(req),
    ...extraHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function retryHeaders(upstream) {
  const retryAfter = upstream.headers.get("Retry-After");
  return retryAfter ? { "Retry-After": retryAfter } : {};
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function handleModels(req, res) {
  try {
    const raw = await readFile(join(__dirname, "models.json"), "utf8");
    res.writeHead(200, {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(raw);
  } catch (error) {
    log("models read failed:", error.message);
    sendJson(res, 500, { error: "Model catalog unavailable" }, req);
  }
}

async function handleHealth(req, res) {
  sendJson(res, 200, {
    ok: true,
    upstream: UPSTREAM_BASE,
    service: "tusk-proxy",
    models: "GET /api/models",
  }, req);
}

async function handleSession(req, res) {
  let payload;
  try {
    payload = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: `Invalid request body: ${error.message}` }, req);
    return;
  }

  const aiModelId = payload.aiModelId || payload.modelId;
  if (!aiModelId) {
    sendJson(res, 400, { error: "aiModelId is required" }, req);
    return;
  }

  const body = {
    role: "user",
    content: payload.content || "Initialize conversation session.",
    aiModelId,
    chatAiModelType: "text",
    askClarifyingQuestion: false,
  };

  try {
    const upstream = await fetch(CREATE_CONVERSATION_URL, {
      method: "POST",
      headers: upstreamHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok) {
      const detail = await safeText(upstream);
      log(`session upstream HTTP ${upstream.status}`);
      sendJson(res, upstream.status, {
        error: `Upstream HTTP ${upstream.status}`,
        detail,
      }, req, retryHeaders(upstream));
      return;
    }

    const json = await upstream.json();
    sendJson(res, 200, json, req);
  } catch (error) {
    log("session failed:", error.message);
    sendJson(res, 502, { error: `Upstream unreachable: ${error.message}` }, req);
  }
}

async function safeText(response) {
  try {
    return (await response.text()).slice(0, 1000);
  } catch {
    return "";
  }
}

// Relay the streamed chat response to the browser. The upstream sends
// newline-delimited JSON objects; we forward each chunk as it arrives so the
// browser can parse the same stream the desktop app does.
async function handleChat(req, res) {
  let payload;
  try {
    payload = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: `Invalid request body: ${error.message}` }, req);
    return;
  }

  const { sessionId, chatId, aiModelId } = payload;
  if (!sessionId || !chatId || !aiModelId) {
    sendJson(res, 400, {
      error: "sessionId, chatId and aiModelId are required",
    }, req);
    return;
  }

  const body = {
    sessionId,
    chatId,
    role: "user",
    content: payload.content || "",
    aiModelId,
    grokproOptions: null,
    voiceAndTone: payload.voiceAndTone || "analytical",
    askClarifyingQuestion: false,
    isWebSearchEnabled: Boolean(payload.isWebSearchEnabled),
    isLocationEnabled: false,
    location: null,
    inputMode: "text",
    snowplow: { sessionId, networkId: null },
  };

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const upstream = await fetch(SEND_MESSAGE_URL, {
      method: "POST",
      headers: upstreamHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const detail = await safeText(upstream);
      log(`chat upstream HTTP ${upstream.status}`);
      sendJson(res, upstream.status, {
        error: `Upstream HTTP ${upstream.status}`,
        detail,
      }, req, retryHeaders(upstream));
      return;
    }

    // Stream in real time. The response is a ReadableStream of Buffers.
    res.writeHead(200, {
      ...corsHeaders(req),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });

    for await (const chunk of upstream.body) {
      res.write(chunk);
    }
    res.end();
  } catch (error) {
    if (error.name === "AbortError") {
      log("chat aborted by client");
      if (!res.headersSent) {
        sendJson(res, 499, { error: "Client aborted the request" }, req);
      } else {
        res.end();
      }
      return;
    }
    log("chat failed:", error.message);
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Upstream unreachable: ${error.message}` }, req);
    } else {
      res.end();
    }
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  // A root identity route so host health checks and a browser probe succeed.
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    handleHealth(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    handleHealth(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/models") {
    handleModels(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/session") {
    handleSession(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/chat") {
    handleChat(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not found" }, req);
});

server.listen(PORT, HOST, () => {
  const bound = server.address().port;
  log(`listening on http://${HOST}:${bound}`);
  log(`routes: GET /api/health, GET /api/models, POST /api/session, POST /api/chat`);
  // Machine-readable line so test helpers can bind an ephemeral port.
  console.log(`PORT=${bound}`);
});

export { server };
