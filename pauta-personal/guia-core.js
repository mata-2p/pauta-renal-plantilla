// First-use guide (S26): pure logic and copy, no DOM and no network.
// The guide explains how the app is used. It never gives food advice, never adds
// anything to the pauta and never quotes or sums it up. guia.js only draws it.
import { isReaderConfigured } from "./etiqueta-core.js";

export const GUIDE_IDS = ["inicio", "registro", "despensa", "etiqueta"];

// One flag per guide, on this phone only. Value «1» once it was closed. Nothing
// else is stored: not who is using the app, not the step reached.
export const SEEN_KEYS = {
  inicio: "guia-inicio-v1",
  registro: "guia-registro-v1",
  despensa: "guia-despensa-v1",
  etiqueta: "guia-etiqueta-v1",
};

export const LABELS = {
  open: "¿Cómo se usa?",
  skip: "Saltar",
  prev: "Anterior",
  next: "Siguiente",
  start: "Empezar",
};

/** «Paso 2 de 6». */
export const counterText = (n, total) => `Paso ${n} de ${total}`;

// `after`: ids to focus when the guide closes by itself (first visible one wins).
// On «Leer una etiqueta» the privacy notice comes right after the help.
// `reader: true`: shown only when the label reader is configured (see guidesFor).
export const GUIDES = {
  inicio: {
    after: ["contenido"],
    steps: [
      {
        title: "Te damos la bienvenida",
        paragraphs: [
          "Aquí está la pauta de alimentación que te entregó tu equipo tratante, palabra por palabra.",
          "Es un apoyo para el día a día. No reemplaza a tu equipo.",
          "Sirve igual para ti y para quien cocina o te acompaña.",
        ],
      },
      {
        title: "Tu pauta y la indicación del alta",
        paragraphs: [
          "En el inicio, cada recuadro abre una parte de tu pauta.",
          "Primero está la «Indicación médica del alta», tal como está escrita.",
          "Si te parece que la indicación y tu pauta dicen cosas distintas, pregúntale a tu equipo.",
        ],
      },
      {
        title: "Letra grande y voz",
        paragraphs: [
          "Con A− y A+, arriba, cambias el tamaño de la letra.",
          "Con «Escuchar», el teléfono lee en voz alta lo que está en pantalla.",
        ],
      },
      {
        title: "Tus anotaciones y tu despensa",
        paragraphs: [
          "En «Mis anotaciones» anotas tus controles, lo que comes, tu presión y peso, y tus preguntas.",
          "En «Mi despensa» anotas lo que hay en casa, ordenado con la tabla de tu pauta.",
          "Todo queda solo en este teléfono. Para compartirlo o guardar un respaldo, exporta una copia en «Compartir».",
        ],
      },
      {
        reader: true,
        title: "Leer una etiqueta",
        paragraphs: [
          "En «Leer una etiqueta» sacas una foto del envase. La foto sale del teléfono para que la lea un servicio en internet, y no se guarda.",
          "Tú revisas lo que se leyó con el envase y lo confirmas. Solo después ves las líneas de tu pauta que tienen que ver.",
          "La app no decide por ti qué comer.",
        ],
      },
      {
        title: "Sin internet, y siempre con tu equipo",
        paragraphs: [
          "Al final del inicio está «Cómo dejarla en la pantalla del teléfono». Así la abres como una app y funciona sin internet. Solo «Leer una etiqueta» necesita internet.",
          "Si tienes preguntas o síntomas, habla siempre con tu equipo tratante.",
        ],
      },
    ],
  },
  registro: {
    after: ["contenido"],
    steps: [
      {
        title: "Mis anotaciones",
        paragraphs: [
          "Aquí anotas tus controles y exámenes, lo que comes cada día, tu presión y peso, y tus preguntas para el control.",
          "Se guarda solo en este teléfono. Para compartirlo con tu familiar o guardar un respaldo, exporta una copia en «Compartir».",
          "«Para el médico» muestra lo que anotaste, tal como lo escribiste, para imprimirlo o mostrarlo.",
        ],
      },
    ],
  },
  despensa: {
    after: ["t-despensa"],
    steps: [
      {
        title: "Mi despensa",
        paragraphs: [
          "Anota lo que hay en casa: búscalo en tu pauta o escríbelo con tus palabras.",
          "Lo que eliges de tu pauta queda en su grupo de la tabla «Qué elegir». Lo que escribes tú queda aparte, en «Otros».",
          "Si marcas «Se acabó / comprar», aparece en «Para comprar». Se guarda solo en este teléfono.",
        ],
      },
    ],
  },
  etiqueta: {
    reader: true,
    after: ["t-aviso", "t-foto", "t-leer"],
    steps: [
      {
        title: "Leer una etiqueta",
        paragraphs: [
          "Saca una foto del envase. La foto sale del teléfono para que la lea un servicio en internet, y no se guarda. Necesitas internet.",
          "Revisa lo que se leyó con el envase y confírmalo tú. Solo después verás las líneas de tu pauta que tienen que ver.",
          "La app no decide por ti qué comer. Antes de la primera foto verás un aviso con más detalle.",
        ],
      },
    ],
  },
};

