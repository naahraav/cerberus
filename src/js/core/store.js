/* Cerberus AI · core/store
   Safe wrappers around localStorage. All persistence goes through here so a
   browser with storage disabled degrades to in-memory instead of throwing. */

(function () {
  "use strict";

  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      if (value === null || value === undefined) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    } catch (error) {
      return;
    }
  }

  function safeGetJson(key, fallback) {
    var raw = safeGet(key);
    if (!raw) {
      return fallback;
    }
    try {
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function safeSetJson(key, value) {
    try {
      safeSet(key, JSON.stringify(value));
    } catch (error) {
      return;
    }
  }

  window.CerberusStore = Object.freeze({
    get: safeGet,
    set: safeSet,
    getJson: safeGetJson,
    setJson: safeSetJson
  });
})();
