// Live conversation runner tests. Loads the browser modules under a minimal
// window shim with a fake tusk client, so the prompt building, responder
// selection, streaming events, and fallback behavior are verified offline.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, "..", "..", "src", "js");

let reviewers;
let liveRoom;

// A scriptable fake client. Tests set `window.__chatImpl` to control replies.
function fakeClient() {
  return {
    createState() {
      return { proxyUrl: "", sessions: {} };
    },
    resetSession() {},
    async chat(state, key, modelId, content, options) {
      if (window.__chatImpl) {
        return window.__chatImpl({ state, key, modelId, content, options });
      }
      return "{}";
    }
  };
}

before(() => {
  globalThis.window = globalThis.window || {};
  window.CerberusHeads = {
    all: [
      { key: "scrath", name: "Joko", epithet: "Buildability", color: "#e25822", motto: "Build it.", scoresOn: "Buildability" },
      { key: "fervent", name: "Kowi", epithet: "Originality", color: "#ffb142", motto: "Make it yours.", scoresOn: "Originality" },
      { key: "warden", name: "Dodo", epithet: "Clarity", color: "#a9c983", motto: "Make it clear.", scoresOn: "Clarity" }
    ],
    keywords: {
      hype: ["revolution", "for everyone"],
      sensitive: ["medical", "loan"],
      pain: ["frustrat", "waste"],
      niche: ["bakery", "bike"]
    }
  };
  window.CerberusTuskClient = fakeClient();
  require(`${BASE}/ai/reviewers.js`);
  require(`${BASE}/ai/liveRoom.js`);
  reviewers = window.CerberusReviewers;
  liveRoom = window.CerberusLiveRoom;
});

test("conversationPrompt stays in character and forbids the verdict schema", () => {
  const prompt = reviewers.conversationPrompt("scrath", {
    transcript: "Founder: we build a bike repair bot.",
    userText: "Is this buildable?",
    pitch: { title: "BikeBot", description: "Repairs bikes." }
  });
  assert.match(prompt, /You are Joko/);
  assert.match(prompt, /Buildability/);
  assert.match(prompt, /Is this buildable\?/);
  assert.match(prompt, /no JSON/i);
  assert.doesNotMatch(prompt, /"score"/);
});

test("conversationPrompt asks for a specific and direct response", () => {
  const prompt = reviewers.conversationPrompt("warden", {
    transcript: "Founder: a bakery app.\nKowi: Strong niche, who pays?",
    userText: "The bakery owners pay.",
    pitch: { title: "BakeryApp", description: "For bakeries." }
  });
  assert.match(prompt, /Respond to a detail/i);
  assert.match(prompt, /Ask one direct question/i);
});

test("openingPrompt uses the written pitch to ask one lens-specific question", () => {
  const prompt = reviewers.openingPrompt("fervent", {
    pitch: { title: "BakeryApp", description: "A log for bakeries.", audience: "Small bakeries" }
  });
  assert.match(prompt, /You are Kowi/);
  assert.match(prompt, /Originality/);
  assert.match(prompt, /BakeryApp/);
  assert.match(prompt, /one focused question/i);
  assert.match(prompt, /do not assume the founder has replied in chat/i);
  assert.match(prompt, /no JSON/i);
  assert.doesNotMatch(prompt, /"score"/);
});

test("openingResponder picks the opener from the pitch's strongest signal", () => {
  assert.equal(liveRoom.openingResponder({ title: "We handle medical records" }), "warden");
  assert.equal(liveRoom.openingResponder({ title: "A revolution for everyone" }), "scrath");
  assert.equal(liveRoom.openingResponder({ title: "A bike repair co-op" }), "fervent");
  assert.equal(liveRoom.openingResponder({ title: "An app" }), "warden");
});

