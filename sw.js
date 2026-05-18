// ИЗМЕНЕНО: добавлены комментарии на русском для каждого этапа жизненного цикла Service Worker

const CACHE_NAME = 'loveos-v3.5-static';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// === Установка: кэшируем статические ресурсы ===
// Кэшируем только shell приложения (HTML, манифест).
// Firebase-скрипты (gstatic.com) не кэшируются здесь —
// они внешние и требуют стратегии network-first.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .catch(err => console.error('[SW] Ошибка кэширования:', err))
  );
  self.skipWaiting();
});

// === Активация: чистим старые кэши ===
// Оставляем только текущую версию кэша, удаляем остальные.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// === Перехват запросов ===
// Для same-origin GET используем Cache First:
// если ресурс в кэше — отдаём сразу, если нет — идём в сеть.
// При ошибке сети (offline) для навигационных запросов
// отдаём index.html, чтобы SPA корректно работала offline.
//
// Firebase POST-запросы НЕ перехватываются — Firebase SDK
// сам управляет offline-очередью через enablePersistence().
self.addEventListener('fetch', e => {
  // Пропускаем не-GET запросы и внешние ресурсы
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).catch(() => {
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
