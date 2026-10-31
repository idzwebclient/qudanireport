// Bump on any change to this file's caching behaviour.
const CACHE = 'rekod-modal-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  // Supabase calls are cross-origin and never cached; the app has its own offline store.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Redirects to /login are not stored, so only a signed-in shell is ever replayed.
          if (url.pathname === '/' && response.ok && !response.redirected) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put('/', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match('/')) ?? new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rekod Modal</title><body style="font:16px system-ui;padding:32px"><h1>Tiada sambungan</h1><p>Buka app sekali semasa online untuk guna secara offline.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        )),
    );
    return;
  }

  // Hashed build files never change, so cache-first is safe for them.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(hit => hit ?? fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});
