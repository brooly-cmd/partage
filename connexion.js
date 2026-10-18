/* =========================================================
   Partage éphémère — la connexion entre appareils (PeerJS)
   L'hôte réserve le code de la salle chez le « standardiste » gratuit PeerJS,
   les invités l'appellent, puis chacun a un tuyau direct vers l'hôte.
   L'hôte fait suivre aux autres invités ce qu'il reçoit (comme un facteur).
   ========================================================= */
"use strict";

// Salle : 8 personnes maximum, hôte compris
const MAX_INVITES = 7;
// Chaque salle s'inscrit chez le standardiste sous ce nom + le code
const PREFIXE = "partage-ephemere-";

// Les paquets voyagent « bruts » (sans l'emballage de PeerJS, qui recoupait et recopiait
// chaque morceau de fichier, et ralentissait tout) : un message part en texte (format JSON),
// un morceau de fichier part tel quel, précédé de son numéro d'envoi et de sa position dans le fichier
// (comme une étiquette « carton 12 » : on peut les remettre dans l'ordre à l'arrivée).
function emballer(paquet) {
  if (paquet.type !== "morceau") return JSON.stringify(paquet);
  const id = new TextEncoder().encode(paquet.id);
  const debut = 1 + id.length + 8;
  const tout = new Uint8Array(debut + paquet.donnees.byteLength);
  tout[0] = id.length;
  tout.set(id, 1);
  new DataView(tout.buffer).setFloat64(1 + id.length, paquet.position);
  tout.set(new Uint8Array(paquet.donnees), debut);
  return tout.buffer;
}

// L'inverse, à l'arrivée (null si le paquet est illisible)
function deballer(brut) {
  try {
    if (typeof brut === "string") return JSON.parse(brut);
    const n = new Uint8Array(brut, 0, 1)[0];
    const id = new TextDecoder().decode(new Uint8Array(brut, 1, n));
    const position = new DataView(brut).getFloat64(1 + n);
    return { type: "morceau", id, position, donnees: brut.slice(1 + n + 8) };
  } catch {
    return null;
  }
}

function envoyer(conn, paquet) {
  conn.send(emballer(paquet));
}

// Envoie le même paquet dans chaque tuyau encore ouvert
function envoyerA(tuyaux, paquet) {
  tuyaux.forEach((conn) => {
    if (conn.open) envoyer(conn, paquet);
  });
}

// Raccroche proprement : coupe tous les tuyaux et la ligne chez le standardiste
function raccrocher() {
  if (etat.peer) {
    const p = etat.peer;
    etat.peer = null; // d'abord, pour que les « close » qui suivent soient ignorés
    p.destroy();
  }
  etat.invites = [];
  etat.numeroInvite = 0;
  etat.connHote = null;
  oublierTransferts();
}

// Vérifie qu'on peut se connecter. Renvoie la clé d'erreur, ou null si tout va bien.
function problemeConnexion() {
  if (navigator.onLine === false) return "reseau";
  if (typeof Peer !== "function") return "reseau"; // PeerJS n'a pas pu se charger
  if (!window.RTCPeerConnection) return "navigateur";
  return null;
}

// Prévient quand un tuyau se coupe, même si l'autre appareil part sans dire au revoir
function surveillerCoupure(conn, quandCoupe) {
  let fait = false;
  const une = () => { if (!fait) { fait = true; quandCoupe(); } };
  conn.on("close", une);
  conn.on("error", une);
  const pc = conn.peerConnection;
  if (pc) {
    // « disconnected » = l'autre ne répond plus (onglet tué, écran verrouillé, réseau perdu).
    // Ça peut être un petit hoquet du réseau : on attend 3 secondes avant de déclarer le tuyau coupé.
    let attente;
    pc.addEventListener("iceconnectionstatechange", () => {
      const s = pc.iceConnectionState;
      clearTimeout(attente);
      if (s === "failed" || s === "closed") une();
      if (s === "disconnected") attente = setTimeout(une, 3000);
    });
  }
}

/* ---------- Côté hôte ---------- */
// « Créer une salle » : on tire un code et on le réserve chez le standardiste
function creerSalle() {
  const probleme = problemeConnexion();
  if (probleme) {
    afficherEcran("accueil");
    afficherErreur(probleme);
    return;
  }
  raccrocher();
  effacerErreur();
  occuper($("btn-creer"), true);
  essayerCode(5);
}

function essayerCode(essaisRestants) {
  const code = tirerCode();
  const peer = new Peer(PREFIXE + code);
  etat.peer = peer;

  peer.on("open", () => {
    if (etat.peer !== peer) return;
    occuper($("btn-creer"), false);
    etat.codeHote = code;
    dessinerQR(lienSalle(code));
    ouvrirSalleHote();
  });

  peer.on("connection", (conn) => (conn.metadata && conn.metadata.renfort ? accueillirRenfort(conn) : accueillirInvite(conn)));

  // Si le lien avec le standardiste saute, on se réinscrit (les invités déjà là restent reliés)
  peer.on("disconnected", () => {
    if (etat.peer === peer && etat.ecran === "hote") peer.reconnect();
  });

  peer.on("error", (err) => {
    if (etat.peer !== peer) return;
    if (err.type === "unavailable-id" && essaisRestants > 1) {
      // Ce code est déjà pris par une autre salle : on en tire un autre
      etat.peer = null;
      peer.destroy();
      essayerCode(essaisRestants - 1);
      return;
    }
    if (etat.ecran === "hote") return; // un petit souci pendant la salle : on continue
    raccrocher();
    occuper($("btn-creer"), false);
    afficherEcran("accueil");
    afficherErreur(err.type === "browser-incompatible" ? "navigateur" : "reseau");
  });
}

