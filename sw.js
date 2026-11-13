const C = 'kv-v1';
const SHELL = ['./', 'index.html', 'diksyonaer.tsv', 'proverbs.tsv', 'dialogues.json', 'manifest.webmanifest', 'dk-icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const data = /\.(tsv|json)$/.test(u.pathname);
  if (u.origin !== location.origin && !(u.hostname === '7stages.net' && data)) return;
  /* network first, cache as fallback, so dictionary edits show up straight away */
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); } return res; }).catch(async () => (await caches.match(r)) || (await caches.match(u.pathname.split('/').pop() || 'index.html')) || caches.match('index.html')));
});
