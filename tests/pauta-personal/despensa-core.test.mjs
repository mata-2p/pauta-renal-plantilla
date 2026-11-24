// Behavior tests for pauta-personal/despensa-core.js («Mi despensa», pure logic, no DOM).
// The pauta does the grouping: an item picked from the pauta's table keeps the
// pauta's own words and its group; anything typed stays apart, unclassified.
// Run: node --test 'tests/pauta-personal/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const here = (p) => new URL(`../../pauta-personal/${p}`, import.meta.url);
const read = (p) => readFileSync(here(p), "utf8");
const core = await import(here("despensa-core.js"));
const registro = await import(here("registro-core.js"));
const {
  parsePautaTable, splitItems, pautaGroups, pautaOptions, searchPauta, groupItems, shoppingList,
  checkDespensaList, createDespensaStore, PAUTA_TABLE, COLUMNS, OTHERS_HEADING, STORAGE_KEY, BACKUP_KEY,
  UI_COPY,
} = core;

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    snapshot: () => Object.fromEntries(map),
  };
}

let seq = 0;
const nextId = () => `d-${++seq}`;
const newStore = (storage = memoryStorage()) => ({ storage, store: createDespensaStore(storage, { id: nextId }) });
const fixedNow = () => new Date("2031-11-19T12:00:00Z");

const AVENA = { group: "Grupo de ejemplo 1", column: "preferir", name: "alimento de ejemplo B" };
const CECINAS = { group: "Grupo de ejemplo 2", column: "limitar", name: "Alimento de ejemplo H" };

/** Visible text of an HTML file (no scripts, styles or tags), whitespace collapsed. */
function htmlText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

// --- The pauta's table ------------------------------------------------------------

// SAMPLE: checked by hand against the «¿Qué alimentos elegir?» table of index.html.
const EXPECTED_ITEMS = {
  "Grupo de ejemplo 1": {
    preferir: ["Alimento de ejemplo A", "alimento de ejemplo B", "alimento de ejemplo C"],
    limitar: ["Alimento de ejemplo D", "alimento de ejemplo E"],
  },
  "Grupo de ejemplo 2": {
    preferir: ["Alimento de ejemplo F", "alimento de ejemplo G"],
    limitar: ["Alimento de ejemplo H", "alimento de ejemplo I", "preparación de ejemplo J"],
  },
  "Grupo de ejemplo 3": {
    preferir: ["Alimento de ejemplo K, según indique tu equipo"],
    limitar: ["Alimento de ejemplo L"],
  },
};

test("the pauta table parsed from index.html equals the table the despensa uses, word for word", () => {
  const parsed = parsePautaTable(read("index.html"));
  assert.deepEqual(parsed.columns, { preferir: "Preferir", limitar: "Limitar o evitar" });
  assert.deepEqual(COLUMNS, parsed.columns);
  assert.equal(parsed.groups.length, 3);
  assert.deepEqual(PAUTA_TABLE, parsed.groups);
  const pageText = htmlText(read("index.html"));
  for (const g of parsed.groups) {
    assert.ok(pageText.includes(g.preferir), g.preferir);
    assert.ok(pageText.includes(g.limitar), g.limitar);
  }
});

test("each group's items are the pauta's own words, in the pauta's order", () => {
  const groups = pautaGroups();
  assert.deepEqual(groups.map((g) => g.group), Object.keys(EXPECTED_ITEMS));
  for (const g of groups) {
    for (const col of ["preferir", "limitar"]) {
      assert.deepEqual(g[col].items, EXPECTED_ITEMS[g.group][col], `${g.group} ${col}`);
      for (const item of g[col].items) assert.ok(g[col].sentence.includes(item), `«${item}» is in «${g[col].sentence}»`);
    }
  }
});

test("splitting keeps qualifiers attached and leaves out the instruction that is not a food", () => {
  assert.deepEqual(splitItems("Alimento de ejemplo K, según indique tu equipo."), ["Alimento de ejemplo K, según indique tu equipo"]);
  assert.deepEqual(splitItems("Alimento de ejemplo F y alimento de ejemplo G. [Ejemplo] Indicación de tu equipo sobre cómo prepararlos."), ["Alimento de ejemplo F", "alimento de ejemplo G"]);
});

