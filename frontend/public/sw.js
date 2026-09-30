// Karaar AI offline support (B2). Pages and static files are cached so the app opens without a
// connection; API calls (/backend, /v1) are never cached: offline changes wait in the IndexedDB
// outbox and are sent when the connection is back. Registered only in production builds.
const VERSION = "karaar-v2";
const SHELL = ["/", "/new", "/deals", "/profile", "/dashboard", "/login", "/ivr-demo", "/offline.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => undefined)))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Remove caches from older versions, and any left behind by another app on this address.
      const stale = (await caches.keys()).filter((k) => k !== VERSION);
      await Promise.all(stale.map((k) => caches.delete(k)));
      await self.clients.claim();
      if (stale.some((k) => !k.startsWith("karaar-"))) {
        const tabs = await self.clients.matchAll({ type: "window" });
        tabs.forEach((tab) => tab.navigate(tab.url));
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/backend") || url.pathname.startsWith("/v1") || url.pathname.includes("webpack-hmr")) return;

  if (url.pathname.startsWith("/_next/static/") || /\.(woff2?|svg|png|webmanifest)$/.test(url.pathname)) {
    // Fingerprinted files never change: cache first.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate" || url.pathname.startsWith("/_next/")) {
    // Pages: network first (fresh when online), cached copy when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (req.mode === "navigate" ? caches.match("/offline.html") : Response.error())),
    );
  }
});
