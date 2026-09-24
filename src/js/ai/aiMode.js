/* Cerberus AI · ai/aiMode
   Loads the site-managed model catalog, requires a model choice for each
   reviewer, and registers the live runners for verdicts and conversation. */

(function () {
  "use strict";

  var dom = window.CerberusDom;
  var store = window.CerberusStore;
  var config = window.CERBERUS_CONFIG || {};
  var client = window.CerberusTuskClient;
  var reviewers = window.CerberusReviewers;
  var liveVerdict = window.CerberusLiveVerdict;
  var liveRoom = window.CerberusLiveRoom;
  var pitchDraft = window.CerberusPitchDraft;
  var getElement = dom.getElement;

  var MODE_KEY = (config.storageKey || "cerberus") + "-ai-mode";

  var state = {
    enabled: false,
    connected: false,
    proxyUrl: "",
    models: [],
    picks: { scrath: "", fervent: "", warden: "", debateA: "", debateB: "", judge: "" },
    debate: false,
    clientState: client.createState(),
    abort: null
  };

  function setPanelStatus(message, tone) {
    var el = getElement("ai-status");
    if (!el) return;
    el.textContent = message || "";
    dom.setTone(el, tone ? "is-" + tone : "", ["is-ready", "is-error", "is-pending"]);
  }

  function setVerdictStatus(message, tone) {
    setPanelStatus(message, tone);
    var loading = getElement("verdict-loading");
    var title = loading && loading.querySelector(".verdict-loading__title");
    if (title && !loading.hidden) title.textContent = message;
  }

  function setToggleLabel() {
    var el = getElement("ai-mode-state");
    if (el) {
      el.textContent = !state.connected
        ? "Models unavailable"
        : hasReviewerModels() ? "Three models selected" : "Choose three different models";
    }
  }

  // Keep the data-use copy in step with the selected review mode.
  function updateRoomNote() {
    var live = state.enabled && state.connected && hasReviewerModels();
    var note = document.querySelector(".room-note");
    if (note) {
      note.textContent = live
        ? "Live AI · three selected models"
        : state.connected ? "Choose your reviewer models first" : "Reviewer models unavailable";
    }
    var pitchPrivacy = getElement("pitch-privacy");
    if (pitchPrivacy) {
      pitchPrivacy.textContent = live
        ? "Your pitch and chat go to the three selected models. Suggestions use one of those three."
        : state.connected
          ? "Your pitch and chat will go to the models you select. Suggestions use one of the selected models."
          : "Connect to reviewer models before continuing.";
    }
    var hint = document.querySelector(".composer__hint");
    if (hint) {
      hint.textContent = live
        ? "Enter to send · Shift+Enter for a new line · Messages go to live AI."
        : "Connect to reviewer models to chat.";
    }
  }

  // The model that writes pitch suggestions. Suggestions are a light task and
  // only need one model, so prefer a reviewer pick, then fall back to the first
  // model in the catalog. This lets the suggestion seed an empty form before the
  // visitor has chosen all three reviewers.
  function pitchSuggestionModel() {
    readPicks();
    var picked = state.picks.warden || state.picks.scrath || state.picks.fervent;
    if (picked) {
      return picked;
    }
    return state.models.length ? state.models[0].id : "";
  }

  // A pitch suggestion only needs one connected model, not the full three-
  // reviewer review set. This is the gate for the "AI pitch suggestion" button.
  function hasSuggestionModel() {
    return state.enabled && state.connected && Boolean(pitchSuggestionModel());
  }

  function suggestPitch(fields, options) {
    if (!hasSuggestionModel()) throw new Error("Connect a reviewer model before requesting a suggestion.");
    return pitchDraft.generate({
      client: client,
      state: state.clientState,
      proxyUrl: state.proxyUrl,
      modelId: pitchSuggestionModel(),
      pitch: fields,
      signal: options && options.signal,
      onWait: options && options.onWait,
      sessionKey: options && options.sessionKey
    });
  }

  function fillSelect(select, includeEmpty) {
    if (!select) return;
    var current = select.value;
    select.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = includeEmpty ? "Use a reviewer model" : "Choose a model";
    placeholder.disabled = !includeEmpty;
    placeholder.selected = true;
    select.appendChild(placeholder);
    state.models.forEach(function (model) {
      var option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name + " - " + model.provider;
      select.appendChild(option);
    });
    select.value = current || "";
  }

  function populateModelSelects() {
    ["ai-model-scrath", "ai-model-fervent", "ai-model-warden", "ai-model-debate-a", "ai-model-debate-b", "ai-model-judge"].forEach(function (id) {
      fillSelect(getElement(id), id === "ai-model-debate-a" || id === "ai-model-debate-b");
    });
    ["ai-model-scrath", "ai-model-fervent", "ai-model-warden", "ai-model-debate-a", "ai-model-debate-b", "ai-model-judge"].forEach(function (id) {
      var select = getElement(id);
      if (select) select.disabled = false;
    });
    var picks = Object.assign({}, state.picks);
    var defaults = {
      "ai-model-scrath": picks.scrath,
      "ai-model-fervent": picks.fervent,
      "ai-model-warden": picks.warden,
      "ai-model-debate-a": picks.debateA || "",
      "ai-model-debate-b": picks.debateB || "",
      "ai-model-judge": picks.judge || window.CerberusDebate.defaultJudgeModel
    };
    Object.keys(defaults).forEach(function (id) {
      var el = getElement(id);
      if (el && defaults[id]) {
        el.value = defaults[id];
      }
    });
    var retry = getElement("ai-connect");
    if (retry) retry.hidden = true;
    savePicks();
    setPanelStatus(state.models.length + " models available.", "ready");
    setToggleLabel();
    refreshPitchContinue();
  }

  function readPicks() {
    state.picks = {
      scrath: getElement("ai-model-scrath") ? getElement("ai-model-scrath").value : "",
      fervent: getElement("ai-model-fervent") ? getElement("ai-model-fervent").value : "",
      warden: getElement("ai-model-warden") ? getElement("ai-model-warden").value : "",
      debateA: getElement("ai-model-debate-a") ? getElement("ai-model-debate-a").value : "",
      debateB: getElement("ai-model-debate-b") ? getElement("ai-model-debate-b").value : "",
      judge: getElement("ai-model-judge") ? getElement("ai-model-judge").value : ""
    };
  }

  function hasReviewerModels() {
    var keys = ["scrath", "fervent", "warden"];
    var selected = keys.map(function (key) {
      var select = getElement("ai-model-" + key);
      return select ? select.value : "";
    });
    return state.enabled && state.connected && state.models.length > 0 && new Set(selected).size === keys.length && selected.every(function (value) {
      return Boolean(value && state.models.some(function (model) {
        return model.id === value;
      }));
    });
  }

  function hasDuplicateReviewerModels() {
    var selected = ["scrath", "fervent", "warden"].map(function (key) {
      var select = getElement("ai-model-" + key);
      return select ? select.value : "";
    }).filter(Boolean);
    return new Set(selected).size !== selected.length;
  }

  function refreshReviewerOptions() {
    var keys = ["scrath", "fervent", "warden"];
    var selected = keys.map(function (key) {
      var select = getElement("ai-model-" + key);
      return select ? select.value : "";
    });
    keys.forEach(function (key, index) {
      var select = getElement("ai-model-" + key);
      if (!select) return;
      Array.prototype.forEach.call(select.options, function (option) {
        option.disabled = !option.value || selected.some(function (value, otherIndex) {
          return otherIndex !== index && value === option.value;
        });
      });
    });
  }

  function updatePickerStatus() {
    if (!state.connected) return;
    if (hasDuplicateReviewerModels()) {
      setPanelStatus("Choose a different model for each reviewer.", "error");
    } else {
      setPanelStatus(hasReviewerModels()
        ? "Three reviewer models selected."
        : state.models.length + " models available.", "ready");
    }
  }

  function refreshPitchContinue() {
    if (window.CerberusPhases && window.CerberusPhases.refreshPitchContinue) {
      window.CerberusPhases.refreshPitchContinue();
    }
  }

  function savePicks() {
    readPicks();
    store.setJson(MODE_KEY, { enabled: state.enabled, debate: state.debate, picks: state.picks });
  }

  function loadPicks() {
    var saved = store.getJson(MODE_KEY, null);
    if (saved && typeof saved.debate === "boolean") {
      state.debate = saved.debate;
    }
    if (saved && saved.picks) {
      state.picks.debateA = saved.picks.debateA || "";
      state.picks.debateB = saved.picks.debateB || "";
      state.picks.judge = saved.picks.judge || "";
    }
    // Reviewer choices are intentionally per-pitch; old automatically filled
    // defaults must not count as a visitor's selection.
    state.picks.scrath = "";
    state.picks.fervent = "";
    state.picks.warden = "";
    state.proxyUrl = resolveProxyUrl();
    if (getElement("ai-debate-toggle")) {
      getElement("ai-debate-toggle").checked = state.debate;
    }
  }

  function readMeta(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta ? (meta.getAttribute("content") || "").trim() : "";
  }

  // Resolve the site-managed model service. Visitors cannot override this with
  // a query parameter or a saved browser value.
  function resolveProxyUrl() {
    var fromMeta = readMeta("cerberus-proxy");
    if (fromMeta) {
      return fromMeta.replace(/\/$/, "");
    }
    var configured = String(config.aiProxyUrl || "").trim();
    if (configured) {
      return configured.replace(/\/$/, "");
    }
    // Same-origin only makes sense over http(s), not file://.
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      return window.location.origin;
    }
    return "http://127.0.0.1:3000";
  }

  // Attempt a connection to a proxy URL. `quiet` suppresses the transient
  // "checking" line and the error text, used by the automatic on-load connect
  // so a missing proxy never greets a first-time visitor with a red message.
  async function attemptConnect(quiet) {
    state.proxyUrl = resolveProxyUrl();
    if (!quiet) {
      setPanelStatus("Connecting to reviewer models…", "pending");
    }

    var result = await client.health(state.proxyUrl);
    if (!result.ok) {
      state.connected = false;
      state.enabled = false;
      registerRunner();
      setPanelStatus("Couldn’t connect to reviewer models. Check your connection and retry.", "error");
      var retry = getElement("ai-connect");
      if (retry) retry.hidden = false;
      setToggleLabel();
      updateRoomNote();
      refreshPitchContinue();
      return false;
    }

    try {
      state.models = await client.listModels(state.proxyUrl);
      if (!state.models.length) throw new Error("No reviewer models are available");
    } catch (error) {
      state.connected = false;
      state.enabled = false;
      registerRunner();
      setPanelStatus("Couldn’t load reviewer models. Check your connection and retry.", "error");
      var retry = getElement("ai-connect");
      if (retry) retry.hidden = false;
      setToggleLabel();
      updateRoomNote();
      refreshPitchContinue();
      return false;
    }

    state.connected = true;
    state.enabled = true;
    state.clientState.proxyUrl = state.proxyUrl;
    state.clientState.models = state.models;
    client.resetSession(state.clientState);
    populateModelSelects();
    registerRunner();
    setToggleLabel();
    updateRoomNote();
    return true;
  }

  // The user-facing Connect button: always verbose.
  async function connect() {
    return attemptConnect(false);
  }

  // On load, try the resolved proxy silently so live AI is on for everyone with
  // no clicks. One attempt, then a single short retry in case the host is cold.
  async function autoConnect() {
    var live = await attemptConnect(true);
    if (!live && state.enabled === false) {
      await new Promise(function (resolve) { window.setTimeout(resolve, 2500); });
      // Only retry if the user has not taken over the panel meanwhile.
      if (!state.connected) {
        live = await attemptConnect(true);
      }
    }
    return state.connected;
  }

  function reportConnectionFailure() {
    state.connected = false;
    state.enabled = false;
    registerRunner();
    setPanelStatus("Couldn’t connect to reviewer models. Retry the connection and try again.", "error");
    var retry = getElement("ai-connect");
    if (retry) retry.hidden = false;
    setToggleLabel();
    updateRoomNote();
    refreshPitchContinue();
  }

  // Register (or clear) the live runners on the judges and room seams. The
  // judges runner produces the verdict; the room runner drives the conversation.
  function registerRunner() {
    if (!state.enabled || !state.connected) {
      window.CerberusJudges.setLiveRunner(null);
      if (window.CerberusRoom && window.CerberusRoom.setLiveRunner) {
        window.CerberusRoom.setLiveRunner(null);
        window.CerberusRoom.setOpeningRunner(null);
      }
      return;
    }
    window.CerberusJudges.setLiveRunner(async function (pitch, conversation, options) {
      readPicks();
      if (!hasReviewerModels()) {
        throw new Error("Choose a different model for each reviewer before pitching.");
      }
      var signal = options && options.signal;
      if (state.debate) {
        return liveVerdict.runDebate(pitch, {
          proxyUrl: state.proxyUrl,
          state: state.clientState,
          modelA: state.picks.debateA || state.picks.scrath,
          modelB: state.picks.debateB || state.picks.fervent,
          judgeModel: state.picks.judge,
          conversation: conversation,
          signal: signal,
          onStatus: function (message, tone) {
            if (!signal || !signal.aborted) setVerdictStatus(message, tone);
          },
          onTurn: function (event) {
            if ((!signal || !signal.aborted) && window.CerberusRoom && window.CerberusRoom.appendTranscriptTurn) {
              window.CerberusRoom.appendTranscriptTurn(event);
            }
          }
        });
      }
      return liveVerdict.runReviewers(pitch, {
        proxyUrl: state.proxyUrl,
        state: state.clientState,
        models: { scrath: state.picks.scrath, fervent: state.picks.fervent, warden: state.picks.warden },
        conversation: conversation,
        signal: signal,
        onStatus: function (message, tone) {
          if (!signal || !signal.aborted) setVerdictStatus(message, tone);
        }
      });
    });
    if (window.CerberusRoom && window.CerberusRoom.setLiveRunner) {
      window.CerberusRoom.setOpeningRunner(async function (pitch, options) {
        readPicks();
        if (!hasReviewerModels()) {
          throw new Error("Choose a different model for each reviewer before opening the review.");
        }
        return liveRoom.runOpening({
          proxyUrl: state.proxyUrl,
          state: state.clientState,
          models: { scrath: state.picks.scrath, fervent: state.picks.fervent, warden: state.picks.warden },
          signal: options && options.signal,
          pitch: pitch,
          onReply: options && options.onReply,
          onStatus: options && options.onStatus
        });
      });
      window.CerberusRoom.setLiveRunner(async function (text, options) {
        readPicks();
        if (!hasReviewerModels()) {
          throw new Error("Choose a different model for each reviewer before pitching.");
        }
        return liveRoom.runTurn(text, {
          proxyUrl: state.proxyUrl,
          state: state.clientState,
          models: { scrath: state.picks.scrath, fervent: state.picks.fervent, warden: state.picks.warden },
          signal: options && options.signal,
          transcript: options && options.transcript,
          turnIndex: options && options.turnIndex,
          pitch: options && options.pitch,
          onReply: options && options.onReply,
          onStatus: function (message, tone) {
            if (!options || !options.signal || !options.signal.aborted) setPanelStatus(message, tone);
          }
        });
      });
    }
  }

  function bind() {
    var connectBtn = getElement("ai-connect");
    if (connectBtn) {
      connectBtn.addEventListener("click", connect);
    }
    var debateToggle = getElement("ai-debate-toggle");
    if (debateToggle) {
      debateToggle.addEventListener("change", function () {
        state.debate = debateToggle.checked;
        var group = getElement("ai-debate-group");
        if (group) group.hidden = !state.debate;
        savePicks();
        window.dispatchEvent(new Event("cerberus-review-input-changed"));
      });
    }
    ["ai-model-scrath", "ai-model-fervent", "ai-model-warden"].forEach(function (id) {
      var el = getElement(id);
      if (el) el.addEventListener("change", function () {
        refreshReviewerOptions();
        savePicks();
        setToggleLabel();
        updateRoomNote();
        updatePickerStatus();
        refreshPitchContinue();
        window.dispatchEvent(new Event("cerberus-review-input-changed"));
      });
    });
    ["ai-model-debate-a", "ai-model-debate-b", "ai-model-judge"].forEach(function (id) {
      var el = getElement(id);
      if (el) el.addEventListener("change", function () {
        savePicks();
        window.dispatchEvent(new Event("cerberus-review-input-changed"));
      });
    });
  }

  function init() {
    loadPicks();
    setToggleLabel();
    updateRoomNote();
    var group = getElement("ai-debate-group");
    if (group) group.hidden = !state.debate;
    setPanelStatus("Connecting to reviewer models…", "pending");
    // Connect in the background so the page paints immediately. The review
    // remains unavailable until the selected live models are connected.
    autoConnect().catch(function () {
      state.connected = false;
      state.enabled = false;
      registerRunner();
      setToggleLabel();
      updateRoomNote();
    });
  }

  function resetPitchSession() {
    client.resetSession(state.clientState);
    state.picks = { scrath: "", fervent: "", warden: "", debateA: "", debateB: "", judge: "" };
    state.debate = false;
    ["ai-model-scrath", "ai-model-fervent", "ai-model-warden", "ai-model-debate-a", "ai-model-debate-b", "ai-model-judge"].forEach(function (id) {
      var select = getElement(id);
      if (select) select.value = "";
    });
    var debateToggle = getElement("ai-debate-toggle");
    if (debateToggle) debateToggle.checked = false;
    var debateGroup = getElement("ai-debate-group");
    if (debateGroup) debateGroup.hidden = true;
    refreshReviewerOptions();
    savePicks();
    setToggleLabel();
    updateRoomNote();
    updatePickerStatus();
    refreshPitchContinue();
  }

  window.CerberusAiMode = Object.freeze({
    init: init,
    bind: bind,
    connect: connect,
    autoConnect: autoConnect,
    suggestPitch: suggestPitch,
    pitchSuggestionModel: pitchSuggestionModel,
    hasSuggestionModel: hasSuggestionModel,
    reportConnectionFailure: reportConnectionFailure,
    resolveProxyUrl: resolveProxyUrl,
    resetPitchSession: resetPitchSession,
    hasReviewerModels: hasReviewerModels,
    hasDuplicateReviewerModels: hasDuplicateReviewerModels,
    isEnabled: function () {
      return state.enabled && state.connected && hasReviewerModels();
    },
    getState: function () {
      return state;
    }
  });
})();
