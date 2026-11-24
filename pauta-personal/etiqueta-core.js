// Leer una etiqueta: pure logic, no DOM and no network.
// The reader only extracts what is printed. The person confirms every value, and
// the screen then shows only sentences copied word for word from the pauta. Nothing
// here compares a number against anything, scores a product or decides for anyone.

// The label reader (Cloudflare Worker, etiquetas-worker/). Only this address is called.
// CONFIGURE: the address of your own Worker, ending in /leer (see README.md). Empty:
// the screen says the reader is not configured and sends nothing.
export const READER_URL = "";

/** True when there is a reader address. Other modules ask here instead of copying it. */
export const isReaderConfigured = () => READER_URL !== "";

// Remembers that the notice was read. Separate from every registro key.
// v2: the notice now names where the photo goes, so it is shown once again.
export const NOTICE_KEY = "etiqueta-aviso-v2";

export const MAX_SIDE = 1600;
export const MAX_BYTES = 1_400_000;
export const TIMEOUT_MS = 25_000;

// The reader's three answers, exactly as it writes them.
export const SI = "sí";
export const NO = "no";
export const ILEGIBLE = "no se pudo leer";
const ANSWERS = [SI, NO, ILEGIBLE];

export const SEALS = [
  { key: "alto_en_sodio", label: "«ALTO EN SODIO»" },
  { key: "alto_en_azucares", label: "«ALTO EN AZÚCARES»" },
  { key: "alto_en_grasas_saturadas", label: "«ALTO EN GRASAS SATURADAS»" },
  { key: "alto_en_calorias", label: "«ALTO EN CALORÍAS»" },
];
export const POTASSIUM = { key: "cloruro_de_potasio", label: "«cloruro de potasio» en los ingredientes" };
export const SODIUM = [
  { key: "sodio_mg_100", label: "Sodio por 100 gramos o 100 mililitros" },
  { key: "sodio_mg_porcion", label: "Sodio por porción" },
];

// S24: «sal light» or «+ potasio» printed on the front of the package.
export const SAL_LIGHT = { key: "dice_sal_light", label: "«sal light» o «+ potasio» en el frente del envase" };
// S24: the product type the package prints, from a closed list in the pauta's own words.
export const CATEGORY = { key: "categoria_impresa", label: "Tipo de producto escrito en el envase" };
export const NINGUNA = "ninguna";
export const CATEGORIES = [
  "cecinas", "vienesas", "hamburguesas procesadas", "nuggets", "caldos en cubo",
  "sopas instantáneas", "snacks salados", "conservas", "salsas comerciales",
];
const CATEGORY_ANSWERS = [...CATEGORIES, NINGUNA, ILEGIBLE];

// The answers the person must choose actively: they are never pre-checked
// from the reading, only shown as «Se leyó: …» next to the choices.
export const CRITICAL = ["alto_en_sodio", POTASSIUM.key, SAL_LIGHT.key, CATEGORY.key];
// Every yes/no/unread question of the form, in screen order.
const YES_NO = [...SEALS, POTASSIUM, SAL_LIGHT];

// --- Sentences of the pauta (index.html), copied word for word -------------------
// SAMPLE: replace each one with the sentence of your team's pauta that the label
// answer points to, word for word (check_verbatim.py checks it).

/** index.html, «Para controlar la presión arterial» (section #presion). */
export const PAUTA_SODIO = "[Ejemplo] Indicación de tu equipo sobre el sodio en los productos envasados.";
/** index.html, «Indicaciones generales» (section #indicaciones). */
export const PAUTA_POTASIO = "[Ejemplo] Indicación de tu equipo sobre la sal light y los sustitutos de sal.";
/**
 * S24: for each product type, the pauta lines that name it with those same words,
 * in the order of the pauta. EMPTY BY DEFAULT: the sample pauta names none of them,
 * so a confirmed product type shows nothing of its own. To fill it, add for a type
 * the lines of your pauta that name it, e.g.
 *   cecinas: [{ text: "<sentence of your pauta>", href: "index.html#presion" }],
 * or, for a cell of the «¿Qué alimentos elegir?» table,
 *   { text: "<cell>", grupo: "<group>", columna: "Limitar o evitar", href: "index.html#elegir" }.
 * The node tests check that each line is in index.html where it says and names its type.
 */
