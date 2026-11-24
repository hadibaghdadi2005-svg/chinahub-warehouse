/* Service worker: enough to make the app installable and to survive the
 * warehouse wifi dropping, and no more.
 *
 * What is cached: the shell — this app's own files and the pinned supabase-js
 * module. What is never cached: anything to do with the database or signing
 * in. Warehouse records change by the minute and are answered per signed-in
 * person, so a stale or someone else's copy would be worse than no answer.
 */
/* Stamped by publish-pages.js. It has to change on every publish, or the
   browser sees identical bytes, keeps the old worker, and the old cache with
   it. */
const VERSION = "chinahub-dev";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./logo.png",
  "./logo-mark.png",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];
const VENDOR = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
/* Addresses that name an exact version, so what they return never changes:
   supabase-js and the parts it loads, the barcode library, and the fonts. */
const IMMUTABLE = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/@supabase\/[^/]+@\d[^/]*\/|cdnjs\.cloudflare\.com\/ajax\/libs\/[^/]+\/\d|fonts\.(googleapis|gstatic)\.com\/)/;
/* How long to wait for the network before using the saved copy. */
const WAIT_MS = 2500;

/* The network's answer if it comes within WAIT_MS, otherwise the saved copy.
   Either way a good network answer is saved for next time. `cache: "reload"`
   goes past the browser's own HTTP cache: without it, GitHub Pages' ten-minute
   max-age can serve yesterday's app to someone just told a fix is live. */
async function freshOrSaved(req, key) {
  const c = await caches.open(VERSION);
  const net = fetch(req, { cache: "reload" }).then(res => {
    if (!res || !res.ok) return null;
    c.put(key, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  const saved = await c.match(key);
  if (!saved) return net;
  const late = new Promise(r => setTimeout(() => r(null), WAIT_MS));
  return (await Promise.race([net, late])) || saved;
}

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
     uncached — except libraries and fonts whose address carries a fixed
     version. Those bytes can never change, so they are kept on the phone and
     never fetched twice. */
  if (!sameOrigin) {
    if (IMMUTABLE.test(req.url))
      e.respondWith((async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque"))
          (await caches.open(VERSION)).put(req, res.clone()).catch(() => {});
        return res;
      })());
    return;
  }

  /* The app's code, styles and page come from the network, so a deploy is
     picked up — but only for as long as the network answers quickly. On slow
     warehouse wifi or mobile data, the copy saved last time is used after a
     short wait instead of leaving a blank screen, and the download carries on
     in the background so the next opening has the new copy. */
  if (/\/(app\.js|styles\.css)$/.test(url.pathname)) {
    e.respondWith(freshOrSaved(req, req).then(r => r || new Response("", { status: 504 })));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(freshOrSaved(req, "./index.html").then(r => r ||
      new Response("Offline, and the app is not cached yet.",
        { status: 503, headers: { "content-type": "text/plain" } })));
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

/* Phone notifications (Hamra clients). The server sends {title, body, tag,
   url}; a tap focuses an open copy of the app, or opens one on that page. */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "ChinaHub", {
    body: d.body || "",
    tag: d.tag || "chinahub",
    renotify: true,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        return w.navigate(url).catch(() => {});
      }
    }
    return self.clients.openWindow(url);
  })());
});
