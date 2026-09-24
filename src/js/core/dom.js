/* Cerberus AI · core/dom
   Shared DOM and status helpers. Every module reads elements and sets status
   text through here so escaping, tones, and live-region wiring stay consistent. */

(function () {
  "use strict";

  function getElement(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#039;"
      }[character];
    });
  }

  function shortAddress(address) {
    if (!address) {
      return "Unknown wallet";
    }
    return address.slice(0, 6) + "..." + address.slice(-4);
  }

  function explorerUrl(network, type, value) {
    return network.explorerUrl.replace(/\/$/, "") + "/" + type + "/" + value;
  }

  function formatDate(seconds) {
    if (!seconds) {
      return "date not recorded";
    }
    return new Date(Number(seconds) * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function setTone(element, tone, tones) {
    if (!element) {
      return;
    }
    tones.forEach(function (name) {
      element.classList.remove(name);
    });
    if (tone) {
      element.classList.add(tone);
    }
  }

  function setStatus(message, tone, link) {
    var status = getElement("live-status");
    if (!status) {
      return;
    }
    setTone(status, tone ? "is-" + tone : "", ["is-ready", "is-error", "is-pending"]);
    status.textContent = "";
    status.appendChild(document.createTextNode(message));
    if (link) {
      var anchor = document.createElement("a");
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = link.label;
      status.appendChild(document.createTextNode(" "));
      status.appendChild(anchor);
    }
  }

  function setSetupLabel(text) {
    var label = getElement("live-setup-state");
    if (label) {
      label.textContent = text;
    }
  }

  function setPitchMessage(message, tone) {
    var element = getElement("pitch-message");
    setTone(element, tone ? "is-" + tone : "", ["is-success", "is-error"]);
    if (element) {
      element.textContent = message || "";
    }
  }

  function setPublishMessage(message, tone) {
    var element = getElement("publish-message");
    setTone(element, tone ? "is-" + tone : "", ["is-success", "is-error"]);
    if (element) {
      element.textContent = message || "";
    }
  }

  function setRecordsStatus(message) {
    var status = getElement("records-status");
    if (status) {
      status.textContent = message || "";
    }
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  window.CerberusDom = Object.freeze({
    getElement: getElement,
    escapeHtml: escapeHtml,
    shortAddress: shortAddress,
    explorerUrl: explorerUrl,
    formatDate: formatDate,
    setTone: setTone,
    setStatus: setStatus,
    setSetupLabel: setSetupLabel,
    setPitchMessage: setPitchMessage,
    setPublishMessage: setPublishMessage,
    setRecordsStatus: setRecordsStatus,
    prefersReducedMotion: prefersReducedMotion
  });
})();
