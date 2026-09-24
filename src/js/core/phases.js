/* Cerberus AI · core/phases
   The guided flow: Pitch, then Conversation, then the Verdict. Only one phase
   is on screen at a time, and the sidebar stepper follows it.

   This is a thin controller layered on top of the existing modules. It does not
   replace any behavior: the pitch form owns the pitch, app.js still runs the
   verdict, publish.js still toggles the publish panel. This module only shows
   the right phase, updates the sidebar steps, and wires the between-phase
   buttons. Every id and class the other modules read is left untouched.

   Reachability (R-26: no dead controls). A step is enabled only when it can
   actually be reached:
   - pitch:        always
   - conversation: once a pitch is complete and three reviewer models are chosen
   - verdict:      once a verdict has rendered
   The Records wall is a separate side view, not a phase. Publish is not a step:
   it is a choice inside the verdict phase. */

(function () {
  "use strict";

  var dom = window.CerberusDom;
  var getElement = dom.getElement;

  var ORDER = ["pitch", "conversation", "verdict"];
  var LABELS = { pitch: "Pitch", conversation: "Make your case", verdict: "Verdict" };
  var TITLES = { pitch: "Pitch your idea", conversation: "Make your case" };
  var INTRO = {
    pitch: "Choose your three models to start.",
    conversation: "The best-matched reviewer reads your pitch first, then asks one focused question."
  };
  var NOTES = {
    pitch: "Choose models, then add your pitch.",
    conversation: "Answer questions, then get the verdict.",
    verdict: "Review the scores and reasons. Publishing is optional."
  };

  var current = "pitch";
  var recordsOpen = false;
  var listeners = [];

  function phaseNodes(phase) {
    return Array.prototype.slice.call(
      document.querySelectorAll('[data-phase="' + phase + '"]:not(.step)')
    );
  }

  function stepButton(phase) {
    return document.querySelector('.step[data-phase="' + phase + '"]');
  }

  // Close the off-canvas sidebar on small screens. The drawer is toggled by
  // app.js with .is-menu-open on .site-header; when a phase is chosen from it,
  // the drawer must close so the change is actually visible (otherwise the
  // sidebar looks static because it is covering the content).
  function closeDrawer() {
    var header = document.querySelector(".site-header");
    if (header && header.classList.contains("is-menu-open")) {
      header.classList.remove("is-menu-open");
      var button = document.querySelector(".menu-toggle");
      if (button) {
        button.setAttribute("aria-expanded", "false");
      }
    }
  }

  // A pitch is on hand when the three written fields all carry a value. The
  // Step 1 "Next" button and this check read the same fields, so the control
  // and the gate can never disagree.
  function hasPitch() {
    var title = getElement("pitch-title");
    var description = getElement("pitch-description");
    var audience = getElement("pitch-audience");
    return Boolean(
      title && title.value.trim() &&
      description && description.value.trim() &&
      audience && audience.value.trim()
    );
  }

  function hasReviewerModels() {
    return Boolean(
      window.CerberusAiMode &&
      window.CerberusAiMode.hasReviewerModels &&
      window.CerberusAiMode.hasReviewerModels()
    );
  }

  // The pitch suggestion only needs one connected model, so it unlocks before
  // the full three-reviewer set is chosen. Falls back to the reviewer gate when
  // the AI mode module is not loaded.
  function hasSuggestionModel() {
    if (window.CerberusAiMode && window.CerberusAiMode.hasSuggestionModel) {
      return Boolean(window.CerberusAiMode.hasSuggestionModel());
    }
    return hasReviewerModels();
  }

  function hasVerdict() {
    var cards = document.querySelectorAll("#head-cards .verdict-card");
    return cards.length > 0;
  }

  function canReach(phase) {
    switch (phase) {
      case "pitch":
        return true;
      case "conversation":
        return hasPitch() && hasReviewerModels();
      case "verdict":
        return hasVerdict();
      default:
        return false;
    }
  }

  // The furthest phase the visitor can currently reach. Used to pick a sensible
  // starting phase on load without inventing state.
  function furthestReachable() {
    var reached = "pitch";
    for (var i = 0; i < ORDER.length; i++) {
      if (canReach(ORDER[i])) {
        reached = ORDER[i];
      } else {
        break;
      }
    }
    return reached;
  }

  function renderSteps() {
    var maxIndex = ORDER.indexOf(current);
    ORDER.forEach(function (phase, index) {
      var button = stepButton(phase);
      if (!button) {
        return;
      }
      var reachable = canReach(phase);
      button.disabled = !reachable;
      button.classList.toggle("is-current", phase === current);
      button.classList.toggle("is-done", index < maxIndex && reachable);
      if (phase === current) {
        button.setAttribute("aria-current", "step");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    var note = getElement("phase-note");
    if (note) {
      note.textContent = current === "pitch" && !hasReviewerModels()
        ? "Choose a different model for each reviewer."
        : current === "pitch" && hasPitch()
          ? "Pitch ready. Continue when you are."
          : NOTES[current] || "";
    }

    var label = "Step " + (maxIndex + 1) + " of 3 · " + (LABELS[current] || "");
    var progress = getElement("phase-progress");
    if (progress) {
      progress.textContent = label;
    }
    var line = getElement("phase-line");
    if (line) {
      line.textContent = label;
    }
    var roomTitle = getElement("room-title");
    if (roomTitle && TITLES[current]) {
      roomTitle.textContent = TITLES[current];
    }
    var intro = getElement("phase-intro");
    if (intro && INTRO[current]) {
      intro.textContent = INTRO[current];
    }
    var mobileBadge = getElement("mobile-phase-badge");
    if (mobileBadge) {
      mobileBadge.textContent = (maxIndex + 1) + "/3";
    }
  }

  // Show exactly one phase. The Records wall is an overlay view on top of the
  // flow, so it hides whichever phase was showing. Publish lives inside the
  // verdict section, so it is not a phase of its own.
  function isVisible(phase) {
    if (recordsOpen) {
      return false;
    }
    return phase === current;
  }

  // The #room section wraps both the Pitch rail and the Conversation column, but
  // it is not itself a [data-phase] node. Without this, the section (its heading,
  // the reviewers strip, the verdict bar, the scoring panel) stays on screen in
  // the Verdict and Records views, leaving an empty shell above them and a stale
  // "Get the final verdict" button. The room belongs to the first two phases only.
  function roomVisible() {
    return !recordsOpen && (current === "pitch" || current === "conversation");
  }

  function applyVisibility() {
    ORDER.forEach(function (phase) {
      var visible = isVisible(phase);
      phaseNodes(phase).forEach(function (node) {
        node.hidden = !visible;
      });
    });

    var room = getElement("room");
    if (room) {
      room.hidden = !roomVisible();
    }

    var recordsView = document.querySelector('section[data-view="records"]');
    if (recordsView) {
      recordsView.hidden = !recordsOpen;
    }

    document.documentElement.setAttribute("data-active-phase", recordsOpen ? "records" : current);
  }

  function focusHeading() {
    if (recordsOpen) {
      var rtitle = getElement("records-title");
      if (rtitle) {
        rtitle.focus({ preventScroll: true });
      }
      return;
    }
    var heading = document.querySelector('[data-phase="' + current + '"]:not(.step) .detail-label, [data-phase="' + current + '"]:not(.step) h2');
    if (heading) {
      if (!heading.hasAttribute("tabindex")) {
        heading.setAttribute("tabindex", "-1");
      }
      heading.focus({ preventScroll: true });
    }
  }

  function animatePhase(phase) {
    if (dom.prefersReducedMotion()) {
      return;
    }
    var targets = {
      pitch: getElement("pitch-panel"),
      conversation: getElement("thread-panel"),
      verdict: getElement("verdict")
    };
    var node = targets[phase];
    if (!node) {
      return;
    }
    node.classList.remove("phase-enter");
    void node.offsetWidth;
    node.classList.add("phase-enter");
    node.addEventListener("animationend", function onEnd(event) {
      if (event.target === node && event.animationName === "phaseEnter") {
        node.classList.remove("phase-enter");
        node.removeEventListener("animationend", onEnd);
      }
    });
  }

  function goTo(phase) {
    if (ORDER.indexOf(phase) === -1 || !canReach(phase)) {
      return false;
    }
    var changed = current !== phase;
    recordsOpen = false;
    current = phase;
    applyVisibility();
    if (changed) {
      animatePhase(phase);
    }
    renderSteps();
    closeDrawer();
    var main = document.querySelector("#main-content") || document.querySelector(".app-main");
    if (main && main.scrollIntoView) {
      main.scrollIntoView({ behavior: dom.prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    }
    focusHeading();
    listeners.forEach(function (fn) {
      try {
        fn(current);
      } catch (error) {
        /* a listener must never break the flow */
      }
    });
    return true;
  }

  function openRecords() {
    recordsOpen = true;
    renderSteps();
    applyVisibility();
    closeDrawer();
    var rtitle = getElement("records-title");
    if (rtitle) {
      if (!rtitle.hasAttribute("tabindex")) {
        rtitle.setAttribute("tabindex", "-1");
      }
      rtitle.focus({ preventScroll: true });
    }
    if (window.CerberusRecords && window.CerberusRecords.refresh) {
      window.CerberusRecords.refresh();
    }
  }

  function closeRecords() {
    recordsOpen = false;
    goTo(current);
  }

  function continueFrom(phase) {
    var index = ORDER.indexOf(phase);
    var next = ORDER[index + 1];
    if (next && canReach(next)) {
      goTo(next);
    }
  }

  function bind() {
    // Sidebar steps
    ORDER.forEach(function (phase) {
      var button = stepButton(phase);
      if (button) {
        button.addEventListener("click", function () {
          goTo(phase);
        });
      }
    });

    // Between-phase buttons. "Make your case" is disabled until the pitch form
    // is filled (app.js owns that toggle), so a click here always advances.
    var pitchContinue = getElement("pitch-continue");
    if (pitchContinue) {
      pitchContinue.addEventListener("click", function () {
        if (!hasPitch()) {
          var title = getElement("pitch-title");
          if (title) {
            title.focus();
          }
          return;
        }
        continueFrom("pitch");
      });
    }

    // The publish toggle opens the panel from inside the verdict phase; keep
    // the stepper in step so the two controls never disagree.
    var publishToggle = getElement("publish-toggle");
    if (publishToggle) {
      publishToggle.addEventListener("click", function () {
        renderSteps();
      });
    }

    // Records side view
    var recordsLink = getElement("nav-records");
    if (recordsLink) {
      recordsLink.addEventListener("click", function (event) {
        event.preventDefault();
        openRecords();
      });
    }
    var recordsBack = getElement("records-back");
    if (recordsBack) {
      recordsBack.addEventListener("click", closeRecords);
    }

    // Escape returns from the records view to the flow.
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && recordsOpen) {
        closeRecords();
      }
    });
  }

  // Called by app.js when a verdict finishes rendering.
  function notifyVerdictReady() {
    renderSteps();
    goTo("verdict");
  }

  // Called by app.js right before the verdict loading card appears, so the room
  // (the pitch form and the conversation) leaves the screen and only the
  // verdict loading state is shown. DESIGN keeps one thing on screen at a time;
  // without this the room and the loading card would both be visible during the
  // judging pause. This does not change the current phase, so notifyVerdictReady
  // still resolves to the verdict phase afterwards.
  function enterVerdictLoading() {
    recordsOpen = false;
    ORDER.forEach(function (phase) {
      phaseNodes(phase).forEach(function (node) {
        node.hidden = true;
      });
    });
    var room = getElement("room");
    if (room) {
      room.hidden = true;
    }
    var recordsView = document.querySelector('section[data-view="records"]');
    if (recordsView) {
      recordsView.hidden = true;
    }
    document.documentElement.setAttribute("data-active-phase", "verdict");
    closeDrawer();
  }

  // Called by app.js once the pitch form is filled and "Next" is clicked.
  function notifyPitchReady() {
    renderSteps();
    if (current === "pitch") {
      goTo("conversation");
    }
  }

  // Step 1 is linear: "Next" stays disabled until the idea name, the audience,
  // and the pitch all carry a value. The button, its helper note, and the
  // sidebar step all read the same three fields, so they never disagree. app.js
  // calls this on every keystroke in those fields and once on load.
  function refreshPitchContinue() {
    var modelsReady = hasReviewerModels();
    ["pitch-title", "pitch-audience", "pitch-description", "pitch-category", "load-sample-pitch"].forEach(function (id) {
      var field = getElement(id);
      if (field) field.disabled = !modelsReady;
    });
    // The AI suggestion can seed an empty form, so it unlocks with any connected
    // model, not only the full reviewer set.
    var suggest = getElement("ai-pitch-suggest");
    if (suggest) suggest.disabled = !hasSuggestionModel();
    var button = getElement("pitch-continue");
    if (button) {
      button.disabled = !hasPitch() || !modelsReady;
    }
    var note = getElement("pitch-continue-note");
    if (note) {
      note.textContent = !modelsReady
        ? "Select all three models to unlock the pitch fields."
        : !hasPitch()
          ? "Add the idea name, audience, and pitch."
          : "Three reviewers are ready. Continue when your pitch is complete.";
    }
    renderSteps();
  }

  function init() {
    bind();
    // Start on the furthest phase the saved state actually allows, so a
    // returning visitor does not replay earlier steps.
    var start = furthestReachable();
    current = start;
    applyVisibility();
    renderSteps();
  }

  window.CerberusPhases = Object.freeze({
    init: init,
    goTo: goTo,
    renderSteps: renderSteps,
    refreshPitchContinue: refreshPitchContinue,
    notifyVerdictReady: notifyVerdictReady,
    notifyPitchReady: notifyPitchReady,
    enterVerdictLoading: enterVerdictLoading,
    openRecords: openRecords,
    closeRecords: closeRecords,
    current: function () {
      return current;
    },
    onPhaseChange: function (fn) {
      if (typeof fn === "function") {
        listeners.push(fn);
      }
    }
  });
})();
