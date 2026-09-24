(function () {
  "use strict";

  // Canonical vocabulary and reviewer rubrics live in core/heads.js so the pack
  // and the judges cannot drift apart.
  var HEAD_SOURCE = window.CerberusHeads;
  var HYPE_WORDS = HEAD_SOURCE ? HEAD_SOURCE.keywords.hype : [];
  var SENSITIVE_AREA = HEAD_SOURCE ? HEAD_SOURCE.keywords.sensitive : [];
  var PAIN_WORDS = HEAD_SOURCE ? HEAD_SOURCE.keywords.pain : [];
  var NICHE_WORDS = HEAD_SOURCE ? HEAD_SOURCE.keywords.niche : [];

  function wordCount(text) {
    var matches = String(text).trim().match(/\S+/g);
    return matches ? matches.length : 0;
  }

  function countHits(text, words) {
    var count = 0;
    for (var i = 0; i < words.length; i++) {
      if (text.indexOf(words[i]) !== -1) {
        count += 1;
      }
    }
    return count;
  }

  function nicheCount(text) {
    var seen = {};
    var count = 0;
    for (var i = 0; i < NICHE_WORDS.length; i++) {
      if (text.indexOf(NICHE_WORDS[i]) !== -1 && !seen[NICHE_WORDS[i]]) {
        seen[NICHE_WORDS[i]] = true;
        count += 1;
      }
    }
    return count;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  function analyze(pitch, conversation) {
    var title = String(pitch && pitch.title ? pitch.title : "").trim();
    var description = String(pitch && pitch.description ? pitch.description : "").trim();
    var audience = String(pitch && pitch.audience ? pitch.audience : "").trim();
    var raw = (title + " " + description + " " + audience).toLowerCase();
    var descLength = description.length;
    var hype = countHits(raw, HYPE_WORDS);
    var niche = nicheCount(raw);
    var hasAudience = audience.length >= 3;
    var audiencePain = countHits(audience.toLowerCase(), PAIN_WORDS) > 0;
    var sensitive = countHits(raw, SENSITIVE_AREA) > 0;

    var clarity = 20;
    if (title.length >= 3 && title.length < 80) {
      clarity += 30;
    }
    if (descLength >= 60 && descLength <= 260) {
      clarity += 40;
    } else if (descLength > 0) {
      clarity += 25;
    }
    if (hasAudience) {
      clarity += 10;
    }
    clarity = clamp(clarity, 5, 100);

    var feasibility = 45;
    if (wordCount(title) <= 9) {
      feasibility += 8;
    }
    if (descLength >= 50 && descLength <= 200) {
      feasibility += 12;
    }
    if (niche >= 1) {
      feasibility += 6;
    }
    feasibility -= Math.min(30, hype * 13);
    if (pitch && pitch.category === "ecosystem") {
      feasibility -= 12;
    }
    feasibility = clamp(feasibility, 5, 95);

    var originality = 50;
    originality += Math.min(24, niche * 8);
    originality -= Math.min(24, hype * 12);
    if (audience.length >= 8) {
      originality += 6;
    }
    originality = clamp(originality, 5, 100);

    var risk = 20;
    if (sensitive) {
      risk += 18;
    }
    if (hype >= 2) {
      risk += 12;
    }
    if (descLength > 270) {
      risk += 8;
    }
    if (pitch && pitch.category === "ecosystem") {
      risk += 8;
    }
    risk = clamp(risk, 0, 100);

    var market = 35;
    if (hasAudience) {
      market += 25;
    }
    if (audiencePain) {
      market += 12;
    }
    market += Math.min(15, niche * 5);
    market -= Math.min(15, Math.floor(hype / 2) * 6);
    market = clamp(market, 5, 100);

    // The conversation is a real scoring input. Each turn the founder takes can
    // sharpen or weaken the reviewers' reading: naming a user, describing a
    // first step, or digging into pain lifts a dimension; leaning on hype or
    // wandering into regulated ground raises risk. The contribution is bounded
    // so the draft still leads and the chat nudges. When there is no
    // conversation, every shift below is zero and the scores are unchanged.
    var talk = conversationSignals(conversation);
    clarity = clamp(clarity + talk.clarity, 5, 100);
    feasibility = clamp(feasibility + talk.feasibility, 5, 95);
    originality = clamp(originality + talk.originality, 5, 100);
    risk = clamp(risk + talk.risk, 0, 100);
    market = clamp(market + talk.market, 5, 100);

    return {
      clarity: clarity,
      feasibility: feasibility,
      originality: originality,
      risk: risk,
      market: market,
      hasAudience: hasAudience,
      audiencePain: audiencePain,
      sensitive: sensitive,
      hype: hype,
      niche: niche,
      descLength: descLength,
      turns: talk.turns
    };
  }

  // Read a plain-text transcript and return bounded per-dimension shifts. Each
  // useful signal the founder adds in chat moves a dimension a little; the caps
  // keep a single word from swinging the score and keep the chat a nudge, not
  // the whole story. Returns all-zero shifts for an empty transcript.
  function conversationSignals(conversation) {
    var empty = { clarity: 0, feasibility: 0, originality: 0, risk: 0, market: 0, turns: 0 };
    var text = String(conversation || "").trim();
    if (!text) {
      return empty;
    }
    var lower = text.toLowerCase();
    // Only the founder's lines are signals; reviewer replies are not counted.
    var founderLines = text.split("\n").filter(function (line) {
      return /^founder:/i.test(line.trim());
    });
    var turns = founderLines.length;
    if (!turns) {
      return empty;
    }
    var founderText = founderLines.join(" ").toLowerCase();

    var signals = {
      audience: /\b(?:who is it for|who should|for whom|audience|customer|users|buyer|target|serves?|helps?|for)\b/.test(founderText),
      plan: /\b(?:step|ship|ship it|first version|mvp|build|launch|roadmap|week|month|prototype|test|pilot)\b/.test(founderText),
      pain: countHits(founderText, PAIN_WORDS) > 0,
      niche: nicheCount(founderText) > 0,
      evidence: /\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|dozen)\b/.test(founderText) &&
        /\b(?:interviewed|surveyed|tested|paid|piloted|preorders?|sign.?ups?|agreed to test)\b/.test(founderText),
      alternative: /\b(?:group chats?|spreadsheets?|whatsapp|email|paper|notion|current workaround|current alternative)\b/.test(founderText),
      hype: countHits(founderText, HYPE_WORDS) > 0,
      sensitive: countHits(founderText, SENSITIVE_AREA) > 0
    };

    var shift = { clarity: 0, feasibility: 0, originality: 0, risk: 0, market: 0, turns: turns };
    // Each signal adds a small bounded amount; the caps keep it a nudge.
    if (signals.audience) {
      shift.clarity += 4;
      shift.market += 5;
    }
    if (signals.plan) {
      shift.feasibility += 5;
      shift.clarity += 2;
    }
    if (signals.pain) {
      shift.market += 4;
    }
    if (signals.niche) {
      shift.originality += 5;
      shift.feasibility += 2;
    }
    if (signals.evidence) {
      shift.market += 7;
      shift.feasibility += 2;
    }
    if (signals.alternative) {
      shift.originality += 4;
    }
    if (signals.hype) {
      shift.feasibility -= 4;
      shift.risk += 6;
      shift.originality -= 3;
    }
    if (signals.sensitive) {
      shift.risk += 8;
    }
    // Depth of discussion helps clarity, but only up to a point.
    shift.clarity += Math.min(6, turns);

    // Cap the total contribution per dimension so a long chat cannot dominate.
    shift.clarity = clamp(shift.clarity, -6, 14);
    shift.feasibility = clamp(shift.feasibility, -8, 12);
    shift.originality = clamp(shift.originality, -6, 10);
    shift.risk = clamp(shift.risk, 0, 16);
    shift.market = clamp(shift.market, -6, 14);
    return shift;
  }

  function overallFrom(scores) {
    var sum = scores.scrath.score + scores.fervent.score + scores.warden.score;
    return clamp(sum / 3, 0, 100);
  }

  function sealKey(text) {
    var value = 0;
    for (var i = 0; i < text.length; i++) {
      value = (value * 31 + text.charCodeAt(i)) >>> 0;
    }
    return value;
  }

  function pickPair(a) {
    var options = [];
    if (a.sensitive && a.risk >= 45) {
      options.push({ head: "scrath", text: "Check the compliance requirements before making public claims." });
      options.push({ head: "warden", text: "Share only details you are comfortable making public permanently." });
    }
    if (a.hype >= 2) {
      options.push({ head: "scrath", text: "Support broad claims with a result you can measure." });
      options.push({ head: "warden", text: "Describe the benefit in specific, testable terms." });
    }
    if (a.niche >= 2) {
      options.push({ head: "fervent", text: "A focused audience can make the first test easier. Which users are you targeting?" });
      options.push({ head: "scrath", text: "Can you reach enough people in this group to test demand?" });
    } else if (a.niche === 1) {
      options.push({ head: "warden", text: "Who are two more people with the same problem?" });
    }
    if (a.hasAudience) {
      options.push({ head: "scrath", text: "The pitch names a user. What task do they need help with?" });
      options.push({ head: "fervent", text: "What would convince this user to try the idea?" });
      options.push({ head: "warden", text: "What is the first task you will design for?" });
    } else {
      options.push({ head: "scrath", text: "Who is this for? Name one user." });
      options.push({ head: "fervent", text: "Name one person who might want this." });
      options.push({ head: "warden", text: "Who would use the first version?" });
    }
    if (a.audiencePain) {
      options.push({ head: "fervent", text: "How often does this problem happen, and what do people do now?" });
      options.push({ head: "warden", text: "Describe the problem before the product." });
    }
    if (a.descLength > 270) {
      options.push({ head: "scrath", text: "Shorten the pitch and keep the user and first version." });
    }
    if (a.descLength < 30) {
      options.push({ head: "warden", text: "Add details about the first version." });
      options.push({ head: "fervent", text: "Who would try this first, and why?" });
    }
    options.push({ head: "scrath", text: "The pitch needs a first step." });
    options.push({ head: "fervent", text: "What would make users choose this idea?" });
    options.push({ head: "warden", text: "What is the first working version?" });

    if (options.length === 0) {
      return [];
    }
    var position = sealKey("bullet" + a.descLength) % options.length;
    var first = options[position];
    var second = options[(position + 3) % options.length];
    if (second === first) {
      second = options[(position + 1) % options.length];
    }
    return [first, second];
  }

  function roastFor(headKey, a, title) {
    var seed = sealKey(headKey + title);
    var high = a.hype >= 2;
    var cool = a.niche >= 1;
    if (headKey === "scrath") {
      var scratches = [
        "The plan needs more detail before I can judge it.",
        "I still need a clear first version and an estimate.",
        "Name the first step and what it will take to deliver it."
      ];
      if (high) {
        scratches.push("Broad claims need a result you can show.");
      }
      if (cool) {
        scratches.push("Which specific user group and need do you have in mind?");
      }
      return scratches[seed % scratches.length];
    }
    if (headKey === "fervent") {
      var fervents = [
        "Identify the first user and what would make them switch.",
        "What evidence would convince you that demand exists?",
        "Try the idea with users before making a broad market claim."
      ];
      if (cool) {
        fervents.push("A focused first audience can make testing easier. How will you reach them?");
      }
      return fervents[seed % fervents.length];
    }
    var wardens = [
      "Restate the problem and first user in one sentence.",
      "What is the smallest version that could test this idea?",
      "Limit public claims to results you can support."
    ];
    return wardens[seed % wardens.length];
  }

  function verdictFor(headKey, score) {
    if (headKey === "scrath") {
      if (score >= 78) {
        return { tier: "Looks buildable", status: "pass", stamp: "A clear first step" };
      }
      if (score >= 55) {
        return { tier: "Feasible, with gaps", status: "warn", stamp: "Needs a tighter plan" };
      }
      return { tier: "Needs a smaller first version", status: "fail", stamp: "Start with a test" };
    }
    if (headKey === "fervent") {
      if (score >= 82) {
        return { tier: "Distinct with market potential", status: "pass", stamp: "Test demand with users" };
      }
      if (score >= 60) {
        return { tier: "Promising but untested", status: "warn", stamp: "Check the alternatives" };
      }
      return { tier: "Needs a stronger reason to choose it", status: "fail", stamp: "Find the unmet need" };
    }
    if (score >= 75) {
      return { tier: "Clear user and first step", status: "pass", stamp: "Ready to test" };
    }
    if (score >= 52) {
      return { tier: "First version needs definition", status: "warn", stamp: "Set a smaller scope" };
    }
    return { tier: "Problem or user is unclear", status: "fail", stamp: "Clarify the user" };
  }

  var HEADS = (HEAD_SOURCE ? HEAD_SOURCE.all : []).map(function (head) {
    var canonical = HEAD_SOURCE.byKey(head.key);
    return {
      key: head.key,
      name: head.name,
      epithet: head.epithet,
      motto: head.motto,
      color: head.color,
      rubric: canonical.rubric
    };
  });

  function scoreHead(head, a) {
    var rubric = head.rubric;
    var safety = (100 - a.risk) * rubric.risk;
    return clamp(
      a.clarity * rubric.clarity +
        a.feasibility * rubric.feasibility +
        a.originality * rubric.originality +
        safety +
        a.market * rubric.market,
      0,
      100
    );
  }

  function judgeVerdict(head, pitch, a, conversation) {
    var score = scoreHead(head, a);
    var verdict = verdictFor(head.key, score);
    return {
      key: head.key,
      name: head.name,
      epithet: head.epithet,
      color: head.color,
      motto: head.motto,
      numeral: head.numeral,
      score: score,
      dims: dimsFor(head, a, score),
      tier: verdict.tier,
      status: verdict.status,
      stamp: verdict.stamp,
      roast: roastFor(head.key, a, String(pitch.title || "")),
      verdict: copyLine(head.key, verdict, pitch, conversation),
      bullets: bulletsFor(head.key, a)
    };
  }

  // Each reviewer reports the five measured dimensions through its own lens: it
  // pulls the dimension it cares about toward its own headline score, so the
  // three cards differ instead of echoing one shared set.
  function dimsFor(head, a, score) {
    var measured = {
      clarity: a.clarity,
      feasibility: a.feasibility,
      originality: a.originality,
      risk: a.risk,
      market: a.market
    };
    var own = { scrath: "feasibility", fervent: "originality", warden: "clarity" }[head.key];
    var out = {};
    Object.keys(measured).forEach(function (key) {
      if (key === own) {
        out[key] = clamp((measured[key] + score) / 2, 0, 100);
      } else {
        // weight the shared reading toward this head's headline score a little
        out[key] = clamp(measured[key] * 0.7 + score * 0.3, 0, 100);
      }
    });
    return out;
  }

  function copyLine(headKey, verdict, pitch, conversation) {
    var description = String((pitch && pitch.description) || "");
    var founderText = String(conversation || "").split("\n").filter(function (line) {
      return /^founder:/i.test(line.trim());
    }).join(" ");
    var claim = description + " " + founderText;
    var firstVersion = /\b(first version|first release|mvp|prototype|pilot)\b/i.test(claim);
    var alternative = [
      ["group chats", /\bgroup chats?\b/i],
      ["spreadsheets", /\bspreadsheets?\b/i],
      ["WhatsApp", /\bwhatsapp\b/i],
      ["email", /\bemail\b/i],
      ["paper", /\bpaper\b/i],
      ["Notion", /\bnotion\b/i]
    ].filter(function (entry) { return entry[1].test(claim); })[0];
    if (headKey === "scrath") {
      if (firstVersion) {
        return verdict.status === "pass"
          ? "You named a first version. Put a time and cost on that scope, then build it for one user."
          : "You have a boundary for the first version. Show the one task end to end, then estimate what it takes.";
      }
      if (verdict.status === "pass") {
        return "This looks buildable. Put a time and cost on the smallest working version before committing.";
      }
      return "Pick one task to prototype. I need to see that workflow before I can judge the build.";
    }
    if (headKey === "fervent") {
      if (alternative) {
        return verdict.status === "pass"
          ? "You have a clear alternative in " + alternative[0] + ". See whether anyone comes back to your version after trying it."
          : "People already use " + alternative[0] + ". Show the moment your version works better, then ask someone to make the switch.";
      }
      if (verdict.status === "pass") {
        return "There is a reason to try it. Ask users what they would stop using if it worked.";
      }
      return "Name what people use today and the moment it lets them down. That is the comparison to win.";
    }
    if (firstVersion) {
      return "The user and problem are easy to follow. Your first version is named; decide what one successful use looks like.";
    }
    if (verdict.status === "pass") {
      return "The problem comes through. Keep the first version focused on one task and one user.";
    }
    return "I can see the problem. Say exactly what the first user needs to finish.";
  }

  function bulletsFor(headKey, a) {
    var pair = pickPair(a);
    var chosen = [];
    for (var i = 0; i < pair.length; i++) {
      if (pair[i].head === headKey) {
        chosen.push(pair[i].text);
      }
    }
    if (chosen.length < 2) {
      for (var j = 0; j < pair.length && chosen.length < 2; j++) {
        if (pair[j].head !== headKey && chosen.indexOf(pair[j].text) === -1) {
          chosen.push(pair[j].text);
        }
      }
    }
    return chosen.length ? chosen : ["Say what the first working version is."];
  }

  // The live AI seam. A failed or incomplete model review must stay an error.
  var liveRunner = null;

  // The last live-runner failure message. Kept in module scope, not on the
  // frozen export object: the module is strict-mode and the export is frozen, so
  // writing a new property on it (`this.lastLiveError = ...`) would throw and
  // report the model failure.
  var lastLiveError = null;

  window.CerberusJudges = Object.freeze({
    heads: HEADS.map(function (head) {
      return { key: head.key, name: head.name, epithet: head.epithet, motto: head.motto, color: head.color };
    }),
    scorePitch: function (pitch, conversation) {
      var a = analyze(pitch, conversation);
      var results = {};
      HEADS.forEach(function (head) {
        results[head.key] = judgeVerdict(head, pitch, a, conversation);
      });
      results.overall = overallFrom(results);
      results.overallTier = overallTier(results.overall);
      results.analysis = {
        clarity: a.clarity,
        feasibility: a.feasibility,
        originality: a.originality,
        risk: a.risk,
        market: a.market
      };
      results.source = "on-device";
      return results;
    },
    // A lightweight standing for the room: the three headline scores plus the
    // overall, without roasts, bullets, or copy. Used to refresh the "Current
    // standing" strip after each conversation turn. Same scoring path as the
    // full verdict, so the strip and the final verdict cannot disagree.
    quickStanding: function (pitch, conversation) {
      var a = analyze(pitch, conversation);
      var heads = {};
      var sum = 0;
      HEADS.forEach(function (head) {
        var score = scoreHead(head, a);
        heads[head.key] = { key: head.key, name: head.name, color: head.color, score: score };
        sum += score;
      });
      var overall = clamp(sum / HEADS.length, 0, 100);
      return { heads: heads, overall: overall, turns: a.turns || 0 };
    },
    // Register (or clear) a live runner: an async function (pitch, conversation) => verdict.
    setLiveRunner: function (runner) {
      liveRunner = typeof runner === "function" ? runner : null;
    },
    hasLiveRunner: function () {
      return Boolean(liveRunner);
    },
    getJudgeVerdicts: async function (pitch, conversation, options) {
      if (!liveRunner) throw new Error("Reviewer models are unavailable.");
      try {
        var live = await liveRunner(pitch, conversation, options || {});
        if (!live || !live.scrath || !live.fervent || !live.warden || !isFinite(live.overall)) {
          throw new Error("The live review was incomplete.");
        }
        live.source = live.source || "live";
        lastLiveError = null;
        return live;
      } catch (error) {
        lastLiveError = error && error.message ? error.message : String(error);
        throw error;
      }
    },
    // The last live-runner failure, for diagnostics. Null after a live run
    // succeeds or when no live runner has failed yet.
    getLastLiveError: function () {
      return lastLiveError;
    }
  });

  function overallTier(total) {
    if (total >= 78) {
      return { tier: "Ready to test", status: "pass", stamp: "Test with a real user" };
    }
    if (total >= 56) {
      return { tier: "Needs work", status: "warn", stamp: "Clarify the open questions" };
    }
    return { tier: "Not ready yet", status: "fail", stamp: "Revise the pitch before building" };
  }
})();
