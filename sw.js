/* Diksyonær offline support: network first, cached copy when offline. Clears caches left by earlier apps on this domain. */
const V = 'diksyonaer-v4';
const SHELL = ['./', 'index.html', 'diksyonaer.tsv', 'kours.tsv', 'essential-500.tsv', 'vocab101.tsv', 'grammar.json', 'manifest.webmanifest', 'dk-icon-48.png', 'dk-icon-180.png', 'dk-icon-192.png', 'dk-icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== V) await caches.delete(k); await self.clients.claim(); })()); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(V);
    try {
      const res = await fetch(r, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') c.put(r.mode === 'navigate' ? 'index.html' : r, res.clone());
      return res;
    } catch (err) {
      const hit = await c.match(r.mode === 'navigate' ? 'index.html' : r, { ignoreSearch: true });
      return hit || Response.error();
    }
  })());
});
