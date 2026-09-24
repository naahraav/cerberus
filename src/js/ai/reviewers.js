/* Cerberus AI · ai/reviewers
   Turns the three Cerberus reviewers into live prompts and parses their JSON
   verdicts back into the exact shape core/verdict.js renders. Each reviewer
   scores on its own criteria and returns a strict JSON object. */

(function () {
  "use strict";

  var heads = (window.CerberusHeads && window.CerberusHeads.all) || [];

  // Default model per reviewer. Chosen so the three genuinely differ:
  // a rigorous reasoner, a hype-heavy generalist, and a grounded planner.
  var DEFAULT_MODELS = {
    scrath: "a1a67a18-d926-42fe-8add-69514527643f", // DeepSeek V3.2
    fervent: "d6ff02cf-f056-4b11-a802-e8791dadccfd", // Gemini 3.5 Flash Lite
    warden: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a" // GPT-5.4 Mini
  };

  var JSON_CONTRACT =
    "Return ONLY a single JSON object, no markdown fences, no prose, with exactly these keys:\n" +
    '{"score": <integer 0-100>, ' +
    '"dims": {"clarity": <0-100>, "feasibility": <0-100>, "originality": <0-100>, "risk": <0-100>, "market": <0-100>}, ' +
    '"tier": "<two to four word summary>", ' +
    '"verdict": "<one or two direct, useful sentences>", ' +
    '"bullets": ["<short critique>", "<short critique>"]}\n' +
    "Score the five dims on your own judgement, each 0 to 100:\n" +
    "- clarity: how clear the problem and the pitch are to a stranger.\n" +
    "- feasibility: how buildable the first version is.\n" +
    "- originality: how distinct the idea is.\n" +
    "- risk: how much execution, regulatory, or market risk it carries (higher is riskier).\n" +
    "- market: how strong the pull is from real, named users.\n" +
    "Your overall \"score\" is your headline number; the dims explain it. " +
    "Be concise and to the point: one or two short sentences, and two short bullet phrases. " +
    "Write to the founder like a thoughtful person: name one concrete strength or gap and the next thing to check. " +
    "Use plain language. No slogans, theatrical judgement, generic praise, or invented evidence.";

  function headFor(key) {
    for (var i = 0; i < heads.length; i += 1) {
      if (heads[i].key === key) {
        return heads[i];
      }
    }
    return null;
  }

  function persona(key) {
    if (key === "scrath") {
      return (
        "You are Joko. You care about buildability: can this idea become a working product people can use? " +
        "Look for a practical first version, likely obstacles, and a small test. Be candid and constructive."
      );
    }
    if (key === "fervent") {
      return (
        "You are Kowi. You care about originality: what gives this idea its own identity and why does " +
        "that difference matter? Compare it with what people already use. Be curious, specific, and honest."
      );
    }
    return (
      "You are Dodo. You care about clarity: can a new person understand the problem, who has it, and " +
      "how the first version helps? Ask for plain words when a claim is vague. Flag high-stakes claims " +
      "without giving legal or medical advice."
    );
  }

  function buildPrompt(key, pitch, founderAnswers) {
    var head = headFor(key);
    var title = String((pitch && pitch.title) || "").trim();
    var description = String((pitch && pitch.description) || "").trim();
    var audience = String((pitch && pitch.audience) || "").trim();
    var category = String((pitch && pitch.category) || "product");

    return (
      persona(key) +
      "\n\nYou are reviewing this pitch as " + (head ? head.name : key) + ", scoring: " +
      (head ? head.scoresOn : "your criteria") + ".\n\n" +
      "PITCH\n" +
      "Title: " + (title || "(none)") + "\n" +
      "Description: " + (description || "(none)") + "\n" +
      "Audience: " + (audience || "(not named)") + "\n" +
      "Category: " + category + "\n\n" +
      "FOUNDER'S ANSWERS DURING THE REVIEW\n" +
      (String(founderAnswers || "").trim() || "(No additional answers in chat.)") + "\n\n" +
      "Score this pitch on your own criterion, from 0 to 100. " +
      "Give " + (head ? head.scoresOn.toLowerCase() : "your criterion") +
      " the most weight in your headline score; use the other dimensions as context. " +
      "Use the founder's answers as part of the case. Treat unsupported statements as claims, not proof. " +
      "Be consistent with the evidence they provided. Be concise: keep the verdict to one or two short sentences.\n\n" +
      JSON_CONTRACT
    );
  }

  // A conversational turn in the room, not a scored verdict. The reviewer stays
  // in character, reacts to what the founder just said, and engages an earlier
  // point when useful. Plain prose, no JSON, no score: the verdict is a
  // separate step.
  function conversationPrompt(key, context) {
    var head = headFor(key);
    var transcript = String((context && context.transcript) || "").trim();
    var userText = String((context && context.userText) || "").trim();
    var pitch = (context && context.pitch) || {};
    var title = String(pitch.title || "").trim();
    var description = String(pitch.description || "").trim();

    return (
      persona(key) +
      "\n\nYou are one of three reviewers talking a founder through a pitch in a chat. " +
      "You are " + (head ? head.name : key) + " and you judge: " +
      (head ? head.scoresOn : "your criteria") + ".\n\n" +
      "PITCH DRAFT SO FAR\n" +
      "Title: " + (title || "(not named yet)") + "\n" +
      "Pitch: " + (description || "(nothing written yet)") + "\n\n" +
      "CONVERSATION SO FAR\n" +
      (transcript || "(this is the first thing the founder said)") + "\n\n" +
      "THE FOUNDER JUST SAID\n" +
      "\"" + (userText || "(nothing)") + "\"\n\n" +
      "Reply in at most two natural sentences, and keep each one short. Lead with the point. " +
      "Respond to a detail the founder actually gave, then " +
      "offer one observation or next step from your lens. Ask one direct question only if its answer " +
      "would help. Do not repeat the pitch, introduce yourself, echo another reviewer, use a slogan, " +
      "or give generic praise. " +
      "Plain prose only: no JSON, headings, lists, scores, or emojis. " +
      "Do not mention that you are an AI or a model."
    );
  }

  // The first thing a reviewer says when the room opens: the founder has stated a
  // pitch (in the gate or the panel) but has not typed anything to the panel yet.
  // The reviewer opens the review by naming the pitch back, stating their lens,
  // and asking the founder the one question they most need answered.
  function openingPrompt(key, context) {
    var head = headFor(key);
    var pitch = (context && context.pitch) || {};
    var title = String(pitch.title || "").trim();
    var description = String(pitch.description || "").trim();
    var audience = String(pitch.audience || "").trim();

    return (
      persona(key) +
      "\n\nYou are one of three reviewers opening a pitch review. The founder has just " +
      "stepped in and stated their pitch. You are " + (head ? head.name : key) + " and you judge: " +
      (head ? head.scoresOn : "your criteria") + ".\n\n" +
      "The pitch as stated:\n" +
      "Title: " + (title || "(not named yet)") + "\n" +
      "Pitch: " + (description || "(nothing written yet)") + "\n" +
      "Who it is for: " + (audience || "(not named)") + "\n\n" +
      "Open in one or two short, plain sentences, and no more than that. Point to one specific detail " +
      "in the pitch, then ask one " +
      "focused question whose answer would help assess your lens. Use only the written pitch; do not " +
      "assume the founder has replied in chat. Do not repeat the title, summarize the pitch, score it, " +
      "or list all three reviewers' concerns. Plain prose only: no JSON, headings, lists, " +
      "no emojis. Do not mention that you are an AI or a model."
    );
  }

  // Find the best candidate JSON object: iterate every balanced {...} block and
  // prefer the one that actually carries a "score" key, so a model that wraps
  // its answer in prose or a refusal is not mistaken for the verdict.
  function findVerdictObject(text) {
    var blocks = balancedObjects(text);
    var best = null;
    for (var i = 0; i < blocks.length; i += 1) {
      var parsed = tryParse(blocks[i]) || tryParse(sanitizeJson(blocks[i]));
      if (parsed && typeof parsed === "object") {
        if (parsed.score !== undefined || parsed.tier !== undefined || parsed.verdict !== undefined) {
          return parsed;
        }
        if (!best) {
          best = parsed;
        }
      }
    }
    // Last resort: repair a truncated tail.
    var repaired = tryParse(sanitizeJson(repairTruncatedJson(text)));
    if (repaired && typeof repaired === "object") {
      return repaired;
    }
    return best;
  }

  // Every balanced top-level {...} block in the text.
  function balancedObjects(text) {
    var blocks = [];
    var depth = 0;
    var start = -1;
    var inString = false;
    var escape = false;
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") inString = true;
      else if (ch === "{") {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          blocks.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
    return blocks;
  }

  // Repair common, non-fatal JSON mistakes model output makes: doubled colons
  // or commas, and smart quotes around keys/values.
  function sanitizeJson(text) {
    return text
      .replace(/::+/g, ":")
      .replace(/,\s*,/g, ",")
      .replace(/[\u201C\u201D]/g, "\"")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, "$1");
  }

  // Pull a field from loose text when there is no usable JSON at all.
  function fieldFromText(text, label) {
    var re = new RegExp('"' + label + '"\\s*:\\s*"?([^"\\n}]+)', "i");
    var m = text.match(re);
    return m ? m[1].trim().replace(/^["']|["',]+$/g, "") : null;
  }

  // Last-resort prose for a reply with no parseable verdict field. Take a
  // readable slice but end it on a whole sentence or word, and never leave a
  // dangling ellipsis: a truncated verdict is the bug we are fixing.
  function proseFallback(text) {
    var clean = String(text || "").replace(/\s+/g, " ").trim().replace(/(?:\s*\.\.\.)+$/, "");
    if (!clean) {
      return null;
    }
    var cap = 280;
    if (clean.length <= cap) {
      return clean;
    }
    var head = clean.slice(0, cap);
    var end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
    if (end !== -1) {
      return head.slice(0, end + 1).trim();
    }
    return head.replace(/\s+\S*$/, "").trim();
  }

  // Parse the model's reply into a verdict object, tolerating stray prose or
  // code fences, malformed JSON, and an object cut off mid-stream.
  function parseVerdict(raw, key, head, options) {
    var text = String(raw || "").trim();
    var data = findVerdictObject(text);
    if (options && options.strict) {
      var dims = data && data.dims;
      var complete = data && clampScore(data.score) !== null &&
        typeof data.tier === "string" && data.tier.trim() &&
        typeof data.verdict === "string" && data.verdict.trim() &&
        Array.isArray(data.bullets) && data.bullets.filter(function (b) { return typeof b === "string" && b.trim(); }).length >= 2 &&
        dims && DIM_KEYS.every(function (dim) { return clampScore(dims[dim]) !== null; });
      if (!complete) throw new Error("The reviewer returned an incomplete verdict.");
    }

    var score = clampScore(data && data.score);
    var tier = stringOr(data && data.tier, null) || fieldFromText(text, "tier") || "Reviewed";
    var roast = stringOr(data && data.roast, null) || fieldFromText(text, "roast") || (options && options.strict ? data.verdict : "The pitch needs a closer look.");
    var verdict = stringOr(data && data.verdict, null) || fieldFromText(text, "verdict") || proseFallback(text) || "The reviewers could not form a clear assessment from this draft. Add a specific user and first test.";
    var bullets = Array.isArray(data && data.bullets)
      ? data.bullets.filter(function (b) {
          return typeof b === "string" && b.trim();
        }).slice(0, 2)
      : [];

    // If the model ignored the schema, derive a score from a "NN/100" mention.
    if (score === null) {
      var numberMatch = text.match(/\b(\d{1,3})\s*\/\s*100\b/);
      score = numberMatch ? clampScore(Number(numberMatch[1])) : null;
    }
    if (score === null) {
      score = 50;
    }
    if (bullets.length < 2) {
      bullets.push("Name the first user and the task they need to finish.");
    }
    if (bullets.length < 2) {
      bullets.push("Describe one small test that would show whether the idea helps.");
    }

    return {
      key: key,
      name: head ? head.name : key,
      epithet: head ? head.epithet : "",
      color: head ? head.color : "",
      motto: head ? head.motto : "",
      score: score,
      dims: parseDims(data && data.dims, score),
      tier: tier,
      status: statusFor(score),
      stamp: stampFor(key, score),
      roast: roast,
      verdict: verdict,
      bullets: bullets,
      raw: text
    };
  }

  var DIM_KEYS = ["clarity", "feasibility", "originality", "risk", "market"];

  // Pull the five dimension scores. If the model omitted or broke a value, fall
  // back to a sensible number derived from the headline score so the bars are
  // never empty or invented out of nothing.
  function parseDims(dims, score) {
    var base = typeof score === "number" ? score : 50;
    var out = {};
    var source = dims && typeof dims === "object" ? dims : {};
    DIM_KEYS.forEach(function (key) {
      var value = clampScore(source[key]);
      if (value === null) {
        // risk reads inverted against a good score; others track the score.
        value = key === "risk" ? Math.max(0, Math.min(100, 100 - base)) : base;
      }
      out[key] = value;
    });
    return out;
  }

  function clampScore(value) {
    if (typeof value === "number" && isFinite(value)) {
      return Math.max(0, Math.min(100, Math.round(value)));
    }
    if (typeof value === "string" && value.trim() !== "" && isFinite(Number(value))) {
      return Math.max(0, Math.min(100, Math.round(Number(value))));
    }
    return null;
  }

  function tryParse(text) {
    try {
      var value = JSON.parse(text);
      return value && typeof value === "object" ? value : null;
    } catch (error) {
      return null;
    }
  }

  // Best-effort repair of a JSON object truncated mid-stream: drop an incomplete
  // trailing string and close any open brackets.
  function repairTruncatedJson(text) {
    var start = text.indexOf("{");
    if (start === -1) {
      return "";
    }
    var body = text.slice(start);
    // Cut back to the last complete key/value boundary if the tail is ragged.
    var lastComma = Math.max(body.lastIndexOf(",\n"), body.lastIndexOf(',"'), body.lastIndexOf('",'));
    if (lastComma > 0) {
      body = body.slice(0, lastComma + 1);
    }
    // Count unclosed braces/brackets and close them.
    var openBraces = 0;
    var openBrackets = 0;
    var inString = false;
    var escape = false;
    for (var i = 0; i < body.length; i += 1) {
      var ch = body[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") inString = true;
      else if (ch === "{") openBraces += 1;
      else if (ch === "}") openBraces -= 1;
      else if (ch === "[") openBrackets += 1;
      else if (ch === "]") openBrackets -= 1;
    }
    if (inString) {
      body += "\"";
    }
    body = body.replace(/,\s*$/, "");
    for (var b = 0; b < openBrackets; b += 1) body += "]";
    for (var c = 0; c < openBraces; c += 1) body += "}";
    return body;
  }

  function stringOr(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  // Status thresholds per reviewer, matching the on-device engine's bands.
  function statusFor(score) {
    if (score >= 70) return "pass";
    if (score >= 45) return "warn";
    return "fail";
  }

  function stampFor(key, score) {
    if (key === "scrath") {
      if (score >= 78) return "A clear first step";
      if (score >= 55) return "Needs a tighter plan";
      return "Start with a test";
    }
    if (key === "fervent") {
      if (score >= 82) return "Test demand with users";
      if (score >= 60) return "Check the alternatives";
      return "Find the unmet need";
    }
    if (score >= 75) return "Ready to test";
    if (score >= 52) return "Set a smaller scope";
    return "Clarify the user";
  }

  window.CerberusReviewers = Object.freeze({
    defaultModels: DEFAULT_MODELS,
    dimKeys: DIM_KEYS,
    buildPrompt: buildPrompt,
    conversationPrompt: conversationPrompt,
    openingPrompt: openingPrompt,
    persona: persona,
    parseVerdict: parseVerdict,
    parseDims: parseDims,
    statusFor: statusFor,
    stampFor: stampFor
  });
})();
