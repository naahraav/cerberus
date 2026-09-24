/* Cerberus AI · app
   The thin orchestrator. It wires the focused modules together, owns the
   verdict run flow and the room tabs, and starts the app. All heavy lifting
   lives in core/* and chain/*. */

(function () {
  "use strict";

  var dom = window.CerberusDom;
  var store = window.CerberusStore;
  var config = window.CERBERUS_CONFIG || { networks: {} };
  var pitch = window.CerberusPitch;
  var room = window.CerberusRoom;
  var verdict = window.CerberusVerdict;
  var publish = window.CerberusPublish;
  var records = window.CerberusRecords;
  var guide = window.CerberusGuide;
  var getElement = dom.getElement;

  var currentPitch = null;
  var currentVerdict = null;
  var judging = false;
  var verdictRunToken = 0;
  var verdictAbort = null;
  var pitchSuggestionToken = 0;
  var pitchSuggestionAbort = null;

  function setPitchSuggestionStatus(message, tone) {
    var status = getElement("ai-pitch-status");
    if (!status) return;
    status.textContent = message || "";
    dom.setTone(status, tone ? "is-" + tone : "", ["is-error", "is-success", "is-pending"]);
  }

  function resetPitchSuggestionButton() {
    var button = getElement("ai-pitch-suggest");
    if (!button) return;
    button.removeAttribute("aria-busy");
    button.textContent = "AI pitch suggestion";
  }

  function invalidatePitchSuggestion() {
    if (!pitchSuggestionAbort) return;
    pitchSuggestionToken += 1;
    pitchSuggestionAbort.abort();
    pitchSuggestionAbort = null;
    resetPitchSuggestionButton();
    setPitchSuggestionStatus("Your edit is saved. Run another suggestion to include it.", "");
  }

  function samePitch(left, right) {
    return left.title === right.title && left.audience === right.audience &&
      left.description === right.description && left.category === right.category;
  }

  function runPitchSuggestion() {
    var aiMode = window.CerberusAiMode;
    if (!aiMode || !aiMode.suggestPitch) {
      setPitchSuggestionStatus("Reviewer models are unavailable here. Connect them above to get a suggestion.", "error");
      return;
    }
    if (aiMode.hasSuggestionModel && !aiMode.hasSuggestionModel()) {
      setPitchSuggestionStatus("Connect a reviewer model above to get a suggestion.", "error");
      return;
    }
    if (pitchSuggestionAbort) pitchSuggestionAbort.abort();
    var token = ++pitchSuggestionToken;
    var controller = new AbortController();
    var fields = pitch.currentFacts();
    var button = getElement("ai-pitch-suggest");
    pitchSuggestionAbort = controller;
    if (button) {
      button.setAttribute("aria-busy", "true");
      button.textContent = "Suggest another";
    }
    setPitchSuggestionStatus("Drafting with one of your selected reviewer models…", "pending");

    Promise.resolve().then(function () {
      return aiMode.suggestPitch(fields, {
        signal: controller.signal,
        sessionKey: "pitch-draft-" + token,
        onWait: function (message) {
          if (token === pitchSuggestionToken && !controller.signal.aborted) setPitchSuggestionStatus(message, "pending");
        }
      });
    }).then(function (draft) {
      if (token !== pitchSuggestionToken || controller.signal.aborted) return;
      if (!samePitch(fields, pitch.currentFacts())) {
        pitchSuggestionAbort = null;
        setPitchSuggestionStatus("Your edits were kept. Run another suggestion to include them.", "");
        return;
      }
      pitchSuggestionAbort = null;
      [["pitch-title", "title"], ["pitch-audience", "audience"], ["pitch-description", "description"]].forEach(function (pair) {
        var field = getElement(pair[0]);
        if (!field) return;
        field.value = draft[pair[1]];
        pitch.markHandEdited(pair[1]);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      pitch.refreshCounts();
      pitch.saveDraft();
      refreshPitchContinue();
      setPitchSuggestionStatus("Draft added to the form. Review and edit it before continuing.", "success");
    }).catch(function (error) {
      if (token !== pitchSuggestionToken || controller.signal.aborted) return;
      var connectionError = error && (error.name === "TypeError" || /failed to fetch|network error/i.test(error.message || ""));
      if (connectionError && aiMode.reportConnectionFailure) aiMode.reportConnectionFailure();
      if (connectionError) {
        setPitchSuggestionStatus("Couldn’t reach the models. Use Retry connection above, then try again.", "error");
        return;
      }
      // A non-network failure is a parsing or model-output problem. Keep the
      // friendly headline but surface the real cause so it is diagnosable.
      if (window.console && window.console.warn) {
        window.console.warn("[Cerberus] pitch suggestion failed:", error && error.message ? error.message : error);
      }
      var cause = error && error.message ? error.message : "";
      setPitchSuggestionStatus(
        cause && !/incomplete pitch draft/i.test(cause)
          ? "Couldn’t make a usable draft. " + cause + " Try the suggestion again."
          : "Couldn’t make a usable draft. Try the suggestion again.",
        "error"
      );
    }).finally(function () {
      if (token !== pitchSuggestionToken) return;
      pitchSuggestionAbort = null;
      resetPitchSuggestionButton();
    });
  }

  /* Room phases: Pitch, Conversation, Verdict, Publish. The flow is owned by
     core/phases.js; these helpers keep the callers simple. */

  function setupRoomTabs() {
    if (window.CerberusPhases) {
      window.CerberusPhases.init();
    }
  }

  function goToPhase(phase) {
    if (window.CerberusPhases) {
      window.CerberusPhases.goTo(phase);
    }
  }

  function switchToPitchIfNarrow() {
    var panel = getElement("pitch-panel");
    if (panel && window.matchMedia("(max-width: 1080px)").matches) {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* Step 1 is linear: "Next" stays disabled until three different reviewer
     models are chosen and the name, audience, and pitch all carry a value.
     core/phases.js owns that toggle; app.js asks it to re-check on input. */
  function refreshPitchContinue() {
    if (window.CerberusPhases && window.CerberusPhases.refreshPitchContinue) {
      window.CerberusPhases.refreshPitchContinue();
    }
  }

  /* Verdict run */

  async function getVerdict(event) {
    if (event) {
      event.preventDefault();
    }
    if (!window.CerberusAiMode || !window.CerberusAiMode.isEnabled()) {
      goToPhase("pitch");
      dom.setPitchMessage("Connect and choose a different model for each reviewer before pitching.", "error");
      ["ai-model-scrath", "ai-model-fervent", "ai-model-warden"].some(function (id) {
        var select = getElement(id);
        if (select && !select.value && !select.disabled) {
          select.focus();
          return true;
        }
        return false;
      });
      return;
    }
    var data = pitch.readPitchForm();
    if (data.error) {
      dom.setPitchMessage(data.error, "error");
      if (data.field) {
        var field = getElement(data.field);
        if (field) {
          field.setAttribute("aria-invalid", "true");
          field.focus();
          field.addEventListener("input", function clear() {
            field.removeAttribute("aria-invalid");
            field.removeEventListener("input", clear);
          });
        }
      }
      // On phones, bring the pitch panel forward so the field is reachable.
      switchToPitchIfNarrow();
      return;
    }
    if (judging) {
      return;
    }
    var runToken = ++verdictRunToken;
    verdictAbort = typeof AbortController === "function" ? new AbortController() : null;
    currentPitch = data;
    currentVerdict = null;
    dom.setPitchMessage("");
    if (room.cancelOpening) {
      room.cancelOpening();
    }
    // Leave the room so only the verdict loading state is on screen while the
    // reviewers work; the phase controller restores the verdict view when the
    // cards are ready.
    if (window.CerberusPhases && window.CerberusPhases.enterVerdictLoading) {
      window.CerberusPhases.enterVerdictLoading();
    }
    verdict.showLoading();
    judging = true;
    // A live debate streams its turns into the conversation; clear any earlier
    // transcript so the new argument starts clean.
    if (room.resetTranscriptBubbles) {
      room.resetTranscriptBubbles();
    }
    try {
      if (runToken !== verdictRunToken) {
        return;
      }
      var conversation = room.getTranscriptText ? room.getTranscriptText() : "";
      var result = await window.CerberusJudges.getJudgeVerdicts(data, conversation, {
        signal: verdictAbort ? verdictAbort.signal : undefined
      });
      if (runToken !== verdictRunToken) {
        return;
      }
      currentVerdict = result;
      verdict.show(result, currentPitch);
      renderStanding(result);
      if (window.CerberusPhases) {
        window.CerberusPhases.notifyVerdictReady();
      }
    } catch (error) {
      if (runToken === verdictRunToken) {
        verdict.hide();
        // Restore a reachable phase before showing the failure.
        var canChat = window.CerberusAiMode && window.CerberusAiMode.isEnabled();
        goToPhase(canChat ? "conversation" : "pitch");
        if (canChat) {
          room.showError(error && error.status === 429
            ? error.message
            : "Couldn’t get a live verdict. Check your connection and try again.");
        } else {
          dom.setPitchMessage("Reviewer models are unavailable. Reconnect and try again.", "error");
        }
      }
    } finally {
      if (runToken === verdictRunToken) {
        verdict.resetRunButton();
        judging = false;
        verdictAbort = null;
      }
    }
  }

  function judgeAnother() {
    invalidatePitchSuggestion();
    setPitchSuggestionStatus("");
    resetPitchSuggestionButton();
    verdictRunToken += 1;
    if (verdictAbort) verdictAbort.abort();
    verdictAbort = null;
    judging = false;
    if (suggestTimer) window.clearTimeout(suggestTimer);
    suggestTimer = null;
    suggestToken += 1;
    var form = getElement("pitch-form");
    if (form) {
      form.reset();
      form.querySelectorAll("[aria-invalid]").forEach(function (field) {
        field.removeAttribute("aria-invalid");
      });
    }
    if (room.clearRoom) {
      room.clearRoom();
    } else {
      room.abortLive();
      room.resetTranscriptBubbles();
    }
    if (window.CerberusAiMode && window.CerberusAiMode.resetPitchSession) {
      window.CerberusAiMode.resetPitchSession();
    }
    pitch.resetHandEdited();
    if (pitch.clearDraft) pitch.clearDraft();
    pitch.refreshCounts();
    dom.setPitchMessage("");
    dom.setPublishMessage("");
    currentPitch = null;
    currentVerdict = null;
    verdict.hide();
    verdict.resetRunButton();
    var publishPanel = getElement("publish-panel");
    if (publishPanel) publishPanel.hidden = true;
    if (publish.setPublishToggleLabel) publish.setPublishToggleLabel(false);
    var proof = getElement("publish-proof");
    if (proof) {
      proof.hidden = true;
      proof.textContent = "";
    }
    var publishConfirm = getElement("publish-confirm");
    if (publishConfirm && publishConfirm.open) publishConfirm.close();
    var judgeGuide = document.querySelector(".judge-guide");
    if (judgeGuide) judgeGuide.open = false;
    var bios = getElement("pack-bios");
    if (bios) bios.hidden = true;
    var biosToggle = getElement("pack-bio-toggle");
    if (biosToggle) {
      biosToggle.setAttribute("aria-expanded", "false");
      biosToggle.textContent = "What they assess";
    }
    var aiPanel = getElement("ai-panel");
    if (aiPanel) aiPanel.open = false;
    // A fresh pitch starts back at Step 1 with an empty form, so "Next" is
    // disabled until the visitor writes the new pitch.
    refreshPitchContinue();
    goToPhase("pitch");
    var top = getElement("pitch-title");
    if (top) {
      top.focus();
    }
    refreshStanding();
    refreshSuggestions();
  }

  function askNewPitch(event) {
    var dialog = getElement("new-pitch-confirm");
    if (dialog && typeof dialog.showModal === "function") {
      var header = document.querySelector(".site-header");
      if (header) header.classList.remove("is-menu-open");
      var menuToggle = document.querySelector(".menu-toggle");
      if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
      dialog.showModal();
      return;
    }
    if (window.confirm("Start a new pitch? This clears the current pitch, verdict, and chat history saved in this browser. Published records are permanent.")) {
      judgeAnother();
    }
  }

  /* Menu and reveal */

  function setupMenu() {
    var header = document.querySelector(".site-header");
    var button = document.querySelector(".menu-toggle");
    var navigation = document.querySelector("#site-nav");
    var scrim = document.querySelector("#sidebar-scrim");
    var closeBtn = document.querySelector("#sidebar-close");
    if (!header || !button || !navigation) {
      return;
    }
    function closeMenu() {
      header.classList.remove("is-menu-open");
      button.setAttribute("aria-expanded", "false");
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", closeMenu);
    }
    button.addEventListener("click", function () {
      var isOpen = header.classList.toggle("is-menu-open");
      button.setAttribute("aria-expanded", String(isOpen));
    });
    navigation.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMenu);
    });
    // Tapping the backdrop closes the drawer. On touch there is no Escape key,
    // so the backdrop is the way to dismiss the menu without the hamburger.
    if (scrim) {
      scrim.addEventListener("click", closeMenu);
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && header.classList.contains("is-menu-open")) {
        header.classList.remove("is-menu-open");
        button.setAttribute("aria-expanded", "false");
        button.focus();
      }
    });
  }

  function initReveal() {
    var targets = document.querySelectorAll(".reveal");
    if (!targets.length) {
      return;
    }
    var reduceMotion = dom.prefersReducedMotion();
    if (reduceMotion || !("IntersectionObserver" in window)) {
      targets.forEach(function (target) {
        target.classList.add("is-visible");
      });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    targets.forEach(function (target) {
      observer.observe(target);
    });
  }

  /* Wiring */

  function setupInteractions() {
    var connect = getElement("connect-wallet");
    if (connect) {
      connect.addEventListener("click", publish.connectWallet);
    }
    var stopConnect = getElement("stop-wallet-connect");
    if (stopConnect) {
      stopConnect.addEventListener("click", function () { publish.stopWalletConnect(false); });
    }
    var connectQr = getElement("connect-wallet-qr");
    if (connectQr) {
      connectQr.addEventListener("click", function () { publish.connectWallet("qr"); });
    }
    var manualAddress = getElement("manual-wallet-form");
    if (manualAddress) {
      manualAddress.addEventListener("submit", publish.openManualAddress);
    }
    var disconnect = getElement("disconnect-wallet");
    if (disconnect) {
      disconnect.addEventListener("click", publish.disconnectWallet);
    }
    getElement("pitch-form").addEventListener("submit", getVerdict);
    getElement("judge-another").addEventListener("click", askNewPitch);
    var newPitchCancel = getElement("new-pitch-cancel");
    if (newPitchCancel) {
      newPitchCancel.addEventListener("click", function () {
        getElement("new-pitch-confirm").close();
      });
    }
    var newPitchConfirm = getElement("new-pitch-confirm-go");
    if (newPitchConfirm) {
      newPitchConfirm.addEventListener("click", function () {
        getElement("new-pitch-confirm").close();
        judgeAnother();
      });
    }
    var newPitchTop = getElement("judge-another-top");
    if (newPitchTop) {
      newPitchTop.addEventListener("click", askNewPitch);
    }
    getElement("publish-record").addEventListener("click", function () {
      publish.publishRecord(currentPitch, currentVerdict);
    });
    getElement("publish-toggle").addEventListener("click", publish.togglePublishPanel);

    // The deploy-guide openers (the publish panel link and the records empty
    // state) are wired by CerberusGuide.bind() via data-action="open-deploy-guide".

    getElement("refresh-records").addEventListener("click", function () {
      records.refresh();
    });

    var networkSelect = getElement("network-select");
    if (networkSelect) {
      networkSelect.addEventListener("change", function () {
        store.set(config.storageKey + "-network", networkSelect.value);
        publish.updateExplorerLink();
        publish.resetLiveState();
        records.refresh();
      });
    }

    getElement("pitch-title").addEventListener("input", function () {
      pitch.countNote("pitch-title", "title-count");
    });
    getElement("pitch-description").addEventListener("input", function () {
      pitch.countNote("pitch-description", "description-count");
    });
    getElement("records-list").addEventListener("click", records.bindAction);
    publish.bindWalletListeners();

    var ledgerSample = getElement("load-sample-pitch");
    if (ledgerSample) {
      ledgerSample.addEventListener("click", function () {
        invalidatePitchSuggestion();
        setPitchSuggestionStatus("");
        pitch.loadSample();
        refreshPitchContinue();
      });
    }
    var pitchSuggestion = getElement("ai-pitch-suggest");
    if (pitchSuggestion) pitchSuggestion.addEventListener("click", runPitchSuggestion);
  }

  function bindLedgerLive() {
    [
      ["pitch-title", "title", "title-count"],
      ["pitch-description", "description", "description-count"],
      ["pitch-audience", "audience", null],
      ["pitch-category", "category", null]
    ].forEach(function (entry) {
      var element = getElement(entry[0]);
      if (!element) {
        return;
      }
      element.addEventListener(element.tagName === "SELECT" ? "change" : "input", function () {
        invalidatePitchSuggestion();
        invalidateVerdict();
        pitch.markHandEdited(entry[1]);
        if (entry[2]) {
          pitch.countNote(entry[0], entry[2]);
        }
        // The Step 1 "Next" button follows the same three written fields.
        if (entry[1] === "title" || entry[1] === "audience" || entry[1] === "description") {
          refreshPitchContinue();
        }
        pitch.saveDraft();
        scheduleRefreshSuggestions();
      });
    });
  }

  function afterSample() {
    switchToPitchIfNarrow();
    var run = getElement("run-verdict");
    if (run) {
      run.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  /* Show only scores returned by the latest completed live review. */

  function renderStanding(standing) {
    var list = getElement("standing-list");
    if (!list || !standing) {
      return;
    }
    var heads = (window.CerberusHeads && window.CerberusHeads.all) || [];
    list.innerHTML = heads.map(function (head) {
      var entry = (standing.heads && standing.heads[head.key]) || standing[head.key] || {};
      var score = Number(entry.score) || 0;
      return (
        "<li class='standing__item' style='--head:" + head.color + "'>" +
          "<span class='standing__mark' aria-hidden='true'>" + head.numeral + "</span>" +
          "<span class='standing__name'>" + head.name + "</span>" +
          "<span class='standing__bar'><i style='width:" + score + "%'></i></span>" +
          "<span class='standing__score'>" + score + "</span>" +
        "</li>"
      );
    }).join("");

    var panel = getElement("standing");
    if (panel) {
      panel.hidden = false;
      panel.classList.remove("is-updated");
      // Force a reflow so the brief highlight replays on each move.
      void panel.offsetWidth;
      panel.classList.add("is-updated");
    }
    var hint = getElement("standing-hint");
    if (hint) hint.textContent = "From the latest live verdict.";
  }

  function invalidateVerdict() {
    if (!currentVerdict) return;
    currentVerdict = null;
    currentPitch = null;
    verdict.hide();
    var publishPanel = getElement("publish-panel");
    if (publishPanel) publishPanel.hidden = true;
    refreshStanding();
  }

  // Show scores only after the live reviewers have returned a verdict.
  function refreshStanding() {
    if (currentVerdict) {
      renderStanding(currentVerdict);
      return;
    }
    var list = getElement("standing-list");
    if (list) list.innerHTML = "";
    var panel = getElement("standing");
    if (panel) panel.hidden = true;
    var hint = getElement("standing-hint");
    if (hint) hint.textContent = "Scores appear with the verdict.";
  }

  /* AI-assisted sentence starters. Refreshed after each turn and pitch edit. */

  var suggestToken = 0;
  var suggestTimer = null;

  function refreshSuggestions() {
    if (!window.CerberusSuggest || !room.renderSuggestions) {
      return;
    }
    var facts = pitch.currentFacts();
    var hasPitch = Boolean(facts.title || facts.description);
    if (!hasPitch) {
      suggestToken += 1;
      room.renderSuggestions([], "");
      return;
    }
    var conversation = room.getTranscriptText ? room.getTranscriptText() : "";
    var token = ++suggestToken;
    window.CerberusSuggest.suggest(facts, conversation).then(function (result) {
      // Ignore a late result if a newer request has started.
      if (token !== suggestToken) {
        return;
      }
      room.renderSuggestions(result.questions, result.source);
    }).catch(function () {
      // Never let a failed suggestion call disturb the room.
    });
  }

  // Debounced refresh for pitch edits, so typing does not fire a call per key.
  function scheduleRefreshSuggestions() {
    if (suggestTimer) {
      window.clearTimeout(suggestTimer);
    }
    suggestTimer = window.setTimeout(refreshSuggestions, 700);
  }

  function init() {
    document.documentElement.classList.add("js");

    publish.restoreNetwork();

    // Restore persisted state before any reachability check runs. phases.init()
    // (called by setupRoomTabs) reads the pitch fields to pick the start phase,
    // so the draft and chat must be loaded first or a returning visitor always
    // restarts at Step 1.
    room.loadChatState();
    pitch.loadDraft();

    setupMenu();
    setupRoomTabs();
    window.addEventListener("cerberus-review-input-changed", function () {
      invalidateVerdict();
      invalidatePitchSuggestion();
    });
    if (window.CerberusPhases && window.CerberusPhases.onPhaseChange) {
      window.CerberusPhases.onPhaseChange(function (phase) {
        if (phase === "conversation") {
          refreshStanding();
          refreshSuggestions();
          room.openConversation();
        } else if (room.cancelOpening) {
          room.cancelOpening();
        }
      });
    }

    // Wire cross-module hooks before anything reads them.
    publish.setRefreshRecords(records.refresh);
    room.setAfterSample(afterSample);

    setupInteractions();
    publish.updateAddressField();
    publish.syncLiveUi();
    initReveal();

    if (window.CerberusTheme) {
      window.CerberusTheme.init();
    }

    bindLedgerLive();
    // A returning visitor with a filled draft starts Step 1 with "Next"
    // already enabled; a new visitor starts with it disabled.
    refreshPitchContinue();
    room.bindComposer();
    room.renderRail();
    room.renderThread();

    // The reviewers' standing tracks the conversation. The room calls this
    // after every settled turn; it also runs once now so a returning visitor
    // sees their scores immediately.
    room.setOnStanding(function () {
      invalidateVerdict();
      refreshStanding();
    });
    // Refresh the suggested questions after every settled turn too.
    room.setOnTurnComplete(function () {
      refreshSuggestions();
    });
    refreshStanding();

    guide.bind();

    // Suggestions appear once there is enough pitch context to make them useful.
    refreshSuggestions();

    if (window.CerberusAiMode) {
      window.CerberusAiMode.init();
      window.CerberusAiMode.bind();
    }

    // The reviewers open the conversation for a returning visitor with a draft
    // who never opened the room. Runs after aiMode so the live runner is
    // registered first when a proxy is available; openConversation no-ops when
    // there is no pitch or the thread already has messages.
    if (room.openConversation) {
      room.openConversation();
    }

    if (window.ethers && window.CerberusJudges) {
      records.refresh();
    }

    window.setTimeout(records.handleSharedRecord, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
