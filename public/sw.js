/* =============================================================
   sw.js — Service worker di "4 & | 2".
   Strategia:
     - API (/api/*): SOLO rete (mai cache di dati dinamici/privati).
     - Navigazioni: network-first con fallback all'app shell offline.
     - Statici same-origin (css/js/img/font): stale-while-revalidate.
     - Cross-origin (tiles mappa, CDN): passthrough (rete).
   ============================================================= */
const VERSION = 'v9';
const CACHE = `4e2-${VERSION}`;
const CORE = [
  '/',
  '/index.html',
  '/offline.html',
  '/css/variables.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/animations.css',
  '/js/core/api.js',
  '/js/core/auth.js',
  '/js/core/ui.js',
  '/js/core/icons.js',
  '/js/core/shell.js',
  '/js/core/map.js',
  '/js/core/geo.js',
  '/js/core/gamification.js',
  '/js/core/pwa.js',
  '/manifest.webmanifest',
  '/favicon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Cross-origin (tiles, CDN MapLibre, font): lascia fare al browser.
  if (url.origin !== self.location.origin) return;

  // API: sempre rete; nessuna cache dei dati.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // Navigazioni: network-first, fallback shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => { cachePut(request, res.clone()); return res; })
        .catch(async () => (await caches.match(request)) || (await caches.match('/index.html')) || caches.match('/offline.html'))
    );
    return;
  }

  // Statici: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => { cachePut(request, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    })
  );
});

function cachePut(request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  caches.open(CACHE).then((c) => c.put(request, response)).catch(() => {});
}

// Click sulla notifica (es. "tracciamento attivo"): porta in primo piano l'app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('/index.html');
  })());
});
