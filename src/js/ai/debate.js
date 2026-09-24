/* Cerberus AI · ai/debate
   Debate mode: two models argue the pitch across rounds while a Lead Judge
   scores each landed turn, then a Chief Justice delivers the final verdict with
   those per-turn scores in hand. The verdict maps onto the three Cerberus
   reviewers so the result renders through the same verdict path. */

(function () {
  "use strict";

  var DEFAULT_JUDGE_MODEL = "bce9d196-5aa7-436a-9e28-760c6d3f8f3a"; // GPT-5.4 Mini
  var MAX_TURNS = 4;

  function debateRules() {
    return (
      "Discuss this specific pitch from your assigned side. Use only the pitch, the founder's answers, " +
      "and the points already made. Do not invent user research, market size, or results. Make one " +
      "concrete point in 50 to 85 words; engage with the other argument instead of restating the pitch. " +
      "Avoid debate clichés, startup slogans, and emojis. " +
      'If a genuine middle ground is reached, start your reply with "[CONSENSUS REACHED]".'
    );
  }

  function debatePrompt(role, side, pitch, transcript, founderAnswers) {
    var title = String((pitch && pitch.title) || "(untitled)");
    var description = String((pitch && pitch.description) || "");
    var audience = String((pitch && pitch.audience) || "(not named)");
    return (
      debateRules() + "\n\n" +
      "You are " + role + " (" + side + ") in this debate.\n\n" +
      "PITCH UNDER DEBATE\n" +
      "Title: " + title + "\n" +
      "Description: " + description + "\n" +
      "Audience: " + audience + "\n\n" +
      "FOUNDER'S ANSWERS DURING THE REVIEW\n" +
      (founderAnswers || "(No additional answers in chat.)") + "\n\n" +
      "TRANSCRIPT SO FAR:\n" + (transcript || "(none yet)") + "\n\n" +
      "Use the founder's answers as claims to assess, not as verified evidence. Respond to one " +
      "specific point from the other side and explain what would change your view. " +
      "Your turn:"
    );
  }

  function judgePrompt(turn, debater, argument) {
    return (
      "You are a neutral reviewer checking this debate turn. Judge the reasoning, not the debater.\n\n" +
      "DEBATER: " + debater + " (Turn " + turn + ")\n" +
      "ARGUMENT:\n\"\"\"" + argument + "\"\"\"\n\n" +
      "Score the turn on logic, evidence, and impact from 1 to 10. Give one or two sentences " +
      "that point to a specific strength or gap in the argument.\n" +
      "Return ONLY JSON:\n" +
      '{"logic": <1-10>, "evidence": <1-10>, "impact": <1-10>, "commentary": "<two sentences>"}'
    );
  }

  function finalJudgePrompt(pitch, transcript, consensus, turnJudgments, founderAnswers) {
    var title = String((pitch && pitch.title) || "(untitled)");
    var summary = formatTurnJudgments(turnJudgments);
    return (
      "You are the final reviewer of this pitch. Base the ruling on the pitch and what the founder " +
      "said in the discussion.\n\n" +
      "PITCH: " + title + "\n" +
      "DESCRIPTION: " + String((pitch && pitch.description) || "") + "\n" +
      "AUDIENCE: " + String((pitch && pitch.audience) || "") + "\n" +
      "STATUS: " + (consensus ? "Consensus reached" : "Maximum rounds completed") + "\n\n" +
      "FOUNDER'S ANSWERS DURING THE REVIEW\n" +
      (founderAnswers || "(No additional answers in chat.)") + "\n\n" +
      "FULL TRANSCRIPT:\n" + transcript + "\n\n" +
      (summary ? "LEAD JUDGE PER-TURN SCORES (1-10 each, use as evidence):\n" + summary + "\n\n" : "") +
      "Score the pitch through three distinct lenses and return ONLY JSON. Give buildability, " +
      "originality, and clarity the most weight in Joko's, Kowi's, and Dodo's scores respectively. Use the founder's " +
      "answers to update your view, while separating a specific test or result from an intention. " +
      "Give each reviewer a different, pitch-specific reason; do not copy the same verdict into all three. " +
      "Be concise: keep each review to one sentence and the overall verdict to one or two short sentences.\n" +
      '{"scrath": <0-100 Joko buildability>,' +
      ' "fervent": <0-100 Kowi originality>,' +
      ' "warden": <0-100 Dodo clarity>,' +
      ' "overall": <0-100 composite>,' +
      ' "tiers": {"scrath": "<two to four word assessment>", "fervent": "<two to four word assessment>", "warden": "<two to four word assessment>"},' +
      ' "dims": {"scrath": {"clarity": <0-100>, "feasibility": <0-100>, "originality": <0-100>, "risk": <0-100>, "market": <0-100>},' +
      ' "fervent": {"clarity": <0-100>, "feasibility": <0-100>, "originality": <0-100>, "risk": <0-100>, "market": <0-100>},' +
      ' "warden": {"clarity": <0-100>, "feasibility": <0-100>, "originality": <0-100>, "risk": <0-100>, "market": <0-100>}},' +
      ' "reviews": {"scrath": "<one sentence on scope, cost, or dependencies>",' +
      ' "fervent": "<one sentence on alternatives or demand>",' +
      ' "warden": "<one sentence on the user, problem, or first task>"},' +
      ' "verdict": "<one or two sentences explaining the verdict>",' +
      ' "bullets": ["<short critique>", "<short critique>"]}'
    );
  }

  // A compact, model-readable summary of the per-turn judge scores, so the
  // Chief Justice rules with the Lead Judge's read of the debate in hand.
  function formatTurnJudgments(turnJudgments) {
    if (!Array.isArray(turnJudgments) || !turnJudgments.length) {
      return "";
    }
    return turnJudgments
      .map(function (entry) {
        return (
          "Turn " + entry.turn + " (" + entry.debater + "): " +
          "logic " + entry.logic + ", evidence " + entry.evidence + ", impact " + entry.impact +
          (entry.commentary ? " - " + entry.commentary : "")
        );
      })
      .join("\n");
  }

  // The average of the per-turn judge scores, or null when nothing was judged.
  // Used to fill any dimension the Chief Justice leaves out.
  function averageJudgeScore(turnJudgments) {
    if (!Array.isArray(turnJudgments) || !turnJudgments.length) {
      return null;
    }
    var total = 0;
    var count = 0;
    turnJudgments.forEach(function (entry) {
      total += (Number(entry.logic) || 0) + (Number(entry.evidence) || 0) + (Number(entry.impact) || 0);
      count += 3;
    });
    if (!count) {
      return null;
    }
    return Math.round((total / count) * 10); // 1-10 average scaled to 0-100
  }

  function parseJson(text) {
    var match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch (error) {
      return null;
    }
  }

  function clampScore(value, fallback) {
    var n = Number(value);
    if (!isFinite(n)) {
      return fallback;
    }
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  // Extract the numeric scores from a judge turn (logic, evidence, impact).
  function parseJudge(text) {
    var data = parseJson(text);
    if (!data || ![data.logic, data.evidence, data.impact].every(function (score) {
      return score !== null && score !== "" && isFinite(Number(score));
    })) throw new Error("The turn judge did not return scores.");
    return {
      logic: Number(data.logic) || 0,
      evidence: Number(data.evidence) || 0,
      impact: Number(data.impact) || 0,
      commentary: typeof data.commentary === "string" ? data.commentary : ""
    };
  }

  /**
   * Run a full debate.
   * deps: { client, state, modelA, modelB, judgeModel, signal,
   *         onStatus, onTurn }
   * Returns { transcript, consensus, final }.
   */
  async function run(pitch, deps) {
    const client = deps.client;
    const state = deps.state;
    const modelA = deps.modelA;
    const modelB = deps.modelB;
    const judgeModel = deps.judgeModel || DEFAULT_JUDGE_MODEL;
    const signal = deps.signal;
    const onStatus = deps.onStatus || function () {};
    const onTurn = deps.onTurn || function () {};
    const founderAnswers = deps.conversation || "(No additional answers in chat.)";

    var transcript = "";
    var consensus = false;
    var judgeScores = [];

    for (var turn = 1; turn <= MAX_TURNS; turn += 1) {
      if (signal && signal.aborted) {
        throw new Error("Debate cancelled.");
      }
      var isA = turn % 2 === 1;
      var role = isA ? "Debater A" : "Debater B";
      var model = isA ? modelA : modelB;
      onStatus("Turn " + turn + " of " + MAX_TURNS + ": " + role + " responds.");

      var argument;
      try {
        argument = await client.chat(
          state,
          "debate-" + role,
          model,
          debatePrompt(role, isA ? "arguing for the idea" : "arguing against the idea", pitch, transcript, founderAnswers),
          { signal: signal, onWait: onStatus, onDelta: (piece) => onTurn({ kind: "argument", role: role, delta: piece }) }
        );
      } catch (error) {
        if (error && (error.status === 429 || error.name === "AbortError")) throw error;
        // One flaky model turn must not sink the whole debate. Note it and move
        // on; the Chief Justice still rules on the turns that did land.
        onStatus("Turn " + turn + " was skipped (" + (error && error.message ? error.message : "model error") + ").");
        onTurn({ kind: "argument-end", role: role, text: "" });
        continue;
      }

      if (!argument || !String(argument).trim()) {
        onStatus("Turn " + turn + " came back empty and was skipped.");
        onTurn({ kind: "argument-end", role: role, text: "" });
        continue;
      }

      transcript += "\n\n" + role + ": " + argument;
      onTurn({ kind: "argument-end", role: role, text: argument });

      // The Lead Judge scores every landed turn. A judge failure on one turn is
      // noted and skipped; it never sinks the debate.
      try {
        var judgeText = await client.chat(
          state,
          "debate-judge-turn-" + turn,
          judgeModel,
          judgePrompt(turn, role, argument),
          { signal: signal, onWait: onStatus, onDelta: (piece) => onTurn({ kind: "judge-turn", delta: piece }) }
        );
        var parsed = parseJudge(judgeText);
        parsed.turn = turn;
        parsed.debater = role;
        judgeScores.push(parsed);
      } catch (error) {
        if (error && (error.status === 429 || error.name === "AbortError")) throw error;
        onStatus("The judge skipped turn " + turn + " (" + (error && error.message ? error.message : "model error") + ").");
      }

      if (argument.indexOf("[CONSENSUS REACHED]") !== -1) {
        consensus = true;
        onStatus("Consensus reached on turn " + turn + ".");
        break;
      }
    }

    onStatus("Putting the scores together.");
    var finalText = await client.chat(
      state,
      "debate-judge",
      judgeModel,
      finalJudgePrompt(pitch, transcript, consensus, judgeScores, founderAnswers),
      { signal: signal, onWait: onStatus, onDelta: (piece) => onTurn({ kind: "judge", delta: piece }) }
    );
    onTurn({ kind: "argument-end", role: "judge", text: finalText });

    var final = parseJson(finalText) || {};
    var reviews = final.reviews;
    var keys = ["scrath", "fervent", "warden"];
    var dimensions = ["clarity", "feasibility", "originality", "risk", "market"];
    if (![final.scrath, final.fervent, final.warden].every(function (score) {
      return score !== null && score !== "" && isFinite(Number(score));
    }) || !reviews || !keys.every(function (key) {
      return typeof reviews[key] === "string" && reviews[key].trim();
    }) || !final.tiers || !keys.every(function (key) {
      return typeof final.tiers[key] === "string" && final.tiers[key].trim();
    }) || !final.dims || !keys.every(function (key) {
      return final.dims[key] && dimensions.every(function (dim) {
        var value = final.dims[key][dim];
        return value !== null && value !== "" && isFinite(Number(value));
      });
    })) {
      throw new Error("The final reviewer returned an incomplete verdict.");
    }
    keys.forEach(function (key) {
      dimensions.forEach(function (dim) {
        final.dims[key][dim] = clampScore(final.dims[key][dim], null);
      });
    });
    return {
      transcript: transcript,
      consensus: consensus,
      judgeScores: judgeScores,
      final: {
        scrath: clampScore(final.scrath, null),
        fervent: clampScore(final.fervent, null),
        warden: clampScore(final.warden, null),
        overall: clampScore(final.overall, null),
        tiers: final.tiers,
        dims: final.dims,
        reviews: reviews,
        roast: typeof final.roast === "string" ? final.roast : reviews.scrath,
        verdict: typeof final.verdict === "string" ? final.verdict : reviews.scrath,
        bullets: Array.isArray(final.bullets)
          ? final.bullets.filter((b) => typeof b === "string" && b.trim()).slice(0, 2)
          : []
      }
    };
  }

  window.CerberusDebate = Object.freeze({
    defaultJudgeModel: DEFAULT_JUDGE_MODEL,
    maxTurns: MAX_TURNS,
    parseJudge: parseJudge,
    parseJson: parseJson,
    run: run,
    _prompts: { debatePrompt: debatePrompt, judgePrompt: judgePrompt, finalJudgePrompt: finalJudgePrompt }
  });
})();
