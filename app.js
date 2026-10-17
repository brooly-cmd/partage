/* =========================================================
   Partage éphémère — le petit moteur de la page
   Mission 6 : l'invité rejoint la salle de l'hôte pour de vrai,
   grâce au « standardiste » gratuit PeerJS.
   Mission 7 : on s'envoie du texte en instantané par ce tuyau.
   Mission 8 : on s'envoie aussi des petits fichiers (bouton « + » ou glisser-déposer).
   Mission 9 : les gros fichiers partent en petits morceaux, avec une barre de progression.
   Mission 10 : l'hôte fait suivre aux autres invités ce qu'il reçoit d'un invité (comme un facteur).
   Mission 11 : quand la salle ferme (ou qu'on la quitte), tout son contenu est effacé de la page.
   Mission 12 : la fermeture automatique après 30 minutes sans activité est dans inactivite.js.
   ========================================================= */
"use strict";

// --- Raccourci pour attraper un élément de la page par son id
const $ = (id) => document.getElementById(id);

// --- Ce que la page « se rappelle » pendant qu'elle est ouverte (en mémoire seulement)
const etat = {
  ecran: "accueil",
  codeHote: null,       // le code de la salle, tiré au hasard à chaque nouvelle salle
  avecExemples: false,  // le panneau Démo peut remplir la salle de faux messages
  peer: null,           // notre « ligne téléphonique » chez le standardiste PeerJS
  invites: [],          // (hôte) les invités connectés : { nom, conn }
  numeroInvite: 0,      // (hôte) pour nommer « Invité 1 », « Invité 2 »…
  connHote: null,       // (invité) le tuyau direct vers l'hôte
  envois: new Map(),    // les fichiers en train de partir, rangés par numéro d'envoi
  recus: new Map(),     // les fichiers en train d'arriver, rangés par numéro d'envoi
};

// Salle : 8 personnes maximum, hôte compris
const MAX_INVITES = 7;
// Chaque salle s'inscrit chez le standardiste sous ce nom + le code
const PREFIXE = "partage-ephemere-";

// --- Tous les textes de la salle fermée, mot pour mot depuis ECRANS.md
const RAISONS = {
  hoteVolontaire:   { texte: "Tu as fermé la salle. Tout a été supprimé.", ancienHote: true },
  hoteFermeInvite:  { texte: "L'hôte a fermé la salle.", ancienHote: false },
  inactiviteHote:   { texte: "La salle s'est fermée après 30 minutes sans activité.", ancienHote: true },
  inactiviteInvite: { texte: "La salle s'est fermée après 30 minutes sans activité.", ancienHote: false },
  disparuInvite:    { texte: "L'hôte n'est plus connecté (écran verrouillé ou connexion coupée).", ancienHote: false },
  disparuHote:      { texte: "Ta salle a été fermée : l'écran s'est verrouillé ou la connexion a été coupée.", ancienHote: true },
};

// --- Les messages d'erreur de l'accueil, mot pour mot
const ERREURS = {
  court:      "Le code contient 6 chiffres.",
  inconnu:    "Aucune salle avec ce code. Vérifie-le auprès de l'hôte.",
  fermee:     "Cette salle est déjà fermée.",
  pleine:     "Cette salle est pleine (8 personnes).",
  reseau:     "Pas de connexion internet.",
  navigateur: "Ce navigateur ne permet pas le partage. Essaie Safari ou Chrome.",
};

// --- Est-ce un iPhone / iPad ? (pour le bandeau et l'encart d'installation)
const estIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const estSafariIOS = estIOS && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
const estInstallee = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/* =========================================================
   Changer d'écran
   ========================================================= */
function afficherEcran(nom) {
  document.querySelectorAll(".ecran").forEach((section) => {
    section.hidden = section.dataset.nom !== nom;
    section.classList.remove("dissout");
  });
  document.body.dataset.ecran = nom;
  etat.ecran = nom;
  $("alerte-inactivite").hidden = true;
  window.scrollTo(0, 0);
}

function formaterCode(code) {
  return code.slice(0, 3) + " " + code.slice(3);
}

/* ---------- Le code et le lien de la salle ---------- */
// Tire 6 chiffres au hasard avec le « dé » sécurisé du navigateur (crypto)
function tirerCode() {
  const nombre = new Uint32Array(1);
  let code;
  do {
    crypto.getRandomValues(nombre);
    code = String(nombre[0] % 1000000).padStart(6, "0");
  } while (code === etat.codeHote); // jamais deux fois de suite le même
  return code;
}

// Le lien de la salle, fabriqué depuis l'adresse de la page
// (en ligne : https://brooly-cmd.github.io/partage/?code=123456)
function lienSalle(code) {
  return location.origin + location.pathname + "?code=" + code;
}

// Dessine le vrai QR code qui contient le lien de la salle
function dessinerQR(texte) {
  const boite = $("qr");
  if (typeof qrcode !== "function") { // la bibliothèque n'a pas pu se charger (pas de réseau ?)
    boite.replaceChildren();
    return;
  }
  const qr = qrcode(0, "L"); // 0 = taille choisie automatiquement, L = QR le plus simple possible
  qr.addData(texte);
  qr.make();
  const n = qr.getModuleCount();
  let chemin = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) chemin += "M" + x + " " + y + "h1v1h-1z";
    }
  }
  boite.innerHTML =
    '<svg viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges" aria-hidden="true">' +
    '<path d="' + chemin + '"/></svg>';
  boite.setAttribute("aria-label", "QR code de la salle : " + texte);
}

