/**
 * sw.js
 * Service worker: cachea el "app shell" para que la app abra y funcione
 * sin conexión. Los datos financieros viven en IndexedDB (ver db.js), no
 * aquí — este archivo solo se encarga de los archivos estáticos.
 */

const CACHE_NAME = 'finanzas-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/db.js',
  './js/auth.js',
  './js/sheetsApi.js',
  './js/sync.js',
  './js/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
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

  // Nunca cachear llamadas a la API de Google: siempre deben ir a la red
  // (o fallar explícitamente para que sync.js las reintente).
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('google.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
