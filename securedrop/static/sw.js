const CACHE = 'securedrop-lan-v2.3';
const ASSETS = [
  '/',
  '/send',
  '/receive',
  '/peers',
  '/clipboard',
  '/static/styles.css',
  '/static/common.js',
  '/static/send.js',
  '/static/receive.js',
  '/static/share.js',
  '/static/dashboard.js',
  '/static/peers.js',
  '/static/clipboard.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
