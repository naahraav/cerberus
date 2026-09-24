/* Cerberus AI · ai/suggest
   The selected live model writes editable sentence starters for the composer.
   Failed calls leave the suggestion strip empty. */

(function () {
  "use strict";

  var client = window.CerberusTuskClient;
  var reviewers = window.CerberusReviewers;

  var MAX = 2;
  var LIVE_TIMEOUT_MS = 12000;

  function heads() {
    return (window.CerberusHeads && window.CerberusHeads.all) || [];
  }

  function keywords() {
    return (window.CerberusHeads && window.CerberusHeads.keywords) || { hype: [], sensitive: [], pain: [], niche: [] };
  }

  function matches(text, words) {
    var lower = " " + String(text || "").toLowerCase() + " ";
    for (var i = 0; i < words.length; i += 1) {
      if (words[i] && lower.indexOf(words[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  // The founder's lines only: reviewer replies are not signals for the gaps.
  function founderText(transcript) {
    return String(transcript || "")
      .split("\n")
      .filter(function (line) {
        return /^founder:/i.test(line.trim());
      })
      .join(" ")
      .toLowerCase();
  }

  function dedupe(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var q = String(list[i] || "").trim();
      if (!q) {
        continue;
      }
      var key = q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen[key]) {
        continue;
      }
      seen[key] = true;
      out.push(q);
    }
    return out;
  }

  /**
   * A deterministic next-prompt generator. It reads the pitch fields and the
   * founder's conversation lines and returns founder-voice lines for the gaps it
   * finds, most important first, capped at two and de-duplicated. The lines are
   * what the founder sends to the reviewers, so they use the founder's "I" voice.
   */
  function contextualQuestions(pitch, transcript) {
    var p = pitch || {};
    var title = String(p.title || "").trim();
    var description = String(p.description || "").trim();
    var audience = String(p.audience || "").trim();
    var talk = founderText(transcript);
    var all = (title + " " + description + " " + audience + " " + talk).toLowerCase();
    var k = keywords();

    var hasUser = audience.length >= 3 || /\b(?:for|helps?|serves?|users?|customers?|buyers?|founders?|owners?|teams?)\b/.test(talk);
    var hasStep = /\b(?:step|ship|first version|mvp|build|launch|prototype|week|month|today|tomorrow)\b/.test(all);
    var hasProof = /\b(?:prove|proof|evidence|test|measure|result|demo|number|data)\b/.test(all);
    var hype = matches(all, k.hype);
    var sensitive = matches(all, k.sensitive);
    var pain = matches(all, k.pain);

    var questions = [];

    if (!hasUser) {
      questions.push("I can name exactly who has this problem: …");
    }
    if (!hasStep) {
      questions.push("The smallest version I can put in front of them this week is …");
    }
    if (hype && !hasProof) {
      questions.push("The specific claim I can prove is …");
    }
    if (sensitive) {
      questions.push("Before I make a public claim, I will check the compliance rules that apply: …");
    }
    if (!pain) {
      questions.push("Today, these users handle the problem by …");
    }
    if (hasUser && !hasProof) {
      questions.push("I would know this helps when …");
    }

    // Baseline lines so the strip is never empty on a thin pitch. These do not
    // re-ask the gap lines above, so the strip stays distinct.
    questions.push("The closest alternative they use today is …");
    questions.push("I can test demand this week by …");
    questions.push("One thing I can leave out of the first version is …");

    return dedupe(questions).slice(0, MAX);
  }

  // Strip a model's reply down to a list of short question strings. Tolerant of
  // prose, code fences, and a trailing array cut off mid-stream.
  function parseQuestions(raw) {
    var text = String(raw || "").trim();
    if (!text) {
      return [];
    }
    text = text.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
    var block = text.match(/\{[\s\S]*\}/);
    var array = text.match(/\[[\s\S]*\]/);
    var parsed = null;
    try {
      if (block) {
        parsed = JSON.parse(block[0]);
      } else if (array) {
        parsed = JSON.parse(array[0]);
      }
    } catch (error) {
      parsed = null;
    }
    var list = [];
    if (parsed && Array.isArray(parsed.questions)) {
      list = parsed.questions;
    } else if (parsed && Array.isArray(parsed)) {
      list = parsed;
    } else {
      // Fall back to line-by-line scraping.
      list = text
        .split("\n")
        .map(function (line) {
          return line.replace(/^[\s\-*\d.)"'[]+/, "").replace(/["',\]]+$/, "").trim();
        })
        .filter(function (line) {
          return line.length > 8 && line.length < 160 && /\?$/.test(line);
        });
    }
    list = list.map(function (q) {
      return String(q || "").replace(/^\d+[.)]\s*/, "").trim();
    }).filter(function (q) {
      return q && q.length <= 160;
    });
    return dedupe(list).slice(0, MAX);
  }

  function buildPrompt(pitch, transcript) {
    var p = pitch || {};
    var title = String(p.title || "").trim() || "(not named yet)";
    var description = String(p.description || "").trim() || "(nothing written yet)";
    var audience = String(p.audience || "").trim() || "(not stated)";
    return (
      "You help a founder sharpen a startup pitch. Read the pitch and the conversation, " +
      "then offer two editable sentence starters the founder could complete in their own words. " +
      "Choose details that would most strengthen this specific pitch: current user behavior, the first " +
      "testable version, evidence of demand, a measurable result, or a claim that needs checking. " +
      "Do not invent users, results, prices, or commitments. Leave the missing fact open with an " +
      "ellipsis. Keep each starter under 65 characters; avoid generic advice, numbering, and emojis. " +
      "Return STRICT JSON only: {\"questions\":[\"...\",\"...\"]}.\n\n" +
      "PITCH\nTitle: " + title + "\nPitch: " + description + "\nAudience: " + audience + "\n\n" +
      "CONVERSATION SO FAR\n" + (String(transcript || "").trim() || "(nothing yet)")
    );
  }

  // Ask the live model for founder-voice lines. A failure leaves the strip empty.
  async function liveQuestions(pitch, transcript, options) {
    var ai = window.CerberusAiMode;
    if (!client || !ai || !ai.isEnabled || !ai.isEnabled()) {
      return [];
    }
    var state = ai.getState ? ai.getState() : null;
    if (!state) {
      return [];
    }
    var modelId = state.picks && (state.picks.warden || state.picks.scrath);
    if (!modelId) {
      return [];
    }
    // The shared client state carries the proxy base the client reads when it
    // opens a session. The verdict and room runners set it; suggestions can run
    // before either, so set it here too or the call targets the page origin and
    // always falls back.
    if (state.clientState && state.proxyUrl) {
      state.clientState.proxyUrl = state.proxyUrl;
    }
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = window.setTimeout(function () {
      if (controller) {
        controller.abort();
      }
    }, LIVE_TIMEOUT_MS);
    try {
      var raw = await client.chat(state.clientState, "suggest", modelId, buildPrompt(pitch, transcript), {
        signal: controller ? controller.signal : undefined,
        voiceAndTone: "concise"
      });
      return parseQuestions(raw);
    } catch (error) {
      return [];
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** Return only model-generated sentence starters. */
  async function suggest(pitch, transcript, options) {
    return { questions: await liveQuestions(pitch, transcript, options || {}), source: "live" };
  }

  window.CerberusSuggest = Object.freeze({
    suggest: suggest,
    contextualQuestions: contextualQuestions,
    parseQuestions: parseQuestions,
    buildPrompt: buildPrompt
  });
})();
