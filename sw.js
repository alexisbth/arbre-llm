// Service worker : garde une copie des fichiers de l'appli pour qu'elle s'ouvre hors connexion.
// Stratégie « réseau d'abord » : la version en ligne est toujours prise si elle est joignable.
const VERSION = 'arbre-llm-v2';
const FICHIERS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  // Chaque fichier est mis en cache séparément : un fichier absent (ex. icône PNG) ne bloque pas les autres.
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(FICHIERS.map(f => c.add(f).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(cles => Promise.all(cles.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Uniquement les fichiers de l'appli : jamais les appels à une API de LLM.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); return r; })
      .catch(() => caches.match(e.request))
  );
});
