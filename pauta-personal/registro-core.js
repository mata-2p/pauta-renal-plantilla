// Mis anotaciones: pure logic, no DOM and no network.
// Everything the person writes is stored and shown exactly as typed. Nothing here
// compares a value against a limit, scores it or labels it.

// «Mi despensa» travels in the same file, as an optional list (files from before
// the despensa existed have none). Its own store keeps it apart from these notes.
import { checkDespensaList, STORAGE_KEY as DESPENSA_KEY } from "./despensa-core.js";

export const APP = "mi-pauta";
export const SCHEMA = 1;
export const STORAGE_KEY = "registro-v1";
export const RECEIVED_KEY = "registro-recibido-v1";
export const BACKUP_KEY = "registro-v1-respaldo";
export const KINDS = ["controles", "diario", "mediciones", "preguntas"];
// Optional block of the exported file, after the four kinds.
export const DESPENSA = "despensa";
// The pauta's meal times.
export const MEALS = ["Desayuno", "Almuerzo", "Once", "Cena", "Colación"];
export const CONTROL_KINDS = { control: "Control", examen: "Examen" };
const MAX_IMPORT_CHARS = 5_000_000;

// Field name -> accepted types, per kind. Used for strict import checks.
const SHAPES = {
  controles: { id: ["string"], date: ["string"], time: ["string"], kind: ["string"], where: ["string"], notes: ["string"], bring: ["string"] },
  diario: { id: ["string"], date: ["string"], meal: ["string"], text: ["string"] },
  mediciones: { id: ["string"], date: ["string"], time: ["string"], systolic: ["string", "null"], diastolic: ["string", "null"], weight: ["string", "null"] },
  preguntas: { id: ["string"], addedOn: ["string"], text: ["string"], asked: ["boolean"] },
};