export const CATEGORY_LINES = Object.fromEntries(CATEGORIES.map((c) => [c, []]));

/** How a pauta line is shown: a table cell with its group and column, a sentence as it is. */
export function quoteLine(p) {
  return p.grupo ? `${p.grupo} — ${p.columna}: «${p.text}»` : `«${p.text}»`;
}

export const NEUTRAL = "Tu pauta no tiene una indicación sobre esto. Consulta con tu equipo tratante si tienes dudas.";

// When a field could not be read: what to check on the package. Never a «no».
export const UNREAD_SODIO = "No se pudo leer si tiene el sello «ALTO EN SODIO». Revísalo en el envase.";
export const UNREAD_POTASIO = "No se pudo leer la lista de ingredientes completa. Revisa en el envase si dice «cloruro de potasio».";
export const UNREAD_SAL_LIGHT = "Revisa en el frente del envase si dice «sal light».";
export const UNREAD_CATEGORIA = "Revisa en el envase si dice qué tipo de producto es.";

/** A confirmed sodium amount: a whole number of mg. Its size is never looked at. */
const isConfirmedMg = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * What to show after the person confirms. Three cases per field:
 * - confirmed «sí» (or, for sodium, any confirmed sodium number): the pauta sentence, once;
 * - «no se pudo leer»: a calm line naming what to check on the package;
 * - confirmed «no»: nothing for that field.
 * The neutral line only when nothing else applies. The sodium numbers are never
 * compared with anything: only whether one was confirmed.
 */
export function phrasesFor(confirmed) {
  const c = confirmed || {};
  const out = [];
  // Each line once, even when two answers point at it (KCl and «sal light»).
  const add = (p) => { if (!out.some((o) => o.text === p.text)) out.push(p); };
  const pauta = (text, href, extra) => add({ text, pauta: true, kind: "pauta", href, ...extra });
  const check = (text) => add({ text, pauta: false, kind: "revisar", href: "index.html#etiquetas" });
  if (c.alto_en_sodio === SI || SODIUM.some(({ key }) => isConfirmedMg(c[key]))) pauta(PAUTA_SODIO, "index.html#presion");
  if (c.alto_en_sodio === ILEGIBLE) check(UNREAD_SODIO);
  if (c.cloruro_de_potasio === SI) pauta(PAUTA_POTASIO, "index.html#indicaciones");
  if (c.cloruro_de_potasio === ILEGIBLE) check(UNREAD_POTASIO);
  if (c.dice_sal_light === SI) pauta(PAUTA_POTASIO, "index.html#indicaciones");
  if (c.dice_sal_light === ILEGIBLE) check(UNREAD_SAL_LIGHT);
  if (CATEGORIES.includes(c.categoria_impresa)) {
    for (const { text, href, grupo, columna } of CATEGORY_LINES[c.categoria_impresa]) {
      pauta(text, href, grupo ? { grupo, columna } : {});
    }
  }
  if (c.categoria_impresa === ILEGIBLE) check(UNREAD_CATEGORIA);
  if (!out.length) out.push({ text: NEUTRAL, pauta: false, kind: "neutral", href: "index.html#inicio" });
  return out;
}

// --- Sodium: whole milligrams, as printed in Chile ------------------------------

const GROUPED = /^\d{1,3}(?:([. \u00a0\u202f])\d{3})(?:\1\d{3})*$/;

/**
 * Reads a sodium field as whole mg. «1250», «1.250» and «1 250» are 1250: a dot or a
 * space only separates groups of three digits. A comma, a decimal or a broken group
 * («1.25») is { ok: false }, so «1.250» is never taken as 1,25. Empty is
 * { ok: true, value: null }: not read, never 0.
 */
export function parseSodium(text) {
  const t = String(text ?? "").trim();
  if (t === "") return { ok: true, value: null };
  let digits = null;
  if (/^\d+$/.test(t)) digits = t;
  else if (GROUPED.test(t)) digits = t.replace(/\D/g, "");
  if (digits === null) return { ok: false };
  const value = Number(digits);
  return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false };
}