test("pautaOptions lists every item once with its group and column", () => {
  const opts = pautaOptions();
  const total = Object.values(EXPECTED_ITEMS).reduce((n, g) => n + g.preferir.length + g.limitar.length, 0);
  assert.equal(opts.length, total);
  assert.deepEqual(opts[0], { group: "Grupo de ejemplo 1", column: "preferir", name: "Alimento de ejemplo A" });
});

test("search finds pauta items ignoring accents and case; an empty search shows nothing", () => {
  assert.deepEqual(searchPauta("PREPARACION").map((o) => o.name), ["preparación de ejemplo J"]);
  assert.deepEqual(searchPauta("ejemplo d").map((o) => [o.name, o.column]), [["Alimento de ejemplo D", "limitar"]]);
  assert.equal(searchPauta("alimento de ejemplo").length, 11);
  assert.deepEqual(searchPauta("   "), []);
  assert.deepEqual(searchPauta("chocolate"), []);
});

// --- Add, edit, remove, mark ------------------------------------------------------------

test("an item picked from the pauta keeps the pauta's wording and goes to its group", () => {
  const { storage, store } = newStore();
  const r = store.addFromPauta(AVENA, { quantity: "1 bolsa", note: "" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    id: "d-1", source: "pauta", group: "Grupo de ejemplo 1", column: "preferir", name: "alimento de ejemplo B",
    quantity: "1 bolsa", note: "", toBuy: false,
  });
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), { schema: 1, items: [r.value] });
  const g = groupItems(store.items());
  assert.deepEqual(g.preferir.map((x) => [x.group, x.items.map((i) => i.name)]), [["Grupo de ejemplo 1", ["alimento de ejemplo B"]]]);
  assert.deepEqual(g.limitar, []);
  assert.deepEqual(g.otros, []);
});

test("an option that is not in the pauta's table is rejected and nothing is stored", () => {
  for (const bad of [
    { group: "Grupo de ejemplo 1", column: "preferir", name: "Alimento de ejemplo B" },
    { group: "Grupo de ejemplo 1", column: "limitar", name: "alimento de ejemplo B" },
    { group: "Postres", column: "preferir", name: "alimento de ejemplo B" },
    null,
  ]) {
    const { storage, store } = newStore();
    const r = store.addFromPauta(bad, {});
    assert.equal(r.ok, false);
    assert.match(r.errors[0].message, /Elige un alimento de la lista de tu pauta/);
    assert.deepEqual(storage.snapshot(), {});
    assert.deepEqual(store.items(), []);
  }
});

test("a typed item goes to «Otros», even when it is spelled like a pauta item", () => {
  const { store } = newStore();
  const a = store.addTyped({ name: "  Chocolate  ", quantity: "", note: "para visitas" });
  const b = store.addTyped({ name: "alimento de ejemplo B", quantity: "", note: "" });
  assert.equal(a.ok, true);
  assert.deepEqual(a.value, { id: a.value.id, source: "otro", group: "", column: "", name: "Chocolate", quantity: "", note: "para visitas", toBuy: false });
  assert.equal(b.value.source, "otro");
  const g = groupItems(store.items());
  assert.deepEqual(g.preferir, []);
  assert.deepEqual(g.limitar, []);
  assert.deepEqual(g.otros.map((i) => i.name), ["Chocolate", "alimento de ejemplo B"]);
  assert.equal(OTHERS_HEADING, "Otros (no aparece en tu pauta)");
});

test("a typed item without a name is rejected and nothing is stored", () => {
  const { storage, store } = newStore();
  const r = store.addTyped({ name: "   ", quantity: "2", note: "" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.field), ["name"]);
  assert.match(r.errors[0].message, /Escribe el nombre del alimento/);
  assert.deepEqual(storage.snapshot(), {});
});

test("editing changes quantity and note; a pauta item keeps the pauta's name, a typed one can be renamed", () => {
  const { store } = newStore();
  const p = store.addFromPauta(AVENA, {}).value;
  const t = store.addTyped({ name: "Chocolate" }).value;
  const r1 = store.update(p.id, { name: "Otra cosa", quantity: "medio kilo", note: "la de siempre" });
  assert.equal(r1.ok, true);
  assert.deepEqual(store.items()[0], { ...p, quantity: "medio kilo", note: "la de siempre" });
  const r2 = store.update(t.id, { name: "Chocolate amargo", quantity: "", note: "" });
  assert.equal(r2.ok, true);
  assert.equal(store.items()[1].name, "Chocolate amargo");
  assert.equal(store.items()[1].source, "otro");
  const bad = store.update(t.id, { name: " ", quantity: "", note: "" });
  assert.equal(bad.ok, false);
  assert.equal(store.items()[1].name, "Chocolate amargo");
  assert.equal(store.update("no-existe", { quantity: "" }).ok, false);
});

