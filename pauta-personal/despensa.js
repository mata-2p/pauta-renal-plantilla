// Mi despensa: DOM layer. All logic lives in despensa-core.js.
// Data stays in this phone's localStorage. Nothing is sent anywhere.
import {
  createDespensaStore, pautaGroups, searchPauta, groupItems, shoppingList,
  COLUMNS, COLUMN_KEYS, OTHERS_HEADING, TEXT, isPautaItem,
} from "./despensa-core.js";

const $ = (id) => document.getElementById(id);

// --- Storage ------------------------------------------------------------------

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

let storage;
let storageWarning = "";
try {
  storage = window.localStorage;
  storage.setItem("despensa-prueba", "1");
  storage.removeItem("despensa-prueba");
} catch {
  storage = memoryStorage();
  storageWarning = TEXT.noStorage;
}

const store = createDespensaStore(storage);

// --- Small DOM helpers -----------------------------------------------------------

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k in node && k !== "list") node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === "") continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const sr = (text) => el("span", { class: "sr" }, text);

function showErrors(box, messages) {
  box.replaceChildren();
  if (!messages.length) return;
  box.append(el("ul", null, messages.map((m) => el("li", null, m))));
}

/** Runs a storage write; reports a failure instead of throwing. */
function safely(fn) {
  try {
    return fn();
  } catch {
    announce(TEXT.saveFailed);
    return null;
  }
}

// The pauta's group is named only for an exact cell of the table, as groupItems does.
const where = (item) => (isPautaItem(item.group, item.column, item.name) ? `${item.group}, ${COLUMNS[item.column]}` : OTHERS_HEADING);

// --- Live region and undo ------------------------------------------------------------

let lastRemoved = null;

function announce(text, { undo = false } = {}) {
  $("cambios").hidden = false;
  // Clearing first makes screen readers repeat an identical message.
  $("estado").textContent = "";
  requestAnimationFrame(() => { $("estado").textContent = text; });
  $("deshacer").hidden = !undo;
  if (!undo) lastRemoved = null;
}

// --- The form: pick from the pauta, or keep what was typed --------------------------

const form = $("f-despensa");
const search = $("buscar");
let choice = null; // { source: "pauta", group, column, name } | { source: "otro" }
let editing = null; // item id

function optionButton(o) {
  return el("li", null, el("button", {
    type: "button", class: "btn opt",
    onclick: () => choose({ source: "pauta", ...o }),
  },
  sr(`${TEXT.pick}: `),
  el("span", { class: "opt-name" }, o.name),
  el("span", { class: "opt-where" }, `${o.group} · ${COLUMNS[o.column]}`)));
}

function renderResults() {
  const q = search.value.trim();
  const box = $("resultados");
  if (!q) { box.replaceChildren(); $("estado-busqueda").textContent = ""; return; }
  const found = searchPauta(q);
  box.replaceChildren(
    found.length ? el("ul", { class: "opt-list", "aria-label": TEXT.fromPauta }, found.map(optionButton)) : el("p", { class: "empty" }, TEXT.noMatch),
    el("button", { type: "button", class: "btn opt typed", onclick: () => choose({ source: "otro" }) }, TEXT.addTyped(q)),
  );
  $("estado-busqueda").textContent = found.length ? TEXT.matches(found.length) : TEXT.noMatch;
}

function renderFullTable() {
  $("tabla-completa").replaceChildren(...pautaGroups().map((g) => el("div", { class: "tabla-g" },
    el("h3", null, g.group),
    COLUMN_KEYS.map((column) => [
      el("p", { class: `tabla-col ${column}` }, COLUMNS[column]),
      el("ul", { class: "opt-list" }, g[column].items.map((name) => optionButton({ group: g.group, column, name }))),
    ]),
  )));
}

function setStep(detail) {
  $("paso-buscar").hidden = detail;
  $("paso-detalle").hidden = !detail;
}

function choose(c) {
  choice = c;
  editing = null;
  showErrors($("e-despensa"), []);
  $("nombre").removeAttribute("aria-invalid");
  $("cantidad").value = "";
  $("nota").value = "";
  showChoice(c.source === "pauta" ? c : { source: "otro", name: search.value.trim() });
  $("h-f-despensa").textContent = TEXT.formNew;
  $("guardar").textContent = TEXT.saveNew;
  $("volver-buscar").textContent = TEXT.pickOther;
  setStep(true);
  (c.source === "pauta" ? $("cantidad") : $("nombre")).focus();
}

function showChoice(item) {
  const fromPauta = item.source === "pauta";
  $("origen").textContent = fromPauta ? `${TEXT.fromPauta} · ${item.group} · ${COLUMNS[item.column]}` : `${TEXT.typed} · ${OTHERS_HEADING}`;
  $("elegido").textContent = fromPauta ? item.name : "";
  $("elegido").hidden = !fromPauta;
  $("campo-nombre").hidden = fromPauta;
  if (!fromPauta) $("nombre").value = item.name;
}

function resetForm() {
  choice = null;
  editing = null;
  form.reset();
  showErrors($("e-despensa"), []);
  $("nombre").removeAttribute("aria-invalid");
  $("h-f-despensa").textContent = TEXT.formNew;
  setStep(false);
  renderResults();
}