function accueillirInvite(conn) {
  conn.on("open", () => {
    if (etat.invites.length >= MAX_INVITES) {
      envoyer(conn, { type: "pleine" });
      setTimeout(() => conn.close(), 500);
      return;
    }
    etat.numeroInvite += 1;
    const invite = { nom: "Invité " + etat.numeroInvite, conn };
    etat.invites.push(invite);
    envoyer(conn, { type: "bienvenue", nom: invite.nom });
    majPresence();
    prevenirInvites(); // le nouveau reçoit le temps qui reste

    conn.on("data", (brut) => {
      const msg = deballer(brut);
      if (!etat.peer || !msg) return;
      if (msg.type === "texte" && typeof msg.texte === "string") {
        ajouterAuFil("hote", { type: "texte", de: invite.nom, texte: msg.texte });
        // L'hôte fait suivre le texte aux autres invités, avec le nom de celui qui l'a écrit
        envoyerA(autresInvites(conn), { type: "texte", de: invite.nom, texte: msg.texte });
      }
      recevoirPaquetFichier("hote", invite.nom, conn, msg);
    });

    surveillerCoupure(conn, () => {
      etat.invites = etat.invites.filter((i) => i !== invite);
      fermerRenforts(conn);
      abandonnerReceptions(conn); // ce qu'il était en train d'envoyer n'arrivera jamais
      oublierCible(conn);         // et il ne recevra plus rien
      if (etat.peer) majPresence();
    });
  });
}

// (hôte) Les tuyaux ouverts vers tous les invités, sauf celui qui vient d'envoyer (s'il y en a un)
function autresInvites(saufConn) {
  return etat.invites.map((i) => i.conn).filter((c) => c !== saufConn && c.open);
}

// « 1 personne connectée », la liste des invités, et la même info envoyée à chaque invité
function texteNombre(n) {
  return n + (n > 1 ? " personnes connectées" : " personne connectée");
}
function majPresence() {
  const n = etat.invites.length;
  $("nombre-hote").textContent = texteNombre(n);
  $("invites-hote").hidden = n === 0;
  $("liste-invites").textContent = etat.invites.map((i) => i.nom).join(" · ");
  envoyerA(autresInvites(), { type: "nombre", n });
}

// L'hôte ferme : il prévient les invités (avec la raison), puis raccroche
// (tout de suite si l'onglet se ferme, sinon après un petit délai pour que le message parte)
function fermerSalleHote(toutDeSuite, raison) {
  envoyerA(autresInvites(), { type: "fermee", raison });
  const peer = etat.peer;
  etat.peer = null;
  raccrocher();
  etat.codeHote = null;
  if (!peer) return;
  if (toutDeSuite) peer.destroy();
  else setTimeout(() => peer.destroy(), 300);
}

/* ---------- Côté invité ---------- */
function rejoindreSalle(code) {
  const probleme = problemeConnexion();
  if (probleme) {
    afficherErreur(probleme);
    return;
  }
  raccrocher();
  const bouton = $("form-rejoindre").querySelector("button[type=submit]");
  occuper(bouton, true, "Connexion…");

  const peer = new Peer(); // l'invité reçoit un nom au hasard du standardiste
  etat.peer = peer;
  let entre = false;

  // Si rien ne répond au bout de 20 secondes, on abandonne
  const minuteur = setTimeout(() => echec("reseau"), 20000);

  function echec(cle) {
    if (etat.peer !== peer || entre) return;
    clearTimeout(minuteur);
    raccrocher();
    occuper(bouton, false);
    afficherEcran("accueil");
    afficherErreur(cle);
  }

  peer.on("open", () => {
    const conn = peer.connect(PREFIXE + code, { reliable: true, serialization: "raw" });
    etat.connHote = conn;

    conn.on("data", (brut) => {
      const msg = deballer(brut);
      if (etat.peer !== peer || !msg) return;
      if (msg.type === "pleine") echec("pleine");
      if (msg.type === "bienvenue") {
        entre = true;
        clearTimeout(minuteur);
        occuper(bouton, false);
        champ.value = "";
        majCases();
        ouvrirSalleInvite(code);
        ouvrirRenforts(peer, code, conn);
      }
      if (msg.type === "nombre") $("nombre-invite").textContent = texteNombre(msg.n);
      if (msg.type === "minuteur" && typeof msg.reste === "number") recevoirMinuteur(msg.reste);
      // « de » : le nom de l'invité qui a écrit, quand l'hôte fait suivre son message
      const de = typeof msg.de === "string" ? msg.de : "Hôte";
      if (msg.type === "texte" && typeof msg.texte === "string") {
        ajouterAuFil("invite", { type: "texte", de, texte: msg.texte });
      }
      recevoirPaquetFichier("invite", de, conn, msg);
      if (msg.type === "fermee") {
        raccrocher();
        fermerAvecEffet(msg.raison === "inactivite" ? "inactiviteInvite" : "hoteFermeInvite");
      }
    });

    surveillerCoupure(conn, () => {
      if (etat.peer !== peer) return;
      if (!entre) return echec("inconnu");
      raccrocher();
      fermerAvecEffet("disparuInvite");
    });
  });

  peer.on("error", (err) => {
    if (err.type === "peer-unavailable") return echec("inconnu"); // personne n'a ce code
    if (err.type === "browser-incompatible") return echec("navigateur");
    if (!entre) echec("reseau");
  });
}

// L'invité part de lui-même : la salle continue pour les autres
function quitterSalle() {
  raccrocher();
  viderSalles();
  afficherEcran("accueil");
}

// Si on ferme l'onglet, on raccroche tout de suite (les autres le voient aussitôt)
window.addEventListener("pagehide", () => {
  if (etat.ecran === "hote") fermerSalleHote(true);
  raccrocher();
});
