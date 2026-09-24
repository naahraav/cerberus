/* Cerberus AI · ai/tuskClient
   Browser client for the local Tusk proxy. Opens a session, streams a chat
   reply, and reports health. It never talks to the upstream directly; the
   proxy holds the headers the browser cannot set. */

(function () {
  "use strict";

  var PROVIDER_TIMEOUT_MS = 120000;
  // The upstream publishes no stable quota. Keep this tab below ten POSTs
  // per minute so three simultaneous reviewers do not arrive as a burst.
  var REQUEST_GAP_MS = 6500;
  var MAX_RATE_RETRIES = 3;
  var MAX_AUTO_WAIT_MS = 90000;
  var requestGates = Object.create(null);

  var parserLib = window.CerberusTuskParser;

  // A reviewer's chosen model and its runtime session, keyed by reviewer.
  function createState() {
    return {
      proxyUrl: "",
      reachable: false,
      models: [],
      sessions: {} // key -> { sessionId, chatId }
    };
  }

  function normalizeBase(url) {
    return String(url || "").trim().replace(/\/$/, "");
  }

  function readRetryAfter(response) {
    var value = response && response.headers && response.headers.get("Retry-After");
    if (!value) return null;
    var seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    var timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
  }

  function abortError() {
    var error = new Error("The request was cancelled.");
    error.name = "AbortError";
    return error;
  }

  function wait(ms, signal) {
    if (signal && signal.aborted) return Promise.reject(abortError());
    if (ms <= 0) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      function onAbort() {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(abortError());
      }
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function gateFor(url) {
    var origin = new URL(url).origin;
    return requestGates[origin] || (requestGates[origin] = { nextAt: 0, cooldownUntil: 0 });
  }

  function notifyWait(onWait, delay) {
    if (onWait) onWait("The AI models are busy. Retrying in " + Math.max(1, Math.ceil(delay / 1000)) + "s…");
  }

  async function waitForSlot(gate, signal, onWait) {
    var slot = Math.max(Date.now(), gate.nextAt);
    gate.nextAt = slot + REQUEST_GAP_MS;
    var queued = slot - Date.now();
    if (queued > 1000 && onWait) onWait("Waiting for the next reviewer…");
    await wait(queued, signal);
    while (gate.cooldownUntil > Date.now()) {
      var delayedSlot = Math.max(gate.cooldownUntil, gate.nextAt);
      gate.nextAt = delayedSlot + REQUEST_GAP_MS;
      var remaining = delayedSlot - Date.now();
      notifyWait(onWait, remaining);
      await wait(remaining, signal);
    }
    if (signal && signal.aborted) throw abortError();
  }

  // All AI calls in this tab share a short gap. On 429, honor Retry-After and
  // retry only before a response stream begins; a partial reply is never sent twice.
  async function fetchRateAware(url, options, onWait) {
    var gate = gateFor(url);
    for (var attempt = 0; ; attempt += 1) {
      await waitForSlot(gate, options && options.signal, onWait);
      var response = await fetch(url, options);
      if (response.status !== 429) return response;
      var retryAfter = readRetryAfter(response);
      var delay = retryAfter === null ? 15000 * Math.pow(2, attempt) : retryAfter;
      gate.cooldownUntil = Math.max(gate.cooldownUntil, Date.now() + delay);
      if (attempt >= MAX_RATE_RETRIES || delay > MAX_AUTO_WAIT_MS) return response;
      if (response.body && response.body.cancel) await response.body.cancel().catch(function () {});
      notifyWait(onWait, delay);
    }
  }

  function errorMessage(response, fallback) {
    if (response.status !== 429) return fallback;
    var retryAfter = readRetryAfter(response);
    return retryAfter && retryAfter > 1000
      ? "The AI service is busy. Try again in about " + Math.ceil(retryAfter / 1000) + " seconds."
      : "The AI service is busy. Please try again shortly.";
  }

  async function fetchJson(url, options, onWait) {
    const response = options && options.method === "POST"
      ? await fetchRateAware(url, options, onWait)
      : await fetch(url, options);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      data = null;
    }
    if (!response.ok) {
      const message = errorMessage(response, (data && data.error) || `HTTP ${response.status}`);
      const err = new Error(message);
      err.status = response.status;
      err.retryAfterMs = readRetryAfter(response);
      throw err;
    }
    return data;
  }

  async function health(proxyUrl, signal) {
    const base = normalizeBase(proxyUrl);
    if (!base) {
      return { ok: false, error: "No proxy URL set." };
    }
    try {
      const data = await fetchJson(`${base}/api/health`, { signal });
      return { ok: Boolean(data && data.ok), upstream: data && data.upstream };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function listModels(proxyUrl, signal) {
    const base = normalizeBase(proxyUrl);
    const data = await fetchJson(`${base}/api/models`, { signal });
    return Array.isArray(data) ? data : [];
  }

  // Open (or reuse) a conversation for a given reviewer key + model.
  async function ensureSession(state, key, aiModelId, signal, onWait) {
    var existing = state.sessions[key];
    if (existing && existing.aiModelId === aiModelId) {
      return existing;
    }
    const base = normalizeBase(state.proxyUrl);
    const data = await fetchJson(`${base}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiModelId, content: "Initialize conversation session." }),
      signal
    }, onWait);
    if (!data || !data.sessionId || !data.chatId) {
      throw new Error("The proxy did not return a session id.");
    }
    var session = { sessionId: data.sessionId, chatId: data.chatId, aiModelId: aiModelId };
    state.sessions[key] = session;
    return session;
  }

  function resetSession(state, key) {
    if (key) {
      delete state.sessions[key];
    } else {
      state.sessions = {};
    }
  }

  /**
   * Stream a reply from one model. `onDelta` is called with each token chunk.
   * Resolves with the full text. Honors an AbortSignal and an idle timeout.
   */
  async function chat(state, key, aiModelId, content, options) {
    const opts = options || {};
    const base = normalizeBase(state.proxyUrl);
    const session = await ensureSession(state, key, aiModelId, opts.signal, opts.onWait);

    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) {
        controller.abort();
      } else {
        opts.signal.addEventListener("abort", onOuterAbort, { once: true });
      }
    }

    let idleTimer = null;
    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    };

    try {
      bumpIdle();
      const response = await fetchRateAware(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          chatId: session.chatId,
          aiModelId,
          content,
          voiceAndTone: opts.voiceAndTone || "analytical",
          isWebSearchEnabled: Boolean(opts.webSearch)
        }),
        signal: controller.signal
      }, function (message) {
        bumpIdle();
        if (opts.onWait) opts.onWait(message);
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        let message = `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(detail);
          if (parsed && parsed.error) message = parsed.error;
        } catch (error) {
          if (detail) message = detail.slice(0, 200);
        }
        const err = new Error(errorMessage(response, message));
        err.status = response.status;
        err.retryAfterMs = readRetryAfter(response);
        throw err;
      }

      if (!response.body || !response.body.getReader) {
        // No streaming support: read it all at once.
        const text = await response.text();
        const full = parserLib.extractAll(text);
        if (opts.onDelta && full) opts.onDelta(full);
        return full;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = parserLib.createParser();
      let full = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bumpIdle();
        const chunk = decoder.decode(value, { stream: true });
        const objects = parser.push(chunk);
        for (const object of objects) {
          const piece = parserLib.extractText(object);
          if (piece) {
            full += piece;
            if (opts.onDelta) opts.onDelta(piece);
          }
        }
      }

      const tail = parser.push(decoder.decode()).concat(parser.end());
      for (const object of tail) {
        const piece = parserLib.extractText(object);
        if (piece) {
          full += piece;
          if (opts.onDelta) opts.onDelta(piece);
        }
      }

      return full;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (opts.signal) opts.signal.removeEventListener("abort", onOuterAbort);
    }
  }

  window.CerberusTuskClient = Object.freeze({
    createState: createState,
    health: health,
    listModels: listModels,
    chat: chat,
    resetSession: resetSession
  });
})();
