// Behavior tests for pauta-personal/sw.js (S22 f): network first, and only correct
// answers from this site go into the offline cache.
// Run: node --test 'tests/pauta-personal/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../pauta-personal/sw.js", import.meta.url), "utf8");
const ORIGIN = "http://127.0.0.1:8000";

/** Loads sw.js in a fake worker scope. `network` answers each fetch. */
function load(network) {
  const handlers = {};
  const puts = [];
  const opened = [];
  const stored = new Map([[`${ORIGIN}/index.html`, { from: "cache", url: "index.html" }]]);
  const cache = {
    put: async (req, res) => { puts.push({ url: req.url, res }); },
    addAll: async () => {},
  };
  const scope = {
    self: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      location: { origin: ORIGIN },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async (name) => { opened.push(name); return cache; },
      keys: async () => [],
      delete: async () => true,
      match: async (req) => stored.get(typeof req === "string" ? `${ORIGIN}/${req}` : req.url) || null,
    },
    fetch: async (req) => network(req),
    URL,
    Promise,
  };
  vm.runInNewContext(source, scope);
  return { handlers, puts, opened };
}

/** Dispatches a fetch event; resolves to { answered, response, waits }. */
async function dispatch(sw, url, method = "GET") {
  let answered = null;
  const waits = [];
  sw.handlers.fetch({
    request: { url, method },
    respondWith: (p) => { answered = p; },
    waitUntil: (p) => { waits.push(p); },
  });
  const response = answered ? await answered : null;
  await Promise.all(waits);
  await new Promise((r) => setTimeout(r, 0));
  return { answered: Boolean(answered), response };
}

const res = (status, type = "basic") => ({
  status, type, ok: status >= 200 && status < 300,
  clone() { return { ...this, cloned: true }; },
});

test("S22f: VERSION is pauta-v1", () => {
  assert.match(source, /var VERSION = "pauta-v1";/);
});

test("S22f: a 200 answer from this site is returned and cached under pauta-v1", async () => {
  const sw = load(() => res(200));
  const { response } = await dispatch(sw, `${ORIGIN}/index.html`);
  assert.equal(response.status, 200);
  assert.equal(sw.puts.length, 1);
  assert.equal(sw.puts[0].url, `${ORIGIN}/index.html`);
  assert.deepEqual(sw.opened, ["pauta-v1"]);
});

test("S22f: a 404, 500, 206 or redirect answer is returned but never cached", async () => {
  for (const status of [404, 500, 503, 206, 301]) {
    const sw = load(() => res(status));
    const { response } = await dispatch(sw, `${ORIGIN}/etiqueta.html`);
    assert.equal(response.status, status, `status ${status}`);
    assert.equal(sw.puts.length, 0, `status ${status} must not be cached`);
  }
});

test("S22f: an opaque or cors answer (not this site's basic answer) is never cached", async () => {
  for (const type of ["opaque", "cors", "opaqueredirect", "error"]) {
    const sw = load(() => res(type === "opaque" || type === "opaqueredirect" || type === "error" ? 0 : 200, type));
    await dispatch(sw, `${ORIGIN}/app.js`);
    assert.equal(sw.puts.length, 0, type);
  }
});

test("S22f: still network first, and offline falls back to the cache", async () => {
  let called = 0;
  const sw = load(() => { called += 1; throw new TypeError("offline"); });
  const { response } = await dispatch(sw, `${ORIGIN}/index.html`);
  assert.equal(called, 1);
  assert.deepEqual(response, { from: "cache", url: "index.html" });
  assert.equal(sw.puts.length, 0);
});

test("other origins and non-GET requests are left to the network, never cached", async () => {
  const sw = load(() => res(200));
  assert.equal((await dispatch(sw, "https://lector-etiquetas.example.workers.dev/leer", "POST")).answered, false);
  assert.equal((await dispatch(sw, "https://example.org/x.js")).answered, false);
  assert.equal((await dispatch(sw, `${ORIGIN}/index.html`, "POST")).answered, false);
  assert.equal(sw.puts.length, 0);
});