test("«se acabó / comprar» builds the shopping list in display order and can be undone", () => {
  const { store } = newStore();
  const t = store.addTyped({ name: "Té" }).value;
  const c = store.addFromPauta(CECINAS, {}).value;
  const a = store.addFromPauta(AVENA, { quantity: "2" }).value;
  assert.equal(store.setToBuy(t.id, true), true);
  assert.equal(store.setToBuy(a.id, true), true);
  assert.deepEqual(shoppingList(store.items()).map((i) => i.name), ["alimento de ejemplo B", "Té"]);
  store.setToBuy(a.id, false);
  assert.deepEqual(shoppingList(store.items()).map((i) => i.id), [t.id]);
  assert.equal(store.items().find((i) => i.id === c.id).toBuy, false);
  assert.equal(store.setToBuy("no-existe", true), false);
});

test("removing returns what was removed and undo puts it back in the same place", () => {
  const { storage, store } = newStore();
  const a = store.addFromPauta(AVENA, {}).value;
  const b = store.addTyped({ name: "Té" }).value;
  const c = store.addFromPauta(CECINAS, {}).value;
  const removed = store.remove(b.id);
  assert.deepEqual(removed, { item: b, index: 1 });
  assert.deepEqual(store.items().map((i) => i.id), [a.id, c.id]);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).items.map((i) => i.id), [a.id, c.id]);
  assert.equal(store.undoRemove(removed), true);
  assert.deepEqual(store.items().map((i) => i.id), [a.id, b.id, c.id]);
  assert.equal(store.undoRemove(removed), false, "undo twice does not duplicate");
  assert.equal(store.remove("no-existe"), null);
});

test("a stored pauta item whose words are no longer in the table shows in «Otros», never in a pauta group", () => {
  const items = [
    { id: "x", source: "pauta", group: "Grupo de ejemplo 1", column: "preferir", name: "chocolate", quantity: "", note: "", toBuy: false },
    { id: "y", source: "otro", group: "Grupo de ejemplo 1", column: "preferir", name: "alimento de ejemplo B", quantity: "", note: "", toBuy: false },
  ];
  const g = groupItems(items);
  assert.deepEqual(g.preferir, []);
  assert.deepEqual(g.otros.map((i) => i.id), ["x", "y"]);
});

// --- Storage robustness -------------------------------------------------------------------

test("corrupt saved data is ignored with a message, a backup is kept and nothing is lost by reading", () => {
  for (const raw of [
    "{not json",
    JSON.stringify({ schema: 2, items: [] }),
    JSON.stringify({ schema: 1, items: [{ id: "a", source: "pauta" }] }),
    JSON.stringify({ schema: 1, items: [{ id: "a", source: "otro", group: "", column: "", name: "x", quantity: "", note: "", toBuy: "sí" }] }),
    JSON.stringify([]),
  ]) {
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const { store } = newStore(storage);
    assert.match(store.loadError(), /no se pudo leer/);
    assert.deepEqual(store.items(), []);
    assert.equal(storage.getItem(BACKUP_KEY), raw);
    assert.equal(storage.getItem(STORAGE_KEY), raw, "reading never overwrites");
  }
});

test("valid saved data loads without a message", () => {
  const { storage, store } = newStore();
  store.addFromPauta(AVENA, { quantity: "1" });
  const again = createDespensaStore(storage, { id: nextId });
  assert.equal(again.loadError(), null);
  assert.deepEqual(again.items(), store.items());
});

test("a browser that refuses to save leaves the previous items in place", () => {
  const { storage, store } = newStore();
  store.addFromPauta(AVENA, {});
  const before = store.items();
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => store.addTyped({ name: "Té" }));
  assert.deepEqual(store.items(), before);
});

// --- Export / import with «Compartir con mi familiar» -----------------------------------------

