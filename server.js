import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const UPSTREAM_BASE = process.env.UPSTREAM_ORIGIN || "https://new.tusksearch.com";
const ORIGIN = "https://new.tusksearch.com";
const CREATE_CONVERSATION_URL = `${UPSTREAM_BASE}/api/v2/chat/conversations`;
const SEND_MESSAGE_URL = `${UPSTREAM_BASE}/api/V2/Chat`;
const UPSTREAM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const ALLOWED_ORIGINS = ALLOW_ORIGIN.split(",").map((v) => v.trim()).filter(Boolean);

const log = (...args) => {
  if (process.env.QUIET !== "1") console.error("[cerberus-server]", ...args);
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

function allowOriginFor(req) {
  if (ALLOWED_ORIGINS.length === 1 && ALLOWED_ORIGINS[0] === "*") {
    return "*";
  }
  const origin = req.headers?.origin || "";
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return ALLOWED_ORIGINS[0] || "*";
}

const app = express();

// CORS headers for API requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", allowOriginFor(req));
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Max-Age", "600");
  res.header("Vary", "Origin");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// JSON body parsing for API
app.use(express.json({ limit: "2mb" }));

// Health endpoints
const handleHealth = (req, res) => {
  res.json({
    ok: true,
    upstream: UPSTREAM_BASE,
    service: "tusk-proxy",
    models: "GET /api/models",
  });
};

app.get("/health", handleHealth);
app.get("/api/health", handleHealth);

// Models catalog endpoint
app.get("/api/models", async (req, res) => {
  try {
    const raw = await readFile(join(__dirname, "tools", "tusk-proxy", "models.json"), "utf8");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(raw);
  } catch (error) {
    log("models read failed:", error.message);
    res.status(500).json({ error: "Model catalog unavailable" });
  }
});

// Session endpoint
app.post("/api/session", async (req, res) => {
  const payload = req.body || {};
  const aiModelId = payload.aiModelId || payload.modelId;
  if (!aiModelId) {
    return res.status(400).json({ error: "aiModelId is required" });
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
      const detail = await upstream.text().catch(() => "");
      log(`session upstream HTTP ${upstream.status}`);
      return res.status(upstream.status).json({
        error: `Upstream HTTP ${upstream.status}`,
        detail: detail.slice(0, 1000),
      });
    }

    const json = await upstream.json();
    res.json(json);
  } catch (error) {
    log("session failed:", error.message);
    res.status(502).json({ error: `Upstream unreachable: ${error.message}` });
  }
});

// Chat endpoint (streaming)
app.post("/api/chat", async (req, res) => {
  const payload = req.body || {};
  const { sessionId, chatId, aiModelId } = payload;
  if (!sessionId || !chatId || !aiModelId) {
    return res.status(400).json({
      error: "sessionId, chatId and aiModelId are required",
    });
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
      const detail = await upstream.text().catch(() => "");
      log(`chat upstream HTTP ${upstream.status}`);
      return res.status(upstream.status).json({
        error: `Upstream HTTP ${upstream.status}`,
        detail: detail.slice(0, 1000),
      });
    }

    res.writeHead(200, {
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
        return res.status(499).json({ error: "Client aborted the request" });
      }
      return res.end();
    }
    log("chat failed:", error.message);
    if (!res.headersSent) {
      return res.status(502).json({ error: `Upstream unreachable: ${error.message}` });
    }
    res.end();
  }
});

// Serve static assets from project root
app.use(express.static(__dirname, {
  extensions: ["html"],
  index: "index.html",
}));

// Route fallback: 404 for unknown /api/*, otherwise serve index.html
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(join(__dirname, "index.html"));
});

const server = app.listen(PORT, HOST, () => {
  const addr = server.address();
  const bound = addr ? addr.port : PORT;
  log(`listening on http://${HOST}:${bound}`);
  log(`routes: GET /api/health, GET /api/models, POST /api/session, POST /api/chat`);
});

export { app, server };
