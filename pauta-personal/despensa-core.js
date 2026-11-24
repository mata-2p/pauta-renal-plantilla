// Mi despensa: pure logic, no DOM and no network.
// The pauta does the grouping, never this code. An item picked from the pauta's
// table («¿Qué alimentos elegir?» in index.html) keeps the pauta's exact words and
// its group. Anything the person types stays apart, under a neutral heading, and is
// never moved into a pauta group, whatever it is called. Nothing here counts,
// scores or warns.

export const SCHEMA = 1;
export const STORAGE_KEY = "despensa-v1";
export const BACKUP_KEY = "despensa-v1-respaldo";

// --- The pauta's table ------------------------------------------------------------

// Column headings, in the pauta's own words.
export const COLUMNS = { preferir: "Preferir", limitar: "Limitar o evitar" };
export const COLUMN_KEYS = ["preferir", "limitar"];
export const OTHERS_HEADING = "Otros (no aparece en tu pauta)";

// SAMPLE: replace it with your team's table, copied word for word from index.html
// (section #elegir), one row per group. check_verbatim.py and the
// node tests compare it with the page, row by row.
// <pauta-table>
export const PAUTA_TABLE = [
  { group: "Grupo de ejemplo 1", preferir: "Alimento de ejemplo A, alimento de ejemplo B y alimento de ejemplo C.", limitar: "Alimento de ejemplo D y alimento de ejemplo E." },
  { group: "Grupo de ejemplo 2", preferir: "Alimento de ejemplo F y alimento de ejemplo G. [Ejemplo] Indicación de tu equipo sobre cómo prepararlos.", limitar: "Alimento de ejemplo H, alimento de ejemplo I y preparación de ejemplo J." },
  { group: "Grupo de ejemplo 3", preferir: "Alimento de ejemplo K, según indique tu equipo.", limitar: "Alimento de ejemplo L." },
];
// </pauta-table>

// Words of a pauta sentence that describe the food before them, not a food of their own.
const QUALIFIERS = ["según indique tu equipo"];
// A sentence of the table that is an instruction, not a food to keep at home.
const INSTRUCTIONS = ["[Ejemplo] Indicación de tu equipo sobre cómo prepararlos"];

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const textOf = (html) => decode(html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, ""));

/**
 * Reads the «¿Qué alimentos elegir?» table out of index.html.
 * Returns { columns: { preferir, limitar }, groups: [{ group, preferir, limitar }] }
 * with every text exactly as the page writes it.
 */
export function parsePautaTable(html) {
  const groups = [];
  const columns = {};
  const article = /<article class="group">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = article.exec(html))) {
    const body = m[1];
    const h3 = /<h3>([\s\S]*?)<\/h3>/.exec(body);
    const row = { group: h3 ? textOf(h3[1]) : "" };
    for (const [cls, key] of [["pref", "preferir"], ["lim", "limitar"]]) {
      const half = new RegExp(`<div class="half ${cls}">\\s*<p class="tag">([\\s\\S]*?)</p>\\s*<p>([\\s\\S]*?)</p>`).exec(body);
      if (!half) continue;
      columns[key] = textOf(half[1]);
      row[key] = textOf(half[2]);
    }
    groups.push(row);
  }
  return { columns, groups };
}

/** Splits one pauta sentence into the foods it names, keeping the pauta's words. */
export function splitItems(sentence) {
  const out = [];
  for (const part of sentence.split(/\.\s+/)) {
    const s = part.replace(/\.$/, "").trim();
    if (!s || INSTRUCTIONS.includes(s)) continue;
    for (const frag of s.split(/,\s+|\s+y\s+/)) {
      if (QUALIFIERS.includes(frag) && out.length) out[out.length - 1] += `, ${frag}`;
      else out.push(frag);
    }
  }
  return out;
}

const GROUPS = PAUTA_TABLE.map((row) => ({
  group: row.group,
  preferir: { sentence: row.preferir, items: splitItems(row.preferir) },
  limitar: { sentence: row.limitar, items: splitItems(row.limitar) },
}));

/** The table with its items: [{ group, preferir: { sentence, items }, limitar: {...} }]. */
export function pautaGroups() {
  return JSON.parse(JSON.stringify(GROUPS));
}

/** Every pauta item once, in the table's order: [{ group, column, name }]. */
export function pautaOptions() {
  const out = [];
  for (const g of GROUPS) {
    for (const column of COLUMN_KEYS) {
      for (const name of g[column].items) out.push({ group: g.group, column, name });
    }
  }
  return out;
}

/** True when group, column and name are exactly a cell of the pauta's table. */
export function isPautaItem(group, column, name) {
  const g = GROUPS.find((x) => x.group === group);
  return Boolean(g && COLUMN_KEYS.includes(column) && g[column].items.includes(name));
}

const FOLD = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n" };
const fold = (s) => String(s).toLowerCase().replace(/[áéíóúüñ]/g, (c) => FOLD[c]).replace(/\s+/g, " ").trim();