/* ---------- Écran 2 : salle de l'hôte ---------- */
/* =========================================================
   La connexion entre appareils (PeerJS)
   ========================================================= */
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

  peer.on("connection", (conn) => accueillirInvite(conn));

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
      conn.send({ type: "pleine" });
      setTimeout(() => conn.close(), 500);
      return;
    }
    etat.numeroInvite += 1;
    const invite = { nom: "Invité " + etat.numeroInvite, conn };
    etat.invites.push(invite);
    conn.send({ type: "bienvenue", nom: invite.nom });
    majPresence();
    noterActivite(true); // une arrivée remonte le réveil, et le nouveau reçoit le temps qui reste

    conn.on("data", (msg) => {
      if (!etat.peer || !msg) return;
      noterActivite(); // tout ce qu'envoie un invité (geste, texte, morceau de fichier) compte
      if (msg.type === "texte" && typeof msg.texte === "string") {
        ajouterAuFil("hote", { type: "texte", de: invite.nom, texte: msg.texte });
        // L'hôte fait suivre le texte aux autres invités, avec le nom de celui qui l'a écrit
        autresInvites(conn).forEach((c) => c.send({ type: "texte", de: invite.nom, texte: msg.texte }));
      }
      recevoirPaquetFichier("hote", invite.nom, conn, msg);
    });

    surveillerCoupure(conn, () => {
      etat.invites = etat.invites.filter((i) => i !== invite);
      abandonnerReceptions(conn); // ce qu'il était en train d'envoyer n'arrivera jamais
      oublierCible(conn);         // et il ne recevra plus rien
      if (etat.peer) majPresence();
    });
  });
}

// (hôte) Les tuyaux ouverts vers tous les invités, sauf celui qui vient d'envoyer
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
  etat.invites.forEach((i) => {
    if (i.conn.open) i.conn.send({ type: "nombre", n });
  });
}