function registroSeeded() {
  const storage = memoryStorage();
  const store = registro.createStore(storage, { now: fixedNow, id: nextId });
  store.add("diario", { date: "2031-11-18", meal: "Desayuno", text: "Pan y quesillo" });
  store.add("preguntas", { text: "¿Cada cuánto me controlo?" });
  return { storage, store };
}

test("the export carries the despensa next to the existing fields and the round trip keeps it equal", () => {
  const { store: notes } = registroSeeded();
  const { store: pantry } = newStore();
  pantry.addFromPauta(AVENA, { quantity: "1 bolsa" });
  pantry.addTyped({ name: "Té", note: "sin azúcar" });
  pantry.setToBuy(pantry.items()[1].id, true);

  const exp = notes.exportFile({ despensa: pantry.items() });
  assert.deepEqual(Object.keys(exp.payload), ["app", "schema", "exportedAt", "data"]);
  assert.equal(exp.payload.schema, 1);
  assert.deepEqual(Object.keys(exp.payload.data), ["controles", "diario", "mediciones", "preguntas", "despensa"]);

  const parsed = registro.parseImport(exp.text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.payload.data.despensa, pantry.items());

  // Restoring on another phone: the notes go to the notes, the despensa to the despensa.
  const other = memoryStorage();
  const otherNotes = registro.createStore(other, { now: fixedNow, id: nextId });
  const otherPantry = createDespensaStore(other, { id: nextId });
  otherNotes.restore(parsed.payload);
  assert.equal(otherPantry.replaceAll(parsed.payload.data.despensa).ok, true);
  assert.deepEqual(otherNotes.getData(), notes.getData());
  assert.deepEqual(Object.keys(JSON.parse(other.getItem(registro.STORAGE_KEY)).data), ["controles", "diario", "mediciones", "preguntas"]);
  assert.deepEqual(createDespensaStore(other, { id: nextId }).items(), pantry.items());
});

test("an export without a despensa keeps exactly the previous shape", () => {
  const { store } = registroSeeded();
  const exp = store.exportFile();
  assert.deepEqual(Object.keys(exp.payload.data), ["controles", "diario", "mediciones", "preguntas"]);
});

// A file written by the previous version (pauta-v5), before the despensa existed.
const OLD_FILE = JSON.stringify({
  app: "mi-pauta",
  schema: 1,
  exportedAt: "2031-11-18T12:00:00.000Z",
  data: {
    controles: [{ id: "c1", date: "2031-12-01", time: "", kind: "control", where: "Nutricionista", notes: "", bring: "" }],
    diario: [{ id: "d1", date: "2031-11-18", meal: "Almuerzo", text: "Arroz con pollo" }],
    mediciones: [{ id: "m1", date: "2031-11-18", time: "08:00", systolic: "128", diastolic: "79", weight: null }],
    preguntas: [{ id: "q1", addedOn: "2031-11-18", text: "¿Puedo usar orégano?", asked: false }],
  },
}, null, 2);

test("an old file without a despensa still opens, restores unchanged and leaves the despensa alone", () => {
  const parsed = registro.parseImport(OLD_FILE);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.payload, JSON.parse(OLD_FILE));
  const storage = memoryStorage();
  const pantry = createDespensaStore(storage, { id: nextId });
  pantry.addFromPauta(AVENA, {});
  const pantryBefore = storage.getItem(STORAGE_KEY);
  const notes = registro.createStore(storage, { now: fixedNow, id: nextId });
  notes.restore(parsed.payload);
  assert.deepEqual(notes.getData(), JSON.parse(OLD_FILE).data);
  assert.equal(storage.getItem(STORAGE_KEY), pantryBefore);
});

function rejectsDespensa(name, mutate, pattern) {
  test(`import rejects a despensa with ${name} and leaves stored data unchanged`, () => {
    const { store: notes } = registroSeeded();
    const { store: pantry } = newStore();
    pantry.addFromPauta(AVENA, {});
    pantry.addTyped({ name: "Té" });
    const payload = structuredClone(notes.exportFile({ despensa: pantry.items() }).payload);
    mutate(payload.data.despensa, payload);
    const { storage, store } = registroSeeded();
    const before = storage.snapshot();
    const r = store.readImport(JSON.stringify(payload));
    assert.equal(r.ok, false);
    assert.match(r.error, pattern);
    assert.match(r.error, /No se cambió nada/);
    assert.deepEqual(storage.snapshot(), before);
  });
}

