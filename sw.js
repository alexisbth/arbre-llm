// Service worker: keeps a copy of the app's files so that it opens offline.
// "Network first" strategy: the online version is always used when it can be reached.
const VERSION = 'ramifai-v7.3';
const FICHIERS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  // Each file is cached separately: a missing file (e.g. a PNG icon) does not block the others.
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(FICHIERS.map(f => c.add(f).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(cles => Promise.all(cles.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Only the app's own files: never calls to an LLM API.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); return r; })
      .catch(() => caches.match(e.request))
  );
});
