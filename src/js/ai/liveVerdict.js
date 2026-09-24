/* Cerberus AI · ai/liveVerdict
   Orchestrates the live AI path. It runs the three reviewers in order (or a
   debate), then assembles the exact verdict object core/verdict.js renders:
   { scrath, fervent, warden, overall, overallTier, analysis, source }. */

(function () {
  "use strict";

  var client = window.CerberusTuskClient;
  var reviewers = window.CerberusReviewers;
  var debate = window.CerberusDebate;
  var heads = (window.CerberusHeads && window.CerberusHeads.all) || [];

  function partialTier(total) {
    if (total >= 78) {
      return { tier: "Ready to pitch", status: "pass", stamp: "All three reviewers approved" };
    }
    if (total >= 56) {
      return { tier: "Needs work", status: "warn", stamp: "Approved with conditions" };
    }
    return { tier: "Not ready yet", status: "fail", stamp: "The reviewers were not convinced" };
  }

  function overallFrom(parts) {
    return Math.max(0, Math.min(100, Math.round((parts.scrath + parts.fervent + parts.warden) / 3)));
  }

  function founderAnswers(conversation) {
    var answers = String(conversation || "").split("\n").filter(function (line) {
      return /^Founder:/i.test(line.trim());
    }).map(function (line) {
      return line.replace(/^Founder:\s*/i, "").trim();
    }).filter(Boolean).slice(-12);
    return answers.length
      ? answers.map(function (answer) { return "Founder: " + answer; }).join("\n")
      : "(No additional answers in chat.)";
  }

  // Overall analysis, averaged across the three reviewers' own dimension
  // scores. This is the shared summary; each card also renders its own dims.
  function deriveAnalysis(parts) {
    var keys = ["clarity", "feasibility", "originality", "risk", "market"];
    var sums = {};
    var counts = {};
    keys.forEach(function (k) {
      sums[k] = 0;
      counts[k] = 0;
    });
    ["scrath", "fervent", "warden"].forEach(function (headKey) {
      var dims = parts[headKey + "Dims"] || {};
      keys.forEach(function (k) {
        if (typeof dims[k] === "number" && isFinite(dims[k])) {
          sums[k] += dims[k];
          counts[k] += 1;
        }
      });
    });
    var out = {};
    keys.forEach(function (k) {
      out[k] = counts[k] ? Math.round(sums[k] / counts[k]) : 50;
    });
    return out;
  }

  function assemble(keyedVerdicts, source) {
    var result = { source: source };
    for (var i = 0; i < heads.length; i += 1) {
      var key = heads[i].key;
      result[key] = keyedVerdicts[key];
    }
    var parts = {
      scrath: result.scrath.score,
      fervent: result.fervent.score,
      warden: result.warden.score,
      scrathDims: result.scrath.dims,
      ferventDims: result.fervent.dims,
      wardenDims: result.warden.dims
    };
    result.overall = overallFrom(parts);
    result.overallTier = partialTier(result.overall);
    result.analysis = deriveAnalysis(parts);
    return result;
  }

  /**
   * Run the three reviewers live, one at a time to avoid overlapping requests.
   * options: { proxyUrl, models, state, signal, onReviewer, onStatus }
   */
  async function runReviewers(pitch, options) {
    var state = options.state || client.createState();
    state.proxyUrl = options.proxyUrl;
    var models = options.models || reviewers.defaultModels;
    var signal = options.signal;
    var onReviewer = options.onReviewer || function () {};
    var onStatus = options.onStatus || function () {};

    onStatus("Reviewing the pitch and your answers.");
    var answers = founderAnswers(options.conversation);

    var keyed = {};

    for (var head of heads) {
      if (signal && signal.aborted) {
        var cancelled = new Error("Review cancelled.");
        cancelled.name = "AbortError";
        throw cancelled;
      }
      onStatus(head.name + " is reviewing your pitch.");
      var modelId = models[head.key] || reviewers.defaultModels[head.key];
      var raw = await client.chat(state, head.key, modelId, reviewers.buildPrompt(head.key, pitch, answers), {
        signal: signal,
        onWait: onStatus,
        onDelta: function (piece) {
          onReviewer(head.key, { delta: piece });
        }
      });
      var parsed = reviewers.parseVerdict(raw, head.key, head, { strict: true });
      keyed[head.key] = parsed;
      onReviewer(head.key, { done: true, verdict: parsed });
    }
    return assemble(keyed, "live");
  }

  /**
   * Run debate mode, then map the Chief Justice verdict onto the three heads.
   * options: { proxyUrl, modelA, modelB, judgeModel, state, signal, onTurn, onStatus }
   */
  async function runDebate(pitch, options) {
    var state = options.state || client.createState();
    state.proxyUrl = options.proxyUrl;

    var outcome = await debate.run(pitch, {
      client: client,
      state: state,
      modelA: options.modelA,
      modelB: options.modelB,
      judgeModel: options.judgeModel,
      conversation: founderAnswers(options.conversation),
      signal: options.signal,
      onStatus: options.onStatus,
      onTurn: options.onTurn
    });

    var final = outcome.final;
    var keyed = {};
    heads.forEach(function (head) {
      var score = final[head.key];
      keyed[head.key] = {
        key: head.key,
        name: head.name,
        epithet: head.epithet,
        color: head.color,
        motto: head.motto,
        score: score,
        dims: final.dims[head.key],
        tier: final.tiers[head.key],
        status: reviewers.statusFor(score),
        stamp: reviewers.stampFor(head.key, score),
        roast: final.roast,
        verdict: typeof (final.reviews && final.reviews[head.key]) === "string" && final.reviews[head.key].trim()
          ? final.reviews[head.key].trim()
          : final.verdict,
        bullets: final.bullets
      };
    });

    var result = assemble(keyed, "debate");
    if (isFinite(Number(final.overall)) && final.overall !== null) {
      result.overall = Math.max(0, Math.min(100, Math.round(Number(final.overall))));
      result.overallTier = partialTier(result.overall);
    }
    result.consensus = outcome.consensus;
    result.transcript = outcome.transcript;
    return result;
  }

  window.CerberusLiveVerdict = Object.freeze({
    runReviewers: runReviewers,
    runDebate: runDebate,
    assemble: assemble,
    deriveAnalysis: deriveAnalysis
  });
})();
