// Worker tests. The Worker is a plain ES module with a fetch handler, so it can
// be exercised directly in Node: we call Worker.fetch(request, env) and stub the
// global fetch() that the Worker uses to reach the upstream. No Cloudflare
// runtime and no network are needed.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import worker from "./worker.mjs";

const STREAM_FRAMES = [
  '{"role":"assistant","content":"{\\"content\\":\\"Hel\\"}"}\n',
  '{"role":"assistant","content":"{\\"content\\":\\"lo\\"}"}\n',
  '{"role":"assistant","content":"{\\"isComplete\\":true,\\"content\\":\\"\\"}"}\n',
];

let realFetch;
let calls; // records the upstream fetches the Worker makes

before(() => {
  realFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
});

// Install a stub upstream. `handler(url, init)` returns a Response, or a plain
// object the stub turns into JSON.
function stubUpstream(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const result = await handler(String(url), init || {});
    if (result instanceof Response) {
      return result;
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function req(path, options) {
  return new Request(`https://proxy.example${path}`, options);
}

test("GET /api/health returns ok and the upstream origin", async () => {
  const res = await worker.fetch(req("/api/health"), {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "tusk-proxy");
  assert.match(body.upstream, /^https:\/\//);
});

test("GET / and /health return the identity payload", async () => {
  for (const path of ["/", "/health"]) {
    const res = await worker.fetch(req(path), {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  }
});

test("GET /api/models returns the catalog inlined at build time", async () => {
  const res = await worker.fetch(req("/api/models"), {});
  assert.equal(res.status, 200);
  const models = await res.json();
  assert.ok(Array.isArray(models));
  assert.ok(models.length >= 20);
  for (const m of models) {
    assert.equal(typeof m.id, "string");
    assert.equal(typeof m.name, "string");
    assert.equal(typeof m.provider, "string");
  }
});

test("OPTIONS preflight carries CORS headers", async () => {
  const res = await worker.fetch(req("/api/chat", { method: "OPTIONS" }), {});
  assert.equal(res.status, 204);
  assert.ok(res.headers.get("access-control-allow-origin"));
  assert.match(res.headers.get("access-control-allow-methods") || "", /POST/);
  assert.equal(res.headers.get("vary"), "Origin");
});

test("CORS echoes the request origin when an allow-list matches", async () => {
  const env = { ALLOW_ORIGIN: "https://cerberus.example.com" };
  const res = await worker.fetch(
    req("/api/health", { headers: { Origin: "https://cerberus.example.com" } }),
    env
  );
  assert.equal(res.headers.get("access-control-allow-origin"), "https://cerberus.example.com");
});

test("CORS blocks a foreign origin when an allow-list is set", async () => {
  const env = { ALLOW_ORIGIN: "https://cerberus.example.com" };
  const res = await worker.fetch(
    req("/api/health", { headers: { Origin: "https://evil.example.com" } }),
    env
  );
  assert.equal(res.headers.get("access-control-allow-origin"), "https://cerberus.example.com");
});

test("session forwards to the conversation endpoint and returns ids", async () => {
  stubUpstream((url) => {
    assert.match(url, /\/api\/v2\/chat\/conversations$/);
    return { sessionId: "sess-1", chatId: "chat-1" };
  });
  const res = await worker.fetch(
    req("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiModelId: "m1" }),
    }),
    {}
  );
  assert.equal(res.status, 200);
  const ids = await res.json();
  assert.equal(ids.sessionId, "sess-1");
  assert.equal(ids.chatId, "chat-1");
});

test("session requires an aiModelId", async () => {
  stubUpstream(() => ({}));
  const res = await worker.fetch(
    req("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "no model" }),
    }),
    {}
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /aiModelId/);
});

test("chat stream passes through unchanged", async () => {
  stubUpstream((url) => {
    assert.match(url, /\/api\/V2\/Chat$/);
    return new Response(STREAM_FRAMES.join(""), {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  });
  const res = await worker.fetch(
    req("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s", chatId: "c", aiModelId: "m1", content: "hi" }),
    }),
    {}
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  const text = await res.text();
  assert.equal(text, STREAM_FRAMES.join(""));
});

test("chat requires sessionId, chatId and aiModelId", async () => {
  stubUpstream(() => ({}));
  const res = await worker.fetch(
    req("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s", chatId: "c" }),
    }),
    {}
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /aiModelId/);
});

test("the Worker injects the Tusk Origin header upstream", async () => {
  stubUpstream(() => {});
  await worker.fetch(
    req("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiModelId: "m1" }),
    }),
    {}
  );
  const header = calls[0].init.headers.Origin;
  assert.equal(header, "https://new.tusksearch.com");
});

test("invalid JSON body is reported as 400, not a crash", async () => {
  stubUpstream(() => ({}));
  const res = await worker.fetch(
    req("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    }),
    {}
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Invalid request body/);
});

test("upstream failure on session surfaces as JSON with the upstream status", async () => {
  stubUpstream(() => new Response("slow down", { status: 429, headers: { "Retry-After": "3" } }));
  const res = await worker.fetch(
    req("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiModelId: "m1" }),
    }),
    {}
  );
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "3");
  assert.equal(res.headers.get("Access-Control-Expose-Headers"), "Retry-After");
  const body = await res.json();
  assert.match(body.error, /Upstream HTTP 429/);
});

test("unknown route is 404 with a JSON error", async () => {
  const res = await worker.fetch(req("/api/nope"), {});
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "Not found");
});

test("UPSTREAM_ORIGIN env overrides the upstream base", async () => {
  stubUpstream(() => ({}));
  await worker.fetch(
    req("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiModelId: "m1" }),
    }),
    { UPSTREAM_ORIGIN: "http://127.0.0.1:1234" }
  );
  assert.match(calls[0].url, /^http:\/\/127\.0\.0\.1:1234\//);
});
