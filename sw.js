// Keeps AMS working offline. Change RELEASE on every update so devices pick up the new files.
const RELEASE = 'v0.5.2-rms';
const VERSION = 'ams|' + self.registration.scope + '|' + RELEASE;
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'img/coa-logo.png', 'img/icon-192.png', 'img/icon-512.png',
  'js/app.js', 'js/config.js', 'js/db.js', 'js/auth.js', 'js/ui.js', 'js/modules.js', 'js/seed.js', 'js/store.js', 'js/api.js', 'js/sync.js', 'js/views/login.js', 'js/views/dashboard.js', 'js/views/admin.js', 'js/frame.js',
  'modules/rms/rms.js', 'modules/rms/rms.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k.startsWith('ams|' + self.registration.scope + '|')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Saved copy first (works offline), refreshed in the background.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
    const net = fetch(e.request).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone())); return res; }).catch(() => hit);
    return hit || net;
  }));
});
