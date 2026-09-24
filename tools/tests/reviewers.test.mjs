// Reviewer parsing + verdict assembly tests. These load the browser modules
// under a minimal window shim and exercise the parsing/assembly logic directly,
// with no network.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, "..", "..", "src", "js");

let reviewers;
let liveVerdict;

before(() => {
  globalThis.window = globalThis.window || {};
  // Canonical heads, as the app defines them.
  window.CerberusHeads = {
    all: [
      { key: "scrath", name: "Scrath", epithet: "The Scourge", color: "#e25822", motto: "Proof.", scoresOn: "Feasibility" },
      { key: "fervent", name: "Fervent", epithet: "The Flame", color: "#ffb142", motto: "Burn.", scoresOn: "Originality" },
      { key: "warden", name: "Warden", epithet: "The Keeper", color: "#a9c983", motto: "First step.", scoresOn: "Clarity" }
    ],
    analysisLabels: { clarity: "Clarity", feasibility: "Feasibility", originality: "Originality", risk: "Risk", market: "Market pull" }
  };
  require(`${BASE}/ai/reviewers.js`);
  require(`${BASE}/ai/liveVerdict.js`);
  reviewers = window.CerberusReviewers;
  liveVerdict = window.CerberusLiveVerdict;
});

test("parses a clean JSON verdict", () => {
  const raw = JSON.stringify({ score: 88, tier: "Strong", roast: "Solid.", verdict: "It works.", bullets: ["a", "b"] });
  const v = reviewers.parseVerdict(raw, "scrath", { key: "scrath", name: "Scrath", epithet: "", color: "", motto: "" });
  assert.equal(v.score, 88);
  assert.equal(v.tier, "Strong");
  assert.equal(v.bullets.length, 2);
  assert.equal(v.status, "pass");
});

test("parses a fenced JSON verdict", () => {
  const raw = "```json\n{\"score\": 35, \"tier\": \"Weak\", \"roast\": \"x\", \"verdict\": \"y\", \"bullets\": [\"a\",\"b\"]}\n```";
  const v = reviewers.parseVerdict(raw, "scrath", { key: "scrath", name: "Scrath", epithet: "", color: "", motto: "" });
  assert.equal(v.score, 35);
  assert.equal(v.tier, "Weak");
  assert.equal(v.status, "fail");
});

test("repairs a truncated JSON verdict", () => {
  const raw = '{"score": 61, "tier": "Mixed", "roast": "Partial", "verdict": "It is cut off here';
  const v = reviewers.parseVerdict(raw, "fervent", { key: "fervent", name: "Fervent", epithet: "", color: "", motto: "" });
  assert.equal(v.score, 61);
  assert.ok(v.bullets.length >= 2);
});

test("derives a score from a NN/100 mention when no JSON", () => {
  const v = reviewers.parseVerdict("I would give this 73/100 overall.", "warden", { key: "warden", name: "Warden", epithet: "", color: "", motto: "" });
  assert.equal(v.score, 73);
});

test("clamps out of range scores", () => {
  const v = reviewers.parseVerdict('{"score": 250}', "scrath", { key: "scrath", name: "Scrath", epithet: "", color: "", motto: "" });
  assert.equal(v.score, 100);
});

test("falls back to a safe verdict on junk input", () => {
  const v = reviewers.parseVerdict("no json at all here", "scrath", { key: "scrath", name: "Scrath", epithet: "", color: "", motto: "" });
  assert.equal(typeof v.score, "number");
  assert.ok(v.score >= 0 && v.score <= 100);
  assert.ok(v.bullets.length >= 2);
});

test("prose fallback trims to a sentence boundary and never adds an ellipsis", () => {
  // No JSON and no derivable field: the verdict comes from the loose prose,
  // which must not be cut mid-word or left with a dangling "...".
  const sentence = "This is a full sentence worth keeping. ";
  const raw = sentence.repeat(20).trim();
  const v = reviewers.parseVerdict(raw, "warden", { key: "warden", name: "Warden", epithet: "", color: "", motto: "" });
  assert.ok(!v.verdict.includes("..."), "no ellipsis on the verdict");
  assert.ok(/[.!?]$/.test(v.verdict), "the verdict ends on real punctuation");
  assert.ok(raw.startsWith(v.verdict.replace(/[.!?]$/, "")), "the verdict is a clean prefix of the reply");
});

test("prose fallback strips a trailing ellipsis from the model text", () => {
  const v = reviewers.parseVerdict("It holds together but the user is unclear...", "scrath", { key: "scrath", name: "Scrath", epithet: "", color: "", motto: "" });
  assert.ok(!v.verdict.endsWith("..."), "a model's own ellipsis is removed");
  assert.ok(v.verdict.includes("unclear"));
});

test("conversationPrompt asks for at most two short sentences", () => {
  const prompt = reviewers.conversationPrompt("scrath", {
    transcript: "Founder: a bike repair bot.",
    userText: "Is this buildable?",
    pitch: { title: "BikeBot", description: "Repairs bikes." }
  });
  assert.match(prompt, /at most two/i);
  assert.match(prompt, /Lead with the point/i);
});

