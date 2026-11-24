import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import worker, {
  handle,
  MODEL,
  MAX_TOKENS,
  MAX_BODY_BYTES,
  UPSTREAM_TIMEOUT_MS,
  SYSTEM_PROMPT,
  createMemoryLimiter,
} from "../src/index.js";

const BASE = "https://lector-etiquetas.example.workers.dev";
const ORIGIN = "https://tu-usuario.github.io";
const CLIENT_IP = "203.0.113.77";
const CLIENT_UA = "UA-del-telefono-secreto";
const CLIENT_COOKIE = "sesion=cookie-secreta";
const KEY = "sk-or-test-not-a-real-key";
const MARKER = "MARCADOR-IMAGEN-9F3A";

// ---------- fixtures ----------

function bytes(...parts) {
  const chunks = parts.map((p) =>
    typeof p === "string" ? new TextEncoder().encode(p) : Uint8Array.from(p),
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// Minimal JPEG: SOI, APP0 JFIF, SOS, scan data (with a marker), EOI.
function jpeg({ exif = false } = {}) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...bytes("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const app1 = exif
    ? [0xff, 0xe1, 0x00, 0x0e, ...bytes("Exif\0\0"), 0x4d, 0x4d, 0, 0x2a, 0, 0]
    : [];
  const sos = [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0];
  return bytes([0xff, 0xd8], app0, app1, sos, MARKER, [0xff, 0xd9]);
}

function webp() {
  return bytes("RIFF", [0x1a, 0, 0, 0], "WEBP", "VP8 ", [0x0e, 0, 0, 0], MARKER);
}

const VALID_OUTPUT = {
  sellos: {
    alto_en_sodio: "sí",
    alto_en_azucares: "no",
    alto_en_grasas_saturadas: "no se pudo leer",
    alto_en_calorias: "no",
  },
  cloruro_de_potasio: "no",
  sodio_mg_100: 820,
  sodio_mg_porcion: null,
  dice_sal_light: "no",
  categoria_impresa: "ninguna",
};

function upstreamOk(content = JSON.stringify(VALID_OUTPUT)) {
  return new Response(
    JSON.stringify({
      id: "gen-1",
      model: MODEL,
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function mockFetch(responder = () => upstreamOk()) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return responder(url, init);
  };
  fn.calls = calls;
  return fn;
}

function okLimiter() {
  const keys = [];
  return { keys, limit: async ({ key }) => (keys.push(key), { success: true }) };
}

function leer({
  body = jpeg(),
  type = "image/jpeg",
  origin = ORIGIN,
  method = "POST",
  path = "/leer",
  extraHeaders = {},
} = {}) {
  const headers = {
    "CF-Connecting-IP": CLIENT_IP,
    "User-Agent": CLIENT_UA,
    Cookie: CLIENT_COOKIE,
    ...extraHeaders,
  };
  if (origin) headers.Origin = origin;
  if (type) headers["Content-Type"] = type;
  const init = { method, headers };
  if (body && method !== "GET" && method !== "HEAD") init.body = body;
  return new Request(BASE + path, init);
}

const env = (over = {}) => ({ OPENROUTER_API_KEY: KEY, ALLOWED_ORIGIN: ORIGIN, ...over });

async function run(req, { e = env(), fetch = mockFetch(), limiter = okLimiter(), timeoutMs } = {}) {
  const res = await handle(req, e, { fetch, limiter, timeoutMs });
  return { res, fetch, limiter };
}

async function expectError(res, status, message) {
  assert.equal(res.status, status);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await res.json(), { error: message });
}

// ---------- capture every console output ----------

let logs;
const original = {};
beforeEach(() => {
  logs = [];
  for (const m of ["log", "info", "warn", "error", "debug"]) {
    original[m] = console[m];
    console[m] = (...args) => logs.push(args.map(String).join(" "));
  }
});
afterEach(() => {
  for (const m of Object.keys(original)) console[m] = original[m];
});

// ---------- happy path ----------

test("happy path: JPEG from the allowed origin returns exactly the validated JSON", async () => {
  const { res, fetch } = await run(leer());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(res.headers.get("Content-Type"), /^application\/json/);
  assert.deepEqual(await res.json(), { ...VALID_OUTPUT, modelo: MODEL });
  assert.equal(fetch.calls.length, 1);
});

test("happy path: WebP is accepted and sent as a webp data URL", async () => {
  const img = webp();
  const { res, fetch } = await run(leer({ body: img, type: "image/webp" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ...VALID_OUTPUT, modelo: MODEL });
  const sent = JSON.parse(fetch.calls[0].init.body);
  const url = sent.messages[1].content.find((p) => p.type === "image_url").image_url.url;
  assert.equal(url, "data:image/webp;base64," + Buffer.from(img).toString("base64"));
});

test("null sodium values stay null and are never turned into 0", async () => {
  const out = { ...VALID_OUTPUT, sodio_mg_100: null, sodio_mg_porcion: null };
  const { res } = await run(leer(), { fetch: mockFetch(() => upstreamOk(JSON.stringify(out))) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sodio_mg_100, null);
  assert.equal(body.sodio_mg_porcion, null);
});

test("default export delegates to handle with the RATE_LIMITER binding", async () => {
  const limiter = okLimiter();
  const realFetch = globalThis.fetch;
  globalThis.fetch = mockFetch();
  try {
    const res = await worker.fetch(leer(), env({ RATE_LIMITER: limiter }), {});
    assert.equal(res.status, 200);
    assert.deepEqual(limiter.keys, [CLIENT_IP]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- routing ----------

test("GET /leer returns 404 and never calls upstream", async () => {
  const { res, fetch } = await run(leer({ method: "GET" }));
  await expectError(res, 404, "no encontrado");
  assert.equal(fetch.calls.length, 0);
});

test("any other path returns 404", async () => {
  for (const path of ["/", "/chat", "/v1/chat/completions", "/leer/extra"]) {
    const { res, fetch } = await run(leer({ path }));
    await expectError(res, 404, "no encontrado");
    assert.equal(fetch.calls.length, 0);
  }
});

test("PUT /leer returns 404", async () => {
  const { res } = await run(leer({ method: "PUT" }));
  await expectError(res, 404, "no encontrado");
});

// ---------- body limits ----------

test("body over 1.5 MB returns 413", async () => {
  assert.equal(MAX_BODY_BYTES, 1.5 * 1024 * 1024);
  const big = new Uint8Array(MAX_BODY_BYTES + 1);
  big.set([0xff, 0xd8, 0xff, 0xe0]);
  const { res, fetch } = await run(leer({ body: big }));
  await expectError(res, 413, "imagen demasiado grande");
  assert.equal(fetch.calls.length, 0);
});

test("declared Content-Length over the limit returns 413 before reading", async () => {
  const { res } = await run(
    leer({ extraHeaders: { "Content-Length": String(MAX_BODY_BYTES + 10) } }),
  );
  await expectError(res, 413, "imagen demasiado grande");
});

test("streamed body over the limit (no Content-Length) returns 413", async () => {
  const chunk = new Uint8Array(512 * 1024);
  chunk.set([0xff, 0xd8, 0xff, 0xe0]);
  let sent = 0;
  const stream = new ReadableStream({
    pull(c) {
      if (sent >= 4) return c.close();
      sent++;
      c.enqueue(chunk.slice());
    },
  });
  const req = new Request(BASE + "/leer", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "image/jpeg", "CF-Connecting-IP": CLIENT_IP },
    body: stream,
    duplex: "half",
  });
  const { res } = await run(req);
  await expectError(res, 413, "imagen demasiado grande");
});

test("other content types return 415 (including text, JSON and PNG)", async () => {
  for (const type of ["text/plain", "application/json", "image/png", "multipart/form-data", null]) {
    const { res, fetch } = await run(leer({ type }));
    await expectError(res, 415, "tipo de imagen no admitido");
    assert.equal(fetch.calls.length, 0);
  }
});

test("bad magic bytes return 400", async () => {
  const cases = [
    { type: "image/jpeg", body: bytes("GIF89a", MARKER) },
    { type: "image/webp", body: bytes("RIFF", [0, 0, 0, 0], "AVIF", MARKER) },
    { type: "image/webp", body: jpeg() },
    { type: "image/jpeg", body: webp() },
    { type: "image/jpeg", body: bytes([0xff, 0xd8]) },
  ];
  for (const c of cases) {
    const { res, fetch } = await run(leer(c));
    await expectError(res, 400, "imagen no válida");
    assert.equal(fetch.calls.length, 0);
  }
});

test("JPEG with an APP1 Exif segment returns 400 «foto con metadatos»", async () => {
  const { res, fetch } = await run(leer({ body: jpeg({ exif: true }) }));
  await expectError(res, 400, "foto con metadatos");
  assert.equal(fetch.calls.length, 0);
});

test("WebP with an EXIF chunk returns 400 «foto con metadatos»", async () => {
  const body = bytes("RIFF", [0x1a, 0, 0, 0], "WEBP", "EXIF", [4, 0, 0, 0], "MM\0*", MARKER);
  const { res } = await run(leer({ body, type: "image/webp" }));
  await expectError(res, 400, "foto con metadatos");
});

// ---------- origin and CORS ----------

test("missing Origin returns 403 without CORS headers", async () => {
  const { res, fetch } = await run(leer({ origin: null }));
  await expectError(res, 403, "origen no permitido");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(fetch.calls.length, 0);
});

test("disallowed Origin returns 403 without CORS headers", async () => {
  for (const origin of [
    "https://evil.example",
    "https://tu-usuario.github.io.evil.example",
    "http://tu-usuario.github.io",
    "http://localhost:8000",
  ]) {
    const { res, fetch } = await run(leer({ origin }));
    await expectError(res, 403, "origen no permitido");
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(fetch.calls.length, 0);
  }
});

test("localhost origins are allowed only when ALLOW_LOCAL_ORIGIN is 1", async () => {
  for (const origin of ["http://localhost:8000", "http://127.0.0.1:5173"]) {
    const { res } = await run(leer({ origin }), { e: env({ ALLOW_LOCAL_ORIGIN: "1" }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
  }
  const { res } = await run(leer({ origin: "http://localhost.evil.example" }), {
    e: env({ ALLOW_LOCAL_ORIGIN: "1" }),
  });
  await expectError(res, 403, "origen no permitido");
});

test("CORS preflight from the allowed origin returns 204 with CORS headers", async () => {
  const req = new Request(BASE + "/leer", {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  const { res, fetch } = await run(req);
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(res.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.match(res.headers.get("Vary"), /Origin/);
  assert.equal(fetch.calls.length, 0);
});

test("CORS preflight from a disallowed origin returns 403 without CORS headers", async () => {
  const req = new Request(BASE + "/leer", {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
  });
  const { res } = await run(req);
  await expectError(res, 403, "origen no permitido");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});

// ---------- rate limit ----------

test("rate limiter over the limit returns 429, keyed by CF-Connecting-IP", async () => {
  const keys = [];
  const limiter = { limit: async ({ key }) => (keys.push(key), { success: false }) };
  const { res, fetch } = await run(leer(), { limiter });
  await expectError(res, 429, "demasiadas solicitudes");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.deepEqual(keys, [CLIENT_IP]);
  assert.equal(fetch.calls.length, 0);
});

test("without a binding the in-memory limiter allows 10 per window and then returns 429", async () => {
  const limiter = createMemoryLimiter({ limit: 10, periodMs: 60_000 });
  const fetch = mockFetch();
  for (let i = 0; i < 10; i++) {
    const { res } = await run(leer(), { limiter, fetch });
    assert.equal(res.status, 200);
  }
  const { res } = await run(leer(), { limiter, fetch });
  await expectError(res, 429, "demasiadas solicitudes");
  assert.equal(fetch.calls.length, 10);
});

test("with no binding and no injected limiter the handler still works", async () => {
  const res = await handle(leer(), env(), { fetch: mockFetch() });
  assert.equal(res.status, 200);
});

// ---------- configuration ----------

test("missing OPENROUTER_API_KEY returns 503 «servicio no configurado»", async () => {
  const { res, fetch } = await run(leer(), { e: { ALLOWED_ORIGIN: ORIGIN } });
  await expectError(res, 503, "servicio no configurado");
  assert.equal(fetch.calls.length, 0);
});

// ---------- model output validation ----------

const BAD_OUTPUTS = {
  "not JSON": "Claro, aquí va: el producto tiene sello ALTO EN SODIO",
  "fenced JSON": "```json\n" + JSON.stringify(VALID_OUTPUT) + "\n```",
  "extra top-level key": JSON.stringify({ ...VALID_OUTPUT, consejo: "puedes comerlo" }),
  "extra seal key": JSON.stringify({
    ...VALID_OUTPUT,
    sellos: { ...VALID_OUTPUT.sellos, alto_en_potasio: "no" },
  }),
  "missing key": JSON.stringify({ ...VALID_OUTPUT, sodio_mg_porcion: undefined }),
  "wrong enum": JSON.stringify({ ...VALID_OUTPUT, cloruro_de_potasio: "si" }),
  "wrong seal enum": JSON.stringify({
    ...VALID_OUTPUT,
    sellos: { ...VALID_OUTPUT.sellos, alto_en_sodio: true },
  }),
  "negative number": JSON.stringify({ ...VALID_OUTPUT, sodio_mg_100: -5 }),
  "number as string": JSON.stringify({ ...VALID_OUTPUT, sodio_mg_porcion: "120" }),
  "array instead of object": JSON.stringify([VALID_OUTPUT]),
};

for (const [name, content] of Object.entries(BAD_OUTPUTS)) {
  test(`model output «${name}» returns 502 and never passes raw text`, async () => {
    const { res } = await run(leer(), { fetch: mockFetch(() => upstreamOk(content)) });
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: "no se pudo leer la etiqueta" });
    assert.ok(!text.includes("puedes comerlo"));
  });
}

test("upstream non-200 returns 502", async () => {
  const fetch = mockFetch(() => new Response("{\"error\":{\"message\":\"x\"}}", { status: 500 }));
  const { res } = await run(leer(), { fetch });
  await expectError(res, 502, "no se pudo leer la etiqueta");
});

test("upstream response without choices returns 502", async () => {
  const fetch = mockFetch(() => new Response("{\"choices\":[]}", { status: 200 }));
  const { res } = await run(leer(), { fetch });
  await expectError(res, 502, "no se pudo leer la etiqueta");
});

test("upstream network error returns 502", async () => {
  const fetch = mockFetch(() => {
    throw new TypeError("fetch failed");
  });
  const { res } = await run(leer(), { fetch });
  await expectError(res, 502, "no se pudo leer la etiqueta");
});

test("upstream timeout returns 504 and aborts the upstream request", async () => {
  assert.equal(UPSTREAM_TIMEOUT_MS, 20_000);
  let aborted = false;
  const fetch = mockFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  );
  const { res } = await run(leer(), { fetch, timeoutMs: 20 });
  await expectError(res, 504, "la lectura tardó demasiado");
  assert.equal(aborted, true);
});

// ---------- upstream request shape ----------

test("upstream request: fixed model, max_tokens, temperature 0, strict schema, data URL, no client data", async () => {
  const img = jpeg();
  const { res, fetch } = await run(leer({ body: img }));
  assert.equal(res.status, 200);
  assert.equal(fetch.calls.length, 1);
  const { url, init } = fetch.calls[0];
  assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(init.method, "POST");
  assert.ok(init.signal, "upstream call has an abort signal");

  const headers = new Headers(init.headers);
  assert.equal(headers.get("Authorization"), `Bearer ${KEY}`);
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.deepEqual([...headers.keys()].sort(), ["authorization", "content-type"]);

  const sent = JSON.parse(init.body);
  assert.equal(sent.model, MODEL);
  assert.equal(sent.max_tokens, MAX_TOKENS);
  assert.ok(MAX_TOKENS >= 200 && MAX_TOKENS <= 400);
  assert.equal(sent.temperature, 0);
  assert.equal(sent.response_format.type, "json_schema");
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.equal(sent.response_format.json_schema.schema.additionalProperties, false);
  assert.equal("user" in sent, false);

  assert.equal(sent.messages[0].role, "system");
  assert.equal(sent.messages[0].content, SYSTEM_PROMPT);
  assert.equal(sent.messages[1].role, "user");
  const image = sent.messages[1].content.find((p) => p.type === "image_url");
  assert.equal(image.image_url.url, "data:image/jpeg;base64," + Buffer.from(img).toString("base64"));

  const wire = init.body + JSON.stringify([...headers.entries()]);
  for (const secret of [CLIENT_IP, CLIENT_UA, CLIENT_COOKIE, "cookie-secreta", ORIGIN, "tu-usuario"]) {
    assert.ok(!wire.includes(secret), `upstream request must not contain ${secret}`);
  }
});

test("the fixed system prompt names the four seals, cloruro de potasio/KCl and forbids advice", () => {
  for (const s of [
    "Ley 20.606",
    "«ALTO EN SODIO»",
    "«ALTO EN AZÚCARES»",
    "«ALTO EN GRASAS SATURADAS»",
    "«ALTO EN CALORÍAS»",
    "«cloruro de potasio»",
    "«KCl»",
    "VISIBLE",
  ]) {
    assert.ok(SYSTEM_PROMPT.includes(s), `prompt must include ${s}`);
  }
  assert.match(SYSTEM_PROMPT, /no des consejos/i);
  assert.match(SYSTEM_PROMPT, /no deduzcas/i);
  assert.match(SYSTEM_PROMPT, /adecuado/i);
});

// S22 (h): other names of potassium chloride count as «sí»; the distractors stay.
test("S22h: the prompt counts «cloruro potásico», E508, E 508 and INS 508 as cloruro de potasio", () => {
  const rule = SYSTEM_PROMPT.split("cloruro_de_potasio:")[1].split("\n\n")[0];
  for (const s of ["«cloruro de potasio»", "«cloruro potásico»", "«KCl»", "«E508»", "«E 508»", "«INS 508»"]) {
    assert.ok(rule.includes(s), `potassium rule must include ${s}`);
  }
  assert.ok(
    rule.includes(
      "Otros compuestos, como «lactato de potasio», «sorbato de potasio», «citrato de potasio» o «cloruro de calcio», no son cloruro de potasio.",
    ),
    "distractor sentence",
  );
});

// ---------- privacy: logging ----------

test("nothing logged contains image bytes or model output; only status codes", async () => {
  const img = jpeg();
  const b64 = Buffer.from(img).toString("base64");
  const statuses = [];
  const scenarios = [
    [leer({ body: img }), {}],
    [leer({ body: img }), { fetch: mockFetch(() => upstreamOk("texto libre " + MARKER)) }],
    [leer({ body: jpeg({ exif: true }) }), {}],
    [leer({ body: img, origin: "https://evil.example" }), {}],
  ];
  for (const [req, opts] of scenarios) {
    const { res } = await run(req, opts);
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [200, 502, 400, 403]);
  assert.ok(logs.length > 0, "status codes are logged");
  for (const line of logs) {
    assert.match(line, /^status=\d{3}$/);
    assert.ok(!line.includes(MARKER));
    assert.ok(!line.includes(b64.slice(0, 16)));
    assert.ok(!line.includes("820"));
  }
});

// ---------- config files ----------

test("wrangler.toml: workers.dev only, observability off, RATE_LIMITER, no secrets", async () => {
  const toml = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /^name = "lector-etiquetas"$/m);
  assert.doesNotMatch(toml, /^\s*account_id/m);
  assert.match(toml, /^ALLOWED_ORIGIN = "https:\/\/[^"\/]+"$/m);
  assert.match(toml, /^workers_dev = true$/m);
  assert.match(toml, /^compatibility_date = "20\d\d-\d\d-\d\d"$/m);
  assert.match(toml, /^\[observability\]\s*\nenabled = false$/m);
  assert.match(toml, /^\[\[ratelimits\]\]\s*\nname = "RATE_LIMITER"$/m);
  assert.doesNotMatch(toml, /^\s*routes?\s*=/m);
  assert.doesNotMatch(toml, /^\s*\[\[?routes/m);
  assert.doesNotMatch(toml, /custom_domain/);
  assert.doesNotMatch(toml, /OPENROUTER_API_KEY\s*=/);
  assert.doesNotMatch(toml, /ALLOW_LOCAL_ORIGIN/);
  assert.doesNotMatch(toml, /sk-or-/);

  const gi = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  for (const entry of [".dev.vars", "node_modules", ".wrangler"]) {
    assert.ok(gi.split("\n").some((l) => l.trim().replace(/\/$/, "") === entry), entry);
  }
});

// Probes added after independent verification (T18).

// S20: rate limit fails closed when the limiter errors or returns garbage
test("rate limiter that throws or returns no success fails closed with 429", async () => {
  for (const limiter of [
    { limit: async () => { throw new Error("kv down"); } },
    { limit: async () => undefined },
    { limit: async () => ({ success: "true" }) },
  ]) {
    const { res, fetch } = await run(leer(), { limiter });
    await expectError(res, 429, "demasiadas solicitudes");
    assert.equal(fetch.calls.length, 0);
  }
});

// S20: key never echoed even when upstream errors contain it
test("upstream errors containing the key never leak it to body or logs", async () => {
  for (const fetch of [
    mockFetch(() => { throw new Error("boom " + KEY); }),
    mockFetch(() => new Response(JSON.stringify({ error: { message: "bad " + KEY } }), { status: 401 })),
  ]) {
    const { res } = await run(leer(), { fetch });
    const text = await res.text();
    assert.equal(res.status, 502);
    assert.ok(!text.includes(KEY));
  }
  assert.ok(logs.every((l) => !l.includes(KEY)));
});

// S20: XMP APP1 and VP8X-chunked WebP EXIF are metadata too; empty body is invalid
test("JPEG with XMP APP1 and VP8X WebP with EXIF return 400 «foto con metadatos»", async () => {
  const xmp = bytes([0xff, 0xd8], [0xff, 0xe0, 0, 0x10], "JFIF\0", [1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xe1, 0, 0x20], "http://ns.adobe.com/xap/1.0/\0",
    [0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0], MARKER, [0xff, 0xd9]);
  await expectError((await run(leer({ body: xmp }))).res, 400, "foto con metadatos");
  const vp8x = bytes("RIFF", [0x2e, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0],
    [8, 0, 0, 0, 0, 0, 0, 0, 0, 0], "EXIF", [4, 0, 0, 0], "MM\0*");
  await expectError((await run(leer({ body: vp8x, type: "image/webp" }))).res, 400, "foto con metadatos");
  await expectError((await run(leer({ body: new Uint8Array(0) }))).res, 400, "imagen no válida");
});

// ---------- S24: «sal light» on the front and the printed product type ----------

const S24_CATEGORIES = [
  "cecinas", "vienesas", "hamburguesas procesadas", "nuggets", "caldos en cubo",
  "sopas instantáneas", "conservas", "salsas comerciales",
];

async function readWith(over) {
  const content = JSON.stringify({ ...VALID_OUTPUT, ...over });
  const { res } = await run(leer(), { fetch: mockFetch(() => upstreamOk(content)) });
  return res;
}

test("S24: the strict schema asks for dice_sal_light and categoria_impresa with closed enums", async () => {
  const { fetch } = await run(leer());
  const schema = JSON.parse(fetch.calls[0].init.body).response_format.json_schema.schema;
  assert.deepEqual(schema.required, ["sellos", "cloruro_de_potasio", "sodio_mg_100", "sodio_mg_porcion", "dice_sal_light", "categoria_impresa"]);
  assert.deepEqual(schema.properties.dice_sal_light, { type: "string", enum: ["sí", "no", "no se pudo leer"] });
  assert.deepEqual(schema.properties.categoria_impresa, { type: "string", enum: [...S24_CATEGORIES, "ninguna", "no se pudo leer"] });
  assert.equal(schema.additionalProperties, false);
});

test("S24: every allowed value of the two new fields passes through as is", async () => {
  for (const v of ["sí", "no", "no se pudo leer"]) {
    const res = await readWith({ dice_sal_light: v });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).dice_sal_light, v);
  }
  for (const v of [...S24_CATEGORIES, "ninguna", "no se pudo leer"]) {
    const res = await readWith({ categoria_impresa: v });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).categoria_impresa, v);
  }
});

test("S24: a product type outside the closed list becomes «no se pudo leer», never passed through", async () => {
  for (const v of ["salchichas", "salchicha", "Cecinas", "sopa", "sopaipillas", "embutidos", "vienesa", "", "puedes comerlo"]) {
    const res = await readWith({ categoria_impresa: v });
    assert.equal(res.status, 200, v);
    const text = await res.text();
    assert.equal(JSON.parse(text).categoria_impresa, "no se pudo leer", v);
    if (v) assert.ok(!text.includes(`"${v}"`), v);
  }
});

test("S24: a wrong type or a missing new field returns 502", async () => {
  const cases = [
    { dice_sal_light: "si" }, { dice_sal_light: true }, { dice_sal_light: null },
    { categoria_impresa: null }, { categoria_impresa: ["cecinas"] }, { categoria_impresa: 3 },
    { dice_sal_light: undefined }, { categoria_impresa: undefined },
  ];
  for (const over of cases) {
    const res = await readWith(over);
    await expectError(res, 502, "no se pudo leer la etiqueta");
  }
});

test("S24: the prompt reads «sal light» only from the front, never from the ingredients", () => {
  const rule = SYSTEM_PROMPT.split("dice_sal_light:")[1].split("\n\n")[0];
  for (const s of ["FRENTE", "«sal light»", "«+ potasio»", "«+potasio»", "«con potasio»", "\"sí\"", "\"no\"", "\"no se pudo leer\""]) {
    assert.ok(rule.includes(s), `sal light rule must include ${s}`);
  }
  assert.match(rule, /no lo deduzcas de la lista de ingredientes/i);
});

test("S24: the prompt names the closed list of product types, literal words only, no synonyms", () => {
  const rule = SYSTEM_PROMPT.split("categoria_impresa:")[1].split("\n\n")[0];
  for (const c of S24_CATEGORIES) assert.ok(rule.includes(`"${c}"`), c);
  for (const s of ["\"ninguna\"", "\"no se pudo leer\"", "singular o plural", "«salchicha» no es «vienesas»", "«sopaipillas»", "sinónimos"]) {
    assert.ok(rule.includes(s), `category rule must include ${s}`);
  }
});

test("S24: the earlier rules stay in the prompt (seals, KCl synonyms and distractors, sodium, no advice)", () => {
  for (const s of ["«ALTO EN SODIO»", "«E508»", "«INS 508»", "«lactato de potasio»", "Nunca escribas 0", "No des consejos"]) {
    assert.ok(SYSTEM_PROMPT.includes(s), s);
  }
});

// S20: empty key and OPTIONS without Origin
test("empty OPENROUTER_API_KEY returns 503; OPTIONS without Origin returns 403", async () => {
  await expectError((await run(leer(), { e: { OPENROUTER_API_KEY: "", ALLOWED_ORIGIN: ORIGIN } })).res, 503, "servicio no configurado");
  const req = new Request(BASE + "/leer", { method: "OPTIONS" });
  await expectError((await run(req)).res, 403, "origen no permitido");
});

test("S24: the reader never proposes 'snacks salados' (eval: inferred from potato chips); the person can still choose it", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /snacks salados/);
  assert.match(src, /«papas fritas» no es ninguno de esos tipos/);
});

test("without ALLOWED_ORIGIN every origin is refused with 403 and nothing is sent", async () => {
  for (const value of [undefined, "", "   ", 5]) {
    const { res, fetch } = await run(leer(), { e: env({ ALLOWED_ORIGIN: value }) });
    await expectError(res, 403, "origen no permitido");
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(fetch.calls.length, 0);
  }
});

test("the allowed origin is the one set in ALLOWED_ORIGIN, matched exactly", async () => {
  const other = "https://otra-persona.github.io";
  const ok = await run(leer({ origin: other }), { e: env({ ALLOWED_ORIGIN: other }) });
  assert.equal(ok.res.status, 200);
  assert.equal(ok.res.headers.get("Access-Control-Allow-Origin"), other);
  const no = await run(leer({ origin: ORIGIN }), { e: env({ ALLOWED_ORIGIN: other }) });
  await expectError(no.res, 403, "origen no permitido");
  assert.equal(no.fetch.calls.length, 0);
});