// L'hôte ferme : il prévient les invités (avec la raison), puis raccroche
// (tout de suite si l'onglet se ferme, sinon après un petit délai pour que le message parte)
function fermerSalleHote(toutDeSuite, raison) {
  etat.invites.forEach((i) => {
    if (i.conn.open) i.conn.send({ type: "fermee", raison });
  });
  const peer = etat.peer;
  etat.peer = null;
  etat.invites = [];
  etat.codeHote = null;
  oublierTransferts();
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
    const conn = peer.connect(PREFIXE + code, { reliable: true });
    etat.connHote = conn;

    conn.on("data", (msg) => {
      if (etat.peer !== peer || !msg) return;
      if (msg.type === "pleine") echec("pleine");
      if (msg.type === "bienvenue") {
        entre = true;
        clearTimeout(minuteur);
        occuper(bouton, false);
        champ.value = "";
        majCases();
        ouvrirSalleInvite(code);
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

// Met un bouton « en attente » (grisé) pendant qu'on se connecte
function occuper(bouton, oui, texte) {
  if (oui) {
    bouton.dataset.texte = bouton.dataset.texte || bouton.innerHTML;
    bouton.disabled = true;
    if (texte) bouton.textContent = texte;
  } else if (bouton.dataset.texte) {
    bouton.innerHTML = bouton.dataset.texte;
    delete bouton.dataset.texte;
    bouton.disabled = false;
  }
}

function ouvrirSalleHote() {
  const plaques = $("plaques-hote");
  plaques.replaceChildren(...etat.codeHote.split("").map((chiffre) => {
    const s = document.createElement("span");
    s.textContent = chiffre;
    return s;
  }));
  plaques.setAttribute("aria-label", "Code de la salle : " + formaterCode(etat.codeHote));

  // Sur iPhone : « ne verrouille pas ». Ailleurs : « garde cette page ouverte ».
  $("bandeau-hote").textContent = estIOS
    ? "Ne verrouille pas ton écran : la salle se fermerait pour tout le monde."
    : "Garde cette page ouverte, sinon la salle se ferme.";

  majPresence();
  remplirFil("hote");
  afficherEcran("hote");
  noterActivite(true); // le réveil démarre à l'ouverture de la salle
}

/* ---------- Écran 3 : salle de l'invité ---------- */
function ouvrirSalleInvite(code) {
  $("code-invite").textContent = formaterCode(code);
  remplirFil("invite");
  afficherEcran("invite");
}

/* ---------- Écran 4 : salle fermée ---------- */
function afficherFermee(cle) {
  viderSalles();
  const raison = RAISONS[cle];
  $("raison").textContent = raison.texte;
  $("btn-nouvelle").hidden = !raison.ancienHote;
  afficherEcran("fermee");
}

// La salle « s'évapore » doucement avant d'afficher l'écran fermé
function fermerAvecEffet(cle) {
  const salle = document.querySelector(".ecran:not([hidden])");
  const sansAnimation = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!salle || sansAnimation) return afficherFermee(cle);
  salle.classList.add("dissout");
  setTimeout(() => afficherFermee(cle), 550);
}

/* =========================================================
   Le fil de messages (vide, ou rempli d'exemples par la Démo)
   ========================================================= */
function creer(balise, classe, texte) {
  const el = document.createElement(balise);
  if (classe) el.className = classe;
  if (texte !== undefined) el.textContent = texte;
  return el;
}

function carteMessage(m) {
  const carte = creer("article", "msg");
  const tete = creer("div", "msg-tete");
  tete.append(creer("b", "", m.de), creer("time", "", m.heure));
  carte.append(tete);

  const corps = creer("div", "msg-corps");

  if (m.type === "texte") {
    corps.append(creer("span", "msg-texte", m.texte));
    const copier = creer("button", "mini", "Copier");
    copier.type = "button";
    copier.addEventListener("click", () => {
      copierTexte(m.texte).then(() => {
        copier.textContent = "Copié ✓";
        setTimeout(() => (copier.textContent = "Copier"), 1500);
      }, () => {});
    });
    corps.append(copier);
    carte.append(corps);
    return carte;
  }

  // Fichiers
  corps.append(creer("span", "ft", m.ext));
  const nom = creer("span", "msg-fichier", m.nom);
  carte.append(corps);

  if (m.type === "fichier") {
    nom.append(creer("small", "", m.taille));
    const telecharger = creer("button", "mini", "Télécharger");
    telecharger.type = "button";
    telecharger.addEventListener("click", () => {
      if (m.blob) telechargerFichier(m.blob, m.nom);
      else afficherToast("Démo : cet exemple n'a pas de vrai fichier.");
    });
    corps.append(nom, telecharger);
  }

  if (m.type === "envoi") {
    nom.append(creer("small", "", m.taille));
    corps.append(nom, creer("span", "pourcent", m.pourcent + " %"));
    const barre = creer("div", "barre");
    barre.setAttribute("role", "progressbar");
    barre.setAttribute("aria-label", m.nom);
    barre.setAttribute("aria-valuenow", m.pourcent);
    const rempli = creer("b");
    rempli.style.width = m.pourcent + "%";
    barre.append(rempli);
    const annuler = creer("button", "mini", "Annuler");
    annuler.type = "button";
    annuler.addEventListener("click", () => (m.annuler ? m.annuler() : retirer(carte)));
    const actions = creer("div", "msg-actions");
    actions.append(annuler);
    carte.append(barre, creer("p", "msg-note", "Garde cet écran ouvert pendant l'envoi."), actions);
  }

  if (m.type === "interrompu") {
    carte.classList.add("interrompu");
    nom.append(creer("small", "", "Envoi interrompu. Réessayer ?"));
    corps.append(nom);
    const reessayer = creer("button", "mini", "Réessayer");
    reessayer.type = "button";
    reessayer.addEventListener("click", () => {
      if (m.reessayer) { retirer(carte); m.reessayer(); }
      else carte.replaceWith(carteMessage({ ...m, type: "envoi", pourcent: 8 }));
    });
    const annuler = creer("button", "mini", "Annuler");
    annuler.type = "button";
    annuler.addEventListener("click", () => retirer(carte));
    const actions = creer("div", "msg-actions");
    actions.append(reessayer, annuler);
    carte.append(actions);
  }

  return carte;
}

function retirer(carte) {
  const fil = carte.parentElement;
  carte.remove();
  if (fil && !fil.querySelector(".msg")) fil.replaceChildren(messageVide(fil.id === "fil-hote" ? "hote" : "invite"));
}

function messageVide(role) {
  return creer("p", "vide", role === "hote"
    ? "Rien pour l'instant. Partage le code pour inviter quelqu'un."
    : "Rien pour l'instant. Envoie le premier message.");
}

const EXEMPLES = {
  hote: [
    { type: "texte", de: "Invité 1", heure: "14:02", texte: "https://maps.app/xyz…" },
    { type: "fichier", de: "Moi", heure: "14:05", ext: "JPG", nom: "IMG_2041.jpg", taille: "2,4 Mo" },
    { type: "envoi", de: "Moi", heure: "14:07", ext: "MP4", nom: "vacances.mp4", taille: "318 / 512 Mo", pourcent: 62 },
    { type: "interrompu", de: "Moi", heure: "14:09", ext: "PDF", nom: "billet-train.pdf" },
  ],
  invite: [
    { type: "fichier", de: "Hôte", heure: "14:05", ext: "PDF", nom: "billet-train.pdf", taille: "310 Ko" },
    { type: "texte", de: "Invité 2", heure: "14:06", texte: "Le code wifi : orange2026" },
    { type: "envoi", de: "Moi", heure: "14:07", ext: "MP4", nom: "vacances.mp4", taille: "318 / 512 Mo", pourcent: 62 },
  ],
};

// Ajoute un message en bas du fil (en enlevant « Rien pour l'instant… ») et descend jusqu'à lui
function ajouterAuFil(role, m) {
  const fil = $(role === "hote" ? "fil-hote" : "fil-invite");
  fil.querySelector(".vide")?.remove();
  const carte = carteMessage({ heure: heureMaintenant(), ...m });
  fil.append(carte);
  fil.scrollTop = fil.scrollHeight;
  return carte;
}

function heureMaintenant() {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// La salle ferme (ou on la quitte) : on efface tous les messages et fichiers de la page,
// comme on vide une table après le repas. Les fichiers gardés en mémoire disparaissent avec leurs cartes.
function viderSalles() {
  ["hote", "invite"].forEach((role) => remplirFil(role, true));
  $("liste-invites").textContent = "";
  if ($("confirmation").open) $("confirmation").close();
}

function remplirFil(role, toutVider) {
  const fil = $(role === "hote" ? "fil-hote" : "fil-invite");
  const zone = fil.parentElement.querySelector("textarea");
  zone.value = "";
  ajusterHauteur(zone);
  if (etat.avecExemples && !toutVider) fil.replaceChildren(...EXEMPLES[role].map(carteMessage));
  else fil.replaceChildren(messageVide(role));
}

/* =========================================================
   Petits messages temporaires (toast) et copie
   ========================================================= */
let minuteurToast;
function afficherToast(texte) {
  const toast = $("toast");
  toast.textContent = texte;
  toast.classList.add("visible");
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => toast.classList.remove("visible"), 2600);
}

// Copie un texte. Renvoie une promesse : réussie si la copie a marché.
function copierTexte(texte) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(texte).catch(() => copierALAncienne(texte));
  }
  return copierALAncienne(texte);
}

// Plan B pour les navigateurs qui refusent la copie moderne
function copierALAncienne(texte) {
  const zone = document.createElement("textarea");
  zone.value = texte;
  zone.setAttribute("readonly", "");
  zone.style.position = "fixed";
  zone.style.opacity = "0";
  document.body.append(zone);
  zone.select();
  zone.setSelectionRange(0, texte.length);
  const ok = document.execCommand("copy");
  zone.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error("copie refusée"));
}