/** Pauta items whose words contain the search, ignoring accents and case. */
export function searchPauta(query) {
  const q = fold(query || "");
  if (!q) return [];
  return pautaOptions().filter((o) => fold(o.name).includes(q));
}

// --- Items ------------------------------------------------------------------------

const FIELDS = { id: "string", source: "string", group: "string", column: "string", name: "string", quantity: "string", note: "string", toBuy: "boolean" };
const SOURCES = ["pauta", "otro"];
const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

export const MSG_PICK = "Elige un alimento de la lista de tu pauta.";
export const MSG_NAME = "Escribe el nombre del alimento.";
export const MSG_GONE = "Ese alimento ya no está en tu despensa.";
export const LOAD_ERROR = "Lo guardado en tu despensa no se pudo leer. Se guardó un respaldo y se empezó de nuevo.";

/**
 * Where each item is shown. Only an item picked from the pauta, whose group, column
 * and words are exactly a cell of the table, goes to that pauta group. Everything
 * else goes to «Otros».
 */
export function groupItems(items) {
  const out = { preferir: [], limitar: [], otros: [] };
  const byCell = new Map();
  for (const item of items) {
    if (item.source === "pauta" && isPautaItem(item.group, item.column, item.name)) {
      const key = `${item.column}\u0000${item.group}`;
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push(item);
    } else {
      out.otros.push(item);
    }
  }
  for (const column of COLUMN_KEYS) {
    for (const g of GROUPS) {
      const list = byCell.get(`${column}\u0000${g.group}`);
      if (list) out[column].push({ group: g.group, items: list });
    }
  }
  return out;
}

/** Items marked «se acabó / comprar», in the same order as the despensa. */
export function shoppingList(items) {
  const g = groupItems(items);
  return [
    ...g.preferir.flatMap((x) => x.items),
    ...g.limitar.flatMap((x) => x.items),
    ...g.otros,
  ].filter((i) => i.toBuy);
}

/**
 * Strict check of a stored or imported list. Returns an error sentence (in the same
 * words as the rest of «Compartir») or null.
 */
export function checkDespensaList(list) {
  if (!Array.isArray(list)) return "El archivo tiene un dato con un formato que no corresponde («despensa») y no se abrió.";
  const ids = new Set();
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const where = `despensa[${i}]`;
    if (typeOf(e) !== "object") return `El archivo tiene un dato con un formato que no corresponde («${where}») y no se abrió.`;
    // Own keys only: «__proto__», «constructor» or «toString» are unknown fields too.
    const extra = Object.keys(e).find((k) => !Object.hasOwn(FIELDS, k));
    if (extra !== undefined) return `El archivo tiene un dato desconocido («${where}.${extra}») y no se abrió.`;
    for (const [field, type] of Object.entries(FIELDS)) {
      if (!(field in e) || typeOf(e[field]) !== type) {
        return `El archivo tiene un dato con un formato que no corresponde («${where}.${field}») y no se abrió.`;
      }
    }
    if (!e.id || ids.has(e.id)) return `El archivo tiene un alimento repetido o sin identificador («${where}») y no se abrió.`;
    ids.add(e.id);
    const asTyped = (k) => e[k] === str(e[k]);
    const ok = SOURCES.includes(e.source) && e.name !== "" && ["name", "quantity", "note", "group", "column"].every(asTyped)
      // A «pauta» item must be exactly a cell of the table, as addFromPauta requires.
      && (e.source === "otro" ? e.group === "" && e.column === "" : isPautaItem(e.group, e.column, e.name));
    if (!ok) return `El archivo tiene un alimento incompleto o con datos que no corresponden («${where}») y no se abrió.`;
  }
  return null;
}

// --- Store (storage is injected: window.localStorage in the page) ---------------------

function defaultId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const fail = (field, message) => ({ ok: false, value: null, errors: [{ field, message }] });

