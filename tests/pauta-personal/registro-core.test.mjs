// Behavior tests for pauta-personal/registro-core.js (pure, DOM-free logic).
// Run: node --test tests/pauta-personal/
import { test } from "node:test";
import assert from "node:assert/strict";

const core = await import(new URL("../../pauta-personal/registro-core.js", import.meta.url));
const {
  createStore, validate, orderControles, groupDiarioByDay, filterByPeriod,
  buildReport, buildExport, parseImport, controlToIcs, formatDate,
  STORAGE_KEY, RECEIVED_KEY, MEALS,
} = core;

// In-memory stand-in for window.localStorage.
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
const fixedNow = () => new Date("2031-11-18T12:00:00Z");
const nextId = () => `id-${++seq}`;
const newStore = (storage = memoryStorage()) => ({ storage, store: createStore(storage, { now: fixedNow, id: nextId }) });

function seeded() {
  const { storage, store } = newStore();
  store.add("controles", { date: "2031-12-01", time: "", kind: "control", where: "Nutricionista, piso 3", notes: "Ayuno", bring: "Exámenes" });
  store.add("controles", { date: "2031-11-02", time: "09:30", kind: "examen", where: "Laboratorio", notes: "", bring: "" });
  store.add("diario", { date: "2031-11-17", meal: "Almuerzo", text: "Arroz con pollo" });
  store.add("diario", { date: "2031-11-18", meal: "Desayuno", text: "Pan y quesillo" });
  store.add("mediciones", { date: "2031-11-18", time: "08:00", systolic: "128", diastolic: "79", weight: "" });
  store.add("mediciones", { date: "2031-11-10", time: "", systolic: "", diastolic: "", weight: "72,5" });
  store.add("preguntas", { text: "¿Puedo usar orégano seco?" });
  store.add("preguntas", { text: "¿Cada cuánto me controlo?" });
  return { storage, store };
}

const messages = (r) => r.errors.map((e) => e.message).join(" | ");

// --- Validation -----------------------------------------------------------

test("control without a date is rejected with a Spanish message and nothing is stored", () => {
  const { storage, store } = newStore();
  const before = storage.snapshot();
  const r = store.add("controles", { date: "", time: "", kind: "control", where: "", notes: "", bring: "" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.field), ["date"]);
  assert.match(messages(r), /fecha/);
  assert.deepEqual(storage.snapshot(), before);
  assert.deepEqual(store.getData().controles, []);
});

test("diary entry without what was eaten is rejected", () => {
  const { storage, store } = newStore();
  const before = storage.snapshot();
  const r = store.add("diario", { date: "2031-11-18", meal: "Once", text: "   " });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.field), ["text"]);
  assert.match(messages(r), /qué comió/);
  assert.deepEqual(storage.snapshot(), before);
});

test("diary entry without a date or with an unknown meal is rejected", () => {
  const r = validate("diario", { date: "", meal: "Merienda", text: "Fruta" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.field).sort(), ["date", "meal"]);
  assert.deepEqual(MEALS, ["Desayuno", "Almuerzo", "Once", "Cena", "Colación"]);
});

test("presión with only one of the two values is rejected", () => {
  for (const input of [
    { date: "2031-11-18", time: "", systolic: "120", diastolic: "", weight: "" },
    { date: "2031-11-18", time: "", systolic: "", diastolic: "80", weight: "70" },
  ]) {
    const { storage, store } = newStore();
    const r = store.add("mediciones", input);
    assert.equal(r.ok, false);
    assert.match(messages(r), /los dos números de la presión/);
    assert.equal(storage.getItem(STORAGE_KEY), null);
  }
});

test("non-integer presión is rejected", () => {
  for (const bad of ["120.5", "12,5", "abc", "-80"]) {
    const r = validate("mediciones", { date: "2031-11-18", time: "", systolic: bad, diastolic: "80", weight: "" });
    assert.equal(r.ok, false, bad);
    assert.match(messages(r), /números enteros/);
  }
});

