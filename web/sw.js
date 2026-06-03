/* ============================================================
   AURA Service Worker  —  sw.js
   Cache-first offline strategy.
   Background sync wired to AURA_API.syncNow().
   ============================================================ */

const CACHE_VERSION = 'aura-v8';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/icon.svg',
  '/manifest.json',
  '/aura-api.js',
  '/ml_pipeline/ml_inference.js',
  '/ml_pipeline/who_standards.json',
  '/ml_pipeline/aura_sam_predictor_80kb.txt'
  // yolov8n.onnx (12 MB) is excluded from pre-cache to avoid SW install timeout;
  // it is cached on first use by the fetch handler.
];

// ─── Install: pre-cache static shell ───────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing AURA service worker v2');
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache =>
      // Use individual adds so one failure doesn't block the rest
      Promise.allSettled(STATIC_ASSETS.map(url =>
        cache.add(url).catch(err => console.warn('[SW] Pre-cache skip:', url, err.message))
      ))
    )
  );
  self.skipWaiting();
});

// ─── Activate: purge stale caches ──────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating, cleaning old caches');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch: cache-first; skip /api/* (always network) ──────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // /api/* and Ollama calls → always network, 503 fallback offline
  if (url.pathname.startsWith('/api/') || url.hostname === 'localhost' && url.port === '11434') {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline', code: 503 }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // App code (HTML navigations + .js) → NETWORK-FIRST so redeploys always load.
  // Falls back to cache only when offline.
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then(c => c || caches.match('/index.html'))
      )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});

// ─── Background Sync: call AURA_API.syncNow() ──────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'aura-poshan-sync') {
    console.log('[SW] Background sync: aura-poshan-sync');
    event.waitUntil(runPoshanSync());
  }
  if (event.tag === 'aura-pdf-gen') {
    event.waitUntil(runPDFGeneration());
  }
});

async function runPoshanSync() {
  const clients = await self.clients.matchAll();

  // Ask a client to run AURA_API.syncNow() (it has DB access)
  for (const client of clients) {
    client.postMessage({ type: 'RUN_SYNC' });
  }

  // If no clients are open, attempt a direct POST with queued data
  // (best-effort: the main thread will reconcile on next open)
  if (!clients.length) {
    try {
      await fetch('/api/attendance', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    } catch (_) {}
  }

  clients.forEach(c => c.postMessage({ type: 'SYNC_COMPLETE' }));
}

async function runPDFGeneration() {
  console.log('[SW] PDF generation deferred to server /api/pdf/*');
}

// ─── Push Notifications: malnutrition early-warning alerts ─
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const options = {
    body:     data.body    ?? 'A child needs attention today.',
    icon:     '/icon.svg',
    badge:    '/icon.svg',
    tag:      'aura-health-alert',
    vibrate:  [200, 100, 200],
    data:     { screen: data.screen ?? 'triage', childId: data.childId ?? null }
  };
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'AURA', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = `/?screen=${event.notification.data?.screen ?? 'shell'}`;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
      const existing = ws.find(w => w.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.postMessage({ type: 'NAV', screen: event.notification.data?.screen }); }
      else clients.openWindow(target);
    })
  );
});

// ─── Messages from main thread ─────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'TRIGGER_SYNC') {
    self.registration.sync?.register('aura-poshan-sync').catch(console.warn);
  }
  if (event.data?.type === 'SYNC_RESULT') {
    // Forward sync result to all clients
    self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({ type: 'SYNC_COMPLETE', ...event.data })));
  }
});
