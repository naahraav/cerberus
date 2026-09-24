// Suggester tests. The on-device generator is deterministic, so these assert the
// shape (at most two, unique, non-empty) and that it reacts to what the pitch
// is still missing. The live path is not tested here because it depends on a
// third-party model.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, "..", "..", "src", "js");

let suggest;

before(() => {
  globalThis.window = globalThis.window || {};
  require(`${BASE}/core/heads.js`);
  // The client and reviewers are read at load time; stub them so the module
  // loads without the browser.
  globalThis.window.CerberusTuskClient = globalThis.window.CerberusTuskClient || {};
  globalThis.window.CerberusReviewers = globalThis.window.CerberusReviewers || { defaultModels: {} };
  require(`${BASE}/ai/suggest.js`);
  suggest = window.CerberusSuggest;
});

const THIN = { title: "An app", description: "", audience: "" };
const RICH = {
  title: "Campus Co-op Repair Log",
  description:
    "Campus bike co-ops lose the repair history of shared bikes. A dated log records each tune-up, so the next mechanic sees what was done. The first version ships next week.",
  audience: "Student bike co-ops",
  category: "web3"
};

test("contextualQuestions returns at most two unique, non-empty strings", () => {
  const list = suggest.contextualQuestions(THIN, "");
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0 && list.length <= 2, `bad length: ${list.length}`);
  const seen = new Set();
  list.forEach((q) => {
    assert.equal(typeof q, "string");
    assert.ok(q.trim().length > 0);
    assert.ok(q.length <= 160, `too long: ${q}`);
    assert.equal(seen.has(q.toLowerCase()), false, `duplicate: ${q}`);
    seen.add(q.toLowerCase());
  });
});

test("a thin pitch asks who it is for and what ships first", () => {
  const list = suggest.contextualQuestions(THIN, "").join(" ").toLowerCase();
  assert.ok(/who/.test(list), "expected a who-is-it-for question");
  assert.ok(/ship|first version|smallest/.test(list), "expected a first-step question");
});

test("hype in the pitch asks for a provable claim", () => {
  const hyped = {
    title: "Revolution",
    description: "This will change the world for everyone, a game changer for the future.",
    audience: "Everyone"
  };
  const list = suggest.contextualQuestions(hyped, "").join(" ").toLowerCase();
  assert.ok(/prove|claim/.test(list), "expected a prove-the-claim question");
});

test("a regulated pitch asks about compliance", () => {
  const medical = {
    title: "Health check",
    description: "A medical app that helps a doctor diagnose a condition.",
    audience: "Clinic nurses"
  };
  const list = suggest.contextualQuestions(medical, "").join(" ").toLowerCase();
  assert.ok(/complian|public|regulat/.test(list), "expected a compliance question");
});

test("the conversation is read: naming a user fills the who gap", () => {
  const withoutChat = suggest.contextualQuestions(THIN, "");
  const withChat = suggest.contextualQuestions(
    THIN,
    "Founder: this is for solo founders who ship alone\nFounder: the first version ships next week"
  );
  // The audience-gap line is sent in an empty room, but the chat names the
  // user, so that specific line drops out. The lines are founder-voice, so the
  // gap shows up as "exactly who has this problem".
  const audienceGap = "exactly who has this problem";
  assert.ok(withoutChat.join(" ").toLowerCase().includes(audienceGap));
  assert.equal(withChat.join(" ").toLowerCase().includes(audienceGap), false);
  // And the answered first-step gap drops out too.
  assert.equal(withChat.join(" ").toLowerCase().includes("smallest version"), false);
});

test("parseQuestions salvages questions from a strict JSON reply", () => {
  const raw = '{"questions":["Who is the first user?","What ships this week?"]}';
  const list = suggest.parseQuestions(raw);
  assert.deepEqual(list, ["Who is the first user?", "What ships this week?"]);
});

test("parseQuestions is tolerant of prose and code fences", () => {
  const raw = "Here you go:\n```json\n{\"questions\":[\"What is the first step?\"]}\n```\n";
  const list = suggest.parseQuestions(raw);
  assert.ok(list.includes("What is the first step?"));
});
