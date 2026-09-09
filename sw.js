/* ══════════════════════════════════════════════════════════════════════
   Suivi BFC — service worker

   Stratégie :
   • index.html et la navigation  → RÉSEAU D'ABORD (cache en secours)
     ⇒ republier le site suffit, l'app se met à jour seule au lancement.
   • autres fichiers du site      → cache d'abord, rafraîchi en arrière-plan.
   • bibliothèques CDN + polices  → cache d'abord, dans un cache séparé
     qui survit aux mises à jour (pas de re-téléchargement inutile).

   Les données (IndexedDB) ne sont JAMAIS touchées par ce fichier :
   elles survivent à toutes les mises à jour.

   ⚠ À CHAQUE PUBLICATION : changez VERSION ci-dessous (1.0, 1.1, 1.2…)
     et reportez la même valeur ligne 20 de index.html.
   ══════════════════════════════════════════════════════════════════════ */

const VERSION = '1.2';

const CACHE_APP = 'bfc-app-' + VERSION;   // fichiers du site (change à chaque version)
const CACHE_LIB = 'bfc-lib-1';            // CDN et polices (change rarement)
const CACHES_ACTIFS = [CACHE_APP, CACHE_LIB];

const FICHIERS_APP = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

const LIBS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/recharts@2.12.7/umd/Recharts.js',
  'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js',
  'https://unpkg.com/@babel/standalone@7.24.7/babel.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

/* ─── Installation ───────────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const app = await caches.open(CACHE_APP);
    await Promise.allSettled(FICHIERS_APP.map((u) => app.add(new Request(u, { cache: 'reload' }))));

    const lib = await caches.open(CACHE_LIB);
    await Promise.allSettled(LIBS.map(async (u) => {
      const deja = await lib.match(u);
      if (!deja) await lib.add(new Request(u, { mode: 'no-cors' }));
    }));

    await self.skipWaiting();
  })());
});

/* ─── Activation : ménage des anciens caches ─────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.map((n) => (CACHES_ACTIFS.includes(n) ? null : caches.delete(n))));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* ─── Message envoyé par le bandeau « Recharger » ────────────────────── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ─── Interception des requêtes ──────────────────────────────────────── */
const estHTML = (url) => url.pathname.endsWith('/') || url.pathname.endsWith('.html');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  const memeOrigine = url.origin === self.location.origin;

  // 1. Navigation et pages HTML : réseau d'abord
  if (req.mode === 'navigate' || (memeOrigine && estHTML(url))) {
    event.respondWith(reseauDAbord(event));
    return;
  }

  // 2. Reste du site : cache d'abord, rafraîchi en arrière-plan
  if (memeOrigine) {
    event.respondWith(cacheDAbord(req, CACHE_APP, true));
    return;
  }

  // 3. CDN, polices, dictionnaire OCR : cache d'abord, cache durable
  event.respondWith(cacheDAbord(req, CACHE_LIB, false));
});

async function reseauDAbord(event) {
  const cache = await caches.open(CACHE_APP);
  try {
    const preload = event.preloadResponse ? await event.preloadResponse : null;
    const reponse = preload || await fetch(event.request, { cache: 'no-store' });
    if (reponse && reponse.ok) {
      cache.put('./index.html', reponse.clone());
      cache.put('./', reponse.clone());
    }
    return reponse;
  } catch (e) {
    const secours = await cache.match(event.request) ||
                    await cache.match('./index.html') ||
                    await cache.match('./');
    if (secours) return secours;
    return new Response(
      '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:32px;color:#1A1A1A;background:#FAF9F6">' +
      '<h1 style="font-size:18px">Suivi BFC est hors ligne</h1>' +
      '<p style="font-size:14px;color:#6E6A63">Reconnectez-vous une fois pour terminer l\'installation.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    );
  }
}

async function cacheDAbord(req, nomCache, revalider) {
  const cache = await caches.open(nomCache);
  const enCache = await cache.match(req);

  const reseau = fetch(req).then((rep) => {
    if (rep && (rep.ok || rep.type === 'opaque')) cache.put(req, rep.clone());
    return rep;
  }).catch(() => null);

  if (enCache) {
    if (revalider) reseau; // rafraîchissement silencieux
    return enCache;
  }
  const rep = await reseau;
  if (rep) return rep;
  return new Response('', { status: 504, statusText: 'Ressource indisponible hors ligne' });
}
