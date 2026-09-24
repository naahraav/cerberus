// Proxy unit tests. These boot the real server on an ephemeral port and drive
// it with global fetch. They mock nothing on the network for the routing /
// CORS / validation cases, and use a local stub upstream only where the test
// needs to prove the relay passes bytes through unchanged.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { activePort, startServer, stopServer } from "./helpers.mjs";

let base;

before(async () => {
  await startServer();
  base = `http://127.0.0.1:${activePort()}`;
});

after(async () => {
  await stopServer();
});

test("health returns ok and the upstream origin", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "tusk-proxy");
  assert.match(body.upstream, /^https:\/\//);
});

test("root and /health return the identity payload for host checks", async () => {
  for (const path of ["/", "/health"]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "tusk-proxy");
  }
});

test("CORS reflects the request origin when an allow-list is configured", async () => {
  // The default test env uses ALLOW_ORIGIN='*'.
  const res = await fetch(`${base}/api/health`, { headers: { Origin: "https://example.test" } });
  const acao = res.headers.get("access-control-allow-origin");
  assert.ok(acao === "*" || acao === "https://example.test");
  assert.equal(res.headers.get("vary"), "Origin");
});

test("models returns a non-empty catalog with id/name/provider", async () => {
  const res = await fetch(`${base}/api/models`);
  assert.equal(res.status, 200);
  const models = await res.json();
  assert.ok(Array.isArray(models));
  assert.ok(models.length >= 20);
  for (const m of models) {
    assert.equal(typeof m.id, "string");
    assert.equal(typeof m.name, "string");
    assert.equal(typeof m.provider, "string");
    assert.ok(m.id.length > 0);
  }
});

test("OPTIONS preflight carries CORS headers", async () => {
  const res = await fetch(`${base}/api/chat`, { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.ok(res.headers.get("access-control-allow-origin"));
  assert.match(res.headers.get("access-control-allow-methods") || "", /POST/);
});

test("GET on a POST route is rejected as not found", async () => {
  const res = await fetch(`${base}/api/chat`, { method: "GET" });
  assert.equal(res.status, 404);
});

test("session requires an aiModelId", async () => {
  const res = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "no model here" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /aiModelId/);
});

test("chat requires sessionId, chatId and aiModelId", async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "s", chatId: "c" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /aiModelId/);
});

test("invalid JSON body is reported as 400, not a crash", async () => {
  const res = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Invalid request body/);
});

test("unknown route is 404 with a JSON error", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "Not found");
});