rejectsDespensa("a wrong type", (d) => { d[0].toBuy = "sí"; }, /formato.*despensa\[0\]\.toBuy/);
rejectsDespensa("an unknown field", (d) => { d[1].semaforo = "rojo"; }, /desconocido.*despensa\[1\]\.semaforo/);
rejectsDespensa("a repeated id", (d) => { d[1].id = d[0].id; }, /repetid/);
rejectsDespensa("an empty name", (d) => { d[1].name = ""; }, /despensa\[1\]/);
rejectsDespensa("an unknown source", (d) => { d[1].source = "preferir"; }, /despensa\[1\]/);
rejectsDespensa("a list that is not a list", (d, p) => { p.data.despensa = { avena: true }; }, /formato.*despensa/);

test("checkDespensaList accepts a valid list and names the first bad entry", () => {
  const { store } = newStore();
  store.addFromPauta(AVENA, {});
  assert.equal(checkDespensaList(store.items()), null);
  assert.match(checkDespensaList([{ ...store.items()[0], quantity: 2 }]), /despensa\[0\]\.quantity/);
});

test("replaceAll refuses an invalid list and keeps the current items", () => {
  const { storage, store } = newStore();
  store.addFromPauta(AVENA, {});
  const before = storage.snapshot();
  const r = store.replaceAll([{ id: "a" }]);
  assert.equal(r.ok, false);
  assert.deepEqual(storage.snapshot(), before);
});

// --- Wording ----------------------------------------------------------------------------

const FORBIDDEN = ["puedes comer", "normal", "riesgo", "elevad", "prohibido", "peligro", "demasiado", "exceso", "semáforo", "puntaje"];

test("the new screen's own words never judge, warn or count", () => {
  assert.ok(UI_COPY.length > 10);
  const sources = {
    UI_COPY: UI_COPY.join(" \n "),
    "despensa.html": htmlText(read("despensa.html")),
    "despensa.js": read("despensa.js"),
    "despensa.css": read("despensa.css"),
  };
  for (const [name, text] of Object.entries(sources)) {
    const low = text.toLowerCase();
    for (const w of FORBIDDEN) assert.ok(!low.includes(w), `«${w}» in ${name}`);
  }
  assert.ok(UI_COPY.includes(OTHERS_HEADING));
  assert.ok(UI_COPY.includes("Preferir") && UI_COPY.includes("Limitar o evitar"));
});

// --- Verification fixes ------------------------------------------------------------------

test("import rejects prototype keys on a despensa item", () => {
  const raw = '{"app":"mi-pauta","schema":1,"exportedAt":"2031-11-19T12:00:00.000Z","data":{"controles":[],"diario":[],"mediciones":[],"preguntas":[],"despensa":[{"__proto__":{"p":1},"id":"a","source":"otro","group":"","column":"","name":"x","quantity":"","note":"","toBuy":false}]}}';
  assert.equal(registro.parseImport(raw).ok, false);
  assert.match(checkDespensaList([{ constructor: "x", id: "a", source: "otro", group: "", column: "", name: "x", quantity: "", note: "", toBuy: false }]), /desconocido/);
});

test("import rejects a «pauta» item that is not a cell of the table, like addFromPauta does", () => {
  assert.notEqual(checkDespensaList([{ id: "x", source: "pauta", group: "Grupo de ejemplo 1", column: "preferir", name: "chocolate", quantity: "", note: "", toBuy: false }]), null);
});

test("saved data with prototype keys or a «pauta» item outside the table is announced, not loaded", () => {
  const ok = { id: "a", source: "otro", group: "", column: "", name: "x", quantity: "", note: "", toBuy: false };
  for (const raw of [
    `{"schema":1,"items":[{"__proto__":{"p":1},"id":"a","source":"otro","group":"","column":"","name":"x","quantity":"","note":"","toBuy":false}]}`,
    JSON.stringify({ schema: 1, items: [{ ...ok, constructor: "x" }] }),
    JSON.stringify({ schema: 1, items: [{ ...ok, toString: "x" }] }),
    JSON.stringify({ schema: 1, items: [{ ...ok, source: "pauta", group: "Grupo de ejemplo 1", column: "preferir", name: "chocolate" }] }),
  ]) {
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const { store } = newStore(storage);
    assert.match(store.loadError() || "", /no se pudo leer/, raw);
    assert.deepEqual(store.items(), []);
    assert.equal(storage.getItem(BACKUP_KEY), raw);
  }
});

