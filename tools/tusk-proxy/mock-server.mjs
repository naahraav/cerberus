// Deterministic mock of the Tusk proxy for end-to-end tests. It speaks the
// same routes/shape as tools/tusk-proxy/server.mjs but returns canned model
// output, so the Cerberus UI can be driven end-to-end offline and repeatably.

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT || 9999);
const HOST = "127.0.0.1";

// Canned verdict per reviewer key, extracted from the prompt body.
const VERDICTS = {
  scrath: { score: 82, tier: "Buildable", roast: "A small first version is possible.", verdict: "Build one complete task and let a user try it.", bullets: ["Name the first step.", "Bound the risk."] },
  fervent: { score: 91, tier: "Distinct", roast: "The approach has its own point of view.", verdict: "Show why this approach helps more than what people use now.", bullets: ["Explain the difference.", "Show the demo."] },
  warden: { score: 68, tier: "Needs clarity", roast: "The user needs a clearer path.", verdict: "Name the user and the task in plain words.", bullets: ["Name a real user.", "Define v1."] },
  default: { score: 70, tier: "Reviewed", roast: "Mock judge.", verdict: "The debate settled it.", bullets: ["Sharpen the pitch.", "Name the user."] }
};

function verdictFor(content) {
  // The pitch-draft prompt asks for title/audience/description, not a verdict.
  if (/Return ONLY a single JSON object with exactly these string keys/i.test(content)) {
    return { title: "ShiftSwap", audience: "hourly cafe workers and managers", description: "Lets a worker offer a shift, an eligible coworker claim it, and the manager approve. The first version works for one shop." };
  }
  // The final debate judge prompt contains this exact header.
  if (/Chief Justice AI delivering the final verdict/i.test(content)) {
    return { scrath: 74, fervent: 88, warden: 66, overall: 76, roast: "Mock Chief Justice.", verdict: "Debate verdict.", bullets: ["a", "b"] };
  }
  if (/You are Joko/i.test(content)) return VERDICTS.scrath;
  if (/You are Kowi/i.test(content)) return VERDICTS.fervent;
  if (/You are Dodo/i.test(content)) return VERDICTS.warden;
  // Debate arguments and per-turn judge prompts.
  return VERDICTS.default;
}

// Encode a verdict as the nested stream frames the real API and parser use.
function frames(verdict) {
  const payload = typeof verdict === "string" ? verdict : JSON.stringify(verdict);
  const mid = Math.ceil(payload.length / 2);
  const parts = [payload.slice(0, mid), payload.slice(mid)];
  const out = [];
  for (const part of parts) {
    out.push(JSON.stringify({ role: "assistant", content: JSON.stringify({ content: part }) }));
  }
  out.push(JSON.stringify({ role: "assistant", content: JSON.stringify({ isComplete: true, content: "" }) }));
  return out.join("\n") + "\n";
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, upstream: "mock", service: "tusk-proxy-mock" }));
    return;
  }
  if (req.method === "GET" && req.url === "/api/models") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify([
      { id: "m-scrath", name: "MockReasoner", provider: "Test" },
      { id: "m-fervent", name: "MockHype", provider: "Test" },
      { id: "m-warden", name: "MockPlanner", provider: "Test" },
      { id: "m-judge", name: "MockJudge", provider: "Test" }
    ]));
    return;
  }
  if (req.method === "POST" && req.url === "/api/session") {
    await readBody(req);
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessionId: "mock-sess-" + Math.random().toString(36).slice(2, 8), chatId: "mock-chat" }));
    return;
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    const body = await readBody(req);
    const verdict = verdictFor(body.content || "");
    if (process.env.MOCK_MODE === "error") {
      res.writeHead(500, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Mock upstream failure" }));
      return;
    }
    res.writeHead(200, { ...cors, "Content-Type": "text/plain; charset=utf-8" });
    res.end(frames(verdict));
    return;
  }
  res.writeHead(404, { ...cors, "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`MOCK_PORT=${PORT}`);
});