// --- Dates -------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isValidDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTime(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** YYYY-MM-DD -> dd-mm-aaaa (Chilean display format). */
export function formatDate(iso) {
  if (!isValidDate(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/** ISO timestamp -> dd-mm-aaaa in local time. */
export function formatTimestamp(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : formatDate(isoDate(d));
}

// --- Validation --------------------------------------------------------------

const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

function checkDate(errors, date, message) {
  if (!date) errors.push({ field: "date", message });
  else if (!isValidDate(date)) errors.push({ field: "date", message: "La fecha no es válida." });
}

function checkTime(errors, time) {
  if (time && !isValidTime(time)) errors.push({ field: "time", message: "La hora no es válida. Escríbela como 09:30." });
}

const VALIDATORS = {
  controles(input) {
    const v = {
      date: str(input.date), time: str(input.time), kind: str(input.kind),
      where: str(input.where), notes: str(input.notes), bring: str(input.bring),
    };
    const errors = [];
    checkDate(errors, v.date, "Escribe la fecha del control o examen.");
    checkTime(errors, v.time);
    if (!(v.kind in CONTROL_KINDS)) errors.push({ field: "kind", message: "Elige si es un control o un examen." });
    return { v, errors };
  },
  diario(input) {
    const v = { date: str(input.date), meal: str(input.meal), text: str(input.text) };
    const errors = [];
    checkDate(errors, v.date, "Escribe la fecha.");
    if (!MEALS.includes(v.meal)) errors.push({ field: "meal", message: "Elige la comida: Desayuno, Almuerzo, Once, Cena o Colación." });
    if (!v.text) errors.push({ field: "text", message: "Escribe qué comió." });
    return { v, errors };
  },
  mediciones(input) {
    const sys = str(input.systolic);
    const dia = str(input.diastolic);
    const weight = str(input.weight);
    const v = { date: str(input.date), time: str(input.time), systolic: sys || null, diastolic: dia || null, weight: weight || null };
    const errors = [];
    checkDate(errors, v.date, "Escribe la fecha.");
    checkTime(errors, v.time);
    if (!sys && !dia && !weight) {
      errors.push({ field: "systolic", message: "Anota la presión, el peso o ambos." });
    } else {
      if (Boolean(sys) !== Boolean(dia)) {
        errors.push({ field: sys ? "diastolic" : "systolic", message: "Escribe los dos números de la presión: el de arriba y el de abajo." });
      }
      for (const [field, value] of [["systolic", sys], ["diastolic", dia]]) {
        if (value && !/^\d+$/.test(value)) {
          errors.push({ field, message: "La presión se escribe con números enteros, sin puntos ni comas." });
        }
      }
      if (weight && !/^\d+([.,]\d)?$/.test(weight)) {
        errors.push({ field: "weight", message: "El peso se escribe con números y como máximo un decimal, por ejemplo 72,5." });
      }
    }
    return { v, errors };
  },
  preguntas(input) {
    const v = { text: str(input.text) };
    const errors = [];
    if (!v.text) errors.push({ field: "text", message: "Escribe la pregunta." });
    return { v, errors };
  },
};

/** Validates form input for a kind. Returns { ok, value, errors }. */
export function validate(kind, input) {
  const fn = VALIDATORS[kind];
  if (!fn) throw new Error(`Unknown kind: ${kind}`);
  const { v, errors } = fn(input || {});
  return { ok: errors.length === 0, value: v, errors };
}

// --- Ordering and filtering ----------------------------------------------------

const when = (e) => `${e.date}T${e.time || "00:00"}`;

/** Upcoming (today included, soonest first), then past (most recent first). */
export function orderControles(list, today) {
  const upcoming = list.filter((c) => c.date >= today).sort((a, b) => when(a).localeCompare(when(b)));
  const past = list.filter((c) => c.date < today).sort((a, b) => when(b).localeCompare(when(a)));
  return { upcoming, past };
}

/** Diary grouped by day, newest day first; meals in the pauta's order. */
export function groupDiarioByDay(list) {
  const byDay = new Map();
  for (const e of list) {
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  }
  return [...byDay.keys()].sort().reverse().map((date) => ({
    date,
    entries: byDay.get(date).slice().sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal)),
  }));
}

/** Measurements, most recent first. */
export function orderMediciones(list) {
  return list.slice().sort((a, b) => when(b).localeCompare(when(a)));
}

/** Questions: pending first, then asked; each group by date added. */
export function orderPreguntas(list) {
  return list.slice().sort((a, b) => (a.asked === b.asked ? a.addedOn.localeCompare(b.addedOn) : a.asked ? 1 : -1));
}

/** Entries whose `field` date lies within [from, to], both inclusive. */
export function filterByPeriod(list, from, to, field = "date") {
  return list.filter((e) => e[field] >= from && e[field] <= to);
}

/** The doctor's sheet: only stored entries, no derived values. */
export function buildReport(data, { from, to, today }) {
  const enPeriodo = orderControles(filterByPeriod(data.controles, from, to), "0000-00-00").upcoming;
  const proximos = orderControles(data.controles.filter((c) => !enPeriodo.includes(c)), today).upcoming;
  return {
    from,
    to,
    diario: groupDiarioByDay(filterByPeriod(data.diario, from, to)),
    controles: { enPeriodo, proximos },
    preguntas: orderPreguntas(data.preguntas.filter((q) => !q.asked)),
    mediciones: orderMediciones(filterByPeriod(data.mediciones, from, to)),
  };
}

// --- Export / import -------------------------------------------------------------

export function emptyData() {
  return { controles: [], diario: [], mediciones: [], preguntas: [] };
}

export function buildExport(data, now = new Date()) {
  const payload = { app: APP, schema: SCHEMA, exportedAt: now.toISOString(), data: clone(data) };
  return { filename: `mis-anotaciones-${isoDate(now)}.json`, payload, text: JSON.stringify(payload, null, 2) };
}

const NOTHING_CHANGED = " No se cambió nada en este teléfono.";
const fail = (msg) => ({ ok: false, error: msg + NOTHING_CHANGED });
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const isPlainObject = (v) => typeOf(v) === "object";

function unknownKey(obj, allowed) {
  return Object.keys(obj).find((k) => !allowed.includes(k));
}

/** Strict validation of the data block. Returns an error string or null. */
function checkData(data) {
  if (!isPlainObject(data)) return "El archivo tiene un dato con un formato que no corresponde («data») y no se abrió.";
  const extra = unknownKey(data, [...KINDS, DESPENSA]);
  if (extra !== undefined) return `El archivo tiene un dato desconocido («${extra}») y no se abrió.`;
  if (DESPENSA in data) {
    const err = checkDespensaList(data[DESPENSA]);
    if (err) return err;
  }
  for (const kind of KINDS) {
    const list = data[kind];
    if (!Array.isArray(list)) return `El archivo tiene un dato con un formato que no corresponde («${kind}») y no se abrió.`;
    const ids = new Set();
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const where = `${kind}[${i}]`;
      if (!isPlainObject(e)) return `El archivo tiene un dato con un formato que no corresponde («${where}») y no se abrió.`;
      const shape = SHAPES[kind];
      const extraField = unknownKey(e, Object.keys(shape));
      if (extraField !== undefined) return `El archivo tiene un dato desconocido («${where}.${extraField}») y no se abrió.`;
      for (const [field, types] of Object.entries(shape)) {
        if (!(field in e) || !types.includes(typeOf(e[field]))) {
          return `El archivo tiene un dato con un formato que no corresponde («${where}.${field}») y no se abrió.`;
        }
      }
      if (!e.id || ids.has(e.id)) return `El archivo tiene una anotación repetida o sin identificador («${where}») y no se abrió.`;
      ids.add(e.id);
      const rule = kind === "preguntas"
        ? (isValidDate(e.addedOn) ? validate(kind, e) : { ok: false })
        : validate(kind, e);
      const asTyped = rule.ok && Object.entries(rule.value).every(([k, v]) => e[k] === v);
      if (!asTyped) return `El archivo tiene una anotación incompleta o con datos que no corresponden («${where}») y no se abrió.`;
    }
  }
  return null;
}

