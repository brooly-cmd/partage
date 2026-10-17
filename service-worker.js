/* =========================================================
   Partage éphémère — le « portier » de l'app installée
   Chrome et Edge en demandent un pour proposer l'installation.
   Il ne garde RIEN : chaque fichier du site est redemandé en ligne,
   sans copie en mémoire, pour toujours avoir la dernière version.
   (Le contenu de la salle ne passe pas par ici : il va en direct entre appareils.)
   ========================================================= */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  // Seulement les fichiers de notre site ; le reste (PeerJS, polices, QR) passe sans lui
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-store" }));
});
