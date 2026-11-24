// Mis anotaciones: DOM layer. All logic lives in registro-core.js.
// Data stays in this phone's localStorage. Nothing is sent anywhere.
import {
  createStore, orderControles, groupDiarioByDay, orderMediciones, orderPreguntas,
  buildReport, controlToIcs, icsFilename, formatDate, formatTimestamp, isoDate, addDays,
  isValidDate, CONTROL_KINDS, restoreAll,
} from "./registro-core.js";
import { createDespensaStore, groupItems, COLUMNS, OTHERS_HEADING } from "./despensa-core.js";

const $ = (id) => document.getElementById(id);
const DASH = "—";

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
  storage.setItem("registro-prueba", "1");
  storage.removeItem("registro-prueba");
} catch {
  storage = memoryStorage();
  storageWarning = "Este navegador no deja guardar anotaciones. Lo que anotes se perderá al cerrar la página.";
}

const store = createStore(storage);
// «Mi despensa» travels in the same file; its items stay in their own store.
const despensa = createDespensaStore(storage);

if (navigator.storage && typeof navigator.storage.persist === "function") {
  navigator.storage.persist().catch(() => { /* not granted: data stays, may be evicted */ });
}

const SAVE_FAILED = "No se pudo guardar: el teléfono no tiene espacio o no permite guardar. Tus anotaciones anteriores siguen igual.";

/** Runs a storage write; reports a failure instead of throwing. */
function safely(fn, errorBox) {
  try {
    return fn();
  } catch {
    showErrors(errorBox, [{ message: SAVE_FAILED }]);
    return null;
  }
}

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
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const show = (v) => (v == null || v === "" ? DASH : v);
const dateAndTime = (e) => (e.time ? `${formatDate(e.date)}, ${e.time}` : formatDate(e.date));
const kindLabel = (c) => CONTROL_KINDS[c.kind] || "Control";
const weightText = (w) => (w == null ? DASH : `${w} kg`);
const pressureText = (m) => (m.systolic == null ? DASH : `${m.systolic} / ${m.diastolic}`);

/** Replaces a node's children; accepts nested arrays and skips empty values. */
function put(target, ...children) {
  target.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false && c !== ""));
}

function showErrors(box, errors) {
  box.replaceChildren();
  if (!errors.length) return;
  box.append(
    el("p", { class: "lead" }, "Revisa lo siguiente:"),
    el("ul", null, errors.map((e) => el("li", null, e.message))),
  );
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const today = () => isoDate(new Date());

// --- Forms ---------------------------------------------------------------------

/** Wires one entry form (add and edit) to the store. */
function bindForm(kind, defaults) {
  const form = $(`f-${kind}`);
  const errorBox = $(`e-${kind}`);
  const status = form.querySelector(".status");
  const title = form.querySelector("h3");
  const submit = form.querySelector("button[type=submit]");
  const cancel = form.querySelector(".cancel");
  let editing = null;

  function fields() {
    return [...form.elements].filter((f) => f.name);
  }

  function read() {
    const data = {};
    for (const f of fields()) {
      if (f.type === "radio") { if (f.checked) data[f.name] = f.value; }
      else if (!(f.name in data)) data[f.name] = f.value;
    }
    for (const f of fields()) if (!(f.name in data)) data[f.name] = "";
    return data;
  }

  function fill(values) {
    for (const f of fields()) {
      const v = values[f.name];
      if (f.type === "radio") f.checked = f.value === v;
      else f.value = v == null ? "" : v;
    }
  }

  function clearInvalid() {
    for (const f of fields()) f.removeAttribute("aria-invalid");
  }

  function setMode(id) {
    editing = id;
    title.textContent = id ? title.dataset.edit : title.dataset.new;
    submit.textContent = id ? submit.dataset.edit : submit.dataset.new;
    cancel.hidden = !id;
  }

  function reset() {
    form.reset();
    fill(defaults());
    clearInvalid();
    showErrors(errorBox, []);
    setMode(null);
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    status.textContent = "";
    clearInvalid();
    const input = read();
    const result = safely(() => (editing ? store.update(kind, editing, input) : store.add(kind, input)), errorBox);
    if (!result) return;
    if (!result.ok) {
      showErrors(errorBox, result.errors);
      let first = null;
      for (const e of result.errors) {
        const f = fields().find((x) => x.name === e.field);
        if (f) { f.setAttribute("aria-invalid", "true"); first = first || f; }
      }
      (first || errorBox).focus?.();
      return;
    }
    const wasEditing = Boolean(editing);
    reset();
    status.textContent = wasEditing ? "Cambios guardados." : "Guardado.";
    renderAll();
  });

  cancel.addEventListener("click", () => { reset(); status.textContent = ""; });

  reset();
  return {
    edit(entry) {
      reset();
      status.textContent = "";
      fill(entry);
      setMode(entry.id);
      form.scrollIntoView({ block: "start" });
      fields()[0].focus({ preventScroll: true });
    },
    isEditing: (id) => editing === id,
    reset,
  };
}

