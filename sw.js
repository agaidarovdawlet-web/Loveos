// ИЗМЕНЕНО: добавлены комментарии на русском для каждого этапа жизненного цикла Service Worker

const CACHE_NAME = 'loveos-v3.5-static';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// === Background Sync для Firebase POST ===
const SYNC_DB_NAME = 'loveos-sync';
const SYNC_STORE = 'requests';
const SYNC_TAG = 'firebase-sync';

// Установка: кэшируем статические ресурсы (HTML, манифест).
// Firebase-скрипты (gstatic.com) не кэшируются здесь, т.к. они внешние
// и требуют отдельной стратегии (network-first). Для offline-работы
// Firebase Realtime Database всё равно требует сети, если не включён persistence.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

// Активация: чистим старые кэши, оставляя только текущую версию.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// === IndexedDB helpers для offline-очереди ===
function openSyncDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        db.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function saveRequest(request) {
  return openSyncDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_STORE, 'readwrite');
      const store = tx.objectStore(SYNC_STORE);
      // Клонируем запрос, т.к. тело можно прочитать только один раз
      request.clone().text().then(body => {
        const entry = {
          url: request.url,
          method: request.method,
          headers: Array.from(request.headers.entries()),
          body: body,
          timestamp: Date.now()
        };
        const addReq = store.add(entry);
        addReq.onsuccess = () => resolve();
        addReq.onerror = () => reject(addReq.error);
      }).catch(reject);
    });
  });
}

function getAllRequests() {
  return openSyncDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_STORE, 'readonly');
      const store = tx.objectStore(SYNC_STORE);
      const all = store.getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
    });
  });
}

function deleteRequest(id) {
  return openSyncDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_STORE, 'readwrite');
      const store = tx.objectStore(SYNC_STORE);
      const del = store.delete(id);
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
    });
  });
}

function isFirebaseUrl(url) {
  return /firebaseio\.com|firebasedatabase\.app|googleapis\.com/.test(url);
}

// === Background Sync ===
// При восстановлении сети браузер вызовет sync с тегом firebase-sync,
// и мы отправим все отложенные POST-запросы.
self.addEventListener('sync', e => {
  if (e.tag === SYNC_TAG) {
    e.waitUntil(processSyncQueue());
  }
});
// Note: Background Sync is not supported in all browsers (e.g. Safari).
// The app should use Firebase's built-in offline persistence instead.

async function processSyncQueue() {
  const reqs = await getAllRequests();
  for (const entry of reqs) {
    try {
      await fetch(new Request(entry.url, {
        method: entry.method,
        headers: new Headers(entry.headers),
        body: entry.body
      }));
      await deleteRequest(entry.id);
    } catch (err) {
      console.error('Background sync failed for', entry.url, err);
      // Если снова ошибка — запрос остаётся в очереди для следующего sync
    }
  }
}

// Перехват запросов: для same-origin GET используем Cache First.
// Если ресурс в кэше — отдаём сразу. Если нет — идём в сеть.
// При ошибке сети (offline) для навигационных запросов отдаём index.html,
// чтобы SPA корректно работала в offline.
//
// Для POST-запросов к Firebase: пытаемся отправить сразу. При ошибке сети
// сохраняем запрос в IndexedDB и регистрируем background sync.
self.addEventListener('fetch', e => {
  // NOTE: POST requests to Firebase are NOT intercepted by SW.
  // Firebase SDK handles offline persistence internally via enablePersistence().
  // Manual background sync for Firebase POSTs was removed because:
  // 1. Firebase expects specific response structure; fake responses break SDK
  // 2. Background sync via raw fetch bypasses Firebase SDK atomicity
  // 3. Firebase RTDB has built-in offline queue when persistence is enabled

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
