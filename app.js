/* =========================================================
   Partage éphémère — le petit moteur de la page
   Mission 5 : « Créer une salle » donne un vrai code au hasard
   et un vrai QR code. Pas encore de connexion entre appareils.
   ========================================================= */
"use strict";

// --- Raccourci pour attraper un élément de la page par son id
const $ = (id) => document.getElementById(id);

// --- Ce que la page « se rappelle » pendant qu'elle est ouverte (en mémoire seulement)
const etat = {
  ecran: "accueil",
  codeHote: null,       // le code de la salle, tiré au hasard à chaque nouvelle salle
  avecExemples: false,  // le panneau Démo peut remplir la salle de faux messages
};

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
// « Créer une salle » : un nouveau code, un nouveau QR, puis la salle
function creerSalle() {
  etat.codeHote = tirerCode();
  dessinerQR(lienSalle(etat.codeHote));
  ouvrirSalleHote();
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
      copierTexte(m.texte);
      copier.textContent = "Copié ✓";
      setTimeout(() => (copier.textContent = "Copier"), 1500);
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

function remplirFil(role) {
  const fil = $(role === "hote" ? "fil-hote" : "fil-invite");
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
  ouvrirSalleInvite(champ.value);
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
    () => fermerAvecEffet("hoteVolontaire")
  );
});

$("btn-quitter").addEventListener("click", () => {
  demanderConfirmation(
    "Quitter la salle ?",
    "Tu perdras ce qui n'est pas téléchargé.",
    "Quitter",
    () => afficherEcran("accueil")
  );
});

$("btn-retour").addEventListener("click", () => afficherEcran("accueil"));
$("btn-nouvelle").addEventListener("click", creerSalle);

$("btn-rester").addEventListener("click", () => ($("alerte-inactivite").hidden = true));

// Envoyer et Ajouter un fichier : pas encore actifs (missions 7 et 8)
document.querySelectorAll("[data-compose]").forEach((form) => {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    afficherToast("Démo : l'envoi de texte arrive à la mission 7.");
  });
});
document.querySelectorAll("[data-ajout]").forEach((bouton) => {
  bouton.addEventListener("click", () => afficherToast("Démo : l'envoi de fichiers arrive à la mission 8."));
});

// Encart d'installation : seulement dans Safari sur iPhone, si l'app n'est pas déjà installée
$("encart-ios").hidden = !(estSafariIOS && !estInstallee);

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