/* =========================================================
   Fenêtre de confirmation
   ========================================================= */
let actionConfirmee = null;
function demanderConfirmation(titre, texte, boutonOui, action) {
  $("conf-titre").textContent = titre;
  $("conf-texte").textContent = texte;
  $("conf-oui").textContent = boutonOui;
  actionConfirmee = action;
  $("confirmation").showModal();
}
$("conf-oui").addEventListener("click", () => {
  $("confirmation").close();
  if (actionConfirmee) actionConfirmee();
});
$("conf-non").addEventListener("click", () => $("confirmation").close());

/* =========================================================
   Écran 1 : le champ du code (6 cases)
   ========================================================= */
const champ = $("champ-code");
const cases = $("cases");

function majCases() {
  const valeur = champ.value;
  cases.querySelectorAll(".case").forEach((c, i) => {
    c.textContent = valeur[i] || "";
    c.classList.toggle("pleine", Boolean(valeur[i]));
    c.classList.toggle("active", i === Math.min(valeur.length, 5));
  });
}
function afficherErreur(cle) {
  const boite = $("erreur-code");
  boite.textContent = ERREURS[cle];
  boite.hidden = false;
  cases.classList.toggle("en-erreur", cle === "court" || cle === "inconnu");
}
function effacerErreur() {
  $("erreur-code").hidden = true;
  cases.classList.remove("en-erreur");
}

champ.addEventListener("input", () => {
  champ.value = champ.value.replace(/\D/g, "").slice(0, 6); // garde seulement les chiffres
  effacerErreur();
  majCases();
});
champ.addEventListener("focus", () => { cases.classList.add("focus"); majCases(); });
champ.addEventListener("blur", () => cases.classList.remove("focus"));

$("form-rejoindre").addEventListener("submit", (e) => {
  e.preventDefault();
  if (champ.value.length !== 6) {
    afficherErreur("court");
    champ.focus();
    return;
  }
  rejoindreSalle(champ.value);
});

/* =========================================================
   Les boutons des écrans
   ========================================================= */
$("btn-creer").addEventListener("click", creerSalle);

$("btn-copier-code").addEventListener("click", () => {
  copierTexte(etat.codeHote).then(() => afficherToast("Code copié ✓"), () => {});
});
$("btn-partager").addEventListener("click", () => {
  copierTexte(lienSalle(etat.codeHote)).then(() => afficherToast("Lien copié ✓"), () => {});
});

$("btn-fermer").addEventListener("click", () => {
  demanderConfirmation(
    "Fermer la salle pour tout le monde ?",
    "Tous les messages et fichiers seront supprimés.",
    "Fermer la salle",
    () => {
      fermerSalleHote();
      fermerAvecEffet("hoteVolontaire");
    }
  );
});

$("btn-quitter").addEventListener("click", () => {
  demanderConfirmation(
    "Quitter la salle ?",
    "Tu perdras ce qui n'est pas téléchargé.",
    "Quitter",
    quitterSalle
  );
});

$("btn-retour").addEventListener("click", () => afficherEcran("accueil"));

// Si on ferme l'onglet, on raccroche tout de suite (les autres le voient aussitôt)
window.addEventListener("pagehide", () => {
  if (etat.ecran === "hote") fermerSalleHote(true);
  raccrocher();
});
$("btn-nouvelle").addEventListener("click", creerSalle);

$("btn-rester").addEventListener("click", () => ($("alerte-inactivite").hidden = true));

/* ---------- Envoyer du texte ---------- */
// L'hôte l'envoie à chaque invité ; l'invité l'envoie à l'hôte
function envoyerTexte(texte) {
  const paquet = { type: "texte", texte };
  if (etat.ecran === "hote") {
    etat.invites.forEach((i) => {
      if (i.conn.open) i.conn.send(paquet);
    });
    ajouterAuFil("hote", { type: "texte", de: "Moi", texte });
    return true;
  }
  if (!etat.connHote || !etat.connHote.open) {
    afficherToast(ERREURS.reseau);
    return false;
  }
  etat.connHote.send(paquet);
  ajouterAuFil("invite", { type: "texte", de: "Moi", texte });
  return true;
}

// La zone d'écriture grandit avec le texte (jusqu'à environ 5 lignes)
function ajusterHauteur(zone) {
  zone.style.height = "";
  if (!zone.scrollHeight) return; // zone encore cachée : on garde sa hauteur normale
  zone.style.height = Math.min(zone.scrollHeight, 120) + "px";
}

document.querySelectorAll("[data-compose]").forEach((form) => {
  const zone = form.querySelector("textarea");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const texte = zone.value.trim();
    if (!texte) return zone.focus();
    if (envoyerTexte(texte)) {
      zone.value = "";
      ajusterHauteur(zone);
      zone.focus();
    }
  });
  zone.addEventListener("input", () => ajusterHauteur(zone));
  // Entrée = Envoyer ; Maj + Entrée = aller à la ligne
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
});

