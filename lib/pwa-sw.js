/* MedhaIQ service worker. Served at /sw.js by routes/pwa.js (only when PWA_ENABLED=on).
   Deliberately tiny: it makes the app installable and shows a branded offline screen
   when a page cannot be reached. It never caches pages, APIs or sign-in, and never
   intercepts the live interview, payments or auth, so it cannot serve stale or private data. */
const VERSION = 'mh-pwa-v1';
const OFFLINE = '/pwa/offline.html';
const PRECACHE = [OFFLINE, '/assets/branding/medhaiq-icon.png', '/assets/pwa/pjs-700.woff2', '/assets/pwa/icon-192.png'];
const NEVER = [/^\/api\//, /^\/auth\//, /^\/interview\/session\//, /^\/checkout/, /^\/pwa\//, /^\/admin/, /^\/founder/, /^\/debug/, /^\/sw\.js$/, /^\/app\//];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((re) => re.test(url.pathname))) return;
  e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});