/** Parses and strictly validates an exported file. Never touches storage. */
export function parseImport(text) {
  if (typeof text !== "string" || text.length > MAX_IMPORT_CHARS) {
    return fail("El archivo no se pudo leer: es demasiado grande o está vacío.");
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return fail("El archivo no se pudo leer. Puede que no sea una copia de Mis anotaciones o que esté dañado.");
  }
  if (!isPlainObject(payload)) return fail("El archivo no se pudo leer. No tiene el formato de una copia de Mis anotaciones.");
  if (payload.app !== APP) return fail("Este archivo no es una copia de Mis anotaciones.");
  if (payload.schema !== SCHEMA) return fail("Este archivo es de otra versión de Mis anotaciones y no se puede abrir aquí.");
  const extra = unknownKey(payload, ["app", "schema", "exportedAt", "data"]);
  if (extra !== undefined) return fail(`El archivo tiene un dato desconocido («${extra}») y no se abrió.`);
  if (typeof payload.exportedAt !== "string" || Number.isNaN(new Date(payload.exportedAt).getTime())) {
    return fail("El archivo tiene un dato con un formato que no corresponde («exportedAt») y no se abrió.");
  }
  const err = checkData(payload.data);
  if (err) return fail(err);
  return { ok: true, payload };
}

// --- Calendar (.ics, RFC 5545) ---------------------------------------------------------

