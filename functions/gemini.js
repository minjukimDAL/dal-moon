// DAL Service Worker v1.0
const CACHE_NAME = 'dal-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,200;0,300;0,400;1,200&family=DM+Sans:wght@200;300;400;500&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

// 설치 — 핵심 파일 캐싱
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(err) {
        console.warn('[SW] 캐시 설치 일부 실패:', err);
      });
    })
  );
  self.skipWaiting();
});

// 활성화 — 이전 캐시 삭제
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// fetch — 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Supabase, Gemini API 요청은 캐시 안 함
  if (url.includes('supabase.co') ||
      url.includes('netlify/functions') ||
      url.includes('googleapis.com/v1') ||
      url.includes('formspree.io')) {
    return;
  }

  // GET 요청만 캐싱
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(function(response) {
        // 정상 응답이면 캐시에도 저장
        if (response && response.status === 200 && response.type !== 'opaque') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, copy);
          });
        }
        return response;
      })
      .catch(function() {
        // 네트워크 실패 시 캐시에서
        return caches.match(e.request).then(function(cached) {
          if (cached) return cached;
          // 캐시도 없으면 오프라인 페이지 (index.html 반환)
          if (e.request.destination === 'document') {
            return caches.match('/');
          }
        });
      })
  );
});

// 푸시 알림 (향후 확장용)
self.addEventListener('push', function(e) {
  if (!e.data) return;
  var data = e.data.json();
  self.registration.showNotification(data.title || 'DAL', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    data: { url: data.url || '/' }
  });
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(
    clients.openWindow(e.notification.data.url || '/')
  );
});
