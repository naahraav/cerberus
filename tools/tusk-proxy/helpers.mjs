// Test helper: boots the real proxy as a child process on an ephemeral port
// (PORT=0), reads the bound port the server prints, waits for /api/health,
// and tears it down afterwards.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "server.mjs");

let child = null;
let port = 0;

async function waitForHealth(base, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * Start the proxy. `env` may include UPSTREAM_ORIGIN to point at a stub.
 * Resolves to the base URL once healthy.
 */
export async function startServer(env = {}) {
  child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", QUIET: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  port = await new Promise((resolve, reject) => {
    // Booting Node plus binding can be slow when many suites run back to back,
    // so allow a generous window instead of a tight one.
    const timer = setTimeout(
      () => reject(new Error("proxy did not report a port" + (stderr ? ` (stderr: ${stderr.trim()})` : ""))),
      20000
    );
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/PORT=(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`proxy exited before reporting a port (code ${code})${stderr ? ` (stderr: ${stderr.trim()})` : ""}`));
    });
  });

  const base = `http://127.0.0.1:${port}`;
  if (!(await waitForHealth(base))) {
    stopServer();
    throw new Error("proxy started but never became healthy");
  }
  return base;
}

export function activePort() {
  return port;
}

export function stopServer() {
  if (child) {
    try {
      child.kill();
    } catch {
      // already gone
    }
    child = null;
  }
}