/**
 * The guides this copy of the app shows. With the reader on: all of them. With the
 * reader off (no reader address): the tour leaves out its «Leer una etiqueta» step and
 * there is no help for that screen. The copy of the other steps does not change.
 */
export function guidesFor(readerOn) {
  if (readerOn) return GUIDES;
  const out = {};
  for (const id of GUIDE_IDS) {
    if (GUIDES[id].reader) continue;
    out[id] = { ...GUIDES[id], steps: GUIDES[id].steps.filter((s) => !s.reader) };
  }
  return out;
}

/** The guides of this copy, after the reader address in etiqueta-core.js. */
export const ACTIVE_GUIDES = guidesFor(isReaderConfigured());

/** Every visible text of the guide, for the checks. Counters for both tour lengths. */
export const GUIDE_COPY = [
  ...Object.values(LABELS),
  ...GUIDE_IDS.flatMap((id) => GUIDES[id].steps.flatMap((s) => [s.title, ...s.paragraphs])),
  ...new Set([true, false].flatMap((on) => {
    const n = guidesFor(on).inicio.steps.length;
    return Array.from({ length: n }, (_, i) => counterText(i + 1, n));
  })),
];

// --- Seen flags ---------------------------------------------------------------------

/**
 * The seen flags over a storage (window.localStorage in the page). When the storage
 * cannot be read or written, the flag lives in memory for this visit only.
 */
export function seenStore(storage) {
  const memory = new Set();
  return {
    seen(id) {
      if (memory.has(id)) return true;
      try { return Boolean(storage) && storage.getItem(SEEN_KEYS[id]) === "1"; } catch { return false; }
    },
    mark(id) {
      if (!SEEN_KEYS[id]) return;
      memory.add(id);
      try { if (storage) storage.setItem(SEEN_KEYS[id], "1"); } catch { /* this visit only */ }
    },
  };
}

// --- The guide as a small state machine ------------------------------------------------

// Every function below takes the guides to use; guia.js passes ACTIVE_GUIDES. A
// guide that is not in them never opens.
const start = (id, guides) => (guides[id] ? { id, index: 0, open: true } : null);

/** The first time a page opens: its guide on the first step, or null once seen. */
export function autoOpen(store, id, guides = GUIDES) {
  return guides[id] && !store.seen(id) ? start(id, guides) : null;
}

/** «¿Cómo se usa?»: the guide again from its first step, whatever was seen. */
export function reopen(id, guides = GUIDES) {
  return start(id, guides);
}

/**
 * One action on the open guide: "siguiente", "empezar", "anterior" or "saltar" (Esc
 * too). Returns { state, markSeen }. Closing by «Saltar» or by finishing marks the
 * guide as seen; moving between steps does not.
 */
export function step(state, action, guides = GUIDES) {
  const total = guides[state.id].steps.length;
  const close = { state: { ...state, open: false }, markSeen: true };
  if (action === "saltar") return close;
  if (action === "siguiente" || action === "empezar") {
    if (action === "empezar" || state.index >= total - 1) return close;
    return { state: { ...state, index: state.index + 1 }, markSeen: false };
  }
  if (action === "anterior" && state.index > 0) {
    return { state: { ...state, index: state.index - 1 }, markSeen: false };
  }
  return { state, markSeen: false };
}

/** What one open step shows. A one-step help has no counter. */
export function view(state, guides = GUIDES) {
  if (!state || !state.open) return null;
  const steps = guides[state.id].steps;
  const s = steps[state.index];
  const last = state.index === steps.length - 1;
  return {
    title: s.title,
    paragraphs: s.paragraphs,
    counter: steps.length > 1 ? counterText(state.index + 1, steps.length) : null,
    showPrev: state.index > 0,
    primary: last ? LABELS.start : LABELS.next,
  };
}
