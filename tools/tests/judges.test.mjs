// On-device judge tests. The engine is deterministic, so these assert the
// scoring shape, the five dimensions per reviewer, and that the three cards
// differ rather than echoing one shared set.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, "..", "..", "src", "js");

let judges;

before(() => {
  globalThis.window = globalThis.window || {};
  // Load the real canonical heads and the keyword sets, then the engine.
  require(`${BASE}/core/heads.js`);
  globalThis.window.CerberusHeads = globalThis.window.CerberusHeads || {};
  require(`${BASE}/judges.js`);
  judges = window.CerberusJudges;
});

const PITCH = {
  title: "Campus Co-op Repair Log",
  description:
    "Campus bike co-ops lose the repair history of shared bikes. A dated log records each tune-up and who did it, so the next mechanic sees what was done.",
  audience: "Student bike co-ops that lose repair history",
  category: "web3"
};

test("scorePitch returns the three heads with scores and the five dims", () => {
  const result = judges.scorePitch(PITCH);
  ["scrath", "fervent", "warden"].forEach((key) => {
    const head = result[key];
    assert.equal(typeof head.score, "number");
    assert.ok(head.score >= 0 && head.score <= 100);
    assert.ok(head.dims, `${key} missing dims`);
    assert.deepEqual(
      Object.keys(head.dims).sort(),
      ["clarity", "feasibility", "market", "originality", "risk"]
    );
    Object.values(head.dims).forEach((v) => {
      assert.ok(v >= 0 && v <= 100, `${key} dim out of range: ${v}`);
    });
  });
  assert.ok(result.overall >= 0 && result.overall <= 100);
  assert.ok(result.analysis);
  assert.deepEqual(
    Object.keys(result.analysis).sort(),
    ["clarity", "feasibility", "market", "originality", "risk"]
  );
});

test("each reviewer's own dimension leads with its headline score", () => {
  const result = judges.scorePitch(PITCH);
  // Each head's owned dimension is pulled toward its own score, so the cards
  // are not identical copies.
  const scrath = result.scrath.dims.feasibility;
  const fervent = result.fervent.dims.feasibility;
  const warden = result.warden.dims.feasibility;
  const allSame = scrath === fervent && fervent === warden;
  assert.equal(allSame, false, "all three feasibility dims are identical");
});

test("scorePitch is deterministic", () => {
  const a = judges.scorePitch(PITCH);
  const b = judges.scorePitch(PITCH);
  assert.equal(a.overall, b.overall);
  assert.deepEqual(a.scrath.dims, b.scrath.dims);
});

test("omitting the conversation yields the same scores as an empty one", () => {
  // Regression guard: the chat-influences-score feature must not change the
  // score when there is no conversation to read.
  const without = judges.scorePitch(PITCH);
  const empty = judges.scorePitch(PITCH, "");
  ["scrath", "fervent", "warden"].forEach((key) => {
    assert.equal(without[key].score, empty[key].score, `${key} changed with no conversation`);
  });
  assert.equal(without.overall, empty.overall);
  assert.deepEqual(without.analysis, empty.analysis);
});

test("a strong conversation moves the reviewers' scores", () => {
  const without = judges.scorePitch(PITCH);
  const conversation = [
    "Founder: this is for student bike co-ops that lose repair history",
    "Founder: the first version ships next week as a dated log",
    "Founder: the co-ops are frustrated and stuck without a record"
  ].join("\n");
  const withChat = judges.scorePitch(PITCH, conversation);
  const moved =
    withChat.overall !== without.overall ||
    withChat.scrath.score !== without.scrath.score ||
    withChat.fervent.score !== without.fervent.score ||
    withChat.warden.score !== without.warden.score;
  assert.equal(moved, true, "conversation did not move any score");
});

test("hype in the conversation raises risk", () => {
  const calm = judges.scorePitch(PITCH, "Founder: a dated log for campus co-ops");
  const hyped = judges.scorePitch(
    PITCH,
    "Founder: this is a revolution that will change the world for everyone"
  );
  assert.ok(hyped.analysis.risk > calm.analysis.risk, "risk did not rise on hype");
});

test("quickStanding returns the three heads, an overall, and a turn count", () => {
  const standing = judges.quickStanding(PITCH, "Founder: a dated log for campus co-ops");
  assert.deepEqual(Object.keys(standing.heads).sort(), ["fervent", "scrath", "warden"]);
  assert.ok(standing.overall >= 0 && standing.overall <= 100);
  assert.equal(typeof standing.turns, "number");
  assert.equal(standing.turns, 1);
  // The standing uses the same scoring path as the full verdict.
  const full = judges.scorePitch(PITCH, "Founder: a dated log for campus co-ops");
  assert.equal(standing.heads.scrath.score, full.scrath.score);
  assert.equal(standing.overall, full.overall);
});
