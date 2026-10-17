/* =========================================================
   Partage éphémère — le socle commun à tous les fichiers
   Le code est rangé par sujet, comme les chapitres d'un livre :
   - app.js        : ce que la page se rappelle, les textes, les petits outils partagés
   - connexion.js  : créer, rejoindre, fermer ou quitter une salle (PeerJS)
   - messages.js   : le fil de messages et l'envoi de texte
   - fichiers.js   : envoyer un fichier en petits morceaux
   - reception.js  : recevoir un fichier et le faire suivre aux autres invités
   - ecrans.js     : ce qu'on voit à l'écran et les boutons
   - inactivite.js : la fermeture automatique après 30 minutes
   ========================================================= */
"use strict";

// --- Raccourci pour attraper un élément de la page par son id
const $ = (id) => document.getElementById(id);

// --- Ce que la page « se rappelle » pendant qu'elle est ouverte (en mémoire seulement)
const etat = {
  ecran: "accueil",
  codeHote: null,       // le code de la salle, tiré au hasard à chaque nouvelle salle
  peer: null,           // notre « ligne téléphonique » chez le standardiste PeerJS
  invites: [],          // (hôte) les invités connectés : { nom, conn }
  numeroInvite: 0,      // (hôte) pour nommer « Invité 1 », « Invité 2 »…
  connHote: null,       // (invité) le tuyau direct vers l'hôte
  envois: new Map(),    // les fichiers en train de partir, rangés par numéro d'envoi
  recus: new Map(),     // les fichiers en train d'arriver, rangés par numéro d'envoi
};

const dansLaSalle = () => etat.ecran === "hote" || etat.ecran === "invite";

// --- Tous les textes de la salle fermée, mot pour mot depuis ECRANS.md
const RAISONS = {
  hoteVolontaire:   { texte: "Tu as fermé la salle. Tout a été supprimé.", ancienHote: true },
  hoteFermeInvite:  { texte: "L'hôte a fermé la salle.", ancienHote: false },
  inactiviteHote:   { texte: "La salle s'est fermée après 30 minutes sans activité.", ancienHote: true },
  inactiviteInvite: { texte: "La salle s'est fermée après 30 minutes sans activité.", ancienHote: false },
  disparuInvite:    { texte: "L'hôte n'est plus connecté (écran verrouillé ou connexion coupée).", ancienHote: false },
};

// --- Les messages d'erreur de l'accueil, mot pour mot
const ERREURS = {
  court:      "Le code contient 6 chiffres.",
  inconnu:    "Aucune salle avec ce code. Vérifie-le auprès de l'hôte.",
  pleine:     "Cette salle est pleine (8 personnes).",
  reseau:     "Pas de connexion internet.",
  navigateur: "Ce navigateur ne permet pas le partage. Essaie Safari ou Chrome.",
};

// --- Est-ce un iPhone / iPad ? (pour le bandeau, l'encart d'installation et la taille des fichiers reçus)
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

// Fabrique un élément de la page, avec sa classe et son texte
function creer(balise, classe, texte) {
  const el = document.createElement(balise);
  if (classe) el.className = classe;
  if (texte !== undefined) el.textContent = texte;
  return el;
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