test("openingPrompt asks for one or two short sentences", () => {
  const prompt = reviewers.openingPrompt("fervent", {
    pitch: { title: "BakeryApp", description: "A log for bakeries.", audience: "Small bakeries" }
  });
  assert.match(prompt, /one or two short/i);
});

test("JSON verdict contract asks for a concise verdict", () => {
  const prompt = reviewers.buildPrompt("scrath", { title: "T", description: "D" }, "");
  assert.match(prompt, /one or two direct/i);
  assert.match(prompt, /concise/i);
});

test("recovers a verdict from malformed JSON (doubled colons)", () => {
  const raw = '{"score"::30,"tier":"Execution Hazard","roast":"Hype bot.","verdict":"Too vague.","bullets":["a","b"]}';
  const v = reviewers.parseVerdict(raw, "scrath", { key: "scrath", name: "Scrath", epithet: "", color: "", motto: "" });
  assert.equal(v.score, 30);
  assert.equal(v.tier, "Execution Hazard");
  assert.notEqual(v.tier, "Reviewed");
});

test("ignores a prose refusal and finds the real verdict object", () => {
  const raw = '<hard-gate>\nThe user provided a JSON requirement.\nNothing to answer.\n{"note":"declined"}\n\nHere is my answer anyway:\n{"score": 74, "tier": "Solid", "roast": "r", "verdict": "v", "bullets": ["a","b"]}';
  const v = reviewers.parseVerdict(raw, "fervent", { key: "fervent", name: "Fervent", epithet: "", color: "", motto: "" });
  assert.equal(v.score, 74);
  assert.equal(v.tier, "Solid");
});

test("extracts fields from loose text when JSON is broken", () => {
  const raw = 'score: 55, "tier": "Vague but fixable", "roast": "Do the work.", "verdict": "Name the user."';
  const v = reviewers.parseVerdict(raw, "warden", { key: "warden", name: "Warden", epithet: "", color: "", motto: "" });
  assert.equal(v.tier, "Vague but fixable");
  assert.equal(v.roast, "Do the work.");
});

test("parseVerdict carries per-reviewer dims", () => {
  const raw = JSON.stringify({
    score: 80,
    dims: { clarity: 70, feasibility: 90, originality: 65, risk: 15, market: 75 },
    tier: "t", roast: "r", verdict: "v", bullets: ["a", "b"]
  });
  const v = reviewers.parseVerdict(raw, "scrath", { key: "scrath", name: "Scrath", epithet: "", color: "", motto: "" });
  assert.equal(v.dims.feasibility, 90);
  assert.equal(v.dims.risk, 15);
  assert.deepEqual(Object.keys(v.dims).sort(), ["clarity", "feasibility", "market", "originality", "risk"]);
});

test("parseDims fills missing dimensions from the headline score", () => {
  const dims = reviewers.parseDims({ clarity: 88 }, 60);
  assert.equal(dims.clarity, 88);
  assert.equal(dims.feasibility, 60);
  assert.equal(dims.risk, 40); // inverted against a good score
});

test("assemble carries per-head dims and averages them for the shared analysis", () => {
  const mk = (key, score, dims) => ({ key, name: key, epithet: "", color: "", score, dims, tier: "t", status: "pass", stamp: "s", roast: "r", verdict: "v", bullets: ["a", "b"] });
  const keyed = {
    scrath: mk("scrath", 90, { clarity: 60, feasibility: 90, originality: 60, risk: 10, market: 60 }),
    fervent: mk("fervent", 60, { clarity: 60, feasibility: 60, originality: 60, risk: 40, market: 60 }),
    warden: mk("warden", 30, { clarity: 30, feasibility: 30, originality: 30, risk: 70, market: 30 })
  };
  const result = liveVerdict.assemble(keyed, "live");
  assert.equal(result.overall, 60);
  assert.equal(result.overallTier.status, "warn");
  assert.deepEqual(Object.keys(result.analysis).sort(), ["clarity", "feasibility", "market", "originality", "risk"]);
  assert.equal(result.source, "live");
  assert.equal(result.scrath.score, 90);
  // Each head keeps its own dims.
  assert.equal(result.scrath.dims.feasibility, 90);
  assert.equal(result.warden.dims.clarity, 30);
  // Shared analysis is the average: clarity (60+60+30)/3 = 50.
  assert.equal(result.analysis.clarity, 50);
  assert.equal(result.analysis.feasibility, 60);
});

test("deriveAnalysis averages the three reviewers' dims", () => {
  const a = liveVerdict.deriveAnalysis({
    scrathDims: { clarity: 40, feasibility: 80, originality: 60, risk: 10, market: 50 },
    ferventDims: { clarity: 60, feasibility: 50, originality: 90, risk: 30, market: 80 },
    wardenDims: { clarity: 80, feasibility: 40, originality: 50, risk: 50, market: 40 }
  });
  assert.equal(a.clarity, 60);
  assert.equal(a.feasibility, 57);
  assert.equal(a.originality, 67);
  assert.equal(a.risk, 30);
  assert.equal(a.market, 57);
});

test("deriveAnalysis falls back to 50 when dims are missing", () => {
  const a = liveVerdict.deriveAnalysis({});
  assert.equal(a.clarity, 50);
  assert.equal(a.risk, 50);
});
