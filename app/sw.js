/* Service worker: enough to make the app installable and to survive the
 * warehouse wifi dropping, and no more.
 *
 * What is cached: the shell — this app's own files and the pinned supabase-js
 * module. What is never cached: anything to do with the database or signing
 * in. Warehouse records change by the minute and are answered per signed-in
 * person, so a stale or someone else's copy would be worse than no answer.
 */
const VERSION = "chinahub-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];
const VENDOR = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    /* One missing file must not fail the whole install. */
    await Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: "reload" }))));
    await c.add(new Request(VENDOR, { mode: "cors" })).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  /* Supabase and anything else off-origin goes straight out, untouched and
     uncached. The one exception is the pinned module, which cannot change
     under a version-locked URL. */
  if (!sameOrigin) {
    if (req.url === VENDOR)
      e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }

  /* A navigation gets the network first so a deploy is picked up, and the
     cached shell when there is nothing to reach. */
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(VERSION);
        c.put("./index.html", fresh.clone());
        return fresh;
      } catch (_) {
        return (await caches.match("./index.html")) ||
               new Response("Offline, and the app is not cached yet.",
                 { status: 503, headers: { "content-type": "text/plain" } });
      }
    })());
    return;
  }

  /* Static files: cache first, refreshed quietly in the background. */
  e.respondWith((async () => {
    const hit = await caches.match(req);
    const net = fetch(req).then(res => {
      if (res && res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    return hit || (await net) ||
      new Response("", { status: 504 });
  })());
});
