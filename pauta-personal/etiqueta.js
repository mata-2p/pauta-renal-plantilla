// Leer una etiqueta: DOM layer. All decisions live in etiqueta-core.js.
// The photo is re-encoded here without metadata, sent once to the label reader and
// dropped. What the person confirms is shown back and never stored.
import {
  READER_URL, NOTICE_KEY, TIMEOUT_MS, SEALS, POTASSIUM, SODIUM, SI, NO, ILEGIBLE, CRITICAL,
  PREPARE_FAILED, phrasesFor, failureMessage, readingToForm, fitSize, encodeWithin, jpegHasApp1,
  parseSodium, formatMg, sodiumEcho, sodiumError, readLine, preChecked, missingChoices,
  SAL_LIGHT, CATEGORY, NINGUNA, categoryReadLine, quoteLine,
} from "./etiqueta-core.js";

const $ = (id) => document.getElementById(id);

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// --- The notice, remembered on this phone only ------------------------------------

let noticeInMemory = false;
function noticeRead() {
  try { return localStorage.getItem(NOTICE_KEY) === "1" || noticeInMemory; } catch { return noticeInMemory; }
}
function markNoticeRead() {
  noticeInMemory = true;
  try { localStorage.setItem(NOTICE_KEY, "1"); } catch { /* storage unavailable: this visit only */ }
}

// --- Screen state --------------------------------------------------------------------

const section = $("leer");
const form = $("f-confirmar");
const canvas = $("lienzo");
const fileInputs = [$("foto-camara"), $("foto-galeria")];
let photo = null; // Uint8Array of the clean JPEG
let busy = false;

function say(text, working = false) {
  const s = $("estado");
  s.textContent = text;
  s.classList.toggle("busy", working);
}

function showError(text) {
  const box = $("error");
  box.replaceChildren();
  if (!text) return;
  box.append(
    el("p", null, text),
    el("p", { class: "small" }, "También puedes revisar el envase con la guía ",
      el("a", { href: "index.html#etiquetas" }, "Cómo leer las etiquetas"), "."),
  );
}

function setBusy(on) {
  busy = on;
  section.setAttribute("aria-busy", on ? "true" : "false");
  $("enviar").disabled = on;
  for (const f of fileInputs) f.disabled = on;
}

// Stops «Escuchar» (app.js listens for this event) when the result goes away.
function stopVoice() {
  document.dispatchEvent(new CustomEvent("routechange", { detail: { section: null } }));
}

function showPhotoStep(focus) {
  $("paso-aviso").hidden = true;
  $("paso-foto").hidden = false;
  if (focus) $("t-foto").focus();
}

function clearPhoto() {
  photo = null;
  canvas.width = 0;
  canvas.height = 0;
  $("vista").hidden = true;
}

function startOver(focus) {
  stopVoice();
  clearPhoto();
  form.hidden = true;
  $("paso-resultado").hidden = true;
  showError("");
  say("");
  showPhotoStep(focus);
}

