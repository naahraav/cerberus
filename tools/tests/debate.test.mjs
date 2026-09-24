// Debate runner tests: one flaky model turn must not sink the debate, and the
// Chief Justice verdict must still map onto the three heads.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, "..", "..", "src", "js");

let debate;

before(() => {
  globalThis.window = globalThis.window || {};
  require(`${BASE}/ai/debate.js`);
  debate = window.CerberusDebate;
});

// A fake client whose chat() behavior is scripted per call index.
function scriptedClient(handler) {
  let call = 0;
  return {
    async chat(state, key, modelId, content, options) {
      call += 1;
      return handler({ call, key, modelId, content, options });
    }
  };
}

test("a failing debate turn is skipped and the debate continues", async () => {
  const turns = [];
  const client = scriptedClient(({ call, key, options }) => {
    if (call === 1) {
      throw new Error("transient 500");
    }
    // The Lead Judge's per-turn call.
    if (key.indexOf("debate-judge-turn-") === 0) {
      return JSON.stringify({ logic: 7, evidence: 6, impact: 8, commentary: "solid" });
    }
    // The Chief Justice's final call.
    if (key === "debate-judge") {
      if (options && options.onDelta) {
        options.onDelta('{"scrath":70}');
      }
      const dims = { clarity: 70, feasibility: 70, originality: 70, risk: 30, market: 70 };
      return JSON.stringify({
        scrath: 70, fervent: 80, warden: 60, overall: 70,
        tiers: { scrath: "Buildable first step", fervent: "Distinct approach", warden: "Needs clearer scope" },
        dims: { scrath: dims, fervent: dims, warden: dims },
        reviews: { scrath: "Build one booking flow.", fervent: "Compare the current workaround.", warden: "Name the first user task." },
        verdict: "The idea needs one test.", bullets: ["a", "b"]
      });
    }
    if (options && options.onDelta) {
      options.onDelta("argument ");
    }
    return "argument text";
  });

  const outcome = await debate.run(
    { title: "T", description: "D", audience: "A" },
    {
      client,
      state: {},
      modelA: "mA",
      modelB: "mB",
      judgeModel: "mJ",
      onTurn: (event) => turns.push(event)
    }
  );

  assert.equal(outcome.final.scrath, 70);
  assert.equal(outcome.final.fervent, 80);
  // The failed turn emitted an empty argument-end so the room can close it.
  assert.ok(turns.some((t) => t.kind === "argument-end" && t.text === ""));
  // Later turns still produced arguments.
  assert.ok(turns.some((t) => t.kind === "argument-end" && t.text === "argument text"));
  // The judge turn streamed its text.
  assert.ok(turns.some((t) => t.kind === "judge"));
  // The Lead Judge scored each landed turn.
  assert.ok(outcome.judgeScores.length > 0);
  assert.equal(outcome.judgeScores[0].logic, 7);
});

test("incomplete final model output is rejected instead of inventing scores", async () => {
  const client = scriptedClient(({ key }) => {
    if (key.indexOf("debate-judge-turn-") === 0) {
      return JSON.stringify({ logic: 6, evidence: 6, impact: 6, commentary: "even" });
    }
    if (key === "debate-judge") {
      return JSON.stringify({ scrath: "Debater A was persuasive.", fervent: "Fervent prose.", warden: 66, overall: "n/a", roast: "r", verdict: "v", bullets: [] });
    }
    if (key) {
      return "argument";
    }
    return "argument";
  });
  await assert.rejects(() => debate.run({ title: "T", description: "D", audience: "A" }, {
    client, state: {}, modelA: "a", modelB: "b", judgeModel: "j"
  }), /incomplete verdict/);
});

test("a failing judge call throws so the caller can show an error", async () => {
  const client = scriptedClient(({ key }) => {
    if (key.indexOf("debate-judge-turn-") === 0) {
      return JSON.stringify({ logic: 5, evidence: 5, impact: 5, commentary: "ok" });
    }
    if (key === "debate-judge") {
      throw new Error("judge down");
    }
    return "argument";
  });
  await assert.rejects(
    () => debate.run({ title: "T" }, { client, state: {}, modelA: "a", modelB: "b", judgeModel: "j" })
  );
});

test("parseJudge rejects junk instead of making up scores", () => {
  assert.throws(() => debate.parseJudge("not json at all"), /did not return scores/);
});
