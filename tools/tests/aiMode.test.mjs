// aiMode tests: model availability for the pitch suggestion. Loads the module
// under a minimal window shim so the fallback and gating logic is verified
// offline, without a browser or a live proxy.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, "..", "..", "src", "js");

let aiMode;
let draftCalls;

// A DOM stub keyed by id so getElement returns controllable select values.
const elements = {};
function el(value) {
  return { value: value === undefined ? "" : value, disabled: false, innerHTML: "", textContent: "", appendChild() {} };
}

before(() => {
  globalThis.window = globalThis.window || {};
  globalThis.document = globalThis.document || { querySelector: () => null, createElement: () => el() };

  window.CerberusDom = {
    getElement(id) {
      return elements[id] || null;
    },
    setTone() {}
  };
  window.CerberusStore = { setJson() {}, getJson() { return null; }, set() {} };
  window.CerberusTuskClient = { createState: () => ({ proxyUrl: "", sessions: {} }), resetSession() {} };
  window.CerberusReviewers = { defaultModels: { scrath: "r1", fervent: "r2", warden: "r3" } };
  window.CerberusLiveVerdict = { runReviewers() {}, runDebate() {} };
  window.CerberusLiveRoom = { runTurn() {}, runOpening() {} };
  window.CerberusJudges = { setLiveRunner() {} };
  window.CERBERUS_CONFIG = { storageKey: "cerberus" };
  window.CerberusDebate = { defaultJudgeModel: "judge-1" };

  draftCalls = [];
  window.CerberusPitchDraft = {
    generate(opts) {
      draftCalls.push(opts);
      return Promise.resolve({ title: "T", audience: "A", description: "D" });
    }
  };

  require(`${BASE}/ai/aiMode.js`);
  aiMode = window.CerberusAiMode;
});

function setState(patch) {
  Object.assign(aiMode.getState(), patch);
}

test("hasSuggestionModel needs a connected model, not the full reviewer set", () => {
  setState({ enabled: false, connected: false, models: [], picks: { scrath: "", fervent: "", warden: "" } });
  assert.equal(aiMode.hasSuggestionModel(), false);

  // Connected with a catalog but no reviewer picks yet: still ready to suggest.
  setState({ enabled: true, connected: true, models: [{ id: "m1", name: "M1", provider: "p" }], picks: { scrath: "", fervent: "", warden: "" } });
  assert.equal(aiMode.hasSuggestionModel(), true);
});

test("pitchSuggestionModel prefers a reviewer pick then falls back to the catalog", () => {
  elements["ai-model-warden"] = el("w-1");
  elements["ai-model-scrath"] = el("");
  elements["ai-model-fervent"] = el("");
  setState({ enabled: true, connected: true, models: [{ id: "m1" }] });
  assert.equal(aiMode.pitchSuggestionModel(), "w-1");

  // No reviewer picks: fall back to the first catalog model.
  elements["ai-model-warden"] = el("");
  assert.equal(aiMode.pitchSuggestionModel(), "m1");
});

test("suggestPitch uses the fallback model on an empty form", async () => {
  draftCalls = [];
  elements["ai-model-warden"] = el("");
  elements["ai-model-scrath"] = el("");
  elements["ai-model-fervent"] = el("");
  setState({ enabled: true, connected: true, models: [{ id: "fallback-1" }], proxyUrl: "https://proxy.example" });

  const draft = await aiMode.suggestPitch({ title: "", audience: "", description: "", category: "app" }, { sessionKey: "s1" });
  assert.equal(draftCalls.length, 1);
  assert.equal(draftCalls[0].modelId, "fallback-1");
  assert.equal(draftCalls[0].sessionKey, "s1");
  assert.deepEqual(draft, { title: "T", audience: "A", description: "D" });
});

test("suggestPitch throws a clear error only when nothing is connected", () => {
  setState({ enabled: false, connected: false, models: [], picks: { scrath: "", fervent: "", warden: "" } });
  assert.throws(() => aiMode.suggestPitch({ category: "product" }), /connect a reviewer model/i);
});
