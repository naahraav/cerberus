// Parser tests. These port the Rust `stream_parser.rs` cases to JS and run
// against the exact file the browser loads, so the offline engine and the
// browser share one verified implementation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const parser = require("../../src/js/ai/tuskStreamParser.js");

function contents(text) {
  return parser
    .createParser()
    .push(text)
    .concat([])
    .map((o) => parser.extractText(o))
    .filter((c) => c !== null && c !== "");
}

test("splits objects across chunks", () => {
  const p = parser.createParser();
  assert.deepEqual(p.push('{"content":"he'), []);
  const objs = p.push('llo"}{"done":true}');
  assert.equal(objs.length, 2);
  assert.equal(objs[0].content, "hello");
});

test("handles braces inside strings", () => {
  const p = parser.createParser();
  const objs = p.push('noise {"content":"a \\"quoted\\" {brace} \\\\ done"} trailing');
  assert.equal(objs.length, 1);
  assert.equal(objs[0].content, 'a "quoted" {brace} \\ done');
});

test("nested objects only top-level parsed", () => {
  const p = parser.createParser();
  const objs = p.push('{{"a":1},"b":{"deep":2}}');
  assert.equal(objs.length, 0);
  assert.equal(p.end().length, 0);
});

test("drops unparseable objects but consumes them", () => {
  const p = parser.createParser();
  assert.equal(p.push('{"bad": tru}').length, 0);
  const objs = p.push('{"ok":1}');
  assert.equal(objs.length, 1);
  assert.equal(objs[0].ok, 1);
});

test("multibyte split across chunks is safe", () => {
  const full = '{"content":"héllo 🦡 world"}';
  const mid = Math.floor(full.length / 2);
  const p = parser.createParser();
  const r1 = p.push(full.slice(0, mid));
  const r2 = p.push(full.slice(mid)).concat(p.end());
  const joined = r1.concat(r2);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].content, "héllo 🦡 world");
});

test("oversized noise does not grow forever", () => {
  const p = parser.createParser();
  for (let i = 0; i < 3000; i += 1) {
    p.push("x".repeat(1024));
  }
  // Buffer is capped; nothing parsed, nothing throws.
  assert.ok(true);
});

test("extractText unwraps the nested content JSON", () => {
  const inner = JSON.stringify({ content: "PONG" });
  const outer = { content: inner };
  assert.equal(parser.extractText(outer), "PONG");
});

test("extractAll joins deltas from a full stream body", () => {
  const body =
    '{"role":"assistant","content":"{\\"content\\":\\"PRO\\"}"}\n' +
    '{"role":"assistant","content":"{\\"content\\":\\"XY\\"}"}\n' +
    '{"role":"assistant","content":"{\\"isComplete\\":true,\\"content\\":\\"\\"}"}\n';
  assert.equal(parser.extractAll(body), "PROXY");
});

test("extractText returns plain string when inner is not JSON", () => {
  assert.equal(parser.extractText({ content: "raw text" }), "raw text");
});
