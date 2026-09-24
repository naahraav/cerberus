// Stream parser for the Tusk chat API.
//
// The upstream sends newline-delimited JSON objects. Each object has a
// `content` field that is itself a JSON string holding the real payload; the
// token delta is that inner object's `content`. This is a direct port of the
// desktop app's Rust `stream_parser.rs` + `extract_stream_text`, so the browser
// reads the identical byte stream the same way.
//
// Works in the browser (attaches to window.CerberusTuskParser) and in Node
// (exports via module.exports) for unit testing.

(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CerberusTuskParser = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_BUFFER_SIZE = 1024 * 1024;

  function createParser() {
    var buffer = "";

    // Extract every complete top-level {...} object found so far. Parse
    // failures are dropped silently, matching the Rust original.
    function push(text) {
      var objects = [];
      if (!text) {
        return objects;
      }
      buffer += text;
      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer = buffer.slice(buffer.length - MAX_BUFFER_SIZE);
      }

      var depth = 0;
      var openStart = -1;
      var inString = false;
      var escape = false;
      var consumedUpTo = 0;

      for (var i = 0; i < buffer.length; i += 1) {
        var ch = buffer[i];

        if (inString) {
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === "\"") {
            inString = false;
          }
          continue;
        }

        if (ch === "\"") {
          inString = true;
        } else if (ch === "{") {
          if (depth === 0) {
            openStart = i;
          }
          depth += 1;
        } else if (ch === "}" && depth > 0) {
          depth -= 1;
          if (depth === 0 && openStart !== -1) {
            var slice = buffer.slice(openStart, i + 1);
            try {
              objects.push(JSON.parse(slice));
            } catch (error) {
              // Broken object: consume it and continue.
            }
            consumedUpTo = i + 1;
            openStart = -1;
          }
        }
      }

      if (openStart !== -1) {
        buffer = buffer.slice(openStart);
      } else if (consumedUpTo > 0) {
        buffer = buffer.slice(consumedUpTo);
      } else if (!inString) {
        buffer = "";
      }

      return objects;
    }

    function end() {
      var rest = buffer;
      buffer = "";
      if (!rest.trim()) {
        return [];
      }
      try {
        return [JSON.parse(rest)];
      } catch (error) {
        return [];
      }
    }

    return { push: push, end: end };
  }

  // Pull the token text out of one stream object.
  function extractText(object) {
    if (!object || typeof object !== "object") {
      return null;
    }
    var contentValue = object.content;
    if (contentValue === undefined || contentValue === null) {
      return null;
    }
    if (typeof contentValue === "string") {
      try {
        var inner = JSON.parse(contentValue);
        if (inner && typeof inner === "object") {
          return typeof inner.content === "string" ? inner.content : "";
        }
      } catch (error) {
        return contentValue;
      }
      return contentValue;
    }
    if (typeof contentValue === "object") {
      return typeof contentValue.content === "string" ? contentValue.content : "";
    }
    return null;
  }

  // Convenience: pull all token text from a full payload string.
  function extractAll(text) {
    var parser = createParser();
    var objects = parser.push(text).concat(parser.end());
    var out = "";
    for (var i = 0; i < objects.length; i += 1) {
      var piece = extractText(objects[i]);
      if (piece) {
        out += piece;
      }
    }
    return out;
  }

  return {
    createParser: createParser,
    extractText: extractText,
    extractAll: extractAll,
    MAX_BUFFER_SIZE: MAX_BUFFER_SIZE
  };
});
