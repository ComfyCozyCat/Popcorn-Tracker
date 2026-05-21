const CACHE_NAME = "app-test-v2";
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "assets/placeholders/missing-action.png",
  "assets/placeholders/missing-romance.png",
  "assets/placeholders/missing-noir.png",
  "assets/placeholders/missing-horror.png",
  "assets/placeholders/missing-adventure.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