/* ---------- Envoyer un fichier, petit ou gros (missions 8 et 9) ---------- */
// Le fichier part en petits morceaux, comme un déménagement en plusieurs cartons :
// on lit un morceau, on l'envoie, on attend qu'il y ait de la place dans le tuyau, puis le suivant.
// Ainsi, le fichier entier n'est jamais chargé d'un coup en mémoire.
const MORCEAU = 64 * 1024;             // 64 Ko par morceau
const TUYAU_PLEIN = 1024 * 1024;       // on ne laisse jamais plus d'1 Mo en attente dans le tuyau
const PAQUET_RECU = 16 * 1024 * 1024;  // à l'arrivée, on range les morceaux par paquets de 16 Mo
// Quand un invité envoie, l'hôte fait suivre aux autres. Pour que l'hôte ne soit jamais débordé,
// il dit « bien reçu » (accusé de réception) tous les 1 Mo, et l'invité n'a jamais plus de 4 Mo d'avance.
const ACCUSE = 1024 * 1024;
const AVANCE_MAX = 4 * 1024 * 1024;
// L'iPhone a peu de mémoire pour les pages web : au-delà de 500 Mo, il refuse de recevoir
// (le fichier entier doit tenir dans la mémoire de Safari avant d'être téléchargé).
const LIMITE_RECEPTION = estIOS ? 500 * 1024 * 1024 : Infinity;

const TEXTE_TROP_GROS_ENVOI = "Ce fichier est trop gros pour cet appareil. Essaie un fichier plus petit.";
const TEXTE_TROP_GROS_RECU = "Ce fichier est trop gros pour être reçu sur cet appareil.";

// « 2,4 Mo », « 310 Ko », « 512 o »
function tailleLisible(octets) {
  if (octets < 1024) return octets + " o";
  if (octets < 1024 * 1024) return Math.round(octets / 1024) + " Ko";
  const mo = octets / (1024 * 1024);
  return mo.toLocaleString("fr-FR", { maximumFractionDigits: mo < 10 ? 1 : 0 }) + " Mo";
}

// « 318 / 512 Mo » (ou « 800 Ko / 2,4 Mo » quand les unités diffèrent)
function tailleProgression(fait, total) {
  const a = tailleLisible(fait);
  const b = tailleLisible(total);
  const unite = (t) => t.slice(t.lastIndexOf(" "));
  return (unite(a) === unite(b) ? a.slice(0, a.lastIndexOf(" ")) : a) + " / " + b;
}

// L'extension du nom (« photo.jpg » → « JPG »), pour la petite pastille de la carte
function extension(nom) {
  const point = nom.lastIndexOf(".");
  const ext = point > 0 ? nom.slice(point + 1) : "";
  return /^[a-z0-9]{1,4}$/i.test(ext) ? ext.toUpperCase() : "?";
}

function carteFichier(de, nom, blob) {
  return { type: "fichier", de, nom, blob, ext: extension(nom), taille: tailleLisible(blob.size) };
}

// La carte « en cours » : barre de progression, pourcentage et bouton Annuler
function carteEnCours(de, nom, taille, annuler) {
  return {
    type: "envoi", de, nom, ext: extension(nom), heure: heureMaintenant(),
    taille: tailleProgression(0, taille), pourcent: 0, annuler,
  };
}

// Fait avancer la barre (seulement quand le pourcentage change, pour ne pas ralentir la page)
function majProgression(carte, fait, total) {
  const pourcent = total ? Math.floor((fait * 100) / total) : 100;
  if (carte.dataset.pourcent === String(pourcent)) return;
  carte.dataset.pourcent = pourcent;
  carte.querySelector(".pourcent").textContent = pourcent + " %";
  carte.querySelector(".barre b").style.width = pourcent + "%";
  carte.querySelector(".barre").setAttribute("aria-valuenow", pourcent);
  carte.querySelector(".msg-fichier small").textContent = tailleProgression(fait, total);
}

// Remplace une carte « en cours » par la carte finale avec le bouton Télécharger
function terminerCarte(carte, de, nom, blob, heure) {
  carte.replaceWith(carteMessage({ ...carteFichier(de, nom, blob), heure }));
}