function startEdit(item) {
  resetForm();
  editing = item.id;
  showChoice(item);
  $("cantidad").value = item.quantity;
  $("nota").value = item.note;
  $("h-f-despensa").textContent = TEXT.formEdit;
  $("guardar").textContent = TEXT.saveEdit;
  $("volver-buscar").textContent = TEXT.cancelEdit;
  setStep(true);
  form.scrollIntoView({ block: "start" });
  (item.source === "pauta" ? $("cantidad") : $("nombre")).focus({ preventScroll: true });
}

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (!choice && !editing) { renderResults(); return; }
  const input = { name: $("nombre").value, quantity: $("cantidad").value, note: $("nota").value };
  const result = safely(() => {
    if (editing) return store.update(editing, input);
    return choice.source === "pauta" ? store.addFromPauta(choice, input) : store.addTyped(input);
  });
  if (!result) return;
  if (!result.ok) {
    showErrors($("e-despensa"), result.errors.map((e) => e.message));
    if (result.errors.some((e) => e.field === "name")) {
      $("nombre").setAttribute("aria-invalid", "true");
      $("nombre").focus();
    }
    return;
  }
  const wasEditing = Boolean(editing);
  const item = result.value;
  search.value = "";
  resetForm();
  render();
  announce(wasEditing ? TEXT.saved(`${item.name} (${where(item)})`) : TEXT.added(`${item.name} (${where(item)})`));
  if (wasEditing) focusItem(item.id, "edit");
  else search.focus();
});

$("volver-buscar").addEventListener("click", () => {
  const id = editing;
  resetForm();
  if (id) focusItem(id, "edit");
  else search.focus();
});

search.addEventListener("input", renderResults);
search.addEventListener("keydown", (ev) => {
  // Enter does not save anything by itself: picking is always explicit.
  if (ev.key === "Enter") ev.preventDefault();
});

// --- The lists -----------------------------------------------------------------------

function focusItem(id, action) {
  const target = document.querySelector(`[data-item="${CSS.escape(id)}"][data-action="${action}"]`);
  if (target) target.focus();
}

function toggleBuy(item) {
  const next = !item.toBuy;
  if (!safely(() => store.setToBuy(item.id, next))) return;
  render();
  announce(next ? TEXT.markedToBuy(item.name) : TEXT.unmarked(item.name));
  focusItem(item.id, "buy");
}

function removeItem(item) {
  const removed = safely(() => store.remove(item.id));
  if (!removed) return;
  if (editing === item.id) resetForm();
  render();
  announce(TEXT.removed(item.name), { undo: true });
  lastRemoved = removed;
  $("deshacer").focus();
}

$("deshacer").addEventListener("click", () => {
  const removed = lastRemoved;
  if (!removed) return;
  if (!safely(() => store.undoRemove(removed))) return;
  render();
  announce(TEXT.restored(removed.item.name));
  focusItem(removed.item.id, "buy");
});

function itemCard(item, level) {
  return el("article", { class: "card entry item" },
    el(`h${level}`, null, item.name),
    item.quantity && el("p", null, `${TEXT.quantity}: ${item.quantity}`),
    item.note && el("p", null, `${TEXT.note}: ${item.note}`),
    item.toBuy && el("p", { class: "in-shop" }, TEXT.inShopping),
    el("div", { class: "actions" },
      el("button", {
        type: "button", class: "btn toggle", "aria-pressed": String(item.toBuy),
        "data-item": item.id, "data-action": "buy", onclick: () => toggleBuy(item),
      }, TEXT.toBuy, sr(`: ${item.name}`)),
      el("button", { type: "button", class: "btn", "data-item": item.id, "data-action": "edit", onclick: () => startEdit(item) },
        TEXT.edit, sr(`: ${item.name}`)),
      el("button", { type: "button", class: "btn", "data-item": item.id, "data-action": "remove", onclick: () => removeItem(item) },
        TEXT.remove, sr(`: ${item.name}`)),
    ),
  );
}

const empty = (text) => el("p", { class: "empty" }, text);

function renderColumn(target, groups) {
  target.replaceChildren(...(groups.length
    ? groups.map((g) => el("div", { class: "pgroup" }, el("h4", null, g.group), g.items.map((i) => itemCard(i, 5))))
    : [empty(TEXT.emptyGroup)]));
}

function renderShopping(items) {
  const list = shoppingList(items);
  $("lista-comprar").replaceChildren(...(list.length
    ? list.map((item) => el("li", { class: "card entry" },
      el("p", { class: "shop-name" }, item.name),
      el("p", { class: "small" }, isPautaItem(item.group, item.column, item.name) ? item.group : OTHERS_HEADING),
      item.quantity && el("p", null, `${TEXT.quantity}: ${item.quantity}`),
      item.note && el("p", null, `${TEXT.note}: ${item.note}`),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "btn", "data-item": item.id, "data-action": "bought", onclick: () => {
          if (!safely(() => store.setToBuy(item.id, false))) return;
          render();
          announce(TEXT.unmarked(item.name));
          const next = document.querySelector("#lista-comprar [data-action=bought]");
          (next || $("t-comprar")).focus();
        } }, TEXT.bought, sr(`: ${item.name}`)),
      ),
    ))
    : [el("li", { class: "empty" }, TEXT.emptyShopping)]));
}

function render() {
  const items = store.items();
  const g = groupItems(items);
  renderColumn($("lista-preferir"), g.preferir);
  renderColumn($("lista-limitar"), g.limitar);
  $("lista-otros").replaceChildren(...(g.otros.length ? g.otros.map((i) => itemCard(i, 4)) : [empty(TEXT.emptyGroup)]));
  renderShopping(items);
}

// --- Start --------------------------------------------------------------------------

showErrors($("avisos"), [storageWarning, store.loadError()].filter(Boolean));
renderFullTable();
resetForm();
render();
