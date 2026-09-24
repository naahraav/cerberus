// Runs every Cerberus test suite: the browser stream parser, the reviewer
// parsing/assembly logic, and the Tusk proxy. Zero dependencies.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const suites = [
  { name: "parser", cwd: ROOT, args: ["--test", "tools/tests/parser.test.mjs"] },
  { name: "rate limit", cwd: ROOT, args: ["--test", "tools/tests/tuskClient.test.mjs"] },
  { name: "publish", cwd: ROOT, args: ["--test", "tools/tests/publish.test.mjs"] },
  { name: "reviewers", cwd: ROOT, args: ["--test", "tools/tests/reviewers.test.mjs"] },
  { name: "judges", cwd: ROOT, args: ["--test", "tools/tests/judges.test.mjs"] },
  { name: "liveRoom", cwd: ROOT, args: ["--test", "tools/tests/liveRoom.test.mjs"] },
  { name: "aiMode", cwd: ROOT, args: ["--test", "tools/tests/aiMode.test.mjs"] },
  { name: "debate", cwd: ROOT, args: ["--test", "tools/tests/debate.test.mjs"] },
  { name: "pack", cwd: ROOT, args: ["--test", "tools/tests/pack.test.mjs"] },
  { name: "suggest", cwd: ROOT, args: ["--test", "tools/tests/suggest.test.mjs"] },
  { name: "pitchDraft", cwd: ROOT, args: ["--test", "tools/tests/pitchDraft.test.mjs"] },
  { name: "proxy", cwd: join(ROOT, "tools", "tusk-proxy"), args: ["--test"] },
];

let failed = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, suite.args, { cwd: suite.cwd, stdio: "inherit" });
  if (result.status !== 0) {
    failed += 1;
    console.error(`\n[suite failed] ${suite.name}`);
  }
}

if (failed) {
  console.error(`\n${failed} suite(s) failed.`);
  process.exit(1);
}
console.log("\nAll test suites passed.");
