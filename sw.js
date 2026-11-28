/* 避難包帖 Service Worker：支援靜態檔案離線開啟，絕不攔截跨網域請求 */

const CACHE_NAME = 'hinanbukuro-v6';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/img/mark.svg',
  './assets/css/tokens.css',
  './assets/css/base.css',
  './assets/css/components.css',
  './assets/css/views.css',
  './assets/js/app.js',
  './assets/js/data/presets.js',
  './assets/js/core/barcode.js',
  './assets/js/core/barcode.worker.js',
  './assets/js/core/dates.js',
  './assets/js/core/gtin.js',
  './assets/js/core/haptics.js',
  './assets/js/core/icons.js',
  './assets/js/core/ics.js',
  './assets/js/core/ocr.js',
  './assets/js/core/off.js',
  './assets/js/core/safety.js',
  './assets/js/core/spring.js',
  './assets/js/core/store.js',
  './assets/js/core/ui.js',
  './assets/js/components/illustrations.js',
  './assets/js/components/itemCard.js',
  './assets/js/views/home.js',
  './assets/js/views/items.js',
  './assets/js/views/safe.js',
  './assets/js/views/scan.js',
  './assets/js/views/settings.js',
  './assets/vendor/qrcode.min.js',
  './assets/vendor/zxing.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('hinanbukuro-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  /* 跨網域請求（PaddleOCR 模型、Open Food Facts API）一律直接放行 */
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/assets/vendor/')) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
