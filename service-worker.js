const CACHE_NAME = "ambulance-report-v7";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./track.js",
  "./amb.js",
  "./storage.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Same-origin files: NETWORK-first (so a new track.js / app.js reaches phones straight away), falling back to the cache when offline.
// Backend calls (POST to Apps Script) are never cached — case submissions must not be served stale.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const same = req.url.startsWith(self.location.origin);
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && same) { const copy = res.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req))
  );
});
