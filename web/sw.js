const CACHE_NAME = 'aura-shell-v2';
const APP_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/data/activity_bank.json',
  '/data/dss.json',
  '/data/milestone_priors.json',
  '/data/remediation_templates.json',
  '/bkt_engine.js',
  '/bandit_engine.js',
  '/guardrail_engine.js',
  '/recovery_engine.js',
  '/aura-api.js',
  '/config.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
  );
});
