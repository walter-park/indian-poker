const CACHE_NAME = 'indian-poker-v1.4.1';

// SW 파일 위치 기준으로 BASE_PATH 계산 (항상 사용 가능)
const BASE_PATH = new URL('./', self.location.href).pathname;

const ASSET_PATHS = [
  '',
  'index.html',
  'css/style.css',
  'js/connection.js',
  'js/game.js',
  'js/app.js',
];

const ASSETS = ASSET_PATHS.map(p => BASE_PATH + p);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // 같은 origin의 BASE_PATH 하위 리소스만 캐싱
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE_PATH)) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
