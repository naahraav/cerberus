/* Cerberus AI · ai/liveRoom
   Streams selected model replies into the review conversation. A failed call
   returns null so the room can show an honest error. */

(function () {
  "use strict";

  var client = window.CerberusTuskClient;
  var reviewers = window.CerberusReviewers;
  var heads = (window.CerberusHeads && window.CerberusHeads.all) || [];

  // Which reviewer answers first for a given kind of message. This mirrors the
  // each turn. The reply text always comes from a selected model.
  var PRIMARY_HEAD = {
    question: "warden",
    hype: "scrath",
    niche: "fervent",
    pain: "fervent",
    sensitive: "warden",
    audience: "warden",
    plan: "scrath",
    market: "scrath",
    web3: "scrath",
    ai: "warden"
  };

  var SECONDARY_HEAD = {
    hype: "fervent",
    niche: "scrath",
    pain: "warden",
    sensitive: "scrath",
    audience: "scrath",
    plan: "warden",
    market: "fervent",
    web3: "warden",
    ai: "fervent"
  };

  function hasConcreteEvidence(text) {
    return /\b(?:\d+(?:\.\d+)?%?|one|two|three|four|five|six|seven|eight|nine|ten|dozen)\b/i.test(text) &&
      /\b(survey(?:ed)?|interview(?:ed|s)?|pilot(?:ed|ing)?|paid|preorder(?:ed)?|trial(?:ed)?|test(?:ed|ing)?|users?|customers?|waitlist|sign.?ups?)\b/i.test(text);
  }

  function keywords() {
    return (window.CerberusHeads && window.CerberusHeads.keywords) || { hype: [], sensitive: [], pain: [], niche: [] };
  }

  function matches(text, words) {
    for (var i = 0; i < words.length; i += 1) {
      if (text.indexOf(words[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  function detect(text) {
    var lower = text.toLowerCase();
    var words = keywords();
    return {
      question: /[?？]\s*$/.test(text.trim()) || /^(who|what|when|where|how|why|does|is|are|can|should|would|will|do)\b/.test(lower),
      hype: matches(lower, words.hype),
      niche: matches(lower, words.niche || []),
      pain: matches(lower, words.pain || []),
      sensitive: matches(lower, words.sensitive || []),
      audience: matches(lower, ["who is it for", "who should", "for whom", "audience", "customer", "users", "buyer", "target"]),
      plan: matches(lower, ["how", "when", "would", "step", "ship", "plan", "build", "version", "roadmap", "test", "pilot", "prototype"]),
      market: matches(lower, ["market", "price", "cost", "pay", "sell", "sales", "money", "revenue"]),
      web3: matches(lower, ["chain", "web3", "token", "defi", "nft", "dao", "on-chain", "ledger", "smart contract", "wallet"]),
      ai: matches(lower, [" ai", "model", "machine learning", "llm", "copilot", "agent", "neural"])
    };
  }

  var PRIORITY = ["sensitive", "audience", "pain", "niche", "hype", "plan", "market", "web3", "ai", "question"];

  function primaryTrigger(flags) {
    for (var i = 0; i < PRIORITY.length; i += 1) {
      if (flags[PRIORITY[i]]) {
        return PRIORITY[i];
      }
    }
    return null;
  }

  // Choose the ordered list of reviewer keys to answer this turn. Falls back to
  // the responder for the turn index so an off-topic line still gets one voice.
  // A clear signal brings in a second reviewer from a different lens (and a
  // third for a safety issue), so the room reads as three heads talking, not a
  // single voice. An off-topic line still gets exactly one rotating voice.
  function respondersFor(text, turnIndex) {
    var flags = detect(text);
    var primary = primaryTrigger(flags);
    var order = [];
    var seen = {};
    function add(key) {
      if (key && !seen[key]) {
        seen[key] = true;
        order.push(key);
      }
    }
    if (primary) {
      add(PRIMARY_HEAD[primary]);
      // A recognized signal almost always earns a second read from another
      // lens; concrete evidence or a safety issue is worth another reviewer.
      var secondary = SECONDARY_HEAD[primary];
      if (secondary && (primary !== "question" || hasConcreteEvidence(text))) {
        add(secondary);
      }
      // A safety issue is every head's business: bring in the third reviewer.
      if (primary === "sensitive") {
        heads.forEach(function (head) {
          add(head.key);
        });
      }
      // Concrete evidence in the founder's line is worth a third lens too.
      if (hasConcreteEvidence(text)) {
        heads.forEach(function (head) {
          add(head.key);
        });
      }
    } else if (heads.length) {
      add(heads[turnIndex % heads.length].key);
    }
    if (!order.length) {
      add("warden");
    }
    return order;
  }

  function headName(key) {
    for (var i = 0; i < heads.length; i += 1) {
      if (heads[i].key === key) {
        return heads[i].name;
      }
    }
    return key;
  }

  // Build a plain-text transcript from the stored chat messages plus the new
  // user line. Capped so a long thread does not blow up the prompt.
  function buildTranscript(messages, limit) {
    var recent = (messages || []).slice(-limit);
    return recent.map(function (msg) {
      if (msg.from === "user") {
        return "Founder: " + msg.text;
      }
      return headName(msg.head || msg.role || "warden") + ": " + msg.text;
    }).join("\n");
  }

  // Which reviewer opens the review, from the pitch's strongest signal. Mirrors
  // the pitch's strongest signal.
  function openingResponder(pitch) {
    var all = (
      String((pitch && pitch.title) || "") + " " +
      String((pitch && pitch.description) || "") + " " +
      String((pitch && pitch.audience) || "")
    ).toLowerCase();
    var words = keywords();
    if (matches(all, words.sensitive || [])) {
      return "warden";
    }
    if (matches(all, words.hype || [])) {
      return "scrath";
    }
    if (matches(all, words.niche || []) || matches(all, words.pain || [])) {
      return "fervent";
    }
    return "warden";
  }

  /**
   * Run the opening turn: one reviewer opens the review against the stated
   * pitch, with no founder message yet. Returns [{ head, text }] or null on any
   * failure (network errors reject; an empty reply resolves to null).
   * options: { proxyUrl, models, state, signal, pitch, onReply, onStatus }
   */
  async function runOpening(options) {
    var opts = options || {};
    if (!reviewers || !client || !reviewers.openingPrompt) {
      return null;
    }
    var state = opts.state || client.createState();
    if (opts.proxyUrl) {
      state.proxyUrl = opts.proxyUrl;
    }
    var models = opts.models || reviewers.defaultModels;
    var signal = opts.signal;
    var onReply = opts.onReply || function () {};
    var onStatus = opts.onStatus || function () {};
    var pitch = opts.pitch || {};

    var key = openingResponder(pitch);
    var modelId = models[key];
    if (!modelId) {
      return null;
    }
    onStatus("The reviewers are reading your pitch.");
    try {
      var prompt = reviewers.openingPrompt(key, { pitch: pitch });
      onReply(key, { start: true });
      var raw = await client.chat(state, "conv-" + key, modelId, prompt, {
        signal: signal,
        onWait: onStatus,
        onDelta: function (piece) {
          onReply(key, { delta: piece });
        }
      });
      var clean = cleanReply(raw);
      if (!clean) {
        client.resetSession(state, "conv-" + key);
        return null;
      }
      onReply(key, { done: true, text: clean });
      return [{ head: key, text: clean }];
    } catch (error) {
      client.resetSession(state, "conv-" + key);
      throw error;
    }
  }

  /**
   * Run one live conversation turn.
   * options: { proxyUrl, models, state, signal, transcript, turnIndex,
   *            pitch, onReply, onStatus }
   * Returns [{ head, text }] or null on any failure (caller falls back).
   */
  async function runTurn(text, options) {
    var opts = options || {};
    if (!reviewers || !client) {
      return null;
    }
    var state = opts.state || client.createState();
    if (opts.proxyUrl) {
      state.proxyUrl = opts.proxyUrl;
    }
    var models = opts.models || reviewers.defaultModels;
    var signal = opts.signal;
    var onReply = opts.onReply || function () {};
    var onStatus = opts.onStatus || function () {};
    var transcript = opts.transcript || "";

    var order = respondersFor(String(text || ""), opts.turnIndex || 0);
    var results = [];

    onStatus("The reviewers are reading that.");

    try {
      for (var i = 0; i < order.length; i += 1) {
        if (signal && signal.aborted) {
          throw new Error("Conversation cancelled.");
        }
        var key = order[i];
        var modelId = models[key] || reviewers.defaultModels[key];
        var prompt = reviewers.conversationPrompt(key, {
          transcript: transcript,
          userText: text,
          pitch: opts.pitch || {}
        });
        onReply(key, { start: true });
        var raw = await client.chat(state, "conv-" + key, modelId, prompt, {
          signal: signal,
          onWait: onStatus,
          onDelta: function (piece) {
            onReply(key, { delta: piece });
          }
        });
        var clean = cleanReply(raw);
        if (!clean) {
          throw new Error("Empty reply from " + key);
        }
        results.push({ head: key, text: clean });
        // Feed this reply back in so the next reviewer sees it.
        transcript += "\n" + headName(key) + ": " + clean;
        onReply(key, { done: true, text: clean });
      }
    } catch (error) {
      if (!results.length) {
        if (error && error.status === 429) throw error;
        return null;
      }
      // Partial success: return what we have so the turn is not lost.
      return results;
    }

    return results.length ? results : null;
  }

  // The largest a single room reply may be. This is a safety net for a model
  // that ignores the brevity instruction, not a display limit: it sits far above
  // any normal reply, and a reply under it is returned untouched.
  var SOFT_CAP = 1500;

  // Trim a reply that overran the soft cap, ending on a whole sentence when one
  // is available so the text never stops mid-thought. Never appends an ellipsis:
  // a cut-off judge reads as a bug, an ended sentence does not. Only trim past
  // the first sentence; if the limit falls inside the opening sentence, keep it
  // whole rather than splitting a thought.
  function softCap(text, limit) {
    var cap = typeof limit === "number" ? limit : SOFT_CAP;
    if (text.length <= cap) {
      return text;
    }
    var head = text.slice(0, cap);
    var end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
    if (end === -1) {
      // No complete sentence fits; fall back to the last word boundary.
      return head.replace(/\s+\S*$/, "").trim();
    }
    return head.slice(0, end + 1).trim();
  }

  // Trim model chatter: strip stray fences, drop a verdict-shaped JSON object if
  // the model answered with JSON instead of prose, collapse whitespace, and apply
  // the soft cap. There is no short display limit: a judge's full reply is shown.
  function cleanReply(raw) {
    var text = String(raw || "").trim();
    if (!text) {
      return "";
    }
    text = text.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
    // If the whole reply is a JSON object, try to salvage readable fields.
    if (/^\{[\s\S]*\}$/.test(text)) {
      try {
        var data = JSON.parse(text);
        var reply = typeof data.verdict === "string" && data.verdict.trim()
          ? data.verdict.trim()
          : typeof data.roast === "string" ? data.roast.trim() : "";
        if (reply) {
          text = reply;
        } else {
          text = "";
        }
      } catch (error) {
        // Not JSON after all; keep going with the raw text.
      }
    }
    text = text.replace(/^(joko|kowi|dodo|scrath|fervent|warden)\s*:\s*/i, "");
    text = text.replace(/\s+/g, " ").trim();
    return softCap(text, SOFT_CAP);
  }

  window.CerberusLiveRoom = Object.freeze({
    runTurn: runTurn,
    runOpening: runOpening,
    openingResponder: openingResponder,
    respondersFor: respondersFor,
    detect: detect,
    primaryTrigger: primaryTrigger,
    buildTranscript: buildTranscript,
    cleanReply: cleanReply,
    softCap: softCap
  });
})();
