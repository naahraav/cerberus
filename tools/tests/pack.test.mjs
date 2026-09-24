// On-device pack tests. The pack is deterministic, so these assert the shape
// (one opener on an empty address, the [{head,text}] reply shape) and that the
// reviewers open the review and talk to each other rather than past each other.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, "..", "..", "src", "js");

let pack;

before(() => {
  globalThis.window = globalThis.window || {};
  require(`${BASE}/core/heads.js`);
  require(`${BASE}/pack.js`);
  pack = window.CerberusPack;
});

test("openingReplies returns exactly one in-character opener for a pitch", () => {
  const replies = pack.openingReplies({ title: "Campus Bike Co-op Repair Log", description: "A dated log for shared bikes.", audience: "Student bike co-ops" });
  assert.ok(Array.isArray(replies));
  assert.equal(replies.length, 1);
  assert.equal(typeof replies[0].head, "string");
  assert.ok(replies[0].text.length > 0);
  assert.ok(replies[0].text.includes("Campus Bike Co-op Repair Log"), "opener names the pitch back");
});

test("openingReplies is deterministic for the same pitch", () => {
  const pitch = { title: "BikeBot", description: "Repairs shared bikes." };
  assert.deepEqual(pack.openingReplies(pitch), pack.openingReplies(pitch));
});

test("openingReplies falls back to a named pitch when the title is empty", () => {
  const replies = pack.openingReplies({});
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.length > 0);
  assert.equal(replies[0].text.includes("{title}"), false, "placeholder must be substituted");
});

test("a hype pitch is opened by Joko (buildability lens)", () => {
  const replies = pack.openingReplies({ title: "A revolution for everyone" });
  assert.equal(replies[0].head, "scrath");
});

test("a regulated pitch is opened by Dodo (clarity/boundaries lens)", () => {
  const replies = pack.openingReplies({ title: "We handle medical records" });
  assert.equal(replies[0].head, "warden");
});

test("a secondary reviewer gives a direct response", () => {
  const replies = pack.reply("This is a revolution for everyone", { title: "X" });
  assert.ok(replies.length >= 2, "a strong hype turn summons more than one reviewer");
  assert.ok(replies[1].text.length > 0);
  assert.doesNotMatch(replies[1].text, /^(And to build on that|There is more fire|That, plus the pull)/);
});

test("reply still returns the [{head,text}] shape on a thin line", () => {
  const replies = pack.reply("hello there", { title: "X" });
  assert.ok(Array.isArray(replies));
  assert.ok(replies.length >= 1);
  assert.equal(typeof replies[0].head, "string");
  assert.equal(typeof replies[0].text, "string");
});
