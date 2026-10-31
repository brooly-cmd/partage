/* Seuls les fichiers de l'app sont mis en cache. Jamais les salles, textes ou fichiers reçus. */
const VERSION = 'partage-ephemere-m22e-v36';
const FICHIERS = [
  './', 'index.html', 'style.css', 'minuit.css', 'app.js', 'connexion.js', 'tuyaux.js',
  'relais.js', 'messages.js', 'fichiers.js', 'reception.js', 'ecrans.js', 'inactivite.js',
  'installation.js', 'demarrage-monde.js', 'monde.js', 'passages.js', 'atelier.js', 'objets.js', 'decor.js', 'fenetre.js',
  'manifest.webmanifest', 'logo.svg', 'icones/icone-192.png', 'icones/icone-512.png', 'icones/icone-apple.png',
  '3d/atelier.glb', '3d/personnage.glb', '3d/studio_small_09_1k.hdr', '3d/wood_floor_diff_1k.jpg', '3d/plaster_grey_04_diff_1k.jpg',
];
const adresses = new Set(FICHIERS.map(f => new URL(f, self.registration.scope).href));
self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(VERSION);
  await cache.addAll([...adresses].map(url => new Request(url, { cache: 'reload' })));
  await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(n => n.startsWith('partage-ephemere-') && n !== VERSION)
    .map(n => caches.delete(n)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url); url.search = '';
  if (!adresses.has(url.href)) return;
  e.respondWith((async () => {
    try {
      const reponse = await fetch(e.request, { cache: 'no-store' });
      if (reponse.ok) {
        const copie = reponse.clone();
        e.waitUntil(caches.open(VERSION).then(cache => cache.put(url.href, copie)).catch(() => {}));
      }
      return reponse;
    } catch (erreur) {
      const copie = await caches.open(VERSION).then(cache => cache.match(url.href)).catch(() => null);
      if (copie) return copie;
      throw erreur;
    }
  })());
});
