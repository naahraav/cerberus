/* Cerberus AI · core/theme
   Light/dark theme for the ChatGPT-style interface. This module is fully
   isolated: it only reads and writes the `data-theme` attribute on <html>, one
   storage key, and the #theme-toggle button. It touches nothing in the pitch,
   room, verdict, AI, or chain flows.

   The chosen theme is applied before first paint by a tiny inline script in
   index.html (so there is no flash of the wrong theme); this module owns the
   toggle button and keeps the two in sync. When nothing is stored, the OS
   preference decides and the page follows it live until the user chooses. */

(function () {
  "use strict";

  var dom = window.CerberusDom || {};
  var store = window.CerberusStore || {};
  var config = window.CERBERUS_CONFIG || {};
  var getElement = dom.getElement || function (id) { return document.getElementById(id); };

  var LIGHT = "light";
  var DARK = "dark";
  var media = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)")) || null;

  function storageKey() {
    return (config.storageKey || "cerberus") + "-theme";
  }

  // The user's explicit choice, or null when they have never chosen.
  function storedTheme() {
    try {
      var value = store.get ? store.get(storageKey()) : window.localStorage.getItem(storageKey());
      return value === LIGHT || value === DARK ? value : null;
    } catch (error) {
      return null;
    }
  }

  function systemTheme() {
    return media && media.matches ? DARK : LIGHT;
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || storedTheme() || systemTheme();
  }

  function persist(theme) {
    try {
      if (store.set) {
        store.set(storageKey(), theme);
      } else {
        window.localStorage.setItem(storageKey(), theme);
      }
    } catch (error) {
      // Storage blocked: the theme still applies for this page load.
    }
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    syncButton(theme);
  }

  function syncButton(theme) {
    var button = getElement("theme-toggle");
    if (!button) {
      return;
    }
    var isDark = theme === DARK;
    button.setAttribute("aria-pressed", String(isDark));
    var label = isDark ? "Switch to light theme" : "Switch to dark theme";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    var text = button.querySelector("[data-theme-label]");
    if (text) {
      text.textContent = isDark ? "Dark mode" : "Light mode";
    }
  }

  function toggle() {
    var next = currentTheme() === DARK ? LIGHT : DARK;
    persist(next);
    apply(next);
    return next;
  }

  // Follow the OS while the user has made no explicit choice, so a visitor who
  // has never touched the toggle sees their system preference, live.
  function followSystem() {
    if (!media || storedTheme()) {
      return;
    }
    var handler = function () {
      apply(systemTheme());
    };
    if (media.addEventListener) {
      media.addEventListener("change", handler);
    } else if (media.addListener) {
      media.addListener(handler);
    }
  }

  function init() {
    var button = getElement("theme-toggle");
    if (button) {
      button.addEventListener("click", function () {
        toggle();
      });
    }
    syncButton(currentTheme());
    followSystem();
  }

  window.CerberusTheme = Object.freeze({
    init: init,
    toggle: toggle,
    current: currentTheme
  });
})();
