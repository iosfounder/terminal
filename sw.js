const V = "terminal-v3";
const SHELL = ["./", "index.html", "manifest.webmanifest", "DotsiesRect.ttf",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  const own = u.origin === location.origin;
  const lib = (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/")) || (u.hostname === "cdnjs.cloudflare.com" && u.pathname.includes("/leaflet/"));
  if (!own && !lib) return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put("index.html", cp)); } return res; })
      .catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => {
    const net = fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
