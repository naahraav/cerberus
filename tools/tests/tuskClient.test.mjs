import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../src/js/ai/tuskClient.js", import.meta.url), "utf8");

function clientWith(fetch) {
  const window = {
    CerberusTuskParser: {
      createParser: () => ({ push: (chunk) => chunk ? [{ text: chunk }] : [], end: () => [] }),
      extractText: (value) => value.text || "",
      extractAll: (value) => value,
    },
  };
  runInNewContext(source, { window, fetch, URL, Date, Number, Promise, AbortController, TextDecoder, setTimeout, clearTimeout });
  return window.CerberusTuskClient;
}

test("a 429 waits and retries before showing one streamed answer", async () => {
  const calls = [];
  const messages = [];
  const client = clientWith(async (url) => {
    calls.push(url);
    if (calls.length === 1) return new Response("busy", { status: 429, headers: { "Retry-After": "0" } });
    if (url.endsWith("/api/session")) return Response.json({ sessionId: "session", chatId: "chat" });
    return new Response("one answer");
  });
  const state = client.createState();
  state.proxyUrl = "https://proxy.test";
  const answer = await client.chat(state, "joko", "model-1", "A pitch", {
    onWait: (message) => messages.push(message),
  });
  assert.equal(answer, "one answer");
  assert.equal(calls.length, 3);
  assert.equal(messages.length > 0, true);
  assert.match(messages[0], /Retrying/);
});

test("aborting during a rate limit wait prevents a stale retry", async () => {
  let calls = 0;
  const controller = new AbortController();
  const client = clientWith(async () => {
    calls += 1;
    return new Response("busy", { status: 429, headers: { "Retry-After": "10" } });
  });
  const state = client.createState();
  state.proxyUrl = "https://proxy.test";
  await assert.rejects(client.chat(state, "joko", "model-1", "A pitch", {
    signal: controller.signal,
    onWait: () => controller.abort(),
  }), (error) => error.name === "AbortError");
  assert.equal(calls, 1);
});
