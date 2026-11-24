// Behavior tests for «Escuchar» by blocks (S22 g): app.js exposes a pure chunking
// function, here run against a tiny DOM-like tree parsed from the real index.html.
// Run: node --test 'tests/pauta-personal/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const here = (p) => new URL(`../../pauta-personal/${p}`, import.meta.url);
const read = (p) => readFileSync(here(p), "utf8");

// app.js without a document only defines the pure function.
const scope = {};
vm.runInNewContext(read("app.js"), scope);
// Arrays from the vm context are copied so deepEqual compares values, not realms.
const voz = scope.pautaVoz && { chunks: (node) => Array.from(scope.pautaVoz.chunks(node)) };

// --- A tiny HTML parser: elements and text, enough for these pages ---------------

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " ", "#39": "'" };

function el(tag, attrs, parent) {
  return {
    nodeType: 1, tagName: tag.toUpperCase(), attrs, childNodes: [], parentNode: parent,
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); },
  };
}

function parse(html) {
  const root = el("#root", {}, null);
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/gi;
  for (const m of html.matchAll(re)) {
    const [, close, tag, rawAttrs, selfClose, text] = m;
    if (text !== undefined) {
      cur.childNodes.push({ nodeType: 3, nodeValue: text.replace(/&(#?\w+);/g, (s, e) => ENTITIES[e] ?? s) });
    } else if (tag && close) {
      let n = cur;
      while (n && n.tagName !== tag.toUpperCase()) n = n.parentNode;
      if (n && n.parentNode) cur = n.parentNode;
    } else if (tag) {
      const attrs = {};
      for (const a of (rawAttrs || "").matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
      const node = el(tag, attrs, cur);
      cur.childNodes.push(node);
      if (!selfClose && !VOID.has(tag.toLowerCase())) cur = node;
    }
  }
  return root;
}

function byId(node, id) {
  if (node.nodeType === 1 && node.getAttribute("id") === id) return node;
  for (const c of node.childNodes || []) {
    const hit = byId(c, id);
    if (hit) return hit;
  }
  return null;
}

function all(node, pred, out = []) {
  if (node.nodeType === 1 && pred(node)) out.push(node);
  for (const c of node.childNodes || []) all(c, pred, out);
  return out;
}

const textOf = (n) => (n.nodeType === 3 ? n.nodeValue : n.childNodes.map(textOf).join(""));
const clean = (s) => s.replace(/\s+/g, " ").trim();
const hasClass = (n, c) => (n.getAttribute("class") || "").split(/\s+/).includes(c);

const doc = parse(read("index.html"));
const section = (id) => byId(doc, id);
// The marker of the sample pauta, read as one more block.
const EJEMPLO = "EJEMPLO: esta es una pauta de ejemplo. Reemplázala por la que te entregue tu equipo tratante.";

test("app.js exposes the chunking function without touching the DOM", () => {
  assert.equal(typeof voz?.chunks, "function");
});

test("S22g: each row of the pauta table is one chunk with its group name and both column words", () => {
  const elegir = section("elegir");
  const chunks = voz.chunks(elegir);
  const rows = all(elegir, (n) => n.tagName === "ARTICLE" && hasClass(n, "group"));
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const group = clean(textOf(all(row, (n) => n.tagName === "H3")[0]));
    const [pref, lim] = all(row, (n) => hasClass(n, "half")).map((h) => {
      const ps = all(h, (n) => n.tagName === "P");
      return { tag: clean(textOf(ps[0])), text: clean(textOf(ps[1])) };
    });
    assert.equal(pref.tag, "Preferir");
    assert.equal(lim.tag, "Limitar o evitar");
    const expected = `${group}. Preferir: ${pref.text} Limitar o evitar: ${lim.text}`;
    assert.ok(chunks.includes(expected), `missing row chunk: ${expected}\n${JSON.stringify(chunks, null, 1)}`);
    // Every food is heard with its list name: no chunk carries a column's words alone.
    for (const c of chunks) {
      if (c.includes(pref.text) || c.includes(lim.text)) assert.equal(c, expected);
    }
  }
});

test("S22g: «Qué elegir» starts with its heading and has one chunk per row", () => {
  const chunks = voz.chunks(section("elegir"));
  assert.equal(chunks[0], "¿Qué alimentos elegir?");
  assert.equal(chunks[1], EJEMPLO);
  assert.equal(chunks.length, 1 + 1 + 3);
});

test("S22g: a section is read as heading, paragraphs and list items, each its own chunk", () => {
  const chunks = voz.chunks(section("indicaciones"));
  assert.deepEqual(chunks, [
    "Indicaciones generales",
    EJEMPLO,
    "Objetivo",
    "[Ejemplo] Objetivo de la pauta, tal como lo escribió tu equipo tratante.",
    "[Ejemplo] Indicación de tu equipo sobre los tiempos de comida.",
    "[Ejemplo] Indicación de tu equipo sobre cómo dar sabor a las comidas.",
    "[Ejemplo] Indicación de tu equipo sobre los alimentos frescos.",
    "[Ejemplo] Indicación de tu equipo sobre los alimentos envasados.",
    "[Ejemplo] Indicación de tu equipo sobre la sal light y los sustitutos de sal.",
  ]);
});

test("S22g: buttons, breadcrumbs, the pager and icons are not read", () => {
  for (const id of ["alta", "indicaciones", "elegir", "dia", "presion", "cocina", "etiquetas", "seguimiento"]) {
    const joined = voz.chunks(section(id)).join(" | ");
    for (const w of ["Escuchar", "Volver al inicio", "Siguiente", "Anterior", "Mi pauta"]) {
      assert.ok(!joined.includes(w), `«${w}» read in #${id}`);
    }
    for (const c of voz.chunks(section(id))) assert.equal(c, clean(c), `chunk not trimmed in #${id}`);
  }
});

test("S22g: «+» in the day example is read as «más», and every meal is its own chunk", () => {
  const chunks = voz.chunks(section("dia"));
  assert.equal(chunks[0], "Ejemplo de un día de alimentación");
  assert.ok(chunks.includes("Desayuno"));
  assert.ok(chunks.some((c) => c.startsWith("[Ejemplo] Alimento de ejemplo A, más alimento de ejemplo F")));
  assert.ok(chunks.every((c) => !c.includes(" + ")));
});

test("S22g: hidden parts are not read", () => {
  const tree = parse('<div id="r"><h2>Título</h2><p hidden>Oculto</p><div hidden><p>Tampoco</p></div><p>Visible</p></div>');
  assert.deepEqual(voz.chunks(byId(tree, "r")), ["Título", "Visible"]);
});

test("S22g: every pauta sentence in the sections is still read, word for word", () => {
  const all7 = ["indicaciones", "elegir", "dia", "presion", "cocina", "etiquetas", "seguimiento"]
    .flatMap((id) => voz.chunks(section(id))).join(" ");
  for (const s of [
    "[Ejemplo] Indicación de tu equipo sobre el sodio en los productos envasados.",
    "[Ejemplo] Indicación de tu equipo sobre la sal light y los sustitutos de sal.",
    "[Ejemplo] Indicación de tu equipo sobre los controles después del alta.",
  ]) assert.ok(all7.includes(s), s);
});

test("S23: «Escuchar» reads the discharge indication block, quote as written, nothing else", () => {
  const alta = section("alta");
  assert.ok(alta, "no #alta block");
  const btn = all(alta, (n) => n.tagName === "BUTTON" && hasClass(n, "speak"))[0];
  assert.equal(btn?.getAttribute("data-target"), "alta");
  const chunks = voz.chunks(alta);
  assert.deepEqual(chunks, [
    "Indicación médica del alta",
    EJEMPLO,
    "[Fecha de ejemplo]",
    "[Ejemplo] Indicación médica del alta, tal como está escrita en el documento.",
    "Pregunta a tu equipo cómo se combina con esta pauta.",
  ]);
  assert.ok(chunks.includes("[Ejemplo] Indicación médica del alta, tal como está escrita en el documento."));
});

test("S23: the discharge indication comes before the pauta's first section", () => {
  const routes = all(doc, (n) => n.tagName === "SECTION" && n.hasAttribute("data-route")).map((n) => n.getAttribute("id"));
  assert.equal(routes[0], "alta");
  assert.equal(routes[1], "indicaciones");
});

test("S22g: app.js keeps es-CL, rate 0.9 and a cancellable queue", () => {
  const src = read("app.js");
  assert.match(src, /lang = "es-CL"/);
  assert.match(src, /rate = 0\.9/);
  assert.match(src, /synth\.cancel\(\)/);
});
