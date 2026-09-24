/* Cerberus AI · core/verdict
   Rendering the verdict: the overall total, the takeaway, one card per
   reviewer with a score dial and bar, the critique copy, and the
   analysis dimensions that explain where a score came from. */

(function () {
  "use strict";

  var dom = window.CerberusDom;
  var getElement = dom.getElement;
  var escapeHtml = dom.escapeHtml;
  var prefersReducedMotion = dom.prefersReducedMotion;

  var LABELS = (window.CerberusHeads && window.CerberusHeads.analysisLabels) || {};

  function toneFor(status) {
    if (status === "pass") {
      return "var(--moss)";
    }
    if (status === "warn") {
      return "var(--flame)";
    }
    return "var(--status-fail)";
  }

  function scoreDial(score, color, name) {
    return (
      "<div class='score-dial' data-score='" + score + "' style='--deg:0deg;--head:" + color + "' role='img' aria-label='" +
        escapeHtml(name) + " scored " + score + " out of 100'>" +
        "<strong data-count='" + score + "'>0</strong>" +
      "</div>"
    );
  }

  // The small labeled bars that show the analysis dimensions behind a score.
  function analysisBars(analysis) {
    if (!analysis) {
      return "";
    }
    return Object.keys(LABELS).map(function (key) {
      var value = Number(analysis[key]) || 0;
      return (
        "<li class='analysis-bar'>" +
          "<span class='analysis-bar__label'>" + escapeHtml(LABELS[key]) + "</span>" +
          "<span class='analysis-bar__track'><i style='width:" + value + "%'></i></span>" +
          "<span class='analysis-bar__value'>" + value + "</span>" +
        "</li>"
      );
    }).join("");
  }

  var FOCUS_MAP = {
    scrath: "Buildability",
    fervent: "Originality",
    warden: "Clarity"
  };

  var NUMERAL_MAP = {
    scrath: "I",
    fervent: "II",
    warden: "III"
  };

  function headCard(headResult, analysis) {
    // Prefer the reviewer's own dimensions; fall back to the shared summary.
    var dims = headResult.dims || analysis;
    var numeral = headResult.numeral || NUMERAL_MAP[headResult.key] || "";
    var focus = FOCUS_MAP[headResult.key] || "";
    return (
      "<article class='verdict-card' style='--head:" + headResult.color + "' data-status='" + headResult.status + "'>" +
        "<div class='verdict-card__top'>" +
          "<div class='verdict-card__who'>" +
            (numeral ? "<span class='verdict-card__badge' aria-hidden='true'>" + escapeHtml(numeral) + "</span>" : "") +
            "<div class='verdict-card__identity'>" +
              "<h3 class='verdict-card__name'>" + escapeHtml(headResult.name) + "</h3>" +
              "<span class='verdict-card__epithet'>" + escapeHtml(headResult.epithet) + "</span>" +
            "</div>" +
          "</div>" +
          (focus ? "<span class='verdict-card__focus-tag'>" + escapeHtml(focus) + "</span>" : "") +
        "</div>" +
        "<div class='verdict-card__score'>" +
          scoreDial(headResult.score, headResult.color, headResult.name) +
          "<div class='verdict-card__status-col'>" +
            "<p class='verdict-card__tier'>" + escapeHtml(headResult.tier) + "</p>" +
            "<div class='verdict-scorebar' style='--head:" + headResult.color + "'><i data-bar='" + headResult.score + "' style='width:0%'></i></div>" +
          "</div>" +
        "</div>" +
        "<div class='verdict-card__body'>" +
          "<p class='verdict-copy'>" + escapeHtml(headResult.verdict) + "</p>" +
        "</div>" +
        "<details class='verdict-why'>" +
          "<summary class='verdict-why__toggle'>Why this score</summary>" +
          "<ul class='analysis-bars'>" + analysisBars(dims) + "</ul>" +
        "</details>" +
      "</article>"
    );
  }

  // Purpose: let a score read as movement, not a static number. Respects
  // reduced motion by snapping straight to the final values.
  function animateCount(el, target, duration) {
    if (prefersReducedMotion() || !window.requestAnimationFrame) {
      el.textContent = String(target);
      return;
    }
    var start = window.performance && window.performance.now ? window.performance.now() : Date.now();
    function tick(now) {
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(target * eased));
      if (t < 1) {
        window.requestAnimationFrame(tick);
      } else {
        el.textContent = String(target);
      }
    }
    window.requestAnimationFrame(tick);
  }

  function animateVerdictNumbers() {
    // Skill dials sweep and score bars fill from zero on the next frame so the
    // CSS transitions actually run. The overall total counts up.
    var dials = document.querySelectorAll(".score-dial[data-score]");
    var bars = document.querySelectorAll(".verdict-scorebar i[data-bar]");
    var counts = document.querySelectorAll("[data-count]");

    window.requestAnimationFrame(function () {
      dials.forEach(function (dial) {
        var score = Number(dial.getAttribute("data-score")) || 0;
        dial.style.setProperty("--deg", Math.round(score * 3.6) + "deg");
      });
      bars.forEach(function (bar) {
        bar.style.width = (Number(bar.getAttribute("data-bar")) || 0) + "%";
      });
      counts.forEach(function (count) {
        animateCount(count, Number(count.getAttribute("data-count")) || 0, 900);
      });
    });
  }

  function renderVerdicts(result, pitch) {
    var pitchLine = getElement("verdict-pitch");
    if (pitchLine) {
      var title = String((pitch && pitch.title) || "Your pitch").trim();
      var audience = String((pitch && pitch.audience) || "").trim();
      pitchLine.textContent = title + (audience ? " · for " + audience : "");
    }

    var total = getElement("verdict-total");
    if (total) {
      total.hidden = false;
      total.style.setProperty("--head", toneFor(result.overallTier.status));
    }
    var totalValue = getElement("verdict-total-value");
    totalValue.textContent = "0";
    totalValue.setAttribute("data-count", String(result.overall));

    var takeaway = getElement("verdict-takeaway");
    if (takeaway) {
      var weakest = [result.scrath, result.fervent, result.warden].sort(function (a, b) {
        return a.score - b.score;
      })[0];
      takeaway.style.setProperty("--head", toneFor(result.overallTier.status));
      takeaway.textContent = weakest.verdict;
    }
    var summaryBox = getElement("verdict-summary-box");
    if (summaryBox) {
      summaryBox.style.setProperty("--head", toneFor(result.overallTier.status));
    }

    getElement("head-cards").innerHTML = [result.scrath, result.fervent, result.warden].map(function (headResult) {
      return headCard(headResult, result.analysis);
    }).join("");

    var stale = getElement("verdict-stale");
    if (stale) {
      stale.hidden = true;
    }

    var publishPanel = getElement("publish-panel");
    if (publishPanel) {
      publishPanel.hidden = true;
    }
    // Reset the publish toggle to its collapsed label and state, so a fresh
    // verdict never inherits "Hide publish setup" from the previous run.
    if (window.CerberusPublish && window.CerberusPublish.setPublishToggleLabel) {
      window.CerberusPublish.setPublishToggleLabel(false);
    } else {
      var publishToggle = getElement("publish-toggle");
      if (publishToggle) {
        publishToggle.setAttribute("aria-expanded", "false");
      }
    }
    dom.setPublishMessage("", "");
    var proof = getElement("publish-proof");
    if (proof) {
      proof.hidden = true;
      proof.textContent = "";
    }
  }

  function showVerdict(result, pitch) {
    var section = getElement("verdict");
    var loading = getElement("verdict-loading");
    var body = getElement("verdict-result");
    if (loading) {
      loading.hidden = true;
    }
    if (body) {
      body.hidden = false;
    }
    renderVerdicts(result, pitch);
    section.hidden = false;
    // Move focus to the result so keyboard and screen-reader users land on it.
    var title = getElement("verdict-title");
    if (title) {
      title.focus({ preventScroll: true });
    }
    section.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    animateVerdictNumbers();
  }

  function showLoading() {
    var section = getElement("verdict");
    var loading = getElement("verdict-loading");
    var body = getElement("verdict-result");
    section.hidden = false;
    if (loading) {
      loading.hidden = false;
      var status = loading.querySelector(".verdict-loading__title");
      if (status) status.textContent = "Reviewing your pitch…";
    }
    if (body) {
      body.hidden = true;
    }
    var run = getElement("run-verdict");
    if (run) {
      run.disabled = true;
      run.classList.add("is-busy");
      run.textContent = "Reading your pitch...";
    }
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetRunButton() {
    var run = getElement("run-verdict");
    if (run) {
      run.disabled = false;
      run.classList.remove("is-busy");
      run.textContent = "Get the verdict";
    }
  }

  function hide() {
    var section = getElement("verdict");
    if (section) {
      section.hidden = true;
    }
    var cards = getElement("head-cards");
    if (cards) {
      cards.innerHTML = "";
    }
    var loading = getElement("verdict-loading");
    if (loading) {
      loading.hidden = true;
    }
  }

  window.CerberusVerdict = Object.freeze({
    render: renderVerdicts,
    show: showVerdict,
    showLoading: showLoading,
    resetRunButton: resetRunButton,
    animateNumbers: animateVerdictNumbers,
    hide: hide
  });
})();