const forms = {
  controles: bindForm("controles", () => ({ kind: "control" })),
  diario: bindForm("diario", () => ({ date: today() })),
  mediciones: bindForm("mediciones", () => ({ date: today() })),
  preguntas: bindForm("preguntas", () => ({})),
};

function removeEntry(kind, entry, question) {
  if (!window.confirm(question)) return;
  const done = safely(() => store.remove(kind, entry.id), $(`e-${kind}`));
  if (done) {
    if (forms[kind].isEditing(entry.id)) forms[kind].reset();
    $(`f-${kind}`).querySelector(".status").textContent = "Anotación borrada.";
    renderAll();
  }
}

function entryActions(kind, entry, question, extra = []) {
  return el("div", { class: "actions" },
    extra,
    el("button", { type: "button", class: "btn", onclick: () => forms[kind].edit(entry) }, "Editar"),
    el("button", { type: "button", class: "btn", onclick: () => removeEntry(kind, entry, question) }, "Borrar"),
  );
}

const empty = (text) => el("p", { class: "empty" }, text);

// --- Lists -----------------------------------------------------------------------

function controlCard(c, { editable, upcoming, lvl }) {
  const calendar = upcoming && el("button", {
    type: "button", class: "btn",
    onclick: () => download(icsFilename(c), controlToIcs(c, new Date()), "text/calendar;charset=utf-8"),
  }, "Agregar a mi calendario");
  return el("article", { class: "card entry" },
    el(`h${lvl + 1}`, null, `${kindLabel(c)}: ${dateAndTime(c)}`),
    c.where && el("p", null, `Con quién o dónde: ${c.where}`),
    c.notes && el("p", null, `Notas: ${c.notes}`),
    c.bring && el("p", null, `Qué llevar: ${c.bring}`),
    editable && entryActions("controles", c, `¿Borrar el ${kindLabel(c).toLowerCase()} del ${formatDate(c.date)}? No se puede deshacer.`, [calendar]),
  );
}

function renderControles(target, data, editable, lvl = 3) {
  const { upcoming, past } = orderControles(data.controles, today());
  put(target,
    el(`h${lvl}`, null, "Próximos"),
    upcoming.length ? upcoming.map((c) => controlCard(c, { editable, upcoming: true, lvl })) : empty("No hay próximos controles anotados."),
    el(`h${lvl}`, null, "Anteriores"),
    past.length ? past.map((c) => controlCard(c, { editable, upcoming: false, lvl })) : empty("No hay controles anteriores anotados."),
  );
}

function renderDiario(target, data, editable, lvl = 3) {
  const groups = groupDiarioByDay(data.diario);
  put(target, ...(groups.length ? groups.map((g) => el("div", null,
    el(`h${lvl}`, null, formatDate(g.date)),
    g.entries.map((e) => el("article", { class: "card entry" },
      el(`h${lvl + 1}`, null, e.meal),
      el("p", null, e.text),
      editable && entryActions("diario", e, `¿Borrar la anotación de ${e.meal.toLowerCase()} del ${formatDate(e.date)}? No se puede deshacer.`),
    )),
  )) : [empty("Todavía no hay comidas anotadas.")]));
}

function renderMediciones(target, data, editable, lvl = 3) {
  const list = orderMediciones(data.mediciones);
  put(target, ...(list.length ? list.map((m) => el("article", { class: "card entry" },
    el(`h${lvl + 1}`, null, dateAndTime(m)),
    el("p", null, `Presión: ${pressureText(m)}`),
    el("p", null, `Peso: ${weightText(m.weight)}`),
    editable && entryActions("mediciones", m, `¿Borrar la anotación del ${formatDate(m.date)}? No se puede deshacer.`),
  )) : [empty("Todavía no hay presión ni peso anotados.")]));
}

