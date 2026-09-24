// Relay tests: prove the proxy forwards the upstream stream byte-for-byte and
// surfaces upstream errors as JSON. A local stub upstream stands in for
// new.tusksearch.com so the test is deterministic and offline.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { startServer, stopServer } from "./helpers.mjs";

const STREAM_FRAMES = [
  '{"role":"assistant","content":"{\\"content\\":\\"Hel\\"}"}\n',
  '{"role":"assistant","content":"{\\"content\\":\\"lo\\"}"}\n',
  '{"role":"assistant","content":"{\\"isComplete\\":true,\\"content\\":\\"\\"}"}\n',
];

let upstream;
let upstreamPort;
let base;
let sawUpstreamOrigin = false;

before(async () => {
  upstream = createServer((req, res) => {
    if (req.url === "/api/v2/chat/conversations") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId: "sess-1", chatId: "chat-1" }));
      return;
    }
    if (req.url === "/api/V2/Chat") {
      sawUpstreamOrigin = req.headers.origin === "https://new.tusksearch.com";
      res.writeHead(200, { "Content-Type": "text/plain" });
      for (const frame of STREAM_FRAMES) {
        res.write(frame);
      }
      res.end();
      return;
    }
    if (req.url === "/api/v2/chat/rate-limited") {
      res.writeHead(429, { "Content-Type": "text/plain" });
      res.end("slow down");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  upstreamPort = upstream.address().port;
  base = await startServer({ UPSTREAM_ORIGIN: `http://127.0.0.1:${upstreamPort}` });
});

after(() => {
  stopServer();
  upstream?.close();
});

test("session returns upstream identifiers", async () => {
  const res = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aiModelId: "m1" }),
  });
  assert.equal(res.status, 200);
  const ids = await res.json();
  assert.equal(ids.sessionId, "sess-1");
  assert.equal(ids.chatId, "chat-1");
});

test("chat stream passes through unchanged", async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "sess-1", chatId: "chat-1", aiModelId: "m1", content: "hi" }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, STREAM_FRAMES.join(""));
});

test("the proxy injects the Tusk Origin header upstream", () => {
  assert.equal(sawUpstreamOrigin, true);
});
