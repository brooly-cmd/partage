/* =========================================================
   Partage éphémère — plusieurs tuyaux en même temps
   Un seul tuyau entre deux appareils avance doucement. Comme on ouvre plusieurs caisses au supermarché,
   chaque invité ouvre 7 tuyaux « renforts » en plus du tuyau principal vers l'hôte.
   Le tuyau principal transporte les messages ; les morceaux de fichier partent dans le tuyau le moins rempli,
   avec leur position dans le fichier, et sont remis dans l'ordre à l'arrivée (voir reception.js).
   ========================================================= */
"use strict";

const TUYAUX = 8; // tuyau principal + 7 renforts

// (invité) Une fois entré dans la salle, on ouvre les renforts vers l'hôte
function ouvrirRenforts(peer, code, principal) {
  principal.renforts = [];
  for (let i = 1; i < TUYAUX; i++) {
    const renfort = peer.connect(PREFIXE + code, { reliable: true, serialization: "raw", metadata: { renfort: true } });
    brancherRenfort(renfort, principal, "invite", "Hôte");
  }
}

// (hôte) Un invité ouvre un renfort : on le range avec son tuyau principal
function accueillirRenfort(renfort) {
  renfort.on("open", () => {
    const invite = etat.invites.find((i) => i.conn.peer === renfort.peer);
    if (!invite) return renfort.close();
    invite.conn.renforts = invite.conn.renforts || [];
    brancherRenfort(renfort, invite.conn, "hote", invite.nom);
    invite.conn.renforts.push(renfort);
  });
}

// Un renfort ne transporte que des morceaux de fichier : on les traite comme s'ils venaient du tuyau principal
function brancherRenfort(renfort, principal, role, de) {
  if (role === "invite") renfort.on("open", () => principal.renforts.push(renfort));
  renfort.on("data", (brut) => {
    const msg = deballer(brut);
    if (etat.peer && msg && msg.type === "morceau") recevoirPaquetFichier(role, de, principal, msg);
  });
  renfort.on("close", () => {
    principal.renforts = principal.renforts.filter((r) => r !== renfort);
  });
}

// L'invité est parti : on ferme aussi ses renforts
function fermerRenforts(principal) {
  (principal.renforts || []).forEach((r) => r.close());
  principal.renforts = [];
}

// Tous les tuyaux encore ouverts vers un appareil (le principal d'abord)
function tuyauxDe(principal) {
  return [principal, ...(principal.renforts || [])].filter((c) => c.open);
}

// Le tuyau le moins rempli vers cet appareil
function tuyauLibre(principal) {
  const remplissage = (c) => (c.bufferSize > 0 ? Infinity : c.dataChannel ? c.dataChannel.bufferedAmount : 0);
  return tuyauxDe(principal).reduce((a, b) => (remplissage(b) < remplissage(a) ? b : a), principal);
}

// Tous les tuyaux vers cet appareil sont-ils pleins ?
function ciblePleine(principal) {
  const ouverts = tuyauxDe(principal);
  return ouverts.length > 0 && ouverts.every(tuyauPlein);
}

// Attend qu'un des tuyaux vers cet appareil ait de la place
function attendrePlaceCible(principal) {
  const ouverts = tuyauxDe(principal);
  return ouverts.length ? Promise.race(ouverts.map(attendrePlace)) : Promise.resolve();
}
