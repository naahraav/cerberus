/* Cerberus AI · core/pitch
   The pitch draft: reading the form, counting characters, the auto-draft that
   fills fields from the conversation, and the sample loader. Fields the user
   edits by hand are never overwritten. */

(function () {
  "use strict";

  var dom = window.CerberusDom;
  var store = window.CerberusStore;
  var config = window.CERBERUS_CONFIG || {};
  var getElement = dom.getElement;

  // Which fields the user has typed into by hand. Hand-edited fields are never
  // overwritten by the auto-draft. State persists across reloads.
  var handEdited = { title: false, description: false, audience: false, category: false };

  var SAMPLE = {
    title: "ShiftSwap",
    description: "When a café worker can't make a shift, managers hunt for cover in group chats. ShiftSwap lets that worker offer the shift, lets an eligible coworker claim it, and asks the manager to approve. The first version works for one shop and sends text alerts.",
    audience: "hourly café workers and their managers",
    category: "app"
  };

  // The on-chain contract counts UTF-8 bytes, not characters, so a pitch with
  // non-ASCII text could pass the browser and then revert on-chain. Count bytes
  // to keep the browser and the contract in agreement.
  var LIMITS = {
    title: { chars: 140, bytes: 140 },
    description: { chars: 800, bytes: 800 },
    audience: { chars: 200, bytes: 0 }
  };

  function byteLength(text) {
    var value = String(text || "");
    if (typeof TextEncoder === "function") {
      return new TextEncoder().encode(value).length;
    }
    // Fallback: count non-ASCII as 2 bytes (close enough for a warning).
    var bytes = 0;
    for (var i = 0; i < value.length; i += 1) {
      bytes += value.charCodeAt(i) > 127 ? 2 : 1;
    }
    return bytes;
  }

  function countNote(inputId, countId, limitKey) {
    var input = getElement(inputId);
    var counter = getElement(countId);
    if (!input || !counter) {
      return;
    }
    // Infer the limit key from the counter id when not given, so callers that
    // only pass ids still work.
    var key = limitKey || String(countId).replace("-count", "");
    var limit = LIMITS[key];
    if (!limit) {
      return;
    }
    var bytes = limit.bytes ? byteLength(input.value) : 0;
    if (bytes > 0 && bytes !== input.value.length) {
      counter.textContent = input.value.length + " / " + limit.chars + " (" + bytes + " bytes)";
    } else {
      counter.textContent = input.value.length + " / " + limit.chars;
    }
    var over = limit.bytes ? bytes > limit.bytes : input.value.length > limit.chars;
    counter.classList.toggle("is-over", over);
  }

  function refreshCounts() {
    countNote("pitch-title", "title-count", "title");
    countNote("pitch-description", "description-count", "description");
  }

  function currentFacts() {
    return {
      title: getElement("pitch-title") ? getElement("pitch-title").value.trim() : "",
      description: getElement("pitch-description") ? getElement("pitch-description").value.trim() : "",
      audience: getElement("pitch-audience") ? getElement("pitch-audience").value.trim() : "",
      category: getElement("pitch-category") ? getElement("pitch-category").value : "product"
    };
  }

  function readPitchForm() {
    var title = getElement("pitch-title").value.trim();
    var description = getElement("pitch-description").value.trim();
    var audience = getElement("pitch-audience").value.trim();
    var category = getElement("pitch-category").value;

    if (!title) {
      return { error: "Add an idea name, or describe the idea in the conversation first.", field: "pitch-title" };
    }
    if (!description) {
      return { error: "Add a one or two sentence pitch, or describe it in the conversation first.", field: "pitch-description" };
    }
    if (!audience) {
      return { error: "Name who the idea is for.", field: "pitch-audience" };
    }
    if (byteLength(title) > LIMITS.title.bytes) {
      return { error: "Keep the idea name under " + LIMITS.title.chars + " characters.", field: "pitch-title" };
    }
    if (byteLength(description) > LIMITS.description.bytes) {
      return { error: "Keep the pitch under " + LIMITS.description.chars + " characters.", field: "pitch-description" };
    }
    if (audience.length > LIMITS.audience.chars) {
      return { error: "Keep the audience under " + LIMITS.audience.chars + " characters.", field: "pitch-audience" };
    }
    return { title: title, description: description, audience: audience, category: category };
  }

  function pitchFingerprint(facts) {
    return [facts.title, facts.description, facts.audience, facts.category].join("\u0001");
  }

  function saveDraft() {
    store.setJson(config.draftStorageKey, currentFacts());
    store.setJson(config.draftEditKey, handEdited);
  }

  function clearDraft() {
    store.set(config.draftStorageKey, null);
    store.set(config.draftEditKey, null);
  }

  function loadDraft() {
    var parsed = store.getJson(config.draftStorageKey, null);
    if (parsed && typeof parsed === "object") {
      var assignments = [
        ["pitch-title", "title"],
        ["pitch-description", "description"],
        ["pitch-audience", "audience"],
        ["pitch-category", "category"]
      ];
      assignments.forEach(function (pair) {
        var element = getElement(pair[0]);
        if (element && typeof parsed[pair[1]] === "string") {
          element.value = parsed[pair[1]];
        }
      });
    }
    var edits = store.getJson(config.draftEditKey, null);
    if (edits && typeof edits === "object") {
      ["title", "description", "audience", "category"].forEach(function (key) {
        handEdited[key] = Boolean(edits[key]);
      });
    }
    refreshCounts();
  }

  // Turn a spoken line into a short idea name. A short line becomes the name as
  // typed; a long line keeps its leading noun phrase, so the field still fills.
  function deriveTitle(text) {
    var words = text.split(/\s+/);
    if (words.length <= 9) {
      return text.slice(0, LIMITS.title.chars);
    }
    var lead = words.slice(0, 7).join(" ").replace(/[,:;.]$/, "");
    return lead.slice(0, LIMITS.title.chars);
  }

  function flashDraftNote() {
    var note = getElement("draft-note");
    if (!note) {
      return;
    }
    note.classList.add("is-flash");
    window.setTimeout(function () {
      note.classList.remove("is-flash");
    }, 900);
  }

  function autoDraftFromUserMessage(text) {
    var updated = false;
    var clean = String(text || "").trim();
    if (!clean) {
      return;
    }

    // The idea name fills from the first line and is refreshed until the user
    // edits it by hand.
    if (!handEdited.title) {
      var title = getElement("pitch-title");
      var nextTitle = deriveTitle(clean);
      if (!title.value.trim() || nextTitle.length > title.value.trim().length) {
        title.value = nextTitle;
        updated = true;
      }
    }

    // The pitch description grows from the longest thing said so far.
    if (!handEdited.description) {
      var description = getElement("pitch-description");
      if (clean.length > description.value.trim().length) {
        description.value = clean.slice(0, LIMITS.description.chars);
        updated = true;
      }
    }

    // A phrase naming the audience fills "Who it is for".
    if (!handEdited.audience) {
      var audience = clean.match(/\b(?:for|helps?|serves?)\s+([a-z0-9][a-z0-9 .,'&-]{2,80})/i);
      if (audience) {
        var target = getElement("pitch-audience");
        if (!target.value.trim() || target.value.trim().length < audience[1].trim().length) {
          target.value = audience[1].replace(/[.,]$/, "").trim().slice(0, LIMITS.audience.chars);
          updated = true;
        }
      }
    }

    if (updated) {
      refreshCounts();
      saveDraft();
      flashDraftNote();
    }
  }

  function markHandEdited(field) {
    handEdited[field] = true;
    store.setJson(config.draftEditKey, handEdited);
  }

  function resetHandEdited() {
    handEdited = { title: false, description: false, audience: false, category: false };
    store.setJson(config.draftEditKey, handEdited);
  }

  function loadSample() {
    var pairs = [
      ["pitch-title", "title"],
      ["pitch-description", "description"],
      ["pitch-audience", "audience"],
      ["pitch-category", "category"]
    ];
    pairs.forEach(function (pair) {
      var element = getElement(pair[0]);
      if (element && typeof SAMPLE[pair[1]] === "string") {
        element.value = SAMPLE[pair[1]];
      }
    });
    handEdited = { title: true, description: true, audience: true, category: true };
    store.setJson(config.draftEditKey, handEdited);
    refreshCounts();
    dom.setPitchMessage("Sample loaded. Edit it, then get the verdict.", "");
    saveDraft();
  }

  window.CerberusPitch = Object.freeze({
    countNote: countNote,
    refreshCounts: refreshCounts,
    currentFacts: currentFacts,
    readPitchForm: readPitchForm,
    pitchFingerprint: pitchFingerprint,
    saveDraft: saveDraft,
    clearDraft: clearDraft,
    loadDraft: loadDraft,
    autoDraftFromUserMessage: autoDraftFromUserMessage,
    markHandEdited: markHandEdited,
    resetHandEdited: resetHandEdited,
    loadSample: loadSample,
    isHandEdited: function (field) {
      return Boolean(handEdited[field]);
    }
  });
})();
