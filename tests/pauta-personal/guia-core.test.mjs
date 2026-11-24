// Behavior tests for the first-use guide (S26): pauta-personal/guia-core.js holds the
// copy and the decisions; guia.js only draws them. No DOM and no network here.
// Run: node --test 'tests/pauta-personal/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const here = (p) => new URL(`../../pauta-personal/${p}`, import.meta.url);
const read = (p) => readFileSync(here(p), "utf8");
const core = await import(here("guia-core.js"));
const { GUIDE_IDS, SEEN_KEYS, GUIDES, GUIDE_COPY, seenStore, autoOpen, reopen, step, view, guidesFor, ACTIVE_GUIDES } = core;
const { NOTICE_KEY, READER_URL, isReaderConfigured } = await import(here("etiqueta-core.js"));
const { STORAGE_KEY: REGISTRO_KEY, RECEIVED_KEY, BACKUP_KEY: REGISTRO_BACKUP } = await import(here("registro-core.js"));
const { STORAGE_KEY: DESPENSA_KEY, BACKUP_KEY: DESPENSA_BACKUP } = await import(here("despensa-core.js"));

/** A fake localStorage that records every write. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    map, writes,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { writes.push([k, String(v)]); map.set(k, String(v)); },
    removeItem: (k) => { writes.push([k, null]); map.delete(k); },
  };
}
/** A storage that refuses everything, like a browser that does not let pages save. */
const brokenStorage = {
  getItem() { throw new Error("denied"); },
  setItem() { throw new Error("denied"); },
  removeItem() { throw new Error("denied"); },
};

const PAGES = { inicio: "index.html", registro: "registro.html", despensa: "despensa.html", etiqueta: "etiqueta.html" };
const allText = (id) => GUIDES[id].steps.flatMap((s) => [s.title, ...s.paragraphs]).join(" ");

// --- Content --------------------------------------------------------------------

test("S26: one welcome tour of 5 or 6 steps and one short help for each screen", () => {
  assert.deepEqual(GUIDE_IDS, ["inicio", "registro", "despensa", "etiqueta"]);
  assert.deepEqual(Object.keys(GUIDES), GUIDE_IDS);
  const n = GUIDES.inicio.steps.length;
  assert.ok(n >= 5 && n <= 6, `tour has ${n} steps`);
  for (const id of ["registro", "despensa", "etiqueta"]) assert.equal(GUIDES[id].steps.length, 1, id);
  for (const id of GUIDE_IDS) {
    for (const s of GUIDES[id].steps) {
      assert.equal(typeof s.title, "string");
      assert.ok(s.title.length > 0 && s.title.length <= 45, `title too long: ${s.title}`);
      assert.ok(s.paragraphs.length >= 1 && s.paragraphs.length <= 3, s.title);
      for (const p of s.paragraphs) assert.ok(p.length <= 190, `paragraph too long: ${p}`);
    }
  }
});

test("S26: the tour says what the app is, its parts and that the care team comes first", () => {
  const [what, pauta, size, notes, label, last] = GUIDES.inicio.steps.map((s) => [s.title, ...s.paragraphs].join(" "));
  assert.match(what, /palabra por palabra/);
  assert.match(what, /No reemplaza a tu equipo/);
  assert.match(what, /quien cocina/);
  assert.match(pauta, /«Indicación médica del alta»/);
  assert.match(pauta, /pregúntale a tu equipo/);
  assert.match(size, /A− y A\+/);
  assert.match(size, /«Escuchar»/);
  assert.match(notes, /«Mis anotaciones»/);
  assert.match(notes, /solo en este teléfono/);
  assert.match(notes, /exporta una copia/);
  assert.match(notes, /«Mi despensa»/);
  assert.match(notes, /tabla de tu pauta/);
  assert.match(label, /«Leer una etiqueta»/);
  assert.match(label, /sale del teléfono/);
  assert.match(label, /confirmas/);
  assert.match(label, /Solo después/);
  assert.match(label, /no decide por ti/);
  assert.match(last, /sin internet/);
  assert.match(last, /«Leer una etiqueta» necesita internet/);
  assert.match(last, /preguntas o síntomas/);
  assert.match(last, /equipo tratante/);
});

