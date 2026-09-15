const SHELL_CACHE = "urbanaccess-shell-v2";
const TILE_CACHE = "urbanaccess-map-tiles-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./src/styles.css",
  "./src/app.js",
  "./src/db.js",
  "./src/domain.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![SHELL_CACHE, TILE_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function trimTileCache(cache, maxEntries = 120) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((request) => cache.delete(request)));
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok || response.type === "opaque") {
          cache.put(event.request, response.clone());
          trimTileCache(cache);
        }
        return response;
      } catch {
        return (await cache.match(event.request)) || Response.error();
      }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      const cache = await caches.open(SHELL_CACHE);
      cache.put(event.request, response.clone());
      return response;
    })());
  }
});
