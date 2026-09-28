/*
 * Sportsbook service worker.
 *
 * Goal: work offline, but always pick up the newest deploy automatically.
 *
 * Strategy is NETWORK-FIRST for same-origin GETs — when the device is online
 * it fetches the latest file and refreshes the cache; when offline it falls
 * back to the cached copy, and finally to the app shell. Bumping CACHE on
 * each deploy (or just letting the byte-diff of this file trigger an update)
 * clears old caches and activates the new worker immediately.
 *
 * skipWaiting() + clients.claim() are deliberate: they let the next deploy
 * replace a bad worker instead of waiting for every tab in the world to
 * close. Serve this file with `no-store`, or a bad worker outlives the deploy
 * meant to replace it.
 *
 * WHEN NOT TO USE THIS: if the app's value is that what you are reading is
 * CURRENT — a news reader, a document viewer, anything server-backed — cache
 * far less, or nothing but an offline fallback page. A shell-caching worker
 * will eventually pin somebody to a stale build with no way out short of
 * clearing site data.
 */

var CACHE = "sportsbook-v1";

var SHELL = [
  "./",
  "./index.html",
  "./css/tokens.css",
  "./css/base.css",
  "./css/components.css",
  "./css/account.css",
  "./css/app.css",
  "./js/app.js",
  "./js/ui.js",
  "./js/store.js",
  "./js/install.js",
  "./js/account.js",
  "./js/account-ui.js",
  "./js/sync.js",
  "./manifest.webmanifest",
  "./icons/favicon.svg",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
// Do NOT add large assets here. A big data file or an audio track in the
// shell means every install downloads it before the app is usable. The fetch
// handler below caches same-origin GETs anyway, so it is cached the first
// time it is actually used and works offline after that.

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return c.add(u).catch(function () { /* ignore individual misses */ });
    }));
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match("./index.html");
      });
    })
  );
});
