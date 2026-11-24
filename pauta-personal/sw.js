// Bump VERSION whenever any cached file changes.
var VERSION = "pauta-v1";
var FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "router.js",
  "registro.html",
  "registro.css",
  "registro.js",
  "registro-core.js",
  "etiqueta.html",
  "etiqueta.css",
  "etiqueta.js",
  "etiqueta-core.js",
  "despensa.html",
  "despensa.css",
  "despensa.js",
  "despensa-core.js",
  "guia.js",
  "guia-core.js",
  "manifest.webmanifest",
  "icon.svg",
  "speaker.svg",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) { return cache.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Network first so a corrected pauta reaches the phone; cache when offline.
// Only this site's own GET requests go through the cache. Anything else, like the
// photo sent to the label reader (a POST to another origin), goes to the network
// only and is never stored.
// Only a correct answer (200, from this site) replaces the cached copy: an error
// page, a partial or redirected answer never overwrites a good offline file.
function cacheable(res) {
  return res && res.ok && res.status === 200 && res.type === "basic";
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then(function (res) {
      if (cacheable(res)) {
        var copy = res.clone();
        var put = caches.open(VERSION).then(function (cache) { return cache.put(event.request, copy); });
        try { event.waitUntil(put); } catch (e) { /* the write still runs */ }
      }
      return res;
    }).catch(function () {
      return caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match("index.html");
      });
    })
  );
});