test("S26: each screen's help explains that screen", () => {
  assert.equal(GUIDES.registro.steps[0].title, "Mis anotaciones");
  assert.match(allText("registro"), /solo en este teléfono/);
  assert.match(allText("registro"), /«Compartir»/);
  assert.equal(GUIDES.despensa.steps[0].title, "Mi despensa");
  assert.match(allText("despensa"), /queda en su grupo/);
  assert.match(allText("despensa"), /queda aparte/);
  assert.equal(GUIDES.etiqueta.steps[0].title, "Leer una etiqueta");
  assert.match(allText("etiqueta"), /sale del teléfono/);
  assert.match(allText("etiqueta"), /confírmalo tú/);
  assert.match(allText("etiqueta"), /Solo después/);
  assert.match(allText("etiqueta"), /no decide por ti/);
  assert.match(allText("etiqueta"), /Antes de la primera foto verás un aviso/);
});

test("S26: GUIDE_COPY holds every visible text of the guide, buttons included", () => {
  for (const id of GUIDE_IDS) {
    for (const s of GUIDES[id].steps) for (const t of [s.title, ...s.paragraphs]) assert.ok(GUIDE_COPY.includes(t), t);
  }
  for (const b of ["Saltar", "Anterior", "Siguiente", "Empezar", "¿Cómo se usa?", "Paso 2 de 6"]) {
    assert.ok(GUIDE_COPY.includes(b), b);
  }
});

// --- No advice, no limits, no judging words -----------------------------------------

// Word stems the guide must never use. «ALTO EN …» (the seal, in capitals) is the only
// exception for «alto».
const FORBIDDEN = [
  "normal", "alto", "bajo", "riesgo", "elevad", "puedes comer", "puede comer", "prohibid",
  "peligr", "demasiad", "exceso", "permitido", "es seguro", "semáforo", "cumplimiento", "puntaje",
];
const stem = (w) => new RegExp(`(?<!\\p{L})${w}`, "iu");

test("S26: the guide copy has none of the forbidden words", () => {
  for (const text of GUIDE_COPY) {
    const t = text.replace(/«ALTO EN [A-ZÁÉÍÓÚÑ ]+»/g, " ");
    for (const w of FORBIDDEN) assert.doesNotMatch(t, stem(w), `«${w}» in: ${text}`);
  }
});

test("S26: the forbidden-word check catches them (sanity)", () => {
  assert.match("es un valor Normal", stem("normal"));
  assert.match("muy elevados", stem("elevad"));
  assert.match("Bajo en sal", stem("bajo"));
  assert.doesNotMatch("trabajo y abajo", stem("bajo"));
  assert.doesNotMatch("Saltar", stem("alto"));
});