export function createDespensaStore(storage, { id = defaultId } = {}) {
  let items = [];
  let loadError = null;

  function load() {
    items = [];
    loadError = null;
    const raw = storage.getItem(STORAGE_KEY);
    if (raw == null) return;
    try {
      const parsed = JSON.parse(raw);
      if (typeOf(parsed) !== "object" || parsed.schema !== SCHEMA || checkDespensaList(parsed.items) !== null) throw new Error("bad state");
      items = parsed.items;
    } catch {
      loadError = LOAD_ERROR;
      if (storage.getItem(BACKUP_KEY) == null) storage.setItem(BACKUP_KEY, raw);
    }
  }
  load();

  // Writes the candidate list; keeps the previous list if the browser refuses.
  function commit(next) {
    storage.setItem(STORAGE_KEY, JSON.stringify({ schema: SCHEMA, items: next }));
    items = next;
  }

  const extras = (input) => ({ quantity: str(input && input.quantity), note: str(input && input.note) });

  function add(entry) {
    const item = { id: id(), ...entry, toBuy: false };
    commit([...clone(items), item]);
    return { ok: true, value: clone(item), errors: [] };
  }

  return {
    loadError: () => loadError,
    items: () => clone(items),
    /** Reads storage again (after a restore was rolled back). */
    reload: load,

    /** Adds a cell of the pauta's table, with the pauta's own words. */
    addFromPauta(option, input) {
      const o = option || {};
      if (!isPautaItem(o.group, o.column, o.name)) return fail("pauta", MSG_PICK);
      return add({ source: "pauta", group: o.group, column: o.column, name: o.name, ...extras(input) });
    },

    /** Adds what the person typed. It always goes to «Otros». */
    addTyped(input) {
      const name = str(input && input.name);
      if (!name) return fail("name", MSG_NAME);
      return add({ source: "otro", group: "", column: "", name, ...extras(input) });
    },

    /** Changes quantity and note; a typed item can also be renamed. A pauta item keeps the pauta's words. */
    update(itemId, input) {
      const i = items.findIndex((x) => x.id === itemId);
      if (i < 0) return fail("", MSG_GONE);
      const next = clone(items);
      const item = { ...next[i], ...extras(input) };
      if (item.source === "otro") {
        const name = str(input && input.name);
        if (!name) return fail("name", MSG_NAME);
        item.name = name;
      }
      next[i] = item;
      commit(next);
      return { ok: true, value: clone(item), errors: [] };
    },

    setToBuy(itemId, toBuy) {
      const i = items.findIndex((x) => x.id === itemId);
      if (i < 0) return false;
      const next = clone(items);
      next[i].toBuy = Boolean(toBuy);
      commit(next);
      return true;
    },

    /** Removes an item. Returns { item, index } for undo, or null. */
    remove(itemId) {
      const index = items.findIndex((x) => x.id === itemId);
      if (index < 0) return null;
      const item = clone(items[index]);
      commit(clone(items).filter((x) => x.id !== itemId));
      return { item, index };
    },

    /** Puts a removed item back where it was. */
    undoRemove(removed) {
      if (!removed || !removed.item || items.some((x) => x.id === removed.item.id)) return false;
      const next = clone(items);
      next.splice(Math.min(Math.max(0, removed.index), next.length), 0, clone(removed.item));
      commit(next);
      return true;
    },

    /** Replaces the whole despensa with an already exported list (Restaurar). */
    replaceAll(list) {
      const err = checkDespensaList(list);
      if (err) return { ok: false, error: err };
      commit(clone(list));
      return { ok: true };
    },
  };
}

// --- Wording -----------------------------------------------------------------------

// Every sentence the screen writes from script. despensa.js uses only these, so the
// wording tests see everything the person can read.
export const TEXT = {
  formNew: "Agregar a mi despensa",
  formEdit: "Cambiar este alimento",
  saveNew: "Guardar en mi despensa",
  saveEdit: "Guardar cambios",
  pickOther: "Elegir otro",
  cancelEdit: "Cancelar cambios",
  fromPauta: "De tu pauta",
  typed: "Escrito por ti",
  addTyped: (name) => `Agregar «${name}» tal como lo escribiste`,
  pick: "Elegir",
  noMatch: "Ningún alimento de tu pauta tiene esas palabras. Puedes agregarlo tal como lo escribiste.",
  matches: (n) => (n === 1 ? "Un alimento de tu pauta tiene esas palabras." : `${n} alimentos de tu pauta tienen esas palabras.`),
  quantity: "Cantidad",
  note: "Nota",
  inShopping: "En la lista para comprar.",
  toBuy: "Se acabó / comprar",
  bought: "Ya lo compré",
  edit: "Editar",
  remove: "Quitar",
  emptyGroup: "Todavía no hay nada anotado aquí.",
  emptyShopping: "No hay nada para comprar. Marca «Se acabó / comprar» en lo que haga falta.",
  added: (name) => `Agregado a tu despensa: ${name}.`,
  saved: (name) => `Cambios guardados: ${name}.`,
  removed: (name) => `Se quitó de tu despensa: ${name}.`,
  restored: (name) => `Volvió a tu despensa: ${name}.`,
  markedToBuy: (name) => `Anotado para comprar: ${name}.`,
  unmarked: (name) => `Ya no está para comprar: ${name}.`,
  saveFailed: "No se pudo guardar: el teléfono no tiene espacio o no permite guardar. Tu despensa sigue igual.",
  noStorage: "Este navegador no deja guardar. Lo que anotes se perderá al cerrar la página.",
};

const sample = (v) => (typeof v === "function" ? v(2) : v);
export const UI_COPY = [
  COLUMNS.preferir, COLUMNS.limitar, OTHERS_HEADING,
  MSG_PICK, MSG_NAME, MSG_GONE, LOAD_ERROR,
  ...Object.values(TEXT).map(sample),
  TEXT.matches(1),
];
