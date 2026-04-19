const CACHE_NAME = 'obra-gastos-v1';
const ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './obra.html',
  './perfil.html',
  './reporte.html',
  './css/styles.css',
  './js/config.js',
  './js/offline.js',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Syne:wght@700;800&display=swap'
];

// Instalar y cachear assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activar y limpiar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Interceptar requests
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Requests a la API: network first, si falla devolver error (el offline.js lo maneja)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'SIN_CONEXION' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Assets: cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Escuchar mensaje de sincronización
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
