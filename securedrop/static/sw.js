const CACHE = 'securedrop-lan-v2';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/', '/static/styles.css', '/static/app.js', '/manifest.json'])));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
