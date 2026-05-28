const CACHE_NAME = "popcorn-archive-v23";
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "assets/top_movies_catalog_with_metadata.csv",
  "assets/icons/bookmark.svg",
  "assets/icons/calendar.svg",
  "assets/icons/dice.svg",
  "assets/icons/expand-all.svg",
  "assets/icons/expand-none.svg",
  "assets/icons/filter.svg",
  "assets/icons/imdb-svgrepo-com.svg",
  "assets/icons/popcorn-movie-cinema-svgrepo-com.svg",
  "assets/icons/ribbon.svg",
  "assets/icons/star-empty.svg",
  "assets/icons/star-filled.svg",
  "assets/icons/thumbs-down.svg",
  "assets/icons/thumbs-up.svg",
  "assets/icons/wikipedia.svg",
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

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName === CACHE_NAME) {
            return Promise.resolve();
          }

          return caches.delete(cacheName);
        })
      )
    )
  );

  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put("./", responseClone);
          });

          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./")))
    );

    return;
  }

  if (!isSameOrigin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });

          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});
