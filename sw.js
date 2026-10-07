const CACHE_NAME = 'gp200-core-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './changelogs.txt'
];

// Install Event: Cache core application files
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate Event: Clean up old core caches safely
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME && key !== 'gp200-audio-cache-v1') {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clientsClaim();
});

// Fetch Event: Network first when online for live updates, fallback to cache when offline
self.addEventListener('fetch', (event) => {
    // Isolated audio cache handler for instant playback
    if (event.request.url.includes('/audio/')) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                return cachedResponse || fetch(event.request);
            })
        );
        return;
    }

    // App core files: Try network first, update cache, fallback to cache via .catch if offline
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                return caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            })
            .catch(() => {
                // Fallback to cache when offline or network fails
                return caches.match(event.request).then((cachedResponse) => {
                    return cachedResponse || (event.request.mode === 'navigate' ? caches.match('./index.html') : null);
                });
            })
    );
});