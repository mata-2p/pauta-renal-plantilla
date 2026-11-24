(function (root) {
  "use strict";

  // --- «Escuchar» by blocks: pure, no DOM globals ------------------------------------
  // Works on any tree with nodeType, tagName, childNodes, nodeValue and getAttribute,
  // so it is tested in Node against the real index.html (tests/pauta-personal/voz.test.mjs).

  // Controls and decoration are not content.
  var SKIP = { BUTTON: 1, NAV: 1, SVG: 1, SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, CANVAS: 1 };
  var BLOCK = {};
  ("ADDRESS ARTICLE ASIDE BLOCKQUOTE CAPTION DD DETAILS DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM " +
    "H1 H2 H3 H4 H5 H6 HEADER LEGEND LI MAIN OL P SECTION SUMMARY TABLE TBODY TD TFOOT TH THEAD TR UL")
    .split(" ").forEach(function (t) { BLOCK[t] = 1; });

  function tag(n) { return n.nodeType === 1 ? String(n.tagName).toUpperCase() : ""; }
  function attr(n, name) { return n.getAttribute ? n.getAttribute(name) : null; }
  function hasClass(n, c) { return (" " + (attr(n, "class") || "") + " ").indexOf(" " + c + " ") >= 0; }
  function skipped(n) {
    return n.nodeType === 1 && (SKIP[tag(n)] || attr(n, "hidden") !== null || attr(n, "aria-hidden") === "true");
  }
  function kids(n) { return Array.prototype.slice.call(n.childNodes || []); }
  function elements(n) { return kids(n).filter(function (c) { return c.nodeType === 1 && !skipped(c); }); }

  // Read "+" as "más" so the meal examples sound natural.
  function clean(s) { return s.replace(/\s+\+\s+/g, ", más ").replace(/\s+/g, " ").trim(); }

  function textOf(n) {
    if (n.nodeType === 3) return n.nodeValue || "";
    if (n.nodeType !== 1 || skipped(n)) return "";
    return kids(n).map(textOf).join("");
  }

  function hasBlock(n) {
    return elements(n).some(function (c) { return BLOCK[tag(c)] || hasBlock(c); });
  }

  function sentence(s) { return /[.!?…:»]$/.test(s) ? s : s + "."; }

  // A row of the pauta table (<article class="group"> with two .half columns):
  // «<grupo>. Preferir: … Limitar o evitar: …», so every food is heard with its list.
  function rowChunk(n) {
    var cols = elements(n).filter(function (c) { return hasClass(c, "half"); });
    var head = elements(n).filter(function (c) { return /^H[1-6]$/.test(tag(c)); })[0];
    if (!head || cols.length < 2) return null;
    var parts = [sentence(clean(textOf(head)))];
    cols.forEach(function (col) {
      var label = "";
      var body = [];
      elements(col).forEach(function (c) {
        if (!label && hasClass(c, "tag")) label = clean(textOf(c));
        else body.push(clean(textOf(c)));
      });
      parts.push((label ? label + ": " : "") + body.join(" "));
    });
    return clean(parts.join(" "));
  }

  function chunks(section) {
    var out = [];
    function push(s) { s = clean(s); if (s) out.push(s); }
    function walk(n) {
      var buffer = [];
      function flush() { push(buffer.join("")); buffer = []; }
      kids(n).forEach(function (c) {
        if (c.nodeType === 3) { buffer.push(c.nodeValue || ""); return; }
        if (c.nodeType !== 1 || skipped(c)) return;
        var t = tag(c);
        if (t === "ARTICLE" && hasClass(c, "group")) {
          var row = rowChunk(c);
          if (row) { flush(); push(row); return; }
        }
        if (t === "TR") {
          flush();
          push(elements(c).map(function (cell) { return clean(textOf(cell)); }).filter(Boolean).join(", "));
          return;
        }
        if (BLOCK[t] || hasBlock(c)) {
          flush();
          if (hasBlock(c)) walk(c); else push(textOf(c));
          return;
        }
        buffer.push(textOf(c));
      });
      flush();
    }
    walk(section);
    return out;
  }

  root.pautaVoz = { chunks: chunks };
  if (typeof document === "undefined") return;

  // Text size: stored only on this device.
  var SCALES = [1, 1.15, 1.3, 1.5];
  var KEY = "pauta-scale";
  var idx = 0;
  try {
    var saved = parseInt(localStorage.getItem(KEY), 10);
    if (saved >= 0 && saved < SCALES.length) idx = saved;
  } catch (e) { /* storage unavailable: keep default */ }

  function applyScale() {
    document.documentElement.style.setProperty("--scale", SCALES[idx]);
    document.getElementById("smaller").disabled = idx === 0;
    document.getElementById("bigger").disabled = idx === SCALES.length - 1;
    try { localStorage.setItem(KEY, String(idx)); } catch (e) { /* ignore */ }
  }
  document.getElementById("bigger").addEventListener("click", function () {
    if (idx < SCALES.length - 1) { idx++; applyScale(); }
  });
  document.getElementById("smaller").addEventListener("click", function () {
    if (idx > 0) { idx--; applyScale(); }
  });
  applyScale();

  // Offline support. Registered before the voice check so a browser without a
  // voice still works offline.
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* online-only fallback */ });
  }

  // Read aloud with the device's own voice (no network).
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".speak"));
  var synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    buttons.forEach(function (b) { b.hidden = true; });
    return;
  }

  var active = null;
  // Each «Escuchar» gets a new run; callbacks of a stopped run do nothing.
  var run = 0;

  function pickVoice() {
    var voices = synth.getVoices();
    var prefs = ["es-CL", "es-419", "es-US", "es-MX", "es-ES", "es"];
    for (var i = 0; i < prefs.length; i++) {
      for (var j = 0; j < voices.length; j++) {
        if (voices[j].lang && voices[j].lang.replace("_", "-").indexOf(prefs[i]) === 0) return voices[j];
      }
    }
    return null;
  }

  // The label lives in a <span> so the inline icon stays.
  function setLabel(b, text) {
    var span = b.querySelector("span");
    if (span) span.textContent = text; else b.textContent = text;
  }

  function reset() {
    run += 1;
    buttons.forEach(function (b) {
      b.setAttribute("aria-pressed", "false");
      setLabel(b, "Escuchar");
    });
    active = null;
  }

  function stop() {
    reset();
    synth.cancel();
  }

  // Leaving a screen stops the voice.
  document.addEventListener("routechange", function () {
    if (active) stop();
  });

  // Speaks the blocks one after another: a short pause falls between them, and
  // «Detener» (or leaving) drops the rest of the queue.
  function speakQueue(btn, queue) {
    var mine = run;
    var voice = pickVoice();
    function next() {
      if (mine !== run || active !== btn) return;
      var text = queue.shift();
      if (!text) { reset(); return; }
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "es-CL";
      u.rate = 0.9;
      if (voice) u.voice = voice;
      u.onend = next;
      u.onerror = function () { if (mine === run && active === btn) reset(); };
      synth.speak(u);
    }
    next();
  }

  buttons.forEach(function (btn) {
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", function () {
      var wasActive = active === btn;
      stop();
      if (wasActive) return;

      var section = document.getElementById(btn.getAttribute("data-target"));
      var queue = section ? chunks(section) : [];
      if (!queue.length) return;
      active = btn;
      btn.setAttribute("aria-pressed", "true");
      setLabel(btn, "Detener");
      speakQueue(btn, queue);
    });
  });

})(this);