function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const icsStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Builds a one-event calendar file for a control or exam. */
export function controlToIcs(c, now = new Date()) {
  const day = c.date.replace(/-/g, "");
  const label = CONTROL_KINDS[c.kind] || "Control";
  const description = [c.notes && `Notas: ${c.notes}`, c.bring && `Qué llevar: ${c.bring}`].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//mi-pauta//Mis anotaciones//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${c.id}@mi-pauta`,
    `DTSTAMP:${icsStamp(now)}`,
  ];
  if (c.time) {
    lines.push(`DTSTART:${day}T${c.time.replace(":", "")}00`, "DURATION:PT1H");
  } else {
    lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${addDays(c.date, 1).replace(/-/g, "")}`);
  }
  lines.push(`SUMMARY:${icsEscape(c.where ? `${label}: ${c.where}` : label)}`);
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(`Mañana: ${label.toLowerCase()}`)}`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function icsFilename(c) {
  return `${c.kind === "examen" ? "examen" : "control"}-${c.date}.ics`;
}

// --- Restore: notes first, then the despensa; all or nothing -------------------------

export const RESTORE_FAILED = "No se pudo restaurar: el teléfono no tiene espacio o no permite guardar. No se cambió nada en este teléfono.";
export const RESTORE_PARTIAL = "No se pudo restaurar del todo: el teléfono no tiene espacio o no permite guardar. Revisa tus anotaciones y tu despensa antes de seguir.";

/**
 * Replaces the notes and, when the file has one, the despensa, with an already
 * validated payload. Writes the notes first, then the despensa. If any write fails,
 * both saved values go back to what they were before and both stores read them
 * again. Returns { ok, despensa } or { ok: false, rolledBack, error }.
 */
export function restoreAll(notes, pantry, payload, storage) {
  const withPantry = Array.isArray(payload.data[DESPENSA]);
  const keys = [STORAGE_KEY, DESPENSA_KEY];
  const before = keys.map((k) => storage.getItem(k));
  try {
    notes.restore(payload);
    if (withPantry) {
      const r = pantry.replaceAll(payload.data[DESPENSA]);
      if (!r.ok) throw new Error(r.error);
    }
    return { ok: true, despensa: withPantry };
  } catch {
    let rolledBack = true;
    keys.forEach((k, i) => {
      try {
        if (before[i] == null) storage.removeItem(k);
        else storage.setItem(k, before[i]);
      } catch {
        rolledBack = false;
      }
    });
    notes.reload();
    pantry.reload();
    return { ok: false, rolledBack, error: rolledBack ? RESTORE_FAILED : RESTORE_PARTIAL };
  }
}

// --- Store (storage is injected: window.localStorage in the page) ------------------------

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function defaultId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function createStore(storage, { now = () => new Date(), id = defaultId } = {}) {
  let state = { schema: SCHEMA, data: emptyData(), lastExportAt: null };
  let loadError = null;

  function load() {
    state = { schema: SCHEMA, data: emptyData(), lastExportAt: null };
    loadError = null;
    const raw = storage.getItem(STORAGE_KEY);
    if (raw == null) return;
    try {
      const parsed = JSON.parse(raw);
      const ok = isPlainObject(parsed) && parsed.schema === SCHEMA && checkData(parsed.data) === null
        && (parsed.lastExportAt === null || typeof parsed.lastExportAt === "string");
      if (!ok) throw new Error("bad state");
      state = { schema: SCHEMA, data: parsed.data, lastExportAt: parsed.lastExportAt };
    } catch {
      loadError = "Las anotaciones guardadas no se pudieron leer. Se guardó un respaldo y se empezó de nuevo.";
      if (storage.getItem(BACKUP_KEY) == null) storage.setItem(BACKUP_KEY, raw);
    }
  }
  load();

  // Writes the candidate state; keeps the previous state if the browser refuses.
  function commit(next) {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
    state = next;
  }

  function withData(mutator) {
    const next = clone(state);
    mutator(next.data);
    commit(next);
  }

  return {
    loadError: () => loadError,
    getData: () => clone(state.data),
    /** Reads storage again (after a restore was rolled back). */
    reload: load,
    lastExportAt: () => state.lastExportAt,

    add(kind, input) {
      const r = validate(kind, input);
      if (!r.ok) return r;
      const entry = { id: id(), ...r.value };
      if (kind === "preguntas") Object.assign(entry, { addedOn: isoDate(now()), asked: false });
      withData((d) => d[kind].push(entry));
      return { ok: true, value: entry, errors: [] };
    },

    update(kind, entryId, input) {
      const r = validate(kind, input);
      if (!r.ok) return r;
      const i = state.data[kind].findIndex((e) => e.id === entryId);
      if (i < 0) return { ok: false, value: null, errors: [{ field: "", message: "Esa anotación ya no existe." }] };
      withData((d) => { d[kind][i] = { ...d[kind][i], ...r.value }; });
      return { ok: true, value: state.data[kind][i], errors: [] };
    },

    remove(kind, entryId) {
      if (!state.data[kind].some((e) => e.id === entryId)) return false;
      withData((d) => { d[kind] = d[kind].filter((e) => e.id !== entryId); });
      return true;
    },

    setAsked(entryId, asked) {
      const i = state.data.preguntas.findIndex((e) => e.id === entryId);
      if (i < 0) return false;
      withData((d) => { d.preguntas[i].asked = Boolean(asked); });
      return true;
    },

    /** The file for the family member. `despensa`, when given, goes after the four kinds. */
    exportFile({ despensa } = {}) {
      const data = Array.isArray(despensa) ? { ...state.data, [DESPENSA]: despensa } : state.data;
      return buildExport(data, now());
    },

    markExported(when = now()) {
      const next = clone(state);
      next.lastExportAt = when.toISOString();
      commit(next);
    },

    readImport: (text) => parseImport(text),

    /** Replaces the own notes with an already validated payload. The despensa, if any, is not kept here. */
    restore(payload) {
      const next = clone(state);
      next.data = Object.fromEntries(KINDS.map((k) => [k, clone(payload.data[k])]));
      commit(next);
    },

    /** Keeps a received copy apart from the own data. */
    receive(payload) {
      storage.setItem(RECEIVED_KEY, JSON.stringify(payload));
    },

    received() {
      const raw = storage.getItem(RECEIVED_KEY);
      if (raw == null) return null;
      const r = parseImport(raw);
      return r.ok ? r.payload : null;
    },

    clearReceived() {
      storage.removeItem(RECEIVED_KEY);
    },
  };
}