function questionCard(q, editable) {
  const id = `ya-${q.id}`;
  return el("article", { class: "card entry" },
    el("p", null, q.text),
    el("p", { class: "small" }, `Anotada el ${formatDate(q.addedOn)}`),
    editable
      ? el("div", { class: "check" },
        el("input", {
          type: "checkbox", id, checked: q.asked,
          onchange: (ev) => {
            if (safely(() => store.setAsked(q.id, ev.target.checked), $("e-preguntas"))) renderAll(id);
            else ev.target.checked = q.asked;
          },
        }),
        el("label", { for: id }, "Ya la pregunté"))
      : el("p", null, q.asked ? "Ya preguntada." : "Por preguntar."),
    editable && entryActions("preguntas", q, "¿Borrar esta pregunta? No se puede deshacer."),
  );
}

function renderPreguntas(target, data, editable, lvl = 3) {
  const list = orderPreguntas(data.preguntas);
  const pending = list.filter((q) => !q.asked);
  const asked = list.filter((q) => q.asked);
  put(target,
    el(`h${lvl}`, null, "Por preguntar"),
    pending.length ? pending.map((q) => questionCard(q, editable)) : empty("No hay preguntas pendientes."),
    el(`h${lvl}`, null, "Ya preguntadas"),
    asked.length ? asked.map((q) => questionCard(q, editable)) : empty("Ninguna todavía."),
  );
}

// --- Doctor's sheet ----------------------------------------------------------------

function controlLine(c) {
  return el("li", null,
    `${kindLabel(c)}: ${dateAndTime(c)}`,
    c.where && `. Con quién o dónde: ${c.where}`,
    c.notes && `. Notas: ${c.notes}`,
    c.bring && `. Qué llevar: ${c.bring}`,
  );
}

const TABLE_HEADS = ["Fecha", "Hora", "Presión, número de arriba", "Presión, número de abajo", "Peso (kg)"];

// On a narrow screen the CSS stacks each row as a small card. The explicit
// roles keep it a table for screen readers; data-label names each value.
function measurementsTable(list) {
  if (!list.length) return empty("Sin anotaciones en este período.");
  const cell = (i, value) => el("td", { role: "cell", "data-label": i ? TABLE_HEADS[i] : null }, value);
  return el("table", { role: "table" },
    el("thead", { role: "rowgroup" }, el("tr", { role: "row" },
      TABLE_HEADS.map((h) => el("th", { scope: "col", role: "columnheader" }, h)))),
    el("tbody", { role: "rowgroup" }, list.map((m) => el("tr", { role: "row" },
      cell(0, formatDate(m.date)), cell(1, show(m.time)),
      cell(2, show(m.systolic)), cell(3, show(m.diastolic)), cell(4, show(m.weight))))),
  );
}

function renderReport(target, report) {
  put(target,
    el("h3", null, "Mis anotaciones para el control"),
    el("p", { class: "lead" }, "Anotado por la persona. Esta página no interpreta estos datos."),
    el("p", null, `Período: del ${formatDate(report.from)} al ${formatDate(report.to)}.`),

    el("h4", null, "Diario del período elegido"),
    report.diario.length
      ? report.diario.map((g) => el("div", null,
        el("h5", null, formatDate(g.date)),
        el("ul", null, g.entries.map((e) => el("li", null, `${e.meal}: ${e.text}`)))))
      : empty("Sin anotaciones en este período."),

    el("h4", null, "Controles y exámenes"),
    el("h5", null, "En el período"),
    report.controles.enPeriodo.length ? el("ul", null, report.controles.enPeriodo.map(controlLine)) : empty("Ninguno anotado."),
    el("h5", null, "Próximos"),
    report.controles.proximos.length ? el("ul", null, report.controles.proximos.map(controlLine)) : empty("Ninguno anotado."),

    el("h4", null, "Preguntas para el control"),
    report.preguntas.length
      ? el("ul", null, report.preguntas.map((q) => el("li", null, `${q.text} (anotada el ${formatDate(q.addedOn)})`)))
      : empty("No hay preguntas pendientes."),

    el("h4", null, "Presión y peso anotados"),
    measurementsTable(report.mediciones),
  );
}