test("peso with two decimals is rejected; one decimal with comma or point is accepted", () => {
  const bad = validate("mediciones", { date: "2031-11-18", time: "", systolic: "", diastolic: "", weight: "72,55" });
  assert.equal(bad.ok, false);
  assert.match(messages(bad), /un decimal/);
  for (const ok of ["72", "72,5", "72.5"]) {
    assert.equal(validate("mediciones", { date: "2031-11-18", time: "", systolic: "", diastolic: "", weight: ok }).ok, true, ok);
  }
});

test("measurement with neither presión nor peso is rejected", () => {
  const { storage, store } = newStore();
  const r = store.add("mediciones", { date: "2031-11-18", time: "10:00", systolic: "", diastolic: "", weight: "" });
  assert.equal(r.ok, false);
  assert.match(messages(r), /presión, el peso o ambos/);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("absent values stay absent (null), never 0, and typed values are kept as typed", () => {
  const { store } = newStore();
  store.add("mediciones", { date: "2031-11-18", time: "", systolic: "", diastolic: "", weight: "72,5" });
  store.add("mediciones", { date: "2031-11-17", time: "07:15", systolic: "0128", diastolic: "79", weight: "" });
  const [a, b] = store.getData().mediciones;
  assert.equal(a.systolic, null);
  assert.equal(a.diastolic, null);
  assert.equal(a.weight, "72,5");
  assert.equal(a.time, "");
  assert.equal(b.systolic, "0128");
  assert.equal(b.weight, null);
  assert.ok(!Object.values(a).includes(0));
});

// --- Ordering and period filtering ----------------------------------------

test("controles: upcoming first (soonest first, today included), then past (most recent first)", () => {
  const list = [
    { id: "a", date: "2031-10-01", time: "" },
    { id: "b", date: "2031-12-05", time: "" },
    { id: "c", date: "2031-11-18", time: "15:00" },
    { id: "d", date: "2031-11-01", time: "" },
    { id: "e", date: "2031-11-18", time: "09:00" },
  ];
  const { upcoming, past } = orderControles(list, "2031-11-18");
  assert.deepEqual(upcoming.map((c) => c.id), ["e", "c", "b"]);
  assert.deepEqual(past.map((c) => c.id), ["d", "a"]);
});

test("diary is grouped by day, newest day first, meals in pauta order", () => {
  const groups = groupDiarioByDay([
    { id: "1", date: "2031-11-17", meal: "Cena", text: "x" },
    { id: "2", date: "2031-11-18", meal: "Once", text: "y" },
    { id: "3", date: "2031-11-17", meal: "Desayuno", text: "z" },
  ]);
  assert.deepEqual(groups.map((g) => g.date), ["2031-11-18", "2031-11-17"]);
  assert.deepEqual(groups[1].entries.map((e) => e.id), ["3", "1"]);
});

test("period filter includes both boundaries and excludes the day outside each one", () => {
  const list = ["2031-10-31", "2031-11-01", "2031-11-15", "2031-11-30", "2031-12-01"].map((date) => ({ date }));
  assert.deepEqual(filterByPeriod(list, "2031-11-01", "2031-11-30").map((e) => e.date), ["2031-11-01", "2031-11-15", "2031-11-30"]);
  assert.deepEqual(filterByPeriod(list, "2031-11-15", "2031-11-15").map((e) => e.date), ["2031-11-15"]);
});

test("Chilean display date format dd-mm-aaaa", () => {
  assert.equal(formatDate("2031-11-08"), "08-11-2031");
});

// --- Edit, delete, questions ----------------------------------------------

test("edit and delete change only the targeted entry", () => {
  const { store } = seeded();
  const [first, second] = store.getData().diario;
  const r = store.update("diario", first.id, { date: first.date, meal: "Cena", text: "Sopa casera" });
  assert.equal(r.ok, true);
  assert.equal(store.getData().diario.find((e) => e.id === first.id).text, "Sopa casera");
  const bad = store.update("diario", first.id, { date: first.date, meal: "Cena", text: "" });
  assert.equal(bad.ok, false);
  assert.equal(store.getData().diario.find((e) => e.id === first.id).text, "Sopa casera");
  assert.equal(store.remove("diario", second.id), true);
  assert.deepEqual(store.getData().diario.map((e) => e.id), [first.id]);
});

test("a question keeps the date it was added and can be marked as asked", () => {
  const { store } = seeded();
  const q = store.getData().preguntas[0];
  assert.equal(q.addedOn, "2031-11-18");
  assert.equal(q.asked, false);
  store.setAsked(q.id, true);
  assert.equal(store.getData().preguntas[0].asked, true);
});

// --- Doctor report ---------------------------------------------------------

test("report model contains only stored values for the period, upcoming controles and pending questions", () => {
  const { store } = seeded();
  const data = store.getData();
  store.setAsked(data.preguntas[1].id, true);
  const stored = store.getData();
  const report = buildReport(stored, { from: "2031-11-11", to: "2031-11-18", today: "2031-11-18" });

  assert.deepEqual(Object.keys(report).sort(), ["controles", "diario", "from", "mediciones", "preguntas", "to"]);
  assert.deepEqual(Object.keys(report.controles).sort(), ["enPeriodo", "proximos"]);
  assert.equal(report.from, "2031-11-11");
  assert.equal(report.to, "2031-11-18");

  const all = [...stored.controles, ...stored.diario, ...stored.mediciones, ...stored.preguntas];
  const shown = [
    ...report.diario.flatMap((g) => g.entries), ...report.controles.enPeriodo,
    ...report.controles.proximos, ...report.preguntas, ...report.mediciones,
  ];
  for (const e of shown) assert.deepEqual(e, all.find((s) => s.id === e.id));
  for (const g of report.diario) assert.deepEqual(Object.keys(g).sort(), ["date", "entries"]);

  assert.deepEqual(report.diario.flatMap((g) => g.entries).map((e) => e.text), ["Pan y quesillo", "Arroz con pollo"]);
  assert.deepEqual(report.controles.enPeriodo, []);
  assert.deepEqual(report.controles.proximos.map((c) => c.date), ["2031-12-01"]);
  assert.deepEqual(report.preguntas.map((q) => q.text), ["¿Puedo usar orégano seco?"]);
  assert.deepEqual(report.mediciones.map((m) => [m.systolic, m.diastolic, m.weight]), [["128", "79", null]]);
});

// --- Export / import -------------------------------------------------------

test("export builds the named file and shape; import round trip restores equal data", () => {
  const { store } = seeded();
  const exp = buildExport(store.getData(), fixedNow());
  assert.equal(exp.filename, "mis-anotaciones-2031-11-18.json");
  assert.deepEqual(Object.keys(exp.payload), ["app", "schema", "exportedAt", "data"]);
  assert.equal(exp.payload.app, "mi-pauta");
  assert.equal(exp.payload.schema, 1);
  assert.equal(exp.payload.exportedAt, "2031-11-18T12:00:00.000Z");
  assert.deepEqual(Object.keys(exp.payload.data), ["controles", "diario", "mediciones", "preguntas"]);

  const parsed = parseImport(exp.text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.payload.data, store.getData());

  const other = newStore();
  other.store.restore(parsed.payload);
  assert.deepEqual(other.store.getData(), store.getData());
});

test("last export date is Nunca until marked", () => {
  const { store } = newStore();
  assert.equal(store.lastExportAt(), null);
  store.markExported(fixedNow());
  assert.equal(store.lastExportAt(), "2031-11-18T12:00:00.000Z");
});

test("receiving a copy stores it separately and leaves own data untouched; it can be cleared", () => {
  const { store: source } = seeded();
  const text = buildExport(source.getData(), fixedNow()).text;
  const { storage, store } = newStore();
  store.add("preguntas", { text: "Propia" });
  const own = storage.getItem(STORAGE_KEY);
  const parsed = store.readImport(text);
  store.receive(parsed.payload);
  assert.equal(storage.getItem(STORAGE_KEY), own);
  assert.deepEqual(store.received().data, source.getData());
  assert.equal(store.received().exportedAt, "2031-11-18T12:00:00.000Z");
  assert.ok(storage.getItem(RECEIVED_KEY));
  store.clearReceived();
  assert.equal(store.received(), null);
  assert.equal(storage.getItem(STORAGE_KEY), own);
});

function rejects(name, mutate, pattern) {
  test(`import rejects ${name} with a Spanish message and leaves stored data unchanged`, () => {
    const { store: source } = seeded();
    const payload = structuredClone(buildExport(source.getData(), fixedNow()).payload);
    const text = typeof mutate === "string" ? mutate : JSON.stringify(mutate(payload) ?? payload);
    const { storage, store } = seeded();
    store.receive(store.readImport(buildExport(store.getData(), fixedNow()).text).payload);
    const before = storage.snapshot();
    const r = store.readImport(text);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
    assert.match(r.error, pattern);
    assert.match(r.error, /No se cambió nada/);
    assert.deepEqual(storage.snapshot(), before);
  });
}

rejects("a wrong app", (p) => { p.app = "otra-app"; }, /no es una copia de Mis anotaciones/);
rejects("a wrong schema", (p) => { p.schema = 2; }, /otra versión/);
rejects("malformed JSON", "{ \"app\": \"mi-pauta\", ", /no se pudo leer/);
rejects("an unknown top-level field", (p) => { p.extra = true; }, /desconocido.*extra/);
rejects("an unknown entry field", (p) => { p.data.diario[0].calorias = 300; }, /desconocido.*calorias/);
rejects("a wrong type", (p) => { p.data.preguntas[0].asked = "sí"; }, /formato.*asked/);
rejects("a numeric presión instead of the typed text", (p) => { p.data.mediciones[0].systolic = 128; }, /formato.*systolic/);
rejects("an entry that breaks the field rules", (p) => { p.data.diario[0].text = ""; }, /no se abrió/);

// --- Calendar file ----------------------------------------------------------

test(".ics for an all-day control: CRLF, VEVENT, UID, DTSTAMP, VALUE=DATE and escaped text", () => {
  const ics = controlToIcs(
    { id: "abc", date: "2031-12-01", time: "", kind: "control", where: "Nutricionista; piso 3, box 2", notes: "Ir en ayunas\nLlevar carnet", bring: "" },
    fixedNow(),
  );
  assert.ok(ics.endsWith("\r\n"));
  assert.equal(ics.replace(/\r\n/g, "").includes("\n"), false, "only CRLF line endings");
  const lines = ics.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("BEGIN:VEVENT"));
  assert.ok(lines.includes("END:VEVENT"));
  assert.ok(lines.includes("END:VCALENDAR"));
  assert.ok(lines.some((l) => l.startsWith("UID:abc")));
  assert.ok(lines.includes("DTSTAMP:20311118T120000Z"));
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20311201"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20311202"));
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  assert.ok(unfolded.includes("Nutricionista\\; piso 3\\, box 2"));
  assert.ok(unfolded.includes("Ir en ayunas\\nLlevar carnet"));
  for (const l of lines) assert.ok(Buffer.byteLength(l, "utf8") <= 75, `line too long: ${l}`);
});

test(".ics for a timed exam uses a local date-time start", () => {
  const ics = controlToIcs({ id: "x", date: "2031-11-30", time: "08:15", kind: "examen", where: "", notes: "", bring: "" }, fixedNow());
  const lines = ics.split("\r\n");
  assert.ok(lines.includes("DTSTART:20311130T081500"));
  assert.ok(!lines.some((l) => l.startsWith("DTSTART;VALUE=DATE")));
  assert.ok(lines.some((l) => l.startsWith("SUMMARY:Examen")));
});