/** Whole mg in es-CL: 1250 -> «1.250». */
export function formatMg(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** The line under a sodium field that repeats what will be kept. */
export function sodiumEcho(value) {
  return `Se entiende como: ${value === null ? ILEGIBLE : `${formatMg(value)} mg`}`;
}

/** The inline error of a sodium field that is not a whole number. */
export function sodiumError(label) {
  return `En «${label}» escribe los miligramos como número entero, sin coma ni decimales. Por ejemplo: 1250 o 1.250.`;
}

// --- Active confirmation of the two critical answers ------------------------------

const READ_TEXT = { [SI]: "sí", [NO]: "no", [ILEGIBLE]: ILEGIBLE };

/** «Se leyó: sí / no / no se pudo leer», shown next to a critical answer. */
export function readLine(answer) {
  return Object.prototype.hasOwnProperty.call(READ_TEXT, answer) ? `Se leyó: ${READ_TEXT[answer]}` : "";
}

const CATEGORY_READ = Object.fromEntries([...CATEGORIES.map((c) => [c, c]), [NINGUNA, "ninguna de estas"], [ILEGIBLE, ILEGIBLE]]);

/** S24: «Se leyó: cecinas / ninguna de estas / no se pudo leer», next to the product type. */
export function categoryReadLine(value) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_READ, value) ? `Se leyó: ${CATEGORY_READ[value]}` : "";
}

/** The radios to pre-check from the reading: every answer except the critical ones. */
export function preChecked(values) {
  const v = values || {};
  const out = {};
  for (const { key } of YES_NO) {
    if (!CRITICAL.includes(key) && ANSWERS.includes(v[key])) out[key] = v[key];
  }
  return out;
}

const CHOOSE = {
  alto_en_sodio: "Toca tu respuesta para el sello «ALTO EN SODIO»: sí, no o no se pudo leer.",
  cloruro_de_potasio: "Toca tu respuesta para «cloruro de potasio» en los ingredientes: sí, no o no se pudo leer.",
  dice_sal_light: "Toca tu respuesta para «sal light» o «+ potasio» en el frente del envase: sí, no o no se pudo leer.",
  categoria_impresa: "Elige el tipo de producto escrito en el envase, «Ninguna de estas» o «No se pudo leer».",
};

/**
 * The answers still missing, in screen order, each with the message to show.
 * Confirming waits until this is empty.
 */
export function missingChoices(choices) {
  const c = choices || {};
  const missing = YES_NO
    .filter(({ key }) => !ANSWERS.includes(c[key]))
    .map(({ key, label }) => ({ key, message: CHOOSE[key] || `Elige una respuesta para ${label}.` }));
  if (!CATEGORY_ANSWERS.includes(c[CATEGORY.key])) missing.push({ key: CATEGORY.key, message: CHOOSE[CATEGORY.key] });
  return missing;
}

// --- Errors ---------------------------------------------------------------------

const OFFLINE = "Para leer una etiqueta se necesita internet. El resto de Mi pauta sigue funcionando sin conexión.";
const GENERIC = "No se pudo leer la etiqueta en este momento. Inténtalo más tarde.";
const BY_STATUS = {
  400: "La foto no se pudo leer así. Prueba sacando otra foto del envase.",
  413: "La foto quedó demasiado pesada. Prueba sacando otra foto, un poco más lejos.",
  415: "Ese tipo de imagen no se puede leer. Prueba con una foto de la cámara.",
  429: "Se leyeron muchas etiquetas seguidas. Espera un minuto y vuelve a intentarlo.",
  502: "No se pudo leer la etiqueta en esta foto. Prueba con otra foto, con buena luz y más cerca de la tabla nutricional.",
  503: "El lector de etiquetas no está disponible en este momento. Inténtalo más tarde.",
  504: "La lectura tardó demasiado. Vuelve a intentarlo en un momento.",
};

/**
 * Friendly message for a failed reading. `failure` is one of
 * { type: "offline" | "network" | "timeout" | "invalid" } or { type: "status", status }.
 * The reader's own error text is never shown.
 */
export function failureMessage(failure) {
  const f = failure || {};
  if (f.type === "offline" || f.type === "network") return OFFLINE;
  if (f.type === "timeout") return BY_STATUS[504];
  if (f.type === "status" && Object.prototype.hasOwnProperty.call(BY_STATUS, f.status)) return BY_STATUS[f.status];
  return GENERIC;
}

// Shown while preparing the photo, if the browser cannot strip it.
export const PREPARE_FAILED = "No se pudo preparar esta foto. Prueba con otra foto del envase.";