function initPeriod() {
  const t = today();
  $("p-to").value = t;
  $("p-from").value = addDays(t, -30);
  $("f-periodo").addEventListener("input", renderSheet);
  $("f-periodo").addEventListener("submit", (ev) => { ev.preventDefault(); renderSheet(); });
  $("imprimir").addEventListener("click", () => { if (renderSheet()) window.print(); });
}

function renderSheet() {
  const from = $("p-from").value;
  const to = $("p-to").value;
  const errors = [];
  if (!isValidDate(from)) errors.push({ field: "from", message: "Escribe la fecha «Desde»." });
  if (!isValidDate(to)) errors.push({ field: "to", message: "Escribe la fecha «Hasta»." });
  if (!errors.length && from > to) errors.push({ field: "from", message: "La fecha «Desde» tiene que ser anterior o igual a «Hasta»." });
  showErrors($("e-periodo"), errors);
  for (const field of ["from", "to"]) {
    const input = $(`p-${field}`);
    if (errors.some((e) => e.field === field)) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  if (errors.length) { $("hoja").replaceChildren(); return false; }
  renderReport($("hoja"), buildReport(store.getData(), { from, to, today: today() }));
  return true;
}

// --- Share with the family member -----------------------------------------------------

function renderLastExport() {
  const at = store.lastExportAt();
  $("ultima-copia").textContent = `Última copia: ${at ? formatTimestamp(at) : "Nunca"}`;
}

async function exportar() {
  const status = $("estado-exportar");
  status.textContent = "";
  const { filename, text } = store.exportFile({ despensa: despensa.items() });
  let shared = false;
  try {
    const file = new File([text], filename, { type: "application/json" });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Mis anotaciones" });
      shared = true;
    }
  } catch (e) {
    if (e && e.name === "AbortError") { status.textContent = "No se compartió la copia."; return; }
  }
  if (!shared) download(filename, text, "application/json");
  safely(() => store.markExported(new Date()), $("e-archivo"));
  renderLastExport();
  status.textContent = shared
    ? `Copia compartida: ${filename}.`
    : `Copia descargada: ${filename}. Búscala en las descargas del teléfono para mandarla.`;
}

let pending = null;

function hideChoice() {
  pending = null;
  $("eleccion").hidden = true;
}

async function abrirArchivo() {
  const input = $("archivo");
  const file = input.files && input.files[0];
  input.value = "";
  $("estado-archivo").textContent = "";
  showErrors($("e-archivo"), []);
  hideChoice();
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    showErrors($("e-archivo"), [{ message: "El archivo no se pudo leer. No se cambió nada en este teléfono." }]);
    return;
  }
  const r = store.readImport(text);
  if (!r.ok) { showErrors($("e-archivo"), [{ message: r.error }]); return; }
  pending = r.payload;
  $("eleccion-texto").textContent = `El archivo se abrió bien. Fue exportado el ${formatTimestamp(pending.exportedAt)}. ¿Qué quieres hacer?`;
  $("eleccion").hidden = false;
  $("solo-ver").focus();
}

function soloVer() {
  if (!pending) return;
  const payload = pending;
  if (safely(() => { store.receive(payload); return true; }, $("e-archivo"))) {
    hideChoice();
    renderReceived();
    $("estado-archivo").textContent = "Copia guardada aparte. Tus propias anotaciones no cambiaron.";
    $("recibida").focus();
  }
}

function restaurar() {
  if (!pending) return;
  const payload = pending;
  const withPantry = Array.isArray(payload.data.despensa);
  const what = withPantry ? "todas las anotaciones y la despensa" : "todas las anotaciones";
  const ok = window.confirm(`Esto reemplaza ${what} de este teléfono por las del archivo exportado el ${formatTimestamp(payload.exportedAt)}. Lo que hay ahora se pierde. ¿Reemplazar?`);
  if (!ok) return;
  const result = restoreAll(store, despensa, payload, storage);
  if (!result.ok) {
    renderAll();
    showErrors($("e-archivo"), [{ message: result.error }]);
    return;
  }
  hideChoice();
  for (const f of Object.values(forms)) f.reset();
  renderAll();
  $("estado-archivo").textContent = withPantry
    ? "Listo: las anotaciones y la despensa del archivo quedaron en este teléfono."
    : "Listo: las anotaciones del archivo quedaron en este teléfono. La despensa de este teléfono no cambió.";
}