// --- The photo: decode with its orientation, re-encode without metadata ----------------

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
    } catch { /* older browser: fall back to <img>, which applies the orientation itself */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepare(file) {
  const image = await decode(file);
  try {
    const size = fitSize(image.width, image.height);
    const ctx = canvas.getContext("2d");
    let drawn = null;
    const encode = (quality, scale) => {
      if (drawn !== scale) {
        canvas.width = Math.max(1, Math.round(size.width * scale));
        canvas.height = Math.max(1, Math.round(size.height * scale));
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
        drawn = scale;
      }
      return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    };
    const out = await encodeWithin(encode);
    if (!out) throw new Error("too big");
    // Redraw at the size that was kept, so the preview is what will be sent.
    if (drawn !== out.scale) await encode(out.quality, out.scale);
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    if (jpegHasApp1(bytes)) throw new Error("metadata");
    return bytes;
  } finally {
    image.done();
  }
}

async function onFile(ev) {
  const input = ev.target;
  const file = input.files && input.files[0];
  input.value = "";
  if (!file || busy) return;
  stopVoice();
  form.hidden = true;
  $("paso-resultado").hidden = true;
  showError("");
  clearPhoto();
  setBusy(true);
  say("Preparando la foto.", true);
  try {
    photo = await prepare(file);
  } catch {
    clearPhoto();
    setBusy(false);
    say("");
    showError(PREPARE_FAILED);
    return;
  }
  setBusy(false);
  $("vista").hidden = false;
  say("Foto lista. Revisa que se vea la etiqueta y toca «Leer esta etiqueta».");
  $("enviar").focus();
}

// --- Send to the reader ---------------------------------------------------------

async function send() {
  if (!READER_URL || !photo || busy) return;
  showError("");
  if (navigator.onLine === false) {
    say("");
    showError(failureMessage({ type: "offline" }));
    return;
  }
  setBusy(true);
  say("Leyendo la etiqueta. Puede tardar unos segundos.", true);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  let failure = null;
  let values = null;
  try {
    const res = await fetch(READER_URL, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: photo,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "cors",
    });
    if (!res.ok) {
      failure = { type: "status", status: res.status };
    } else {
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      values = readingToForm(data);
      if (!values) failure = { type: timedOut ? "timeout" : "invalid" };
    }
  } catch {
    failure = { type: timedOut ? "timeout" : navigator.onLine === false ? "offline" : "network" };
  } finally {
    clearTimeout(timer);
    setBusy(false);
  }
  if (failure) {
    say("");
    showError(failureMessage(failure));
    return;
  }
  fillForm(values);
  form.hidden = false;
  say("Listo. Revisa cada dato con el envase.");
  $("t-confirmar").focus();
}

// --- Confirm -------------------------------------------------------------------

const ANSWER_TEXT = { [SI]: "Sí", [NO]: "No", [ILEGIBLE]: "No se pudo leer" };
// Every radio question of the form, in screen order.
const RADIO_FIELDS = [...SEALS, POTASSIUM, SAL_LIGHT, CATEGORY];
/** The product type as confirmed: the radio's own label («Cecinas», «Ninguna de estas»…). */
const categoryText = (value) => {
  const r = form.querySelector(`input[name="${CATEGORY.key}"][value="${CSS.escape(value)}"]`);
  return r && r.labels.length ? r.labels[0].textContent : value === NINGUNA ? "Ninguna de estas" : value;
};
const sodiumInput = (key) => form.elements.namedItem(key);
const echoFor = (key) => $(key === "sodio_mg_100" ? "eco-sodio-100" : "eco-sodio-porcion");
const labelFor = (key) => SODIUM.find((s) => s.key === key).label;

/**
 * Repeats under a sodium field the whole mg that will be kept. A value that is not
 * a whole number shows its error once the field was left (strict) or was already
 * marked, so typing «1.2» on the way to «1.250» does not flash an error.
 */
function updateEcho(key, strict) {
  const input = sodiumInput(key);
  const out = echoFor(key);
  const parsed = parseSodium(input.value);
  if (parsed.ok) {
    input.removeAttribute("aria-invalid");
    out.classList.remove("bad");
    out.textContent = sodiumEcho(parsed.value);
  } else if (strict || input.getAttribute("aria-invalid") === "true") {
    input.setAttribute("aria-invalid", "true");
    out.classList.add("bad");
    out.textContent = sodiumError(labelFor(key));
  } else {
    out.classList.remove("bad");
    out.textContent = "";
  }
  return parsed;
}

function fillForm(values) {
  form.reset();
  // The critical answers are never pre-checked: the reading is only shown.
  const checked = preChecked(values);
  for (const { key } of RADIO_FIELDS) {
    for (const r of form.querySelectorAll(`input[name="${key}"]`)) {
      r.checked = r.value === checked[key];
      r.removeAttribute("aria-invalid");
    }
  }
  for (const key of CRITICAL) {
    $(`leido-${key}`).textContent = key === CATEGORY.key ? categoryReadLine(values[key]) : readLine(values[key]);
  }
  for (const { key } of SODIUM) {
    sodiumInput(key).value = values[key];
    sodiumInput(key).removeAttribute("aria-invalid");
    updateEcho(key, values[key] !== "");
  }
  $("e-confirmar").replaceChildren();
}

