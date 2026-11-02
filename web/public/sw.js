// Service worker кеширует только оболочку приложения. Ответы /api/* не кешируются никогда.
const SHELL = 'qarjy-shell-v1';
const FILES = ['/', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return; // сеть напрямую
  e.respondWith(fetch(e.request).then(r => { if (r.ok && (u.pathname.startsWith('/assets/') || FILES.includes(u.pathname))) { const c = r.clone(); caches.open(SHELL).then(ch => ch.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match('/'))));
});