function renderReceived() {
  const copy = store.received();
  const box = $("recibida");
  $("aviso-recibida").hidden = !copy;
  box.hidden = !copy;
  if (!copy) { $("recibida-contenido").replaceChildren(); return; }
  $("recibida-banner").textContent = `Copia recibida, exportada el ${formatTimestamp(copy.exportedAt)}. Solo se puede ver: aquí no se cambia nada.`;
  const parts = { controles: el("div"), diario: el("div"), mediciones: el("div"), preguntas: el("div") };
  renderControles(parts.controles, copy.data, false, 4);
  renderDiario(parts.diario, copy.data, false, 4);
  renderMediciones(parts.mediciones, copy.data, false, 4);
  renderPreguntas(parts.preguntas, copy.data, false, 4);
  put($("recibida-contenido"),
    el("h3", null, "Controles y exámenes"), parts.controles,
    el("h3", null, "Diario"), parts.diario,
    el("h3", null, "Presión y peso anotados"), parts.mediciones,
    el("h3", null, "Preguntas para el control"), parts.preguntas,
    Array.isArray(copy.data.despensa) && [el("h3", null, "Despensa"), receivedPantry(copy.data.despensa)],
  );
}

/** The received despensa, read only, grouped by the pauta's table exactly as on its own page. */
function receivedPantry(items) {
  if (!items.length) return empty("Todavía no hay nada anotado en la despensa.");
  const line = (i) => el("li", null, i.name,
    i.quantity && `. Cantidad: ${i.quantity}`,
    i.note && `. Nota: ${i.note}`,
    i.toBuy && ". Para comprar.");
  const g = groupItems(items);
  const column = (key) => (g[key].length ? [
    el("h4", null, COLUMNS[key]),
    g[key].map((x) => el("div", null, el("h5", null, x.group), el("ul", null, x.items.map(line)))),
  ] : null);
  // el() flattens one level only, so the nested parts are flattened here.
  return el("div", null, [
    column("preferir"),
    column("limitar"),
    g.otros.length ? [el("h4", null, OTHERS_HEADING), el("ul", null, g.otros.map(line))] : null,
  ].flat(Infinity));
}

function borrarRecibida() {
  if (!window.confirm("¿Borrar la copia recibida? Tus propias anotaciones no se tocan.")) return;
  store.clearReceived();
  renderReceived();
  $("estado-archivo").textContent = "Copia recibida borrada.";
}

// --- Hub: what comes next, only as recorded ---------------------------------------------

function renderNext(data) {
  const { upcoming } = orderControles(data.controles, today());
  const days = groupDiarioByDay(data.diario);
  const box = $("proximo");
  if (!upcoming.length && !days.length) { box.hidden = true; return; }
  const c = upcoming[0];
  $("proximo-control").textContent = c
    ? `${kindLabel(c)}: ${dateAndTime(c)}${c.where ? `. ${c.where}` : ""}`
    : "No hay próximos controles anotados.";
  $("proximo-diario").textContent = days.length
    ? `Última anotación en tu diario: ${formatDate(days[0].date)}.`
    : "Todavía no hay comidas anotadas.";
  box.hidden = false;
}

// --- Start --------------------------------------------------------------------------

function renderAll(focusId) {
  const data = store.getData();
  renderControles($("lista-controles"), data, true);
  renderDiario($("lista-diario"), data, true);
  renderMediciones($("lista-mediciones"), data, true);
  renderPreguntas($("lista-preguntas"), data, true);
  renderNext(data);
  renderSheet();
  renderLastExport();
  if (typeof focusId === "string" && $(focusId)) $(focusId).focus();
}

const warnings = [storageWarning, store.loadError(), despensa.loadError()].filter(Boolean);
showErrors($("avisos"), warnings.map((message) => ({ message })));

initPeriod();
$("exportar").addEventListener("click", exportar);
$("archivo").addEventListener("change", abrirArchivo);
$("solo-ver").addEventListener("click", soloVer);
$("restaurar").addEventListener("click", restaurar);
$("cancelar-archivo").addEventListener("click", () => { hideChoice(); $("estado-archivo").textContent = "No se abrió el archivo."; });
$("borrar-recibida").addEventListener("click", borrarRecibida);
renderAll();
renderReceived();
