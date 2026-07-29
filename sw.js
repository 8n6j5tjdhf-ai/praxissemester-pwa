// Service Worker NUR für die PWA (iPhone/iPad, GitHub Pages) - siehe app.js,
// wo die Registrierung bewusst auf "kein lokaler Server erreichbar" begrenzt
// ist. In der Electron-App (Mac) läuft server.py und liefert Dateien immer
// frisch von der Festplatte; ein Service Worker dort würde riskieren, eine
// veraltete app.js/index.html zwischenzuspeichern und künftige Änderungen zu
// verschleiern - deshalb registriert sich dieses Skript dort nie.
//
// Cached wird ausschließlich die statische App-Shell, NIE Supabase-Antworten
// oder sonstige Daten - iOS Safari hat kein verlässliches Background-Sync,
// ein "funktioniert komplett offline"-Versprechen wäre hier irreführend.
const CACHE_NAME = 'praxissemester-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './sync.js',
  './config.js',
  './vendor/supabase-js.min.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Nur eigene, statische GET-Requests cachen - alles Richtung Supabase
  // (anderer Origin) oder jede Nicht-GET-Anfrage läuft unverändert durch.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