test("the screens never write a «0» when a group is empty and show the pauta's group only for a table cell", () => {
  for (const name of ["registro.js", "despensa.js"]) {
    assert.doesNotMatch(read(name), /\.length\s*&&\s*\[/, name);
  }
  const js = read("despensa.js");
  assert.match(js, /const where = \(item\) => \(isPautaItem\(item\.group, item\.column, item\.name\)/);
  assert.match(js, /isPautaItem\(item\.group, item\.column, item\.name\) \? item\.group : OTHERS_HEADING/);
  // Showing a group name never rests on «source» alone (the form may still use it to decide if the name is editable).
  assert.doesNotMatch(js, /item\.source === "pauta" \? `\$\{item\.group\}|item\.source === "pauta" && item\.group/);
});

// Restoring a file writes the notes first, then the despensa; any failure puts both back.
function restoreSetup() {
  const storage = memoryStorage();
  const notes = registro.createStore(storage, { now: fixedNow, id: nextId });
  const pantry = createDespensaStore(storage, { id: nextId });
  notes.add("preguntas", { text: "Propia" });
  pantry.addTyped({ name: "Té" });
  const { store: src } = registroSeeded();
  const { store: srcPantry } = newStore();
  srcPantry.addFromPauta(AVENA, {});
  const payload = registro.parseImport(src.exportFile({ despensa: srcPantry.items() }).text).payload;
  return { storage, notes, pantry, payload, notesBefore: notes.getData(), pantryBefore: pantry.items(), snap: storage.snapshot() };
}

test("restore writes notes and despensa together", () => {
  const { storage, notes, pantry, payload } = restoreSetup();
  const r = registro.restoreAll(notes, pantry, payload, storage);
  assert.deepEqual(r, { ok: true, despensa: true });
  assert.deepEqual(notes.getData(), Object.fromEntries(registro.KINDS.map((k) => [k, payload.data[k]])));
  assert.deepEqual(pantry.items(), payload.data.despensa);
});

for (const failing of [registro.STORAGE_KEY, STORAGE_KEY]) {
  test(`restore rolls everything back when writing ${failing} fails, and says nothing changed`, () => {
    const { storage, notes, pantry, payload, notesBefore, pantryBefore, snap } = restoreSetup();
    const setItem = storage.setItem;
    let armed = true;
    storage.setItem = (k, v) => { if (armed && k === failing) { armed = false; throw new Error("QuotaExceededError"); } setItem(k, v); };
    const r = registro.restoreAll(notes, pantry, payload, storage);
    assert.equal(r.ok, false);
    assert.equal(r.rolledBack, true);
    assert.match(r.error, /No se cambió nada en este teléfono/);
    assert.deepEqual(storage.snapshot(), snap);
    assert.deepEqual(notes.getData(), notesBefore);
    assert.deepEqual(pantry.items(), pantryBefore);
  });
}

test("restore of an old file without a despensa leaves the despensa alone", () => {
  const { storage, notes, pantry, pantryBefore } = restoreSetup();
  const r = registro.restoreAll(notes, pantry, registro.parseImport(OLD_FILE).payload, storage);
  assert.deepEqual(r, { ok: true, despensa: false });
  assert.deepEqual(pantry.items(), pantryBefore);
  assert.deepEqual(notes.getData(), JSON.parse(OLD_FILE).data);
});

test("if even the roll back cannot be written, the message does not claim nothing changed", () => {
  const { storage, notes, pantry, payload } = restoreSetup();
  const setItem = storage.setItem;
  let notesWritten = false;
  storage.setItem = (k, v) => {
    if (k === registro.STORAGE_KEY && notesWritten) throw new Error("QuotaExceededError");
    if (k === STORAGE_KEY) throw new Error("QuotaExceededError");
    if (k === registro.STORAGE_KEY) notesWritten = true;
    setItem(k, v);
  };
  const r = registro.restoreAll(notes, pantry, payload, storage);
  assert.equal(r.ok, false);
  assert.equal(r.rolledBack, false);
  assert.doesNotMatch(r.error, /No se cambió nada/);
});