test("S26: the guide copy adds no numbers with units, no colors and no pauta sentence", () => {
  const verbatim = read("../tests/pauta-personal/check_verbatim.py");
  // The pauta's sentences as check_verbatim.py lists them (either quote style).
  const source = [...verbatim.split("SOURCE = [", 2)[1].split("\n]\n", 1)[0].matchAll(/^\s*(["'])(.*)\1,$/gm)].map((m) => m[2]);
  assert.ok(source.length >= 20, `found ${source.length} pauta sentences`);
  const alta = verbatim.match(/^ALTA_QUOTE = (["'])(.*)\1$/m)[2];
  for (const text of GUIDE_COPY) {
    assert.doesNotMatch(text, /\d\s*(mg|g|ml|cc|kcal|litros?|L)\b/, text);
    if (!/^Paso \d+ de \d+$/.test(text)) assert.doesNotMatch(text, /\d/, `no numbers in the guide copy: ${text}`);
    assert.doesNotMatch(text, /\b(rojo|verde|amarillo)\b/i, text);
    for (const s of [...source, alta]) assert.ok(!text.includes(s), `quotes the pauta: ${s}`);
    // A «…» ending in a period would read as a pauta sentence.
    assert.doesNotMatch(text, /«[^»]+\.»/, text);
  }
});

// --- First run: shown once, remembered on this phone only ------------------------------

test("S26: the flags are new keys, one per guide, apart from every other key", () => {
  assert.deepEqual(SEEN_KEYS, {
    inicio: "guia-inicio-v1",
    registro: "guia-registro-v1",
    despensa: "guia-despensa-v1",
    etiqueta: "guia-etiqueta-v1",
  });
  const others = [NOTICE_KEY, REGISTRO_KEY, RECEIVED_KEY, REGISTRO_BACKUP, DESPENSA_KEY, DESPENSA_BACKUP, "pauta-scale"];
  for (const k of Object.values(SEEN_KEYS)) assert.ok(!others.includes(k), k);
});

test("S26: the first time, the guide opens on its first step; nothing is written yet", () => {
  for (const id of GUIDE_IDS) {
    const storage = fakeStorage();
    const state = autoOpen(seenStore(storage), id);
    assert.deepEqual(state, { id, index: 0, open: true });
    assert.deepEqual(storage.writes, []);
  }
});

test("S26: «Saltar» (and Esc) closes on any step and marks only that guide as seen", () => {
  const storage = fakeStorage();
  const store = seenStore(storage);
  let state = autoOpen(store, "inicio");
  state = step(state, "siguiente").state;
  const out = step(state, "saltar");
  assert.equal(out.state.open, false);
  assert.equal(out.markSeen, true);
  store.mark("inicio");
  assert.deepEqual(storage.writes, [["guia-inicio-v1", "1"]]);
  assert.equal(autoOpen(store, "inicio"), null);
  assert.equal(autoOpen(seenStore(storage), "inicio"), null, "remembered for the next visit");
  assert.deepEqual(autoOpen(store, "registro"), { id: "registro", index: 0, open: true }, "other guides are separate");
});

test("S26: «Siguiente» walks the steps; «Empezar» on the last one closes and marks seen", () => {
  let state = autoOpen(seenStore(fakeStorage()), "inicio");
  const total = GUIDES.inicio.steps.length;
  for (let i = 1; i < total; i++) {
    const out = step(state, "siguiente");
    assert.equal(out.markSeen, false);
    assert.equal(out.state.index, i);
    assert.equal(out.state.open, true);
    state = out.state;
  }
  const back = step(state, "anterior");
  assert.equal(back.state.index, total - 2);
  assert.equal(back.markSeen, false);
  const end = step(state, "siguiente");
  assert.equal(end.state.open, false);
  assert.equal(end.markSeen, true);
  assert.deepEqual(step(state, "empezar"), end);
});

test("S26: «Anterior» on the first step stays there; an unknown action changes nothing", () => {
  const state = { id: "inicio", index: 0, open: true };
  assert.deepEqual(step(state, "anterior"), { state, markSeen: false });
  assert.deepEqual(step(state, "otra"), { state, markSeen: false });
});

test("S26: a one-step help closes and marks seen with «Empezar» or «Saltar»", () => {
  for (const id of ["registro", "despensa", "etiqueta"]) {
    const state = autoOpen(seenStore(fakeStorage()), id);
    for (const action of ["siguiente", "empezar", "saltar"]) {
      const out = step(state, action);
      assert.equal(out.state.open, false, `${id} ${action}`);
      assert.equal(out.markSeen, true, `${id} ${action}`);
    }
  }
});

test("S26: without storage the guide still opens once and is remembered for this visit", () => {
  const store = seenStore(brokenStorage);
  assert.deepEqual(autoOpen(store, "inicio"), { id: "inicio", index: 0, open: true });
  assert.doesNotThrow(() => store.mark("inicio"));
  assert.equal(autoOpen(store, "inicio"), null);
  assert.deepEqual(autoOpen(seenStore(null), "despensa"), { id: "despensa", index: 0, open: true });
});

test("S26: only the value «1» counts as seen", () => {
  assert.equal(autoOpen(seenStore(fakeStorage({ "guia-inicio-v1": "1" })), "inicio"), null);
  assert.ok(autoOpen(seenStore(fakeStorage({ "guia-inicio-v1": "0" })), "inicio"));
  assert.equal(autoOpen(seenStore(fakeStorage()), "nada"), null, "an unknown guide never opens");
});

// --- «¿Cómo se usa?» reopens ------------------------------------------------------------

test("S26: «¿Cómo se usa?» reopens the guide from its first step, even when already seen", () => {
  const storage = fakeStorage({ "guia-inicio-v1": "1", "guia-etiqueta-v1": "1" });
  const store = seenStore(storage);
  assert.equal(autoOpen(store, "inicio"), null);
  assert.deepEqual(reopen("inicio"), { id: "inicio", index: 0, open: true });
  assert.deepEqual(reopen("etiqueta"), { id: "etiqueta", index: 0, open: true });
  assert.equal(reopen("nada"), null);
  assert.deepEqual(storage.writes, [], "reopening writes nothing");
});

// --- The etiqueta notice is untouched ----------------------------------------------------

test("S26: the etiqueta help never reads, writes or pre-accepts the privacy notice", () => {
  assert.equal(NOTICE_KEY, "etiqueta-aviso-v2");
  for (const initial of [{}, { [NOTICE_KEY]: "1" }]) {
    const storage = fakeStorage(initial);
    const store = seenStore(storage);
    const state = autoOpen(store, "etiqueta");
    const out = step(state, "saltar");
    if (out.markSeen) store.mark("etiqueta");
    assert.deepEqual(storage.writes, [["guia-etiqueta-v1", "1"]]);
    assert.equal(storage.getItem(NOTICE_KEY), initial[NOTICE_KEY] ?? null);
  }
  for (const f of ["guia-core.js", "guia.js"]) {
    assert.doesNotMatch(read(f), /etiqueta-aviso|NOTICE_KEY|paso-aviso"\)\.hidden\s*=|entendido/, f);
  }
});

test("S26: after the etiqueta help, focus goes to the notice when it is shown", () => {
  assert.deepEqual(GUIDES.etiqueta.after, ["t-aviso", "t-foto", "t-leer"]);
  // etiqueta.js keeps deciding on its own when the notice shows.
  assert.match(read("etiqueta.js"), /if \(noticeRead\(\)\) showPhotoStep\(false\);\nelse \$\("paso-aviso"\)\.hidden = false;/);
  assert.match(read("etiqueta.html"), /<div id="paso-aviso" class="card aviso measure" hidden>/);
});

// --- One step on screen ----------------------------------------------------------------

test("S26: the step view gives the counter as text and the right buttons", () => {
  const total = GUIDES.inicio.steps.length;
  const first = view({ id: "inicio", index: 0, open: true });
  assert.equal(first.counter, `Paso 1 de ${total}`);
  assert.equal(first.showPrev, false);
  assert.equal(first.primary, "Siguiente");
  assert.equal(first.title, GUIDES.inicio.steps[0].title);
  assert.deepEqual(first.paragraphs, GUIDES.inicio.steps[0].paragraphs);
  const second = view({ id: "inicio", index: 1, open: true });
  assert.equal(second.counter, `Paso 2 de ${total}`);
  assert.equal(second.showPrev, true);
  const last = view({ id: "inicio", index: total - 1, open: true });
  assert.equal(last.primary, "Empezar");
  assert.equal(last.showPrev, true);
  const help = view({ id: "etiqueta", index: 0, open: true });
  assert.equal(help.counter, null, "a one-step help has no counter");
  assert.equal(help.showPrev, false);
  assert.equal(help.primary, "Empezar");
  assert.equal(view({ id: "inicio", index: 0, open: false }), null);
});

// --- The pages ----------------------------------------------------------------------

test("S26: every page has the guide dialog, its buttons, «Escuchar» and «¿Cómo se usa?»", () => {
  for (const [id, page] of Object.entries(PAGES)) {
    const html = read(page);
    assert.match(html, /<html lang="es-CL">/, page);
    const d = html.match(/<dialog id="guia" class="guia" data-guia="([a-z]+)" aria-labelledby="guia-titulo">([\s\S]*?)<\/dialog>/);
    assert.ok(d, `${page}: no guide dialog`);
    assert.equal(d[1], id, page);
    for (const [k, label] of [["saltar", "Saltar"], ["anterior", "Anterior"], ["siguiente", "Siguiente"]]) {
      assert.match(d[2], new RegExp(`<button type="button" class="[^"]*" data-guia="${k}">${label}</button>`), `${page}: ${label}`);
    }
    assert.match(d[2], /<p id="guia-paso" class="guia-paso"><\/p>/, page);
    // L50: the text area is the only part that scrolls, so it can be reached by keyboard.
    assert.match(d[2], /<div id="guia-texto" class="guia-texto" tabindex="0" role="region" aria-labelledby="guia-titulo">\s*<h2 id="guia-titulo" tabindex="-1"><\/h2>\s*<div id="guia-cuerpo"><\/div>\s*<\/div>/, page);
    // Order: top row, text, then the button row last.
    assert.ok(d[2].indexOf('class="guia-top"') < d[2].indexOf('id="guia-texto"'), page);
    assert.ok(d[2].indexOf('id="guia-texto"') < d[2].indexOf('class="guia-acciones"'), page);
    assert.match(d[2], /<button type="button" class="speak" data-target="guia-texto">/, page);
    assert.match(html, /<button type="button" class="btn guia-abrir" data-guia-abrir hidden>¿Cómo se usa\?<\/button>/, page);
    assert.match(html, /<script type="module" src="guia\.js"><\/script>/, page);
    // The dialog and «Escuchar» exist before app.js binds the voice buttons.
    assert.ok(html.indexOf('<dialog id="guia"') < html.indexOf('<script src="app.js">'), page);
  }
});

test("S26: «Escuchar» in the guide reads the step title and its paragraphs", () => {
  const scope = {};
  vm.runInNewContext(read("app.js"), scope);
  const text = (s) => ({ nodeType: 3, nodeValue: s });
  const node = (tag, attrs, kids) => ({
    nodeType: 1, tagName: tag, childNodes: kids,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
  });
  const v = view({ id: "inicio", index: 2, open: true });
  const tree = node("DIV", { id: "guia-texto" }, [
    node("H2", { id: "guia-titulo" }, [text(v.title)]),
    node("DIV", { id: "guia-cuerpo" }, v.paragraphs.map((p) => node("P", {}, [text(p)]))),
  ]);
  assert.deepEqual(Array.from(scope.pautaVoz.chunks(tree)), [v.title, ...v.paragraphs]);
});

test("S26: the guide is cached for offline use and its scripts never use the network", () => {
  const sw = read("sw.js");
  for (const f of ["guia-core.js", "guia.js"]) {
    assert.match(sw, new RegExp(`"${f.replace(".", "\\.")}"`), f);
    assert.doesNotMatch(read(f), /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?:\/\//, f);
  }
});

test("S26: the guide writes only its own key", () => {
  const src = read("guia-core.js") + read("guia.js");
  assert.equal((src.match(/setItem\(/g) || []).length, 1);
  assert.doesNotMatch(src, /removeItem\(|\.clear\(\)/);
});

test("S26: the despensa and etiqueta helps close to the right focus target and never touch the notice", () => {
  const storage = fakeStorage();
  const store = seenStore(storage);
  for (const id of ["despensa", "etiqueta"]) {
    const out = step(autoOpen(store, id), "empezar");
    assert.equal(out.state.open, false); if (out.markSeen) store.mark(id);
  }
  assert.deepEqual(storage.writes, [["guia-despensa-v1", "1"], ["guia-etiqueta-v1", "1"]]);
  assert.equal(storage.getItem("etiqueta-aviso-v2"), null);
  assert.equal(GUIDES.etiqueta.after[0], "t-aviso");
  assert.equal(GUIDES.despensa.after[0], "t-despensa");
});

// --- L50: step 1 wording, the button row and the reader switch ---------------------------

const STEP_1 = "Aquí está la pauta de alimentación que te entregó tu equipo tratante, palabra por palabra.";

test("S26 (L50): tour step 1 says who gave the pauta, as the home screen does", () => {
  assert.equal(GUIDES.inicio.steps[0].paragraphs[0], STEP_1);
  assert.ok(!GUIDE_COPY.some((t) => t.includes("que te dio")), "the old wording is gone");
  const who = STEP_1.match(/que te entregó (.+), palabra por palabra\.$/)[1];
  assert.ok(read("index.html").includes(`la pauta que te entregó ${who}.`), `index.html says «${who}» too`);
});

const ON = guidesFor(true);
const OFF = guidesFor(false);
const titles = (g) => g.inicio.steps.map((s) => s.title);

test("S26 (L50): with the reader on, the tour keeps its 6 steps and the label help", () => {
  assert.deepEqual(ON, GUIDES);
  assert.deepEqual(Object.keys(ON), GUIDE_IDS);
  assert.equal(ON.inicio.steps.length, 6);
  assert.equal(titles(ON)[4], "Leer una etiqueta");
  assert.equal(view({ id: "inicio", index: 0, open: true }, ON).counter, "Paso 1 de 6");
  const storage = fakeStorage();
  assert.deepEqual(autoOpen(seenStore(storage), "etiqueta", ON), { id: "etiqueta", index: 0, open: true });
  assert.deepEqual(reopen("etiqueta", ON), { id: "etiqueta", index: 0, open: true });
  assert.deepEqual(storage.writes, []);
});

test("S26 (L50): with the reader off, the tour leaves out «Leer una etiqueta» and counts 5 steps", () => {
  assert.equal(OFF.inicio.steps.length, 5);
  assert.deepEqual(titles(OFF), titles(ON).filter((t) => t !== "Leer una etiqueta"));
  for (const s of OFF.inicio.steps) assert.ok(ON.inicio.steps.includes(s), `same copy: ${s.title}`);
  let state = autoOpen(seenStore(fakeStorage()), "inicio", OFF);
  const counters = [];
  for (let i = 0; i < 5; i++) {
    const v = view(state, OFF);
    counters.push(v.counter);
    assert.equal(v.title, OFF.inicio.steps[i].title);
    assert.equal(v.primary, i === 4 ? "Empezar" : "Siguiente");
    const out = step(state, "siguiente", OFF);
    assert.equal(out.markSeen, i === 4);
    assert.equal(out.state.open, i !== 4);
    state = out.state;
  }
  assert.deepEqual(counters, ["Paso 1 de 5", "Paso 2 de 5", "Paso 3 de 5", "Paso 4 de 5", "Paso 5 de 5"]);
  for (const c of counters) assert.ok(GUIDE_COPY.includes(c), c);
});

test("S26 (L50): with the reader off, the label help never opens, not even from «¿Cómo se usa?»", () => {
  assert.deepEqual(Object.keys(OFF), ["inicio", "registro", "despensa"]);
  const storage = fakeStorage();
  assert.equal(autoOpen(seenStore(storage), "etiqueta", OFF), null);
  assert.equal(reopen("etiqueta", OFF), null);
  assert.deepEqual(storage.writes, []);
  for (const id of ["registro", "despensa"]) assert.deepEqual(OFF[id], ON[id], id);
});

test("S26 (L50): the live guide follows READER_URL, read from etiqueta-core.js only", () => {
  assert.equal(isReaderConfigured(), READER_URL !== "");
  assert.deepEqual(ACTIVE_GUIDES, guidesFor(isReaderConfigured()));
  assert.equal(ACTIVE_GUIDES.inicio.steps.length, READER_URL ? 6 : 5);
  assert.equal("etiqueta" in ACTIVE_GUIDES, Boolean(READER_URL));
  assert.match(read("guia-core.js"), /^import \{ isReaderConfigured \} from "\.\/etiqueta-core\.js";$/m);
  assert.doesNotMatch(read("guia-core.js") + read("guia.js"), /workers\.dev|READER_URL/);
  const ui = read("guia.js");
  assert.doesNotMatch(ui, /\bGUIDES\b/, "guia.js draws only the active guides");
  for (const call of ["autoOpen(store, id, ACTIVE_GUIDES)", "reopen(id, ACTIVE_GUIDES)", "step(state, action, ACTIVE_GUIDES)", "view(state, ACTIVE_GUIDES)"]) {
    assert.ok(ui.includes(call), call);
  }
});

test("S26 (L50): only the text of the guide scrolls; the button row always stays in the dialog", () => {
  const css = read("styles.css");
  const rule = (sel) => {
    const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.[\]():-]/g, "\\$&")} \\{([^}]*)\\}`));
    assert.ok(m, `no rule ${sel}`);
    return m[1].replace(/\s+/g, " ");
  };
  const open = rule(".guia[open]");
  for (const d of ["display: flex;", "flex-direction: column;", "overflow: hidden;"]) assert.ok(open.includes(d), d);
  assert.doesNotMatch(rule(".guia"), /overflow-y: auto/);
  const text = rule(".guia-texto");
  for (const d of ["flex: 1 1 auto;", "min-height: 0;", "overflow-y: auto;"]) assert.ok(text.includes(d), d);
  for (const sel of [".guia-top", ".guia-acciones"]) assert.ok(rule(sel).includes("flex: none;"), sel);
  // The focus ring of the text area is drawn inside it, where the dialog does not clip it.
  assert.match(rule(".guia-texto:focus-visible"), /outline-offset: -\d+px;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n {2}\.guia\[open\] \{ animation: none; \}/);
  // Tab and Shift+Tab go round the buttons and the text area; the text starts at the top.
  const ui = read("guia.js");
  assert.ok(ui.includes(`dialog.querySelectorAll('button, [tabindex="0"]')`));
  assert.ok(ui.includes("text.scrollTop = 0;"));
});

test("S26 (L50): reader-off guides contain no reader copy at all", () => {
  const OFF = guidesFor(false);
  const txt = Object.values(OFF).flatMap((g) => g.steps.flatMap((s) => [s.title, ...s.paragraphs])).join(" ");
  assert.doesNotMatch(txt, /Leer una etiqueta» sacas|foto del envase/);
  assert.equal(OFF.inicio.after[0], "contenido");
});
