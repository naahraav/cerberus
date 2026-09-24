import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
globalThis.window = {};
require(join(ROOT, "src", "js", "ai", "pitchDraft.js"));
const pitchDraft = window.CerberusPitchDraft;

test("draft prompt uses the editable fields and chosen category, including an empty form", () => {
  const prompt = pitchDraft.buildPrompt({ title: "ClinicQueue", audience: "small clinics", description: "A walk-in waitlist.", category: "app" });
  assert.match(prompt, /"category":"app"/);
  assert.match(prompt, /ClinicQueue/);
  assert.match(prompt, /small clinics/);
  assert.match(prompt, /invent one specific idea/i);
  assert.match(prompt, /Do not invent customers, revenue, testing, partnerships, or results/);
  assert.match(pitchDraft.buildPrompt({ category: "physical" }), /"category":"physical"/);
});

test("draft parser accepts structured model text but rejects incomplete and oversized output", () => {
  const draft = pitchDraft.parseDraft('```json\n{"title":"ClinicQueue","audience":"Small clinics","description":"A shared walk-in waitlist."}\n```');
  assert.deepEqual(draft, { title: "ClinicQueue", audience: "Small clinics", description: "A shared walk-in waitlist." });
  assert.throws(() => pitchDraft.parseDraft("not a draft"), /incomplete pitch draft/i);
  assert.throws(() => pitchDraft.parseDraft(JSON.stringify({ title: "a", audience: "b", description: "" })), /incomplete pitch draft/i);
  assert.throws(() => pitchDraft.parseDraft(JSON.stringify({ title: "💡".repeat(36), audience: "People", description: "A useful first version." })), /too long/i);
});

test("draft parser tolerates fences, surrounding prose, and smart quotes", () => {
  const want = { title: "BikeBot", audience: "bike co-ops", description: "Logs repairs for a co-op." };
  assert.deepEqual(pitchDraft.parseDraft('```json\n{"title":"BikeBot","audience":"bike co-ops","description":"Logs repairs for a co-op."}\n```'), want);
  assert.deepEqual(pitchDraft.parseDraft('Sure, here you go:\n{"title":"BikeBot","audience":"bike co-ops","description":"Logs repairs for a co-op."}\nLet me know!'), want);
  assert.deepEqual(pitchDraft.parseDraft('{"title":"BikeBot","audience":"bike co-ops","description":"Logs repairs for a co-op."}'.replace(/"/g, "\u201C")), want);
});

test("draft parser survives doubled colons and braces inside a value", () => {
  assert.deepEqual(
    pitchDraft.parseDraft('{"title"::"BikeBot","audience":"co-ops","description":"Uses the {config} file."}'),
    { title: "BikeBot", audience: "co-ops", description: "Uses the {config} file." }
  );
});

test("draft parser repairs a JSON tail truncated mid-stream", () => {
  const draft = pitchDraft.parseDraft('{"title":"BikeBot","audience":"co-ops","description":"A log for the whole');
  assert.equal(draft.title, "BikeBot");
  assert.equal(draft.audience, "co-ops");
  assert.match(draft.description, /A log for the whole/);
});

test("draft parser unwraps a single nested draft object", () => {
  assert.deepEqual(
    pitchDraft.parseDraft('{"draft":{"title":"BikeBot","audience":"co-ops","description":"Logs repairs."}}'),
    { title: "BikeBot", audience: "co-ops", description: "Logs repairs." }
  );
});

test("draft parser scrapes loose prose as a last resort", () => {
  const draft = pitchDraft.parseDraft('title: BikeBot\n audience: bike co-ops\n description: Logs repairs for a co-op.');
  assert.equal(draft.title, "BikeBot");
  assert.equal(draft.audience, "bike co-ops");
  assert.match(draft.description, /Logs repairs/);
});

test("draft parser rejects non-object JSON cleanly instead of throwing a TypeError", () => {
  assert.throws(() => pitchDraft.parseDraft("null"), /incomplete pitch draft/i);
  assert.throws(() => pitchDraft.parseDraft("42"), /incomplete pitch draft/i);
  assert.throws(() => pitchDraft.parseDraft('[{"title":"x"}]'), /incomplete pitch draft/i);
  assert.throws(() => pitchDraft.parseDraft(""), /incomplete pitch draft/i);
});

test("draft prompt gives an explicit JSON example and only the three keys", () => {
  const prompt = pitchDraft.buildPrompt({ category: "app" });
  assert.match(prompt, /Return ONLY a single JSON object/i);
  assert.match(prompt, /"title":"ShiftSwap"/);
  assert.match(prompt, /no extra keys/i);
});

test("draft prompt tells the model to invent an idea when the form is empty", () => {
  const prompt = pitchDraft.buildPrompt({ category: "product" });
  assert.match(prompt, /If it is empty, invent one specific idea/i);
  assert.match(prompt, /"title":""/);
});

test("generation works for a fully empty form (the seed case)", async () => {
  const client = {
    resetSession() {},
    async chat(_state, _key, _modelId, prompt) {
      // The model invents an idea from the empty facts.
      assert.match(prompt, /If it is empty, invent one specific idea/i);
      return JSON.stringify({ title: "NewIdea", audience: "a named group", description: "A first version that helps." });
    }
  };
  const draft = await pitchDraft.generate({
    client,
    state: {},
    proxyUrl: "https://proxy.example",
    modelId: "suggestion-model",
    pitch: { category: "app", title: "", audience: "", description: "" }
  });
  assert.deepEqual(draft, { title: "NewIdea", audience: "a named group", description: "A first version that helps." });
});

test("generation uses the selected model, forwards category context, and isolates its session", async () => {
  const calls = [];
  const state = { proxyUrl: "" };
  const client = {
    resetSession: (...args) => calls.push({ reset: args[1] }),
    async chat(_state, key, modelId, prompt, options) {
      calls.push({ key, modelId, prompt, options });
      return JSON.stringify({ title: "ClinicQueue", audience: "Small clinics", description: "A shared walk-in waitlist." });
    }
  };
  const draft = await pitchDraft.generate({
    client,
    state,
    proxyUrl: "https://proxy.example/",
    modelId: "model-kowi",
    sessionKey: "pitch-draft-12",
    pitch: { category: "app", title: "ClinicQueue", audience: "Small clinics", description: "A waitlist." }
  });
  assert.equal(state.proxyUrl, "https://proxy.example");
  assert.equal(calls[1].modelId, "model-kowi");
  assert.equal(calls[1].key, "pitch-draft-12");
  assert.match(calls[1].prompt, /ClinicQueue/);
  assert.deepEqual(draft, { title: "ClinicQueue", audience: "Small clinics", description: "A shared walk-in waitlist." });
  assert.deepEqual(calls.filter((call) => call.reset).map((call) => call.reset), ["pitch-draft-12", "pitch-draft-12"]);
});

test("malformed model output fails without returning a canned draft", async () => {
  const client = {
    resetSession() {},
    async chat() { return "I could not finish that."; }
  };
  await assert.rejects(pitchDraft.generate({
    client,
    state: {},
    proxyUrl: "https://proxy.example",
    modelId: "selected-model",
    pitch: { category: "product" }
  }), /incomplete pitch draft/i);
});
