(function () {
  "use strict";

  // The reviewers and the shared keyword sets come from core/heads.js so the
  // conversation the user has and the score they receive speak the same words.
  var HEAD_SOURCE = window.CerberusHeads;
  var HEADS = (HEAD_SOURCE ? HEAD_SOURCE.all : []).map(function (head) {
    return {
      key: head.key,
      name: head.name,
      epithet: head.epithet,
      motto: head.motto,
      color: head.color,
      numeral: head.numeral
    };
  });

  var KEYWORDS = HEAD_SOURCE ? HEAD_SOURCE.keywords : { hype: [], sensitive: [], pain: [], niche: [] };

  var THINKING = {
    scrath: ["Checking the first build", "Looking at scope and cost"],
    fervent: ["Comparing the alternatives", "Looking for evidence of demand"],
    warden: ["Pinning down the user", "Checking the problem and first task"]
  };

  var BANKS = {
    question: {
      scrath: ["Name the first buyer and what they would pay for.", "Who pays, and when would you ask them?"],
      fervent: ["How would potential users hear about this?", "What could you demonstrate to show people want it?"],
      warden: ["State the answer in one clear sentence.", "Can the first version help the user do that task?"]
    },
    hype: {
      scrath: ["The claim needs evidence. What result can you measure?", "Replace the broad claim with the first step you can take."],
      fervent: ["What could you demonstrate to support that claim?", "How would a potential user confirm that the product works?"],
      warden: ["What could you build and test this week?", "State what the first version does without the broad claim."]
    },
    niche: {
      fervent: ["Which alternatives does this audience use today?", "What would make this group choose your idea?"],
      scrath: ["How many people are in the first audience you can reach?", "Where could you find and speak with these users?"],
      warden: ["Name one user in this audience and the task they need to do.", "How would you reach the first few users?"]
    },
    pain: {
      fervent: ["How often does this problem happen for the people you named?", "What do people do now when this problem comes up?"],
      warden: ["Describe the problem before describing the product.", "What is the first step you would build to address it?"],
      scrath: ["How could you reach people who have this problem?", "Can you test whether the solution actually reaches them?"]
    },
    sensitive: {
      warden: ["This may involve regulated activity. Check the relevant rules before making public claims.", "Keep the pitch to claims you can support and safely publish."],
      scrath: ["What compliance work and cost would this require?", "Who can verify the requirements before you build?"],
      fervent: ["Which result can you claim and demonstrate safely?", "Keep the benefit specific to what the product can show."]
    },
    audience: {
      warden: ["Which specific user has this problem most often?", "What task does this user need to complete?"],
      scrath: ["Who would pay, and what would they pay for?", "State this user's problem in one sentence."],
      fervent: ["What alternatives does this audience use?", "What would make this audience switch?"]
    },
    plan: {
      scrath: ["What is the first task you can complete?", "What time or equipment would that first step require?"],
      warden: ["What would you include in the first version?", "What can you leave out and still test the idea?"],
      fervent: ["How soon could you show the idea to a potential user?", "What would you ask a user to test first?"]
    },
    market: {
      scrath: ["Who is the first person you could ask to pay?", "What would count as evidence of demand?"],
      fervent: ["What would make someone try this instead of their current option?", "How could you learn whether people want this before building it?"],
      warden: ["What is the smallest version a user could try?", "What task should that version support?"]
    },
    web3: {
      scrath: ["Which user needs this information recorded on-chain?", "What requirement does the chain meet that a database cannot?"],
      warden: ["What part of the product needs to use a blockchain?", "Could the first version work without an on-chain component?"],
      fervent: ["How does a public record help the user?", "What would users gain from the on-chain part?"]
    },
    ai: {
      warden: ["What task does the AI help the user complete?", "What result should the user check before relying on the model?"],
      fervent: ["What can users do with this that they cannot do now?", "How could a simple demo show the benefit?"],
      scrath: ["What happens when the model gives a wrong answer?", "How would you measure whether the model is reliable enough?"]
    },
    fallback: {
      scrath: ["What is the first version you would build?", "Which part is hardest to deliver with your current resources?", "How could you test demand before building it?", "What would the first release cost?", "What could stop the first version from working?", "Which feature can you leave out of the first test?"],
      fervent: ["What are people using instead today?", "Why would someone choose this over that option?", "What evidence could show that people want it?", "Who would try this first?", "What would make the idea easy to explain to a new user?", "What would you want a user to say after trying it?"],
      warden: ["Who has the problem most often?", "What task would the first version help with?", "What result would tell you the product helped?", "How would the first user find this?", "Which part of the pitch can you test with one user?", "What can wait until after the first test?"]
    }
  };

  var OVERHEARS = {
    scrath: "What would the first version cost to build?",
    fervent: "Which alternative would a user compare this with?",
    warden: "Who will try the first version, and when?"
  };

  // The first thing each reviewer says when the review opens (before the founder
  // has typed anything to the panel). Each opener names the pitch back and asks
  // the one question that reviewer most needs answered, in that reviewer's voice.
  // Deterministic and clearly on-device: no scores, no invented specifics.
  var OPENERS = {
    scrath: [
      "For {title}, what is the smallest version you could build and test first?",
      "What would you build for {title} in the first week, and what could block it?",
      "Which part of {title} can you test before building the full product?"
    ],
    fervent: [
      "Who wants {title} badly enough to switch from what they use now?",
      "What makes {title} different from the alternatives, and how would a user notice?",
      "Which person has this problem most often, and what would they pay to solve it?"
    ],
    warden: [
      "Who is the first user for {title}, and what job would the first version help them do?",
      "State the problem in one sentence. Who has it most often?",
      "Where do these users look for a solution today, and what is missing?"
    ]
  };

  var NUDGE = "Add the problem and first step to the pitch, or explain them here.";

  var WEB3_WORDS = ["chain", "web3", "token", "defi", "nft", "daos", "dao", "on-chain", "on chain", "ledger", "smart contract", "wallet"];
  var AI_WORDS = [" ai", "model", "machine learning", "llm", "copilot", "agent", "neural"];

  function hash(text) {
    var value = 0;
    for (var i = 0; i < text.length; i++) {
      value = (value * 31 + text.charCodeAt(i)) >>> 0;
    }
    return value;
  }

  function getRoll(slot) {
    var current = 0;
    try {
      var raw = sessionStorage.getItem("cerberus-pack-roll");
      var parsed = raw ? JSON.parse(raw) : {};
      current = parsed[slot] || 0;
    } catch (err) {
      current = 0;
    }
    current += 1;
    try {
      var store = {};
      try {
        store = JSON.parse(sessionStorage.getItem("cerberus-pack-roll")) || {};
      } catch (err2) {
        store = {};
      }
      store[slot] = current;
      sessionStorage.setItem("cerberus-pack-roll", JSON.stringify(store));
    } catch (err3) {
      return current;
    }
    return current;
  }

  function getTurn() {
    try {
      return parseInt(sessionStorage.getItem("cerberus-pack-turn"), 10) || 0;
    } catch (err) {
      return 0;
    }
  }

  function setTurn(n) {
    try {
      sessionStorage.setItem("cerberus-pack-turn", String(n));
    } catch (err) {}
  }

  function resetSession() {
    try {
      sessionStorage.removeItem("cerberus-pack-roll");
      sessionStorage.removeItem("cerberus-pack-turn");
    } catch (err) {}
  }

  function matches(text, words) {
    var lower = " " + text.toLowerCase() + " ";
    for (var i = 0; i < words.length; i++) {
      if (lower.indexOf(words[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  function detect(text) {
    var lower = text.toLowerCase();
    var flags = {
      question: /[?？]$/.test(text.trim()) || /^(who|what|when|where|how|why|does|is|are|can|should|would|will|do) /.test(lower),
      hype: matches(lower, KEYWORDS.hype),
      niche: matches(lower, KEYWORDS.niche),
      pain: matches(lower, KEYWORDS.pain),
      sensitive: matches(lower, KEYWORDS.sensitive),
      audience: matches(lower, ["who is it for", "who should", "for whom", "who's it for", "whos it for", "audience", "customer", "users", "buyer", "target"]),
      plan: matches(lower, ["how", "when", "would", "what if", "step", "ship", "plan", "build", "version", "roadmap", "test", "pilot", "prototype"]),
      market: matches(lower, ["market", "price", "cost", "pay", "sell", "sales", "money", "revenue", "how much"]),
      web3: matches(lower, WEB3_WORDS),
      ai: matches(lower, AI_WORDS)
    };
    return flags;
  }

  var PRIORITY = ["sensitive", "audience", "pain", "niche", "hype", "plan", "market", "web3", "ai", "question"];

  function primaryTrigger(flags) {
    for (var i = 0; i < PRIORITY.length; i++) {
      if (flags[PRIORITY[i]]) {
        return PRIORITY[i];
      }
    }
    return null;
  }

  var SECONDARY = {
    sensitive: "pain",
    audience: "plan",
    pain: "niche",
    niche: "market",
    hype: "market",
    plan: "audience",
    market: "niche",
    web3: "plan",
    ai: "plan",
    question: null
  };

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

  function pickLine(headKey, trigger, seed, slot) {
    var bank = BANKS[trigger] || BANKS.fallback;
    var lines = bank[headKey] || BANKS.fallback[headKey];
    if (!lines || !lines.length) {
      lines = BANKS.fallback[headKey];
    }
    var index = (hash(seed + headKey) + getRoll(slot)) % lines.length;
    return lines[index];
  }

  function excerpt(text, limit) {
    var value = String(text || "").replace(/\s+/g, " ").trim();
    value = value.split(/[.!?\n]/)[0].replace(/^[\s,;:]+|[\s,;:]+$/g, "");
    if (value.length > limit) {
      value = value.slice(0, limit).replace(/\s+\S*$/, "").replace(/[\s,;:]+$/, "");
    }
    return value;
  }

  // The offline reviewer has no language model, so it uses a short piece of
  // the founder's own answer to decide whether to acknowledge a useful test or
  // ask for the next concrete detail. Keep the follow-up tied to each lens.
  function contextualReply(headKey, text, pitch, seed) {
    var words = String(text || "").trim().split(/\s+/);
    if (words.length < 6 || /^(i don't know|not sure|maybe|idk)\b/i.test(String(text || "").trim())) {
      return null;
    }
    var audience = excerpt(pitch && pitch.audience, 44);
    var lower = text.toLowerCase();
    var alternative = "";
    [["spreadsheet", "spreadsheets"], ["notion", "Notion"], ["excel", "Excel"], ["paper", "paper"], ["whatsapp", "WhatsApp"]].some(function (item) {
      if (lower.indexOf(item[0]) !== -1) {
        alternative = item[1];
        return true;
      }
      return false;
    });
    var mentionsMissedWork = /miss(?:ed|es|ing)?|forget(?:s|ting)?/.test(lower);
    var options = hasConcreteEvidence(text) ? {
      scrath: ["Keep the first test small. What must work before anyone can try it?", "Your test has a number attached. What could stop you from running it?"],
      fervent: alternative
        ? ["They already use " + alternative + ". What would make them open your version instead?", "When they try it, watch whether they return to " + alternative + ". That tells you more than a polite yes."]
        : ["You have people to ask. What would make them try this again after the first test?", "That gives you a group to learn from. Watch what they actually use after trying it."],
      warden: mentionsMissedWork
        ? ["A missed follow-up is a clear failure to count. Which reminder should the first test handle?", "Start by counting missed follow-ups. How many fewer would make the test a win?"]
        : ["There is a user and a task to test. What should the first version help them finish?", "What result from that first test would tell you the idea helped?"]
    } : {
      scrath: ["What needs to be ready before " + (audience || "the first user") + " can try it?", "Which part could you leave out and still test the idea?"],
      fervent: ["What do " + (audience || "those users") + " use now instead?", "What would make them switch from the option they use today?"],
      warden: ["What should the first version help " + (audience || "the user") + " finish?", "What does the first user do today when this problem comes up?"]
    };
    var choices = options[headKey] || options.warden;
    return choices[seed % choices.length];
  }

  function buildReplies(text, pitch) {
    var flags = detect(text);
    var primary = primaryTrigger(flags);
    var turn = getTurn();
    var order = [];
    var used = {};

    if (primary) {
      order.push(PRIMARY_HEAD[primary]);
      used[PRIMARY_HEAD[primary]] = true;
      var second = SECONDARY[primary];
      // A clear signal earns a second read from another lens, so the room hears
      // more than one head. A safety issue or concrete evidence always does.
      var wantsSecond = primary !== "question" || hasConcreteEvidence(text);
      if (wantsSecond && second && SECONDARY_HEAD[primary] && !used[SECONDARY_HEAD[primary]]) {
        order.push(SECONDARY_HEAD[primary]);
        used[SECONDARY_HEAD[primary]] = true;
      }
    } else {
      var fallbackHead = HEADS[turn % HEADS.length].key;
      order.push(fallbackHead);
    }

    setTurn(turn + 1);

    return order.map(function (headKey, idx) {
      var seed = hash(text + headKey + turn + idx);
      var line = contextualReply(headKey, text, pitch, seed);
      if (!line) {
        line = pickLine(headKey, primary || "fallback", text, headKey + ":" + turn + ":" + idx);
      }
      return {
        head: headKey,
        text: line
      };
    });
  }

  // The reviewers open the review. The founder has stated a pitch (gate or
  // panel) but has not typed to the panel yet. One reviewer opens by naming the
  // pitch and asking their sharpest question; the others wait to join. Returns
  // [{ head, text }] with a single opener.
  function openingReplies(pitch) {
    var facts = pitch || {};
    var title = String(facts.title || "").trim() || "your idea";
    var audience = excerpt(facts.audience, 54);
    var openerKey = openerFor(facts);
    if (audience) {
      var opening = {
        scrath: "What is the smallest version of " + title + " you can put in front of " + audience + "?",
        fervent: "What do " + audience + " use now, and what would make them choose " + title + " instead?",
        warden: "What is the hardest part of this problem for " + audience + " today?"
      };
      return [{ head: openerKey, text: opening[openerKey] || opening.warden }];
    }
    var lines = OPENERS[openerKey] || OPENERS.warden;
    var index = hash(title + ":" + openerKey) % lines.length;
    return [{
      head: openerKey,
      text: lines[index].replace(/\{title\}/g, title)
    }];
  }

  // Choose the opener from the pitch's strongest signal, so the first voice is
  // the reviewer with the most at stake on what the pitch actually says.
  function openerFor(pitch) {
    var all = (
      String(pitch.title || "") + " " + String(pitch.description || "") + " " + String(pitch.audience || "")
    ).toLowerCase();
    if (matches(all, KEYWORDS.sensitive)) {
      return "warden";
    }
    if (matches(all, KEYWORDS.hype)) {
      return "scrath";
    }
    if (matches(all, KEYWORDS.niche) || matches(all, KEYWORDS.pain)) {
      return "fervent";
    }
    return "warden";
  }

  function nudge(pitch, turnCount) {
    if (turnCount < 2) {
      return null;
    }
    var desc = String((pitch && pitch.description) || "").trim();
    if (desc.length >= 30) {
      return null;
    }
    return { head: "warden", text: NUDGE };
  }

  window.CerberusPack = Object.freeze({
    heads: HEADS.map(function (h) {
      return { key: h.key, name: h.name, epithet: h.epithet, motto: h.motto, color: h.color, numeral: h.numeral };
    }),
    thinkingFor: function (headKey) {
      var list = THINKING[headKey] || THINKING.warden;
      return list[hash(headKey + getRoll("think-" + headKey)) % list.length];
    },
    reply: function (text, pitch) {
      try {
        return buildReplies(String(text || ""), pitch || {});
      } catch (err) {
        return [{ head: "warden", text: "The reviewers could not complete that reply. Try again." }];
      }
    },
    openingReplies: function (pitch) {
      try {
        return openingReplies(pitch || {});
      } catch (err) {
        return [{ head: "warden", text: "The reviewers are ready. Tell them who this is for and what ships first." }];
      }
    },
    resetSession: resetSession,
    nudge: nudge
  });
})();