test("runOpening streams through the selected reviewer model and conversation session", async () => {
  let called;
  window.__chatImpl = async ({ key, modelId, state, options }) => {
    called = { key, modelId, proxyUrl: state.proxyUrl };
    options.onDelta("So this is BikeBot.");
    options.onDelta(" What ships first?");
    return "So this is BikeBot. What ships first?";
  };
  const events = [];
  const replies = await liveRoom.runOpening({
    state: window.CerberusTuskClient.createState(),
    proxyUrl: "https://proxy.example",
    models: { scrath: "m1", fervent: "m2", warden: "m3" },
    pitch: { title: "BikeBot", description: "A bike repair co-op.", audience: "Co-ops" },
    onReply: (key, event) => events.push([key, event])
  });
  assert.ok(Array.isArray(replies));
  assert.equal(replies.length, 1);
  assert.equal(called.key, "conv-fervent");
  assert.equal(called.modelId, "m2");
  assert.equal(called.proxyUrl, "https://proxy.example");
  const deltas = events.filter(([, e]) => typeof e.delta === "string");
  assert.ok(deltas.length >= 2);
  assert.ok(events.find(([, e]) => e.done));
});

test("runOpening propagates a model failure for the room to display and retry", async () => {
  window.__chatImpl = async () => {
    throw new Error("proxy unreachable");
  };
  const replies = liveRoom.runOpening({
    state: window.CerberusTuskClient.createState(),
    models: { scrath: "m1", fervent: "m2", warden: "m3" },
    pitch: { title: "BikeBot", description: "A bike repair co-op." }
  });
  await assert.rejects(replies, /proxy unreachable/);
});

test("detect and primaryTrigger route an audience message to Dodo", () => {
  const flags = liveRoom.detect("Who is it for? A named audience.");
  assert.equal(liveRoom.primaryTrigger(flags), "audience");
  assert.deepEqual(liveRoom.respondersFor("Who is it for? A named audience.", 0), ["warden", "scrath"]);
});

test("a hype message summons Joko (and Kowi as secondary)", () => {
  const order = liveRoom.respondersFor("This is a revolution for everyone", 0);
  assert.equal(order[0], "scrath");
  assert.ok(order.includes("fervent"));
});

test("a sensitive message summons all three reviewers", () => {
  const order = liveRoom.respondersFor("We handle medical records", 0);
  assert.equal(order.length, 3);
  assert.equal(order[0], "warden");
});

test("an off-topic line falls back to one rotating responder", () => {
  assert.deepEqual(liveRoom.respondersFor("hello there", 0), ["scrath"]);
  assert.deepEqual(liveRoom.respondersFor("hello there", 1), ["fervent"]);
});

test("buildTranscript renders founder and reviewer lines", () => {
  const text = liveRoom.buildTranscript(
    [
      { from: "user", text: "Idea: a bakery app." },
      { from: "pack", head: "fervent", text: "Strong niche." }
    ],
    12
  );
  assert.match(text, /Founder: Idea: a bakery app\./);
  assert.match(text, /Kowi: Strong niche\./);
});

test("cleanReply strips fences and reviewer name prefixes", () => {
  assert.equal(liveRoom.cleanReply("```json\nJoko: It holds.\n```"), "It holds.");
  assert.equal(liveRoom.cleanReply("Dodo: Say who it is for."), "Say who it is for.");
});

test("cleanReply no longer truncates a long reply with an ellipsis", () => {
  // A full-length reply under the soft cap must survive untouched: this was the
  // bug where judge responses were cut off and replaced with "...".
  const full = ("This pitch names a real user and a first task. ").repeat(15).trim();
  const clean = liveRoom.cleanReply(full);
  assert.equal(clean, full);
  assert.ok(clean.length > 700, "the reply must not be cut at 700 characters");
  assert.ok(!clean.endsWith("..."), "the reply must not end with an ellipsis");
});

test("cleanReply soft cap ends on a whole sentence and never adds an ellipsis", () => {
  // Well over the cap: the result is trimmed, but to a sentence boundary, with
  // no trailing "..." and no mid-word cut.
  const long = "One point stands out here. ".repeat(120).trim();
  assert.ok(long.length > 1500);
  const clean = liveRoom.cleanReply(long);
  assert.ok(clean.length <= 1500, "the reply is capped at the soft limit");
  assert.ok(clean.endsWith("."), "the capped reply ends on a sentence");
  assert.ok(!clean.includes("..."), "no ellipsis is ever introduced");
  assert.ok(/[.!?]$/.test(clean), "the reply ends on real punctuation");
});

test("softCap keeps an over-cap reply whole when no sentence fits", () => {
  // One very long sentence with no boundary inside the cap: fall back to the
  // last word boundary, still with no ellipsis.
  const blob = "word ".repeat(400).trim();
  const capped = liveRoom.softCap(blob, 100);
  assert.ok(capped.length <= 100);
  assert.ok(!capped.endsWith("..."));
  assert.ok(!/\s$/.test(capped), "no trailing whitespace");
  assert.ok(blob.startsWith(capped), "it is a clean prefix of the original");
});

