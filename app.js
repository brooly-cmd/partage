/* =========================================================
   Partage éphémère — le petit moteur de la page
   Mission 6 : l'invité rejoint la salle de l'hôte pour de vrai,
   grâce au « standardiste » gratuit PeerJS.
   Mission 7 : on s'envoie du texte en instantané par ce tuyau.
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
    pc.addEventListener("iceconnectionstatechange", () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") une();
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

    conn.on("data", (msg) => {
      if (!etat.peer || !msg) return;
      if (msg.type === "texte" && typeof msg.texte === "string") {
        ajouterAuFil("hote", { type: "texte", de: invite.nom, texte: msg.texte });
      }
    });

    surveillerCoupure(conn, () => {
      etat.invites = etat.invites.filter((i) => i !== invite);
      if (etat.peer) majPresence();
    });
  });
}

// « 1 personne connectée », la liste des invités, et la même info envoyée à chaque invité
function texteNombre(n) {
  return n + (n > 1 ? " personnes connectées" : " personne connectée");
}
function majPresence() {
  const n = etat.invites.length;
  $("etat-hote").textContent = texteNombre(n);
  $("invites-hote").hidden = n === 0;
  $("liste-invites").textContent = etat.invites.map((i) => i.nom).join(", ");
  etat.invites.forEach((i) => {
    if (i.conn.open) i.conn.send({ type: "nombre", n });
  });
}

// L'hôte ferme : il prévient les invités, puis raccroche
// (tout de suite si l'onglet se ferme, sinon après un petit délai pour que le message parte)
function fermerSalleHote(toutDeSuite) {
  etat.invites.forEach((i) => {
    if (i.conn.open) i.conn.send({ type: "fermee" });
  });
  const peer = etat.peer;
  etat.peer = null;
  etat.invites = [];
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
      if (msg.type === "nombre") $("etat-invite").textContent = texteNombre(msg.n);
      if (msg.type === "texte" && typeof msg.texte === "string") {
        ajouterAuFil("invite", { type: "texte", de: "Hôte", texte: msg.texte });
      }
      if (msg.type === "fermee") {
        raccrocher();
        fermerAvecEffet("hoteFermeInvite");
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
}

/* ---------- Écran 3 : salle de l'invité ---------- */
function ouvrirSalleInvite(code) {
  $("code-invite").textContent = formaterCode(code);
  remplirFil("invite");
  afficherEcran("invite");
}

/* ---------- Écran 4 : salle fermée ---------- */
function afficherFermee(cle) {
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
    telecharger.addEventListener("click", () => afficherToast("Démo : le téléchargement arrive à la mission 8."));
    corps.append(nom, telecharger);
  }

  if (m.type === "envoi") {
    nom.append(creer("small", "", m.taille));
    corps.append(nom, creer("span", "pourcent", m.pourcent + " %"));
    const barre = creer("div", "barre");
    const rempli = creer("b");
    rempli.style.width = m.pourcent + "%";
    barre.append(rempli);
    const annuler = creer("button", "mini", "Annuler");
    annuler.type = "button";
    annuler.addEventListener("click", () => retirer(carte));
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
      carte.replaceWith(carteMessage({ ...m, type: "envoi", pourcent: 8 }));
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
  fil.append(carteMessage({ heure: heureMaintenant(), ...m }));
  fil.scrollTop = fil.scrollHeight;
}

function heureMaintenant() {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function remplirFil(role) {
  const fil = $(role === "hote" ? "fil-hote" : "fil-invite");
  const zone = fil.parentElement.querySelector("textarea");
  zone.value = "";
  ajusterHauteur(zone);
  if (etat.avecExemples) fil.replaceChildren(...EXEMPLES[role].map(carteMessage));
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

// Ajouter un fichier : pas encore actif (mission 8)
document.querySelectorAll("[data-ajout]").forEach((bouton) => {
  bouton.addEventListener("click", () => afficherToast("Démo : l'envoi de fichiers arrive à la mission 8."));
});

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
