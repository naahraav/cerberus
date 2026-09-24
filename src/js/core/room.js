/* Cerberus AI · core/room
   The conversation with the three reviewers: chat state and persistence, the
   thread renderer, the compositor, starter chips, the room tabs, and the clear
   control. Reviewer replies come from the selected live models. */

(function () {
  "use strict";

  var dom = window.CerberusDom;
  var store = window.CerberusStore;
  var config = window.CERBERUS_CONFIG || {};
  var getElement = dom.getElement;
  var pitch = window.CerberusPitch;

  var chatState = { messages: [] };
  var roomBusy = false;

  // The live conversation seam. Set by ai/aiMode when live mode connects; null
  // means the models are unavailable. The runner is async(text, options) and
  // returns [{ head, text }] or null, streaming through options.onReply.
  var liveRunner = null;
  var openingRunner = null;
  var liveTurnIndex = 0;
  var liveAbort = null;
  var liveTurnToken = 0;
  var activeOpeningCancel = null;

  function heads() {
    return (window.CerberusHeads && window.CerberusHeads.all) || [];
  }

  function headMeta(key) {
    var list = heads();
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].key === key) {
        return list[i];
      }
    }
    return { key: key, name: key, color: "", numeral: "" };
  }

  function setActiveReviewer(key) {
    document.querySelectorAll(".reviewer-chip").forEach(function (chip) {
      var active = Boolean(key && chip.classList.contains("reviewer-chip--" + key));
      chip.classList.toggle("is-speaking", active);
      if (active) {
        chip.setAttribute("aria-current", "true");
      } else {
        chip.removeAttribute("aria-current");
      }
    });
  }

  function loadChatState() {
    var parsed = store.getJson(config.chatStorageKey, null);
    if (!parsed || !Array.isArray(parsed.messages)) {
      return;
    }
    chatState.messages = parsed.messages.filter(function (msg) {
      return msg && typeof msg.text === "string" && (msg.from === "user" || msg.head);
    }).slice(-60);
  }

  function saveChatState() {
    store.setJson(config.chatStorageKey, { messages: chatState.messages.slice(-60) });
  }

  function appendChatNode(from, text, headKey, meta) {
    var node = document.createElement("div");
    if (from === "user") {
      node.classList.add("msg", "msg--user");
      var userBody = document.createElement("div");
      userBody.className = "msg__body";

      var userContent = document.createElement("div");
      userContent.className = "msg__content";

      var userText = document.createElement("p");
      userText.className = "msg__text";
      userText.textContent = text;

      userContent.appendChild(userText);
      userBody.appendChild(userContent);
      node.appendChild(userBody);
      return node;
    }

    var head = headMeta(headKey);
    if (meta) {
      head = {
        name: meta.name || head.name,
        numeral: meta.numeral || head.numeral,
        color: meta.color || head.color,
        epithet: meta.epithet || head.epithet
      };
    }
    node.classList.add("msg", "msg--pack");
    if (head.color) {
      node.style.setProperty("--head", head.color);
    }
    var body = document.createElement("div");
    body.className = "msg__body";

    var header = document.createElement("div");
    header.className = "msg__header";

    var speaker = document.createElement("div");
    speaker.className = "msg__speaker";

    var mark = document.createElement("span");
    mark.className = "msg__mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = head.numeral || "";

    var identity = document.createElement("div");
    identity.className = "msg__identity";

    var name = document.createElement("span");
    name.className = "msg__name";
    name.textContent = head.name || headKey;

    identity.appendChild(name);
    if (head.epithet) {
      var epithet = document.createElement("span");
      epithet.className = "msg__epithet";
      epithet.textContent = head.epithet;
      identity.appendChild(epithet);
    }

    speaker.appendChild(mark);
    speaker.appendChild(identity);

    header.appendChild(speaker);

    var content = document.createElement("div");
    content.className = "msg__content";

    var textNode = document.createElement("p");
    textNode.className = "msg__text";
    textNode.textContent = text;

    content.appendChild(textNode);
    body.appendChild(header);
    body.appendChild(content);
    node.appendChild(body);
    return node;
  }

  // A minimal, quiet intro for an empty conversation. Pure chat: no buttons,
  // no step list, no template prompts. The reviewers open the conversation and
  // the suggested lines live above the composer.
  function welcomeNode() {
    var node = document.createElement("div");
    node.className = "thread-welcome";

    var lead = document.createElement("p");
    lead.className = "thread-welcome__lead";
    lead.textContent = "Your pitch is ready. The best-matched reviewer will open with a question.";

    node.appendChild(lead);
    return node;
  }

  function scrollThreadToEnd(thread) {
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }

  function removeWelcome(thread) {
    var welcome = thread && thread.querySelector(".thread-welcome");
    if (welcome) {
      welcome.remove();
    }
  }

  function showError(message, retryAction) {
    var thread = getElement("thread");
    if (!thread) return;
    var existing = thread.querySelector(".thread-error");
    if (existing) existing.remove();
    var error = document.createElement("p");
    error.className = "thread-error";
    error.setAttribute("role", "alert");
    error.textContent = message || "Couldn’t reach the reviewers. Try again.";
    if (typeof retryAction === "function") {
      var retry = document.createElement("button");
      retry.className = "thread-error__action";
      retry.type = "button";
      retry.textContent = "Retry response";
      retry.addEventListener("click", retryAction);
      error.appendChild(retry);
    }
    thread.appendChild(error);
    scrollThreadToEnd(thread);
  }

  function showOpeningError(message) {
    var thread = getElement("thread");
    if (!thread) return;
    clearError();
    var error = document.createElement("div");
    error.className = "thread-error";
    error.setAttribute("role", "alert");
    var text = document.createElement("p");
    text.textContent = message || "The reviewer couldn’t open this review.";
    var retry = document.createElement("button");
    retry.className = "thread-error__action";
    retry.type = "button";
    retry.textContent = "Retry opening";
    retry.addEventListener("click", retryOpening);
    error.appendChild(text);
    error.appendChild(retry);
    thread.appendChild(error);
    scrollThreadToEnd(thread);
  }

  function showConnectionError(message) {
    var thread = getElement("thread");
    if (!thread) return;
    clearError();
    var error = document.createElement("div");
    error.className = "thread-error";
    error.setAttribute("role", "alert");
    var text = document.createElement("p");
    text.textContent = message || "Reviewer models are disconnected. Return to model selection to reconnect.";
    var retry = document.createElement("button");
    retry.className = "thread-error__action";
    retry.type = "button";
    retry.textContent = "Return to model selection";
    retry.addEventListener("click", function () {
      if (window.CerberusPhases) window.CerberusPhases.goTo("pitch");
      var connect = getElement("ai-connect");
      if (connect && !connect.hidden) connect.focus();
    });
    error.appendChild(text);
    error.appendChild(retry);
    thread.appendChild(error);
    scrollThreadToEnd(thread);
  }

  function clearError() {
    var error = document.querySelector("#thread .thread-error");
    if (error) error.remove();
  }

  function renderThread() {
    var thread = getElement("thread");
    if (!thread) {
      return;
    }
    thread.innerHTML = "";
    if (!chatState.messages.length) {
      thread.classList.add("thread--opening");
      thread.appendChild(welcomeNode());
    } else {
      thread.classList.toggle("thread--opening", !chatState.messages.some(function (msg) {
        return msg.from === "user";
      }));
      chatState.messages.forEach(function (msg) {
        var meta = msg.name ? { name: msg.name, numeral: msg.numeral, color: msg.color } : null;
        thread.appendChild(appendChatNode(msg.from, msg.text, msg.head, meta));
      });
    }
    scrollThreadToEnd(thread);
  }

  // A bubble that fills in as a model streams tokens. Returns handles so callers
  // can append deltas; the node is finalized with the full text so escaping and
  // persistence stay in one place.
  function streamingNode(headKey, statusText) {
    var head = headMeta(headKey);
    var node = document.createElement("div");
    node.classList.add("msg", "msg--pack", "msg--streaming");
    if (head.color) {
      node.style.setProperty("--head", head.color);
    }
    var body = document.createElement("div");
    body.className = "msg__body";

    var header = document.createElement("div");
    header.className = "msg__header";

    var speaker = document.createElement("div");
    speaker.className = "msg__speaker";

    var mark = document.createElement("span");
    mark.className = "msg__mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = head.numeral || "";

    var identity = document.createElement("div");
    identity.className = "msg__identity";

    var name = document.createElement("span");
    name.className = "msg__name";
    name.textContent = head.name || headKey;

    identity.appendChild(name);
    if (head.epithet) {
      var epithet = document.createElement("span");
      epithet.className = "msg__epithet";
      epithet.textContent = head.epithet;
      identity.appendChild(epithet);
    }

    speaker.appendChild(mark);
    speaker.appendChild(identity);

    header.appendChild(speaker);

    var content = document.createElement("div");
    content.className = "msg__content";

    var textNode = document.createElement("p");
    textNode.className = "msg__text";

    var statusNode = null;
    if (statusText) {
      statusNode = document.createElement("p");
      statusNode.className = "msg__status";
      statusNode.setAttribute("role", "status");
      statusNode.textContent = statusText;
      textNode.hidden = true;
      content.appendChild(statusNode);
      node.setAttribute("aria-busy", "true");
    }

    content.appendChild(textNode);
    body.appendChild(header);
    body.appendChild(content);
    node.appendChild(body);
    return { node: node, textEl: textNode, statusEl: statusNode, buffer: "" };
  }

  function setComposerBusy(busy) {
    var send = getElement("composer-send");
    var input = getElement("composer-input");
    if (send) {
      send.disabled = busy;
    }
    if (input) {
      input.disabled = busy;
    }
  }

  // A plain-text transcript of the conversation so far, in the same shape the
  // live prompt builder uses. Only the founder's lines are scoring signals, but
  // the reviewers' lines are kept so the transcript reads naturally. Capped so a
  // long thread cannot grow without bound.
  function getTranscriptText(limit) {
    var cap = typeof limit === "number" ? limit : 40;
    return chatState.messages.slice(-cap).map(function (msg) {
      var text = String(msg.text || "").replace(/\s+/g, " ").trim();
      if (msg.from === "user") {
        return "Founder: " + text;
      }
      var head = headMeta(msg.head);
      return (head.name || msg.head || "Reviewer") + ": " + text;
    }).join("\n");
  }

  // Called after every settled turn so the app can refresh the reviewers'
  // "Current standing". app.js registers the handler; the room stays UI-agnostic.
  var onStanding = null;
  var onTurnComplete = null;

  function notifyStanding() {
    if (typeof onStanding === "function") {
      onStanding(getTranscriptText(), chatState.messages);
    }
    if (typeof onTurnComplete === "function") {
      onTurnComplete(getTranscriptText(), chatState.messages);
    }
  }

  // Render the AI-assisted suggestion pills above the composer. Empty when
  // there is nothing to suggest, so the strip disappears instead of showing a
  // stale template.
  function renderSuggestions(questions, source) {
    var container = getElement("prompt-chips");
    if (!container) {
      return;
    }
    var list = Array.isArray(questions) ? questions.filter(function (q) {
      return typeof q === "string" && q.trim();
    }).slice(0, 2) : [];
    if (!list.length) {
      container.innerHTML = "";
      container.hidden = true;
      return;
    }
    container.hidden = false;
    container.dataset.source = source === "live" ? "live" : "context";
    container.innerHTML = "<span class='prompt-chips__label'>A useful detail to add</span>" + list.map(function (question) {
      var label = question.length > 52 ? question.slice(0, 49).replace(/\s+\S*$/, "") + "..." : question;
      return "<button class='chip' type='button' data-suggest=\"" +
        dom.escapeHtml(question) + "\" aria-label=\"Add this sentence starter: " + dom.escapeHtml(question) + "\" title=\"" + dom.escapeHtml(question) + "\">" +
        dom.escapeHtml(label) + "</button>";
    }).join("");
  }

  function sendTurn(rawText, sourceInput) {
    var text = String(rawText || "").trim();
    if (!text || roomBusy) {
      return;
    }
    if (!liveRunner) {
      showError("Reviewer models are unavailable. Check your connection and try again.");
      return;
    }
    clearError();
    var thread = getElement("thread");
    if (!thread) {
      return;
    }
    removeWelcome(thread);
    chatState.messages.push({ from: "user", text: text });
    saveChatState();
    thread.appendChild(appendChatNode("user", text));
    thread.classList.remove("thread--opening");
    scrollThreadToEnd(thread);
    pitch.autoDraftFromUserMessage(text);
    if (sourceInput) {
      sourceInput.value = "";
      autosizeComposer(sourceInput);
    }
    deliverLiveTurn(text);
  }

  // Run a turn through the registered live runner, streaming each reviewer's
  // reply into its own bubble as it arrives. A failed model call is shown as an
  // error, never as a reviewer message.
  function deliverLiveTurn(text) {
    var thread = getElement("thread");
    if (!thread) {
      return;
    }
    roomBusy = true;
    setComposerBusy(true);

    var bubbles = {};
    var token = ++liveTurnToken;
    var controller = (typeof AbortController === "function") ? new AbortController() : null;
    liveAbort = controller ? function () { controller.abort(); } : null;

    function bubbleFor(key) {
      if (!bubbles[key]) {
        setActiveReviewer(key);
        var handle = streamingNode(key, headMeta(key).name + " is reading that…");
        thread.appendChild(handle.node);
        bubbles[key] = handle;
        scrollThreadToEnd(thread);
      }
      return bubbles[key];
    }

    var transcript = (window.CerberusLiveRoom && window.CerberusLiveRoom.buildTranscript)
      ? window.CerberusLiveRoom.buildTranscript(chatState.messages, 12)
      : "";

    var settled = false;
    var timeout = window.setTimeout(function () {
      if (!settled && controller) {
        controller.abort();
      }
    }, 120000);

    var finish = function () {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      liveAbort = null;
      roomBusy = false;
      setComposerBusy(false);
      setActiveReviewer(null);
      var input = getElement("composer-input");
      if (input) {
        input.focus();
      }
      notifyStanding();
    };

    liveRunner(text, {
      signal: controller ? controller.signal : undefined,
      transcript: transcript,
      turnIndex: liveTurnIndex,
      pitch: pitch.currentFacts(),
      onReply: function (key, event) {
        if (token !== liveTurnToken) return;
        if (event && event.start) {
          bubbleFor(key);
          return;
        }
        var bubble = bubbleFor(key);
        if (event && typeof event.delta === "string") {
          if (bubble.statusEl) {
            bubble.statusEl.hidden = true;
            bubble.textEl.hidden = false;
            bubble.node.removeAttribute("aria-busy");
            bubble.statusEl = null;
          }
          bubble.buffer += event.delta;
          bubble.textEl.textContent = bubble.buffer;
          scrollThreadToEnd(thread);
        }
        if (event && event.done) {
          finalizeBubble(bubble, event.text || bubble.buffer, key);
        }
      },
      onStatus: function (message) {
        if (token !== liveTurnToken || !/busy|retrying/i.test(String(message))) return;
        Object.keys(bubbles).forEach(function (key) {
          if (bubbles[key].statusEl) bubbles[key].statusEl.textContent = message;
        });
      }
    }).then(function (replies) {
      if (token !== liveTurnToken) {
        return;
      }
      if (!replies || !replies.length) {
        // Nothing came back: drop any empty bubbles and show a retry message.
        Object.keys(bubbles).forEach(function (key) {
          if (thread.contains(bubbles[key].node)) {
            thread.removeChild(bubbles[key].node);
          }
        });
        finish();
        showError("The reviewers didn’t reply. Try sending your message again.");
        return;
      }
      // Finalize any bubble the runner left open.
      Object.keys(bubbles).forEach(function (key) {
        if (!bubbles[key].finalized) {
          finalizeBubble(bubbles[key], bubbles[key].buffer, key);
        }
      });
      liveTurnIndex += 1;
      finish();
    }).catch(function (error) {
      if (token !== liveTurnToken) {
        return;
      }
      Object.keys(bubbles).forEach(function (key) {
        if (thread.contains(bubbles[key].node) && !bubbles[key].finalized) {
          thread.removeChild(bubbles[key].node);
        }
      });
      finish();
      if (error && error.status === 429) {
        showError(error.message, function () {
          clearError();
          deliverLiveTurn(text);
        });
      } else {
        showError("Couldn’t reach the reviewers. Try sending your message again.");
      }
    });
  }

  // The reviewers open the conversation. After the founder states a pitch (the
  // gate or the panel), the reviewing panel speaks first: one reviewer names the
  // pitch back and asks their sharpest question, so the founder answers rather
  // than starting the room themselves. Runs once per pitch, only on an empty
  // thread using the selected live model.
  var openedFor = "";
  function openConversation(force) {
    if (roomBusy || chatState.messages.length) {
      return false;
    }
    var facts = pitch.currentFacts();
    var title = String(facts.title || "").trim();
    var description = String(facts.description || "").trim();
    if (!title && !description) {
      return false;
    }
    if (!window.CerberusAiMode || !window.CerberusAiMode.hasReviewerModels()) {
      if (document.documentElement.getAttribute("data-active-phase") === "conversation") {
        showConnectionError("Reviewer models are unavailable. Return to model selection and reconnect.");
      }
      return false;
    }
    // Only open once per distinct pitch (title + pitch text), so a re-render or
    // a second unlock call does not repeat the opener.
    var signature = title + "\u0000" + description;
    if (!force && openedFor === signature) {
      return false;
    }
    var thread = getElement("thread");
    if (!thread) {
      return false;
    }
    openedFor = signature;

    if (openingRunner) {
      clearError();
      deliverLiveOpening();
    } else {
      openedFor = "";
      showConnectionError("Reviewer models are disconnected. Return to model selection and retry the connection.");
    }
    return true;
  }

  function retryOpening() {
    clearError();
    openedFor = "";
    return openConversation(true);
  }

  // Stream the live opener into a single reviewer bubble.
  function deliverLiveOpening() {
    var thread = getElement("thread");
    if (!thread) {
      return;
    }
    removeWelcome(thread);
    roomBusy = true;
    var bubbles = {};
    var token = ++liveTurnToken;
    var controller = (typeof AbortController === "function") ? new AbortController() : null;
    liveAbort = controller ? function () { controller.abort(); } : null;
    var facts = pitch.currentFacts();
    var openingKey = window.CerberusLiveRoom.openingResponder(facts);
    var openingHead = headMeta(openingKey);
    setComposerBusy(true);
    var hint = document.querySelector(".composer__hint");
    if (hint) hint.textContent = openingHead.name + " is reading your pitch…";
    if (hint) hint.hidden = true;

    function bubbleFor(key) {
      if (!bubbles[key]) {
        setActiveReviewer(key);
        var head = headMeta(key);
        var handle = streamingNode(key, head.name + " is reading your pitch…");
        thread.appendChild(handle.node);
        bubbles[key] = handle;
        scrollThreadToEnd(thread);
      }
      return bubbles[key];
    }

    var settled = false;
    var timeout = window.setTimeout(function () {
      if (!settled && controller) {
        controller.abort();
      }
    }, 60000);

    var cancel = function () {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (controller) controller.abort();
      if (token === liveTurnToken) liveTurnToken += 1;
      if (liveAbort === cancel) liveAbort = null;
      activeOpeningCancel = null;
      Object.keys(bubbles).forEach(function (key) {
        if (thread.contains(bubbles[key].node)) thread.removeChild(bubbles[key].node);
      });
      roomBusy = false;
      setComposerBusy(false);
      setActiveReviewer(null);
      openedFor = "";
      var hint = document.querySelector(".composer__hint");
      if (hint) {
        hint.hidden = false;
        hint.textContent = "Enter to send · Shift+Enter for a new line";
      }
    };
    activeOpeningCancel = cancel;
    liveAbort = cancel;

    var finish = function () {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      liveAbort = null;
      activeOpeningCancel = null;
      roomBusy = false;
      setComposerBusy(false);
      setActiveReviewer(null);
      var hint = document.querySelector(".composer__hint");
      if (hint) {
        hint.hidden = false;
        hint.textContent = "Enter to send · Shift+Enter for a new line";
      }
      notifyStanding();
    };

    function openingFailed() {
      Object.keys(bubbles).forEach(function (key) {
        if (thread.contains(bubbles[key].node)) {
          thread.removeChild(bubbles[key].node);
        }
      });
      finish();
      openedFor = "";
      showOpeningError("The reviewer didn’t return an opening. You can retry without sending a message.");
    }

    bubbleFor(openingKey);
    openingRunner(facts, {
      signal: controller ? controller.signal : undefined,
      onReply: function (key, event) {
        if (token !== liveTurnToken) return;
        if (event && event.start) {
          bubbleFor(key);
          return;
        }
        var bubble = bubbleFor(key);
        if (event && typeof event.delta === "string") {
          if (bubble.statusEl) {
            bubble.statusEl.hidden = true;
            bubble.textEl.hidden = false;
            bubble.node.removeAttribute("aria-busy");
            bubble.statusEl = null;
          }
          bubble.buffer += event.delta;
          bubble.textEl.textContent = bubble.buffer;
          scrollThreadToEnd(thread);
        }
        if (event && event.done) {
          finalizeBubble(bubble, event.text || bubble.buffer, key);
        }
      },
      onStatus: function (message) {
        if (token !== liveTurnToken || !bubbles[openingKey] || !bubbles[openingKey].statusEl) return;
        bubbles[openingKey].statusEl.textContent = message;
      }
    }).then(function (replies) {
      if (token !== liveTurnToken) {
        return;
      }
      if (!replies || !replies.length) {
        openingFailed();
        return;
      }
      replies.forEach(function (reply) {
        if (!reply || typeof reply.text !== "string" || !reply.text.trim()) return;
        var key = reply.head || openingKey;
        var bubble = bubbleFor(key);
        if (!bubble.finalized) {
          finalizeBubble(bubble, reply.text || bubble.buffer, key);
        }
      });
      Object.keys(bubbles).forEach(function (key) {
        if (!bubbles[key].finalized) {
          if (bubbles[key].buffer.trim()) {
            finalizeBubble(bubbles[key], bubbles[key].buffer, key);
          } else if (thread.contains(bubbles[key].node)) {
            thread.removeChild(bubbles[key].node);
          }
        }
      });
      var hasReply = Object.keys(bubbles).some(function (key) {
        return bubbles[key].finalized && bubbles[key].textEl.textContent.trim();
      });
      if (!hasReply) {
        openingFailed();
        return;
      }
      finish();
    }).catch(function (error) {
      if (token !== liveTurnToken) {
        return;
      }
      var connectionFailed = !window.CerberusAiMode || !window.CerberusAiMode.isEnabled() ||
        error instanceof TypeError || (error && (error.status === 502 || error.status === 503 || error.status === 504)) ||
        /\bHTTP (502|503|504)\b/i.test(String(error && error.message || error || ""));
      if (connectionFailed) {
        Object.keys(bubbles).forEach(function (key) {
          if (thread.contains(bubbles[key].node)) thread.removeChild(bubbles[key].node);
        });
        finish();
        openedFor = "";
        if (window.CerberusAiMode && window.CerberusAiMode.reportConnectionFailure) {
          window.CerberusAiMode.reportConnectionFailure();
        }
        showConnectionError("The model service couldn’t finish the opening. Return to model selection to reconnect.");
      } else if (error && error.status === 429) {
        Object.keys(bubbles).forEach(function (key) {
          if (thread.contains(bubbles[key].node)) thread.removeChild(bubbles[key].node);
        });
        finish();
        openedFor = "";
        showOpeningError(error.message);
      } else {
        openingFailed();
      }
    });
  }

  // Turn a streaming bubble into a settled, persisted message.
  function finalizeBubble(bubble, text, key) {
    if (!bubble || bubble.finalized) {
      return;
    }
    var clean = String(text || "").trim();
    bubble.finalized = true;
    bubble.node.classList.remove("msg--streaming");
    if (bubble.statusEl) {
      bubble.statusEl.hidden = true;
      bubble.textEl.hidden = false;
      bubble.node.removeAttribute("aria-busy");
      bubble.statusEl = null;
    }
    if (!clean) {
      var thread = getElement("thread");
      if (thread && thread.contains(bubble.node)) {
        thread.removeChild(bubble.node);
      }
      return;
    }
    bubble.textEl.textContent = clean;
    chatState.messages.push({ from: "pack", head: key, text: clean });
    saveChatState();
  }

  function autosizeComposer(input) {
    if (!input) {
      return;
    }
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 130) + "px";
  }

  function clearRoom() {
    abortLive();
    chatState.messages = [];
    liveTurnIndex = 0;
    roomBusy = false;
    openedFor = "";
    resetTranscriptBubbles();
    store.set(config.chatStorageKey, null);
    setComposerBusy(false);
    renderThread();
    var input = getElement("composer-input");
    if (input) {
      input.value = "";
      input.closest(".composer").classList.remove("has-suggestion");
      autosizeComposer(input);
    }
    renderSuggestions([], "");
    var standing = getElement("standing-list");
    if (standing) {
      standing.innerHTML = "";
    }
    var hint = getElement("standing-hint");
    if (hint) {
      hint.textContent = "Scores appear with the verdict.";
    }
  }

  function abortLive() {
    liveTurnToken += 1;
    if (liveAbort) {
      try {
        liveAbort();
      } catch (error) {}
      liveAbort = null;
    }
    roomBusy = false;
    setComposerBusy(false);
    setActiveReviewer(null);
  }

  function cancelOpening() {
    if (activeOpeningCancel) activeOpeningCancel();
  }

  function bindComposer() {
    var send = getElement("composer-send");
    var input = getElement("composer-input");
    if (!send || !input) {
      return;
    }
    send.addEventListener("click", function () {
      sendTurn(input.value, input);
      input.focus();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendTurn(input.value, input);
      }
    });
    input.addEventListener("input", function () {
      input.closest(".composer").classList.remove("has-suggestion");
      autosizeComposer(input);
    });
    // The suggestion pills (rendered above the composer) drop their text into
    // the composer so the founder can edit it before sending. They never send
    // on their own: the founder stays in control of what reaches the reviewers.
    var chips = getElement("prompt-chips");
    if (chips) {
      chips.addEventListener("click", function (event) {
        var chip = event.target.closest("button[data-suggest]");
        if (!chip || roomBusy) {
          return;
        }
        var text = chip.getAttribute("data-suggest") || "";
        input.value = text;
        input.closest(".composer").classList.add("has-suggestion");
        autosizeComposer(input);
        input.focus();
        // Put the caret at the end so the founder can keep typing.
        try {
          input.setSelectionRange(text.length, text.length);
        } catch (error) {}
      });
    }
    var toggle = getElement("pack-bio-toggle");
    var bios = getElement("pack-bios");
    if (toggle && bios) {
      toggle.addEventListener("click", function () {
        var open = bios.hidden;
        bios.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.textContent = open ? "Hide details" : "Show details";
      });
    }
  }

  // Render the reviewer rail from the canonical heads so the names, marks,
  // colors and criteria cannot drift from the data used to score.
  function renderRail() {
    var container = getElement("pack-bios");
    if (!container || !heads().length) {
      return;
    }
    container.innerHTML = heads().map(function (head) {
      return (
        "<article class='pack-bio' style='--head:" + head.color + "'>" +
          "<div class='pack-bio__header'>" +
            "<span class='pack-bio__badge' aria-hidden='true'>" + head.numeral + "</span>" +
            "<div class='pack-bio__identity'>" +
              "<h3 class='pack-bio__name'>" + head.name + "</h3>" +
              "<span class='pack-bio__epithet'>" + head.epithet + "</span>" +
            "</div>" +
            "<span class='pack-bio__role-tag'>Reviewer</span>" +
          "</div>" +
          "<div class='pack-bio__body'>" +
            "<span class='pack-bio__rubric-label'>What they assess</span>" +
            "<p class='pack-bio__desc'>" + head.railNote + "</p>" +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  function isBusy() {
    return roomBusy;
  }

  function setThreadMessages(messages) {
    chatState.messages = messages;
    saveChatState();
  }

  // Register (or clear) the live conversation runner: async(text, options) =>
  // [{ head, text }] | null. A null result is shown as a connection error.
  function setLiveRunner(runner) {
    liveRunner = typeof runner === "function" ? runner : null;
    liveTurnIndex = 0;
  }

  function setOpeningRunner(runner) {
    openingRunner = typeof runner === "function" ? runner : null;
  }

  function hasLiveRunner() {
    return Boolean(liveRunner);
  }

  // Append a debate turn from the verdict run to the conversation so the
  // argument plays out in the room, not just in the verdict. `label` is a
  // pseudo reviewer key ("debate-a", "debate-b", "judge") rendered with its own
  // mark and color. Streaming is driven by start/delta/done events.
  var transcriptBubbles = {};
  var transcriptOpen = {};
  var transcriptTurnSeq = 0;

  function transcriptHeadMeta(key) {
    if (key === "debate-a") {
      return { name: "Debater A", numeral: "A", color: "var(--flame)" };
    }
    if (key === "debate-b") {
      return { name: "Debater B", numeral: "B", color: "var(--ember)" };
    }
    return { name: "Panel judge", numeral: "J", color: "var(--moss)" };
  }

  function transcriptNode(key) {
    var head = transcriptHeadMeta(key);
    var node = document.createElement("div");
    node.classList.add("msg", "msg--pack", "msg--streaming");
    node.style.setProperty("--head", head.color);

    var body = document.createElement("div");
    body.className = "msg__body";

    var header = document.createElement("div");
    header.className = "msg__header";

    var speaker = document.createElement("div");
    speaker.className = "msg__speaker";

    var mark = document.createElement("span");
    mark.className = "msg__mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = head.numeral;

    var identity = document.createElement("div");
    identity.className = "msg__identity";

    var name = document.createElement("span");
    name.className = "msg__name";
    name.textContent = head.name;

    identity.appendChild(name);

    speaker.appendChild(mark);
    speaker.appendChild(identity);

    header.appendChild(speaker);

    var content = document.createElement("div");
    content.className = "msg__content";

    var textNode = document.createElement("p");
    textNode.className = "msg__text";

    content.appendChild(textNode);
    body.appendChild(header);
    body.appendChild(content);
    node.appendChild(body);
    return { node: node, textEl: textNode, buffer: "", key: key };
  }

  // Map a debate role ("Debater A", "Debater B", or unspecified judge) to the
  // pseudo-key used for the bubble's mark and color.
  function normalizeTranscriptKey(role) {
    if (role === "debate-a" || role === "Debater A") {
      return "debate-a";
    }
    if (role === "debate-b" || role === "Debater B") {
      return "debate-b";
    }
    return "judge";
  }

  function appendTranscriptTurn(event) {
    var thread = getElement("thread");
    if (!thread || !event) {
      return;
    }
    var key = normalizeTranscriptKey(event.role);
    if (event.kind === "argument" || event.kind === "judge") {
      if (event.delta === undefined) {
        return;
      }
      var bubbleId = transcriptOpen[key];
      if (!bubbleId) {
        transcriptTurnSeq += 1;
        bubbleId = "debate-" + key + "-" + transcriptTurnSeq;
        transcriptOpen[key] = bubbleId;
        transcriptBubbles[bubbleId] = transcriptNode(key);
        if (key === "judge") {
          // The judge streams raw JSON; show a placeholder until it is parsed.
          transcriptBubbles[bubbleId].textEl.textContent = "Putting the scores together…";
        }
        thread.appendChild(transcriptBubbles[bubbleId].node);
        scrollThreadToEnd(thread);
      }
      transcriptBubbles[bubbleId].buffer += event.delta;
      // Never show the judge's raw JSON in the room; it is parsed on completion.
      if (key !== "judge") {
        transcriptBubbles[bubbleId].textEl.textContent = transcriptBubbles[bubbleId].buffer;
      }
      scrollThreadToEnd(thread);
      return;
    }
    if (event.kind === "argument-end") {
      var bubble = transcriptBubbles[transcriptOpen[key]];
      if (bubble) {
        bubble.node.classList.remove("msg--streaming");
        var clean = key === "judge"
          ? judgeVerdictText(event.text || bubble.buffer)
          : String(event.text || bubble.buffer || "").trim();
        if (clean) {
          bubble.textEl.textContent = clean;
          var meta = transcriptHeadMeta(key);
          chatState.messages.push({
            from: "pack",
            head: transcriptHeadKey(key),
            name: meta.name,
            numeral: meta.numeral,
            color: meta.color,
            text: clean
          });
          saveChatState();
        } else {
          if (thread.contains(bubble.node)) {
            thread.removeChild(bubble.node);
          }
        }
      }
      transcriptOpen[key] = null;
      return;
    }
  }

  // Pull the human-readable ruling out of the Chief Justice's JSON.
  function judgeVerdictText(raw) {
    var text = String(raw || "").trim();
    if (!text) {
      return "";
    }
    var match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        var data = JSON.parse(match[0]);
        var parts = [];
        if (typeof data.verdict === "string" && data.verdict.trim()) {
          parts.push(data.verdict.trim());
        }
        if (parts.length) {
          return parts.join(" ");
        }
      } catch (error) {}
    }
    return "";
  }

  // Map a debate pseudo-key to the closest real head so a persisted transcript
  // reloads with a valid mark and color.
  function transcriptHeadKey(key) {
    return key === "debate-b" ? "scrath" : key === "debate-a" ? "fervent" : "warden";
  }

  function resetTranscriptBubbles() {
    transcriptBubbles = {};
    transcriptOpen = {};
    transcriptTurnSeq = 0;
  }

  // Called after the sample pitch is loaded, from either the welcome block or
  // the first-visit panel. app.js sets the real behavior (switch to the pitch
  // tab and scroll to the verdict button).
  var afterSample = function () {};

  window.CerberusRoom = Object.freeze({
    loadChatState: loadChatState,
    renderThread: renderThread,
    renderRail: renderRail,
    bindComposer: bindComposer,
    sendTurn: sendTurn,
    openConversation: openConversation,
    clearRoom: clearRoom,
    isBusy: isBusy,
    setThreadMessages: setThreadMessages,
    getTranscriptText: getTranscriptText,
    renderSuggestions: renderSuggestions,
    showError: showError,
    setOnStanding: function (fn) {
      onStanding = typeof fn === "function" ? fn : null;
    },
    setOnTurnComplete: function (fn) {
      onTurnComplete = typeof fn === "function" ? fn : null;
    },
    setLiveRunner: setLiveRunner,
    setOpeningRunner: setOpeningRunner,
    cancelOpening: cancelOpening,
    hasLiveRunner: hasLiveRunner,
    abortLive: abortLive,
    appendTranscriptTurn: appendTranscriptTurn,
    resetTranscriptBubbles: resetTranscriptBubbles,
    // Indirection, not a snapshot: the frozen export must call whatever
    // setAfterSample last stored. Exporting the var by value would freeze the
    // initial no-op and the real handler would never run.
    afterSample: function () {
      afterSample();
    },
    setAfterSample: function (fn) {
      afterSample = fn || function () {};
    }
  });
})();