test("cleanReply leaves a reply exactly at the soft cap untouched", () => {
  // Build a sentence that lands exactly on the cap boundary comfortably under it.
  const reply = "A short, complete answer with a clear ask. ".repeat(20).trim();
  assert.ok(reply.length < 1500);
  assert.equal(liveRoom.cleanReply(reply), reply);
});

test("cleanReply salvages readable text from a verdict-shaped JSON reply", () => {
  const raw = JSON.stringify({ score: 82, tier: "Buildable", roast: "The plan holds.", verdict: "It survives contact with reality.", bullets: ["a", "b"] });
  const clean = liveRoom.cleanReply(raw);
  assert.ok(!clean.includes("{"), "JSON braces should be gone");
  assert.ok(clean.includes("It survives contact with reality."));
  assert.ok(!clean.includes("The plan holds."));
});

test("cleanReply keeps the raw text when a JSON-looking reply does not parse", () => {
  assert.equal(liveRoom.cleanReply("{ not: valid json }"), "{ not: valid json }");
});

test("runTurn streams deltas and returns the [{head,text}] shape", async () => {
  window.__chatImpl = async ({ options }) => {
    options.onDelta("Hello");
    options.onDelta(" there");
    return "Hello there";
  };
  const events = [];
  const replies = await liveRoom.runTurn("Who is this for?", {
    state: window.CerberusTuskClient.createState(),
    models: { scrath: "m1", fervent: "m2", warden: "m3" },
    transcript: "",
    turnIndex: 0,
    pitch: {},
    onReply: (key, event) => events.push([key, event])
  });
  assert.ok(Array.isArray(replies));
  assert.equal(replies[0].head, "warden");
  assert.equal(replies[0].text, "Hello there");
  const deltas = events.filter(([, e]) => typeof e.delta === "string");
  assert.ok(deltas.length >= 2);
  const done = events.find(([, e]) => e.done);
  assert.ok(done);
});

test("runTurn feeds each reviewer's reply into the next reviewer's prompt", async () => {
  const prompts = [];
  window.__chatImpl = async ({ key, content }) => {
    prompts.push({ key, content });
    // The client key is "conv-<head>".
    return key === "conv-scrath" ? "First, the risk is real." : "Second, on risk: agreed, plus pull.";
  };
  const replies = await liveRoom.runTurn("This is a revolution for everyone", {
    state: window.CerberusTuskClient.createState(),
    models: { scrath: "m1", fervent: "m2" },
    turnIndex: 0,
    pitch: {},
    onReply: () => {}
  });
  assert.ok(replies.length >= 2, "a hype turn summons at least two reviewers");
  assert.equal(prompts.length, replies.length);
  // The second reviewer's prompt must carry the first reviewer's reply text.
  assert.ok(
    prompts[1].content.includes("First, the risk is real."),
    "the later reviewer should see the earlier reviewer's reply"
  );
});

test("runTurn returns null when every model call fails", async () => {
  window.__chatImpl = async () => {
    throw new Error("proxy unreachable");
  };
  const replies = await liveRoom.runTurn("Who is this for?", {
    state: window.CerberusTuskClient.createState(),
    models: {},
    turnIndex: 0
  });
  assert.equal(replies, null);
});

test("runTurn keeps partial results when only a later head fails", async () => {
  let call = 0;
  window.__chatImpl = async () => {
    call += 1;
    if (call === 1) {
      return "First reviewer reply with enough text.";
    }
    throw new Error("second head failed");
  };
  const replies = await liveRoom.runTurn("This is a revolution for everyone", {
    state: window.CerberusTuskClient.createState(),
    models: {},
    turnIndex: 0
  });
  assert.ok(Array.isArray(replies));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].head, "scrath");
});

test("runTurn aborts when the signal is already aborted", async () => {
  window.__chatImpl = async () => "should not run";
  const controller = new AbortController();
  controller.abort();
  const replies = await liveRoom.runTurn("Who is this for?", {
    state: window.CerberusTuskClient.createState(),
    models: {},
    signal: controller.signal,
    turnIndex: 0
  });
  assert.equal(replies, null);
});
