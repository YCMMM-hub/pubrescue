// Service worker : met l'app en cache pour fonctionner hors ligne après la première visite.
const CACHE = 'pubrescue-v3';
const ASSETS = ['./', './index.html', './css/app.css', './js/app.js', './js/engine.js', './js/render.js', './js/license.js',
  './engine/pubengine.mjs', './engine/pubengine.wasm', './js/track.js', './js/metafile.js', './vendor/WMFJS.bundle.min.js', './vendor/EMFJS.bundle.min.js', './img/example-result.png', './vendor/pdf-lib.esm.min.js', './vendor/fflate.js', './manifest.webmanifest', './icons/icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
