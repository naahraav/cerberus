// verify-css.mjs
// Guards against shipping a stale CSS artifact. It rebuilds src/css/tailwind.css
// into a temp file and compares byte-for-byte with the committed one. If they
// differ, the committed artifact is stale: run `npm run build:css`.
//
// This keeps the "commit the built CSS" workflow safe (zero-build deploy) while
// making drift impossible to merge unnoticed.

import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const COMMITTED = join(ROOT, "src", "css", "tailwind.css");

const outDir = mkdtempSync(join(tmpdir(), "cerberus-css-"));
const outFile = join(outDir, "tailwind.css");

// Run the Tailwind CLI through Node directly (no shell), so this works the same
// on Windows, macOS, and Linux.
const cliEntry = join(ROOT, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs");
const result = spawnSync(
  process.execPath,
  [cliEntry, "-i", "src/tailwind/tailwind.css", "-o", outFile, "--minify"],
  { cwd: ROOT, stdio: "inherit" }
);

if (result.status !== 0) {
  rmSync(outDir, { recursive: true, force: true });
  console.error("\n[verify:css] the CSS build failed.");
  process.exit(1);
}

let fresh;
let committed;
try {
  fresh = readFileSync(outFile, "utf8");
  committed = readFileSync(COMMITTED, "utf8");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

// Normalise line endings so a CRLF checkout does not report false drift.
const norm = (s) => s.replace(/\r\n/g, "\n");

if (norm(fresh) !== norm(committed)) {
  console.error(
    "\n[verify:css] src/css/tailwind.css is STALE.\n" +
      "The committed stylesheet does not match src/tailwind/*.css + src/css/styles.css.\n" +
      "Run: npm run build:css  (then commit the rebuilt file)."
  );
  process.exit(1);
}

console.log("[verify:css] src/css/tailwind.css is up to date.");
