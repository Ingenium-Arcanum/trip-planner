// Service worker: lets the app open and work without a connection.
//
//  • App files (this site): network first, so you always get the newest version when online;
//    if the network fails or takes > 4 s, the saved copy is used. Everything is saved at install,
//    so even screens you haven't opened yet work offline.
//  • Map tiles (OpenStreetMap): tiles you have looked at are kept (max ~3000). No bulk downloading —
//    that's against the OSM tile policy.
//  • Leaflet + Google Fonts (CDN, versioned): kept once loaded.
//  • Place pictures from Wikimedia: kept (max 300), only when the server allows it (CORS).
//  • Everything else (search, Discover, Wikipedia text): straight to the network.
//
// Not used inside the claude.ai artifact viewer (service workers aren't allowed there).
// When you add or rename a file the app needs, add it to PRECACHE (tests/pwa.test.mjs checks this).

const VERSION = 'v1';
const APP = 'tp-app-' + VERSION;
const TILES = 'tp-tiles', CDN = 'tp-cdn', IMG = 'tp-img';
const LIMIT = { [TILES]: 3000, [IMG]: 300 };

const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-64.png',
  'trips/index.json',
  'js/main.js',
  'js/app.js',
  'js/autoplan.js',
  'js/config.js',
  'js/discover.js',
  'js/geo.js',
  'js/links.js',
  'js/nearby.js',
  'js/net.js',
  'js/photos.js',
  'js/pwa.js',
  'js/optimise.js',
  'js/rescue.js',
  'js/routing.js',
  'js/schedule.js', 'js/sun.js',
  'js/share.js',
  'js/sheets.js',
  'js/state.js',
  'js/store.js',
  'js/util.js',
  'js/map/index.js',
  'js/map/schematic.js',
  'js/map/tiles.js',
  'js/views/components.js',
  'js/views/home.js',
  'js/views/ideas.js',
  'js/views/now.js',
  'js/views/plan.js'
];
const CDN_PRECACHE = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const app = await caches.open(APP);
    await app.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })));
    // The map library is nice to have offline, but must not block installing.
    const cdn = await caches.open(CDN);
    await Promise.all(CDN_PRECACHE.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && cdn.put(u, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('tp-app-') && k !== APP) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // Every page load is the app shell; '?…' and '#…' don't matter.
    const key = req.mode === 'navigate' ? new URL('./', self.registration.scope).href : req;
    e.respondWith(networkFirst(e, req, key));
  } else if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(cacheFirst(e, TILES, req));
  } else if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    e.respondWith(cacheFirst(e, CDN, req));
  } else if (url.hostname.endsWith('wikimedia.org') && req.destination === 'image') {
    e.respondWith(cacheFirst(e, IMG, req));
  }
  // anything else: browser default (network)
});

async function networkFirst(e, req, key) {
  const cache = await caches.open(APP);
  const net = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const slow = new Promise(r => setTimeout(() => r(null), 4000));
  try {
    const res = await Promise.race([net, slow]);
    if (res) return res;
  } catch (err) { /* offline */ }
  const hit = await cache.match(key, { ignoreSearch: true });
  if (hit) return hit;
  try { return await net; } catch (err) {
    return new Response('Offline — this part of the app hasn’t been saved yet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

let puts = 0;
/** Saved copy if we have one; otherwise fetch (as CORS, so it can be stored safely) and keep it. */
async function cacheFirst(e, name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  let res;
  try { res = await fetch(new Request(req.url, { mode: 'cors', credentials: 'omit' })); }
  catch (err) {
    // Server doesn't allow CORS (or we're offline): let the browser fetch it normally, don't store it.
    try { return await fetch(req); } catch (err2) { return Response.error(); }
  }
  if (res.ok) {
    e.waitUntil(cache.put(req.url, res.clone()).then(() => (++puts % 50 === 0 ? trim(name) : null)));
  }
  return res;
}

async function trim(name) {
  const max = LIMIT[name];
  if (!max) return;
  const cache = await caches.open(name), keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]); // oldest first
}