// Every sentence the screen can show from script, for the wording tests.
export const UI_COPY = [
  ...Object.values(BY_STATUS), OFFLINE, GENERIC, PREPARE_FAILED,
  PAUTA_SODIO, PAUTA_POTASIO, ...Object.values(CATEGORY_LINES).flat().map((l) => l.text), NEUTRAL,
  UNREAD_SODIO, UNREAD_POTASIO, UNREAD_SAL_LIGHT, UNREAD_CATEGORIA,
  ...Object.values(CHOOSE), ...SODIUM.map((s) => sodiumError(s.label)),
  sodiumEcho(null), readLine(SI), readLine(NO), readLine(ILEGIBLE),
  ...CATEGORY_ANSWERS.map(categoryReadLine),
  ...SEALS.map((s) => s.label), POTASSIUM.label, SAL_LIGHT.label, CATEGORY.label, ...SODIUM.map((s) => s.label),
  SI, NO, ILEGIBLE,
];

// --- The reader's answer -> the confirmation form -------------------------------

const isAnswer = (v) => ANSWERS.includes(v);
const isAmount = (v) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

/** A reader amount as printed in Chile: 1250 -> «1.250», 12.5 -> «12,5» (left for the person to fix). */
function amountText(n) {
  if (Number.isSafeInteger(n)) return formatMg(n);
  const [whole, frac] = String(n).split(".");
  return frac === undefined ? String(n) : `${formatMg(whole)},${frac}`;
}

/**
 * Checks the reader's answer and turns it into form values. Returns null when the
 * answer does not have the expected shape. A missing amount (null) becomes an empty
 * field, never 0; a printed 0 stays "0".
 */
export function readingToForm(r) {
  if (!r || typeof r !== "object" || !r.sellos || typeof r.sellos !== "object") return null;
  const out = {};
  for (const { key } of SEALS) {
    if (!isAnswer(r.sellos[key])) return null;
    out[key] = r.sellos[key];
  }
  if (!isAnswer(r[POTASSIUM.key])) return null;
  out[POTASSIUM.key] = r[POTASSIUM.key];
  // S24: a reader from before S24 sends neither field; then nothing is read for
  // them and the person still answers. A value that is there must be in its list.
  if (SAL_LIGHT.key in r) {
    if (!isAnswer(r[SAL_LIGHT.key])) return null;
    out[SAL_LIGHT.key] = r[SAL_LIGHT.key];
  }
  if (CATEGORY.key in r) {
    if (!CATEGORY_ANSWERS.includes(r[CATEGORY.key])) return null;
    out[CATEGORY.key] = r[CATEGORY.key];
  }
  for (const { key } of SODIUM) {
    if (!isAmount(r[key])) return null;
    out[key] = r[key] === null ? "" : amountText(r[key]);
  }
  return out;
}

// --- The photo -----------------------------------------------------------------

/** Size that keeps the shape and caps the long side at MAX_SIDE. */
export function fitSize(width, height, max = MAX_SIDE) {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const k = max / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

const QUALITIES = [0.86, 0.78, 0.7, 0.62, 0.54, 0.46];
const SCALES = [1, 0.8, 0.64, 0.5];

/**
 * Encodes at lower and lower quality, then smaller, until the result fits in
 * `max` bytes. `encode(quality, scale)` returns a Blob (or anything with `size`).
 * Returns { blob, quality, scale } or null when nothing fits.
 */
export async function encodeWithin(encode, max = MAX_BYTES) {
  for (const scale of SCALES) {
    for (const quality of QUALITIES) {
      const blob = await encode(quality, scale);
      if (blob && blob.size <= max) return { blob, quality, scale };
    }
  }
  return null;
}

export function isJpeg(b) {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/**
 * True when the JPEG still carries an APP1 segment (Exif, or XMP, which can hold
 * the location). Walks the marker segments up to the start of scan. Fails closed:
 * anything it cannot walk counts as carrying metadata, so it is never sent.
 */
export function jpegHasApp1(b) {
  if (!isJpeg(b)) return true;
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return true;
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) {
      i += 1;
      m = b[i + 1];
    }
    if (m === 0xe1) return true;
    if (m === 0xda) return false; // start of scan: no more header segments
    if (m === 0xd9) return true; // ended without an image
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (i + 3 >= b.length) return true;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return true;
    i += 2 + len;
  }
  return true;
}
