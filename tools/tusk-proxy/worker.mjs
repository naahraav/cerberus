// Tusk AI proxy for Cerberus AI — Cloudflare Worker edition.
//
// Same job as server.mjs (the local Node proxy), but hosted on Cloudflare's
// edge so the page can connect to it automatically with no one running node:
//
//   browser -> this Worker -> https://new.tusksearch.com -> stream back
//
// Why a proxy at all: the Tusk API is keyless but only answers requests that
// carry an Origin/Referer of its own site, and it sends no CORS headers. A
// browser cannot set Origin and cannot read a cross-origin response without
// CORS, so the page cannot call Tusk directly. A Worker can set the headers and
// relay the stream, which is exactly what this does. It stores nothing.
//
// Routes (identical to server.mjs):
//   GET  /            identity + health
//   GET  /health      identity + health
//   GET  /api/health  { ok, upstream, service }
//   GET  /api/models  the model catalog
//   POST /api/session { aiModelId, content? }  -> conversation ids
//   POST /api/chat    { sessionId, chatId, aiModelId, content, ... } -> stream
//
// Deploy:  npx wrangler deploy   (from tools/tusk-proxy, see wrangler.toml)

import MODELS from "./models.json" with { type: "json" };

// The upstream base URL is overridable only so tests can point at a stub. The
// Origin/Referer the upstream expects is always the real Tusk origin.
const DEFAULT_UPSTREAM = "https://new.tusksearch.com";
const ORIGIN = "https://new.tusksearch.com";
const UPSTREAM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function upstreamBase(env) {
  return (env && env.UPSTREAM_ORIGIN) || DEFAULT_UPSTREAM;
}

function upstreamHeaders() {
  return {
    Origin: ORIGIN,
    Referer: `${ORIGIN}/`,
    "User-Agent": UPSTREAM_UA,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
  };
}

// Work out the Access-Control-Allow-Origin for a request. "*" reflects any
// origin; an allow-list echoes the request Origin only when permitted, and
// falls back to the first configured origin otherwise.
function allowedOrigins(env) {
  const raw = (env && env.ALLOW_ORIGIN) || "*";
  return String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function allowOriginFor(request, env) {
  const list = allowedOrigins(env);
  if (list.length === 1 && list[0] === "*") {
    return "*";
  }
  const origin = request.headers.get("Origin") || "";
  if (origin && list.indexOf(origin) !== -1) {
    return origin;
  }
  return list[0] || "*";
}

function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Origin": allowOriginFor(request, env),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "Retry-After",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(request, env, status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request, env),
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function retryHeaders(upstream) {
  const retryAfter = upstream.headers.get("Retry-After");
  return retryAfter ? { "Retry-After": retryAfter } : {};
}

async function readJson(request) {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("Invalid request body: " + error.message);
  }
}

async function safeText(response) {
  try {
    return (await response.text()).slice(0, 1000);
  } catch {
    return "";
  }
}

async function handleHealth(request, env) {
  return json(request, env, 200, {
    ok: true,
    upstream: upstreamBase(env),
    service: "tusk-proxy",
    models: "GET /api/models",
  });
}

async function handleModels(request, env) {
  return new Response(JSON.stringify(MODELS), {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function handleSession(request, env) {
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json(request, env, 400, { error: error.message });
  }

  const aiModelId = payload.aiModelId || payload.modelId;
  if (!aiModelId) {
    return json(request, env, 400, { error: "aiModelId is required" });
  }

  const body = {
    role: "user",
    content: payload.content || "Initialize conversation session.",
    aiModelId,
    chatAiModelType: "text",
    askClarifyingQuestion: false,
  };

  try {
    const upstream = await fetch(`${upstreamBase(env)}/api/v2/chat/conversations`, {
      method: "POST",
      headers: upstreamHeaders(),
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const detail = await safeText(upstream);
      return json(request, env, upstream.status, {
        error: `Upstream HTTP ${upstream.status}`,
        detail,
      }, retryHeaders(upstream));
    }

    const data = await upstream.json();
    return json(request, env, 200, data);
  } catch (error) {
    return json(request, env, 502, { error: `Upstream unreachable: ${error.message}` });
  }
}

// Relay the streamed chat response to the browser. The upstream sends
// newline-delimited JSON objects; we forward the body stream straight through
// so the browser parses the same bytes the desktop app does.
async function handleChat(request, env) {
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json(request, env, 400, { error: error.message });
  }

  const { sessionId, chatId, aiModelId } = payload;
  if (!sessionId || !chatId || !aiModelId) {
    return json(request, env, 400, { error: "sessionId, chatId and aiModelId are required" });
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

  let upstream;
  try {
    upstream = await fetch(`${upstreamBase(env)}/api/V2/Chat`, {
      method: "POST",
      headers: upstreamHeaders(),
      body: JSON.stringify(body),
    });
  } catch (error) {
    return json(request, env, 502, { error: `Upstream unreachable: ${error.message}` });
  }

  if (!upstream.ok) {
    const detail = await safeText(upstream);
    return json(request, env, upstream.status, {
      error: `Upstream HTTP ${upstream.status}`,
      detail,
    }, retryHeaders(upstream));
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

// The Worker entry point. Exported so tests can call it directly in Node.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return handleHealth(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return handleHealth(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/models") {
      return handleModels(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/session") {
      return handleSession(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(request, env);
    }

    return json(request, env, 404, { error: "Not found" });
  },
};

// Named exports for unit tests.
export { handleChat, handleHealth, handleModels, handleSession, corsHeaders };
