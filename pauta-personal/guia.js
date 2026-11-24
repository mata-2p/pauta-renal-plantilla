// First-use guide (S26): DOM layer. Copy and decisions live in guia-core.js.
// A native modal dialog: focus moves in and stays in, Esc is «Saltar», and focus
// goes back where it was. Only the guide's own «seen» flag is stored.
// Only the text area scrolls (styles.css), so the button row is always in view; the
// text area can take focus, so it can be scrolled from the keyboard too.
import { ACTIVE_GUIDES, LABELS, seenStore, autoOpen, reopen, step, view } from "./guia-core.js";

const dialog = document.getElementById("guia");
if (dialog && typeof dialog.showModal === "function") setup(dialog);

function setup(dialog) {
  const id = dialog.getAttribute("data-guia");
  // Not in this copy (the label help without a reader): no guide and no «¿Cómo se usa?».
  if (!ACTIVE_GUIDES[id]) return;
  const part = (sel) => dialog.querySelector(sel);
  const title = part("#guia-titulo");
  const text = part("#guia-texto");
  const body = part("#guia-cuerpo");
  const counter = part("#guia-paso");
  const prev = part('[data-guia="anterior"]');
  const next = part('[data-guia="siguiente"]');

  let storage = null;
  try { storage = window.localStorage; } catch { /* storage unavailable: this visit only */ }
  const store = seenStore(storage);
  let state = null;
  let opener = null;

  // Stops «Escuchar» (app.js listens for this event) when the step changes or closes.
  const stopVoice = () => document.dispatchEvent(new CustomEvent("routechange", { detail: { section: null } }));

  function render() {
    const v = view(state, ACTIVE_GUIDES);
    title.textContent = v.title;
    body.replaceChildren(...v.paragraphs.map((t) => {
      const p = document.createElement("p");
      p.textContent = t;
      return p;
    }));
    counter.textContent = v.counter || "";
    counter.hidden = !v.counter;
    prev.hidden = !v.showPrev;
    next.textContent = v.primary;
    text.scrollTop = 0;
    title.focus();
  }

  function open(s, from) {
    if (!s) return;
    stopVoice();
    state = s;
    opener = from;
    if (!dialog.open) dialog.showModal();
    render();
  }

  function visible(el) {
    return el && !el.closest("[hidden]") && el.getClientRects().length > 0;
  }

  function finish(markSeen) {
    stopVoice();
    if (markSeen) store.mark(id);
    state = null;
    if (dialog.open) dialog.close();
    const back = opener && document.contains(opener) ? opener
      : ACTIVE_GUIDES[id].after.map((x) => document.getElementById(x)).find(visible);
    opener = null;
    if (back) back.focus({ preventScroll: !back.matches("h1, h2") });
  }

  function act(action) {
    if (!state) return;
    stopVoice();
    const out = step(state, action, ACTIVE_GUIDES);
    if (!out.state.open) { finish(out.markSeen); return; }
    state = out.state;
    render();
  }

  prev.addEventListener("click", () => act("anterior"));
  next.addEventListener("click", () => act("siguiente"));
  part('[data-guia="saltar"]').addEventListener("click", () => act("saltar"));
  // Esc is «Saltar». If the browser closes the dialog anyway, it counts the same.
  dialog.addEventListener("cancel", (ev) => { ev.preventDefault(); act("saltar"); });
  dialog.addEventListener("close", () => { if (state) act("saltar"); });

  // Focus stays inside the dialog: Tab and Shift+Tab go round its buttons and the
  // text area, in page order.
  dialog.addEventListener("keydown", (ev) => {
    if (ev.key !== "Tab") return;
    const items = [...dialog.querySelectorAll('button, [tabindex="0"]')].filter(visible);
    // From the heading both neighbours are in the dialog (the text area, «Escuchar»): the browser moves.
    if (!items.length || document.activeElement === title) return;
    const at = items.indexOf(document.activeElement);
    if (ev.shiftKey ? at <= 0 : at === -1 || at === items.length - 1) {
      ev.preventDefault();
      (ev.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  });

  for (const b of document.querySelectorAll("[data-guia-abrir]")) {
    b.textContent = LABELS.open;
    b.hidden = false;
    b.addEventListener("click", () => open(reopen(id, ACTIVE_GUIDES), b));
  }

  open(autoOpen(store, id, ACTIVE_GUIDES), null);
}