function readForm() {
  const values = {};
  for (const { key } of RADIO_FIELDS) {
    const checked = form.querySelector(`input[name="${key}"]:checked`);
    if (checked) values[key] = checked.value;
  }
  const errors = missingChoices(values).map(({ key, message }) => ({
    input: form.querySelector(`input[name="${key}"]`), message,
  }));
  for (const { key, label } of SODIUM) {
    const parsed = updateEcho(key, true);
    if (parsed.ok) values[key] = parsed.value;
    else errors.push({ input: sodiumInput(key), message: sodiumError(label) });
  }
  return { values, errors };
}

function renderResult(values) {
  const items = [
    ...SEALS.map(({ key, label }) => `Sello ${label}: ${ANSWER_TEXT[values[key]]}`),
    `${POTASSIUM.label}: ${ANSWER_TEXT[values[POTASSIUM.key]]}`,
    `${SAL_LIGHT.label}: ${ANSWER_TEXT[values[SAL_LIGHT.key]]}`,
    `${CATEGORY.label}: ${categoryText(values[CATEGORY.key])}`,
    ...SODIUM.map(({ key, label }) => `${label}: ${values[key] === null ? ILEGIBLE : `${formatMg(values[key])} miligramos`}`),
  ];
  $("confirmado").replaceChildren(...items.map((t) => el("li", null, t)));

  const phrases = phrasesFor(values);
  const said = phrases.filter((p) => p.kind !== "revisar");
  const check = phrases.filter((p) => p.kind === "revisar");
  $("frases").replaceChildren(...said.map((p) => (p.pauta
    ? el("div", { class: "cita" },
      el("blockquote", null, el("p", null, quoteLine(p))),
      el("p", null, el("a", { href: p.href }, "Ver en tu pauta")))
    : el("div", null,
      el("p", null, p.text),
      el("p", null, el("a", { href: p.href }, "Abrir tu pauta"))))));
  $("pauta-card").hidden = said.length === 0;
  $("revisar").replaceChildren(...check.map((p) => el("p", null, p.text)));
  if (check.length) {
    $("revisar").append(el("p", null, el("a", { href: check[0].href }, "Cómo leer las etiquetas")));
  }
  $("revisar-card").hidden = check.length === 0;
}

for (const { key } of SODIUM) {
  sodiumInput(key).addEventListener("input", () => updateEcho(key, false));
  sodiumInput(key).addEventListener("change", () => updateEcho(key, true));
}

// An answer chosen after a blocked confirmation is no longer marked as missing.
form.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t instanceof HTMLInputElement && t.type === "radio") {
    for (const r of form.querySelectorAll(`input[name="${t.name}"]`)) r.removeAttribute("aria-invalid");
  }
});

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const { values, errors } = readForm();
  const box = $("e-confirmar");
  box.replaceChildren();
  if (errors.length) {
    box.append(el("p", { class: "lead" }, "Revisa lo siguiente:"), el("ul", null, errors.map((e) => el("li", null, e.message))));
    for (const e of errors) e.input.setAttribute("aria-invalid", "true");
    errors[0].input.focus();
    return;
  }
  renderResult(values);
  form.hidden = true;
  $("paso-foto").hidden = true;
  $("paso-resultado").hidden = false;
  say("");
  $("t-resultado").focus();
});

// --- Start ----------------------------------------------------------------------

$("entendido").addEventListener("click", () => { markNoticeRead(); showPhotoStep(true); });
$("ver-aviso").addEventListener("click", () => {
  $("paso-foto").hidden = true;
  $("paso-aviso").hidden = false;
  $("t-aviso").focus();
});
for (const f of fileInputs) f.addEventListener("change", onFile);
$("enviar").addEventListener("click", send);
$("otra-foto").addEventListener("click", () => startOver(true));
$("otra-etiqueta").addEventListener("click", () => startOver(true));
$("corregir").addEventListener("click", () => {
  stopVoice();
  $("paso-resultado").hidden = true;
  $("paso-foto").hidden = false;
  form.hidden = false;
  $("t-confirmar").focus();
});

// Without a reader address nothing is sent: the screen only says so.
if (!READER_URL) $("no-configurado").hidden = false;
else if (noticeRead()) showPhotoStep(false);
else $("paso-aviso").hidden = false;