// Un numéro d'envoi au hasard, pour reconnaître les morceaux d'un même fichier
function nouvelId() {
  const n = new Uint32Array(2);
  crypto.getRandomValues(n);
  return n[0].toString(36) + n[1].toString(36);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Le tuyau est-il encore trop rempli ? (PeerJS garde aussi sa propre file d'attente)
function tuyauPlein(conn) {
  const canal = conn.dataChannel;
  return conn.bufferSize > 0 || (canal && canal.bufferedAmount > TUYAU_PLEIN);
}

// Attend que le tuyau ait de nouveau de la place. On écoute le signal du tuyau (« bufferedamountlow »)
// plutôt qu'un minuteur, car un onglet caché derrière un autre a ses minuteurs ralentis par le navigateur.
function attendrePlace(conn) {
  const canal = conn.dataChannel;
  if (!canal || !tuyauPlein(conn)) return Promise.resolve();
  if (conn.bufferSize > 0) return pause(50); // c'est PeerJS qui fait patienter : on repasse vite
  canal.bufferedAmountLowThreshold = TUYAU_PLEIN / 2;
  return new Promise((ok) => {
    const fini = () => {
      canal.removeEventListener("bufferedamountlow", fini);
      canal.removeEventListener("close", fini);
      clearTimeout(secours);
      ok();
    };
    const secours = setTimeout(fini, 2000); // au cas où le signal ne viendrait jamais
    canal.addEventListener("bufferedamountlow", fini);
    canal.addEventListener("close", fini);
  });
}

// Envoie le même paquet à tous ceux qui reçoivent ce fichier
function diffuser(envoi, paquet) {
  envoi.cibles.forEach((conn) => {
    if (conn.open) conn.send(paquet);
  });
}

// Retire ceux dont le tuyau s'est coupé pendant l'envoi
function retirerCoupes(envoi) {
  envoi.cibles.forEach((conn) => {
    if (!conn.open) {
      envoi.cibles.delete(conn);
      envoi.coupe = true;
    }
  });
}

// (invité) Attend le « bien reçu » de l'hôte, ou 2 secondes au plus pour revérifier
function attendreAccuse(envoi) {
  return new Promise((ok) => {
    const secours = setTimeout(ok, 2000);
    envoi.reveil = () => { clearTimeout(secours); envoi.reveil = null; ok(); };
  });
}

// Les fichiers partent un par un, dans l'ordre (comme une file d'attente au guichet)
let fileEnvois = Promise.resolve();

// L'hôte l'envoie à chaque invité ; l'invité l'envoie à l'hôte (comme le texte)
function envoyerFichier(fichier) {
  const role = etat.ecran;
  if (role !== "hote" && role !== "invite") return;
  if (role === "invite" && (!etat.connHote || !etat.connHote.open)) {
    afficherToast(ERREURS.reseau);
    return;
  }
  const cibles = role === "hote" ? etat.invites.map((i) => i.conn).filter((c) => c.open) : [etat.connHote];
  if (cibles.length === 0) {
    // Personne dans la salle pour l'instant : le fichier apparaît seulement chez moi
    ajouterAuFil(role, carteFichier("Moi", fichier.name, fichier));
    return;
  }
  const envoi = {
    id: nouvelId(), fichier, role, peer: etat.peer, cibles: new Set(cibles), coupe: false, annule: false,
    accuse: 0, // (invité) combien d'octets l'hôte a déjà bien reçus et fait suivre
  };
  envoi.carte = ajouterAuFil(role, carteEnCours("Moi", fichier.name, fichier.size, () => annulerEnvoi(envoi)));
  envoi.heure = envoi.carte.querySelector("time").textContent;
  etat.envois.set(envoi.id, envoi);
  fileEnvois = fileEnvois.then(() => transmettre(envoi));
}

// « Annuler » chez celui qui envoie : on prévient les autres et on retire la carte
function annulerEnvoi(envoi) {
  envoi.annule = true;
  envoi.reveil?.();
  etat.envois.delete(envoi.id);
  diffuser(envoi, { type: "annule", id: envoi.id });
  retirer(envoi.carte);
}

async function transmettre(envoi) {
  const { fichier, id } = envoi;
  const salleOuverte = () => etat.peer === envoi.peer && etat.ecran === envoi.role;
  const continuer = () => !envoi.annule && salleOuverte() && envoi.cibles.size > 0;
  if (!continuer()) return;

  diffuser(envoi, { type: "fichier-debut", id, nom: fichier.name, mime: fichier.type, taille: fichier.size });
  let envoye = 0;
  let lectureRatee = false;
  try {
    while (envoye < fichier.size) {
      retirerCoupes(envoi);
      // On attend que les tuyaux se vident un peu avant d'ajouter un morceau
      while (continuer() && [...envoi.cibles].some(tuyauPlein)) {
        await Promise.all([...envoi.cibles].map(attendrePlace));
        retirerCoupes(envoi);
      }
      // L'invité attend que l'hôte suive (il fait passer le fichier aux autres en même temps)
      while (continuer() && envoi.role === "invite" && envoye - envoi.accuse > AVANCE_MAX) {
        await attendreAccuse(envoi);
        retirerCoupes(envoi);
      }
      if (!continuer()) break;
      const donnees = await fichier.slice(envoye, envoye + MORCEAU).arrayBuffer();
      if (!continuer()) break;
      diffuser(envoi, { type: "morceau", id, donnees });
      envoye += donnees.byteLength;
      majProgression(envoi.carte, envoye, fichier.size);
    }
    retirerCoupes(envoi);
  } catch {
    lectureRatee = true; // le fichier n'a pas pu être lu (supprimé, ou trop gros pour l'appareil)
  }

  etat.envois.delete(id);
  if (envoi.annule || !salleOuverte()) return; // carte déjà retirée, ou salle fermée

  if (!lectureRatee && envoye >= fichier.size && envoi.cibles.size > 0) {
    diffuser(envoi, { type: "fichier-fin", id });
    terminerCarte(envoi.carte, "Moi", fichier.name, fichier, envoi.heure);
    return;
  }
  if (lectureRatee || envoi.coupe) {
    // Le tuyau s'est coupé (ou le fichier est illisible) : on propose de réessayer
    diffuser(envoi, { type: "annule", id });
    const carte = carteMessage({
      type: "interrompu", de: "Moi", heure: envoi.heure, ext: extension(fichier.name), nom: fichier.name,
      reessayer: () => envoyerFichier(fichier),
    });
    envoi.carte.replaceWith(carte);
    if (lectureRatee) afficherToast(TEXTE_TROP_GROS_ENVOI);
    return;
  }
  // Tous les autres ont annulé ou refusé : le fichier reste seulement chez moi
  terminerCarte(envoi.carte, "Moi", fichier.name, fichier, envoi.heure);
}

/* ---------- Recevoir un fichier, morceau par morceau ---------- */
// Les paquets possibles : « fichier-debut », « morceau », « fichier-fin », « annule », « refus », « accuse »
// L'hôte qui reçoit le fichier d'un invité le fait suivre, morceau par morceau, aux autres invités (« relais »).
// Il peut faire suivre sans garder le fichier pour lui (« garder » = false) : s'il a annulé, ou s'il manque de place.
function recevoirPaquetFichier(role, de, conn, msg) {
  const id = msg.id;
  if (typeof id !== "string") return;

  if (msg.type === "accuse") {
    // (invité) L'hôte a bien reçu et fait suivre mon fichier jusque-là
    const envoi = etat.envois.get(id);
    if (envoi && typeof msg.n === "number") {
      envoi.accuse = Math.max(envoi.accuse, msg.n);
      envoi.reveil?.();
    }
    return;
  }

  if (msg.type === "annule" || msg.type === "refus") {
    // Celui qui recevait mon fichier n'en veut plus
    etat.envois.get(id)?.cibles.delete(conn);
    const recu = etat.recus.get(id);
    if (!recu) return;
    if (recu.conn === conn) {
      // Celui qui m'envoyait un fichier l'a annulé : on prévient aussi ceux à qui on le faisait suivre
      etat.recus.delete(id);
      recu.relais.forEach((c) => { if (c.open) c.send({ type: "annule", id }); });
      if (recu.garder) retirer(recu.carte);
    } else if (recu.relais.delete(conn)) {
      // Un invité ne veut plus du fichier que je lui faisais suivre
      lacherSiPersonne(recu);
    }
    return;
  }

  if (msg.type === "fichier-debut") {
    if (typeof msg.nom !== "string" || typeof msg.taille !== "number" || etat.recus.has(id)) return;
    const nom = msg.nom || "fichier";
    const mime = typeof msg.mime === "string" ? msg.mime : "";
    // L'hôte fait suivre l'annonce aux autres invités, avec le nom de l'expéditeur
    const relais = new Set(role === "hote" ? autresInvites(conn) : []);
    relais.forEach((c) => c.send({ type: "fichier-debut", id, nom, mime, taille: msg.taille, de }));
    const tropGros = msg.taille > LIMITE_RECEPTION;
    if (tropGros) afficherToast(TEXTE_TROP_GROS_RECU);
    if (tropGros && relais.size === 0) {
      conn.send({ type: "refus", id });
      return;
    }
    const recu = {
      id, conn, de, nom, mime, garder: !tropGros, relais, accuse: 0,
      taille: msg.taille, recu: 0, morceaux: [], tailleMorceaux: 0, paquets: [],
    };
    if (recu.garder) {
      recu.carte = ajouterAuFil(role, carteEnCours(de, nom, recu.taille, () => arreterDeGarder(recu, "annule")));
      recu.heure = recu.carte.querySelector("time").textContent;
    }
    etat.recus.set(id, recu);
    return;
  }

  const recu = etat.recus.get(id);
  if (!recu || recu.conn !== conn) return;

  if (msg.type === "morceau") {
    let donnees = msg.donnees;
    if (ArrayBuffer.isView(donnees)) donnees = donnees.buffer.slice(donnees.byteOffset, donnees.byteOffset + donnees.byteLength);
    if (!(donnees instanceof ArrayBuffer)) return;
    recu.recu += donnees.byteLength;
    if (recu.relais.size > 0) faireSuivre(recu, { type: "morceau", id, donnees });
    if (role === "hote" && recu.recu - recu.accuse >= ACCUSE) envoyerAccuse(recu);
    if (!recu.garder) return;
    recu.morceaux.push(donnees);
    recu.tailleMorceaux += donnees.byteLength;
    try {
      // Tous les 16 Mo, on range les morceaux dans un « Blob » (un fichier gardé par le navigateur),
      // que l'ordinateur peut mettre sur son disque au lieu de tout garder en mémoire vive
      if (recu.tailleMorceaux >= PAQUET_RECU) {
        recu.paquets.push(new Blob(recu.morceaux));
        recu.morceaux = [];
        recu.tailleMorceaux = 0;
      }
    } catch {
      return echecReception(recu);
    }
    majProgression(recu.carte, recu.recu, recu.taille);
    return;
  }

  if (msg.type === "fichier-fin") {
    etat.recus.delete(id);
    if (recu.relais.size > 0) faireSuivre(recu, { type: "fichier-fin", id });
    if (!recu.garder) return;
    let blob;
    try {
      blob = new Blob([...recu.paquets, ...recu.morceaux], { type: recu.mime });
    } catch {
      return echecReception(recu);
    }
    terminerCarte(recu.carte, recu.de, recu.nom, blob, recu.heure);
    afficherToast("Fichier reçu. Télécharge-le avant la fermeture.");
  }
}

// (hôte) Fait suivre un paquet aux invités qui reçoivent ce fichier par moi
function faireSuivre(recu, paquet) {
  recu.relais.forEach((c) => {
    if (c.open) c.send(paquet);
    else recu.relais.delete(c);
  });
  lacherSiPersonne(recu);
}

// (hôte) Dit « bien reçu » à l'expéditeur, mais seulement quand les tuyaux vers les autres
// ont de la place : ainsi l'expéditeur ralentit au rythme du plus lent, et rien ne s'entasse chez l'hôte
async function envoyerAccuse(recu) {
  if (recu.accuseEnCours) return;
  recu.accuseEnCours = true;
  const pleins = () => [...recu.relais].filter((c) => c.open && tuyauPlein(c));
  while (etat.recus.get(recu.id) === recu && pleins().length > 0) {
    await Promise.all(pleins().map(attendrePlace));
  }
  recu.accuseEnCours = false;
  if (etat.recus.get(recu.id) !== recu || !recu.conn.open) return;
  recu.accuse = recu.recu;
  recu.conn.send({ type: "accuse", id: recu.id, n: recu.recu });
}

// Je ne garde plus le fichier pour moi (annulé, ou plus de place) ;
// je continue de le faire suivre aux autres s'il y en a
function arreterDeGarder(recu, raison) {
  if (recu.garder) retirer(recu.carte);
  recu.garder = false;
  recu.morceaux = [];
  recu.paquets = [];
  recu.tailleMorceaux = 0;
  lacherSiPersonne(recu, raison);
}

// Plus personne ne veut ce fichier (ni moi, ni les autres) : on dit à l'expéditeur d'arrêter
function lacherSiPersonne(recu, raison = "refus") {
  if (recu.garder || recu.relais.size > 0 || etat.recus.get(recu.id) !== recu) return;
  etat.recus.delete(recu.id);
  if (recu.conn.open) recu.conn.send({ type: raison, id: recu.id });
}

// L'appareil n'a plus assez de place pour garder le fichier : on arrête et on l'explique
function echecReception(recu) {
  arreterDeGarder(recu, "refus");
  afficherToast(TEXTE_TROP_GROS_RECU);
}

// Un invité est parti en plein envoi : ses fichiers à moitié arrivés sont jetés, chez moi et chez les autres
function abandonnerReceptions(conn) {
  etat.recus.forEach((recu) => {
    if (recu.conn !== conn) return;
    etat.recus.delete(recu.id);
    recu.relais.forEach((c) => { if (c.open) c.send({ type: "annule", id: recu.id }); });
    if (recu.garder) retirer(recu.carte);
  });
}

// (hôte) Un invité est parti : on arrête de lui faire suivre des fichiers
function oublierCible(conn) {
  etat.recus.forEach((recu) => {
    if (recu.relais.delete(conn)) lacherSiPersonne(recu);
  });
}

// La salle ferme : on oublie tout ce qui était en route
function oublierTransferts() {
  etat.envois.clear();
  etat.recus.clear();
}

// « Télécharger » : on fabrique un lien temporaire vers le fichier en mémoire et on clique dessus
function telechargerFichier(blob, nom) {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Le bouton « + » ouvre le choix de fichiers (sur iPhone : Photos, Fichiers, appareil photo)
const choixFichier = document.createElement("input");
choixFichier.type = "file";
choixFichier.multiple = true;
choixFichier.hidden = true;
document.body.append(choixFichier);
choixFichier.addEventListener("change", () => {
  Array.from(choixFichier.files).forEach(envoyerFichier);
  choixFichier.value = ""; // pour pouvoir renvoyer le même fichier ensuite
});
document.querySelectorAll("[data-ajout]").forEach((bouton) => {
  bouton.addEventListener("click", () => choixFichier.click());
});

// Glisser-déposer (PC) : on peut lâcher le fichier n'importe où dans la salle
const contientFichiers = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
document.querySelectorAll(".salle").forEach((salle) => {
  let profondeur = 0; // le survol passe d'un élément à l'autre : on compte les entrées/sorties
  salle.addEventListener("dragenter", (e) => {
    if (!contientFichiers(e)) return;
    profondeur += 1;
    salle.classList.add("glisse");
  });
  salle.addEventListener("dragleave", () => {
    profondeur = Math.max(0, profondeur - 1);
    if (profondeur === 0) salle.classList.remove("glisse");
  });
  salle.addEventListener("drop", (e) => {
    profondeur = 0;
    salle.classList.remove("glisse");
    if (!contientFichiers(e)) return;
    e.preventDefault();
    Array.from(e.dataTransfer.files).forEach(envoyerFichier);
  });
});
// Partout dans la page, un fichier lâché ne doit pas remplacer la page (sinon la salle se fermerait)
window.addEventListener("dragover", (e) => { if (contientFichiers(e)) e.preventDefault(); });
window.addEventListener("drop", (e) => { if (contientFichiers(e)) e.preventDefault(); });

// Encart d'installation : seulement dans Safari sur iPhone, si l'app n'est pas déjà installée
$("encart-ios").hidden = !(estSafariIOS && !estInstallee);

// Arrivée par le lien du QR code (…/?code=123456) : on entre directement
(function arriveeParLien() {
  const code = new URLSearchParams(location.search).get("code");
  if (code === null) return;
  history.replaceState(null, "", location.pathname); // on enlève le code de l'adresse
  champ.value = code.replace(/\D/g, "").slice(0, 6);
  majCases();
  if (champ.value.length !== 6) return afficherErreur("court");
  rejoindreSalle(champ.value);
})();

/* =========================================================
   Panneau Démo (temporaire)
   ========================================================= */
const demoBouton = $("demo-bouton");
const demoPanneau = $("demo-panneau");
demoBouton.addEventListener("click", () => {
  const ouvert = demoPanneau.hidden;
  demoPanneau.hidden = !ouvert;
  demoBouton.setAttribute("aria-expanded", String(ouvert));
});

demoPanneau.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;

  if (d.demo === "accueil") afficherEcran("accueil");
  if (d.demo === "hote") etat.codeHote ? ouvrirSalleHote() : creerSalle();
  if (d.demo === "invite") ouvrirSalleInvite(etat.codeHote || "482915");

  if (d.fermee) afficherFermee(d.fermee);

  if (d.erreur) {
    afficherEcran("accueil");
    if (d.erreur === "court") { champ.value = "482"; majCases(); }
    if (d.erreur === "inconnu") { champ.value = "999111"; majCases(); }
    afficherErreur(d.erreur);
  }

  if (d.salle === "exemples" || d.salle === "vider") {
    etat.avecExemples = d.salle === "exemples";
    if (etat.ecran === "hote" || etat.ecran === "invite") remplirFil(etat.ecran);
    else creerSalle();
  }
  if (d.salle === "inactivite") {
    if (etat.ecran !== "hote" && etat.ecran !== "invite") creerSalle();
    $("alerte-inactivite").hidden = false;
    $("btn-rester").focus();
  }

  if (d.toast) afficherToast(d.toast);

  if (d.install === "ios") { afficherEcran("accueil"); $("encart-ios").hidden = !$("encart-ios").hidden; }
  if (d.install === "pc") { afficherEcran("accueil"); $("btn-installer").hidden = !$("btn-installer").hidden; }
});
