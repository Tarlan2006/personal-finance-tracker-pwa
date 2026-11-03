// Cache Storage is optional (for example, in restricted Safari sessions).
// API responses always go directly to the network.
const SHELL = 'qarjy-shell-v2';
const FILES = ['/', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png'];
async function withCache(action) {
  try {
    const storage = self.caches;
    if (storage) return await action(storage);
  } catch { /* Disabled storage must not break network responses or activation. */ }
}
self.addEventListener('install', e => {
  e.waitUntil(withCache(async storage => (await storage.open(SHELL)).addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(withCache(async storage => {
    const keys = await storage.keys();
    await Promise.all(keys.filter(k => k.startsWith('qarjy-shell-') && k !== SHELL).map(k => storage.delete(k)));
  }).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || u.pathname === '/api' || u.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    try {
      const response = await fetch(e.request);
      if (response.ok && (u.pathname.startsWith('/assets/') || FILES.includes(u.pathname))) {
        const copy = response.clone();
        e.waitUntil(withCache(async storage => (await storage.open(SHELL)).put(e.request, copy)));
      }
      return response;
    } catch {
      const cached = await withCache(async storage => {
        const cache = await storage.open(SHELL);
        return (await cache.match(e.request)) || (e.request.mode === 'navigate' ? await cache.match('/') : undefined);
      });
      if (cached) return cached;
      if (e.request.mode === 'navigate') return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Qarjy — нет соединения</title><body><h1>Не удалось загрузить Qarjy</h1><p>Проверьте интернет и обновите страницу. В этом режиме браузер может запрещать офлайн-кэш.</p><button onclick="location.reload()">Попробовать снова</button></body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      return Response.error();
    }
  })());
});
