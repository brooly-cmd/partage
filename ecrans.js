/* =========================================================
   Partage éphémère — ce qu'on voit à l'écran
   L'accueil (les 6 cases du code), la salle de l'hôte (code et QR code),
   la salle de l'invité, l'écran « Salle fermée », et tous les boutons.
   ========================================================= */
"use strict";

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
function ouvrirSalleHote() {
  const plaques = $("plaques-hote");
  plaques.replaceChildren(...etat.codeHote.split("").map((chiffre) => creer("span", "", chiffre)));
  plaques.setAttribute("aria-label", "Code de la salle : " + formaterCode(etat.codeHote));

  // Sur iPhone : « ne verrouille pas ». Ailleurs : « garde cette page ouverte ».
  $("bandeau-hote").textContent = estIOS
    ? "Ne verrouille pas ton écran : la salle se fermerait pour tout le monde."
    : "Garde cette page ouverte, sinon la salle se ferme.";

  majPresence();
  viderFil("hote");
  afficherEcran("hote");
  noterActivite(true); // le réveil démarre à l'ouverture de la salle
}

/* ---------- Écran 3 : salle de l'invité ---------- */
function ouvrirSalleInvite(code) {
  $("code-invite").textContent = formaterCode(code);
  majAnneaux(1); // l'anneau part plein, puis se vide jusqu'au temps restant annoncé par l'hôte
  viderFil("invite");
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

// La salle « s'éteint » d'un coup avant d'afficher l'écran fermé
function fermerAvecEffet(cle) {
  const salle = document.querySelector(".ecran:not([hidden])");
  const sansAnimation = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!salle || sansAnimation) return afficherFermee(cle);
  salle.classList.add("dissout");
  setTimeout(() => afficherFermee(cle), 450);
}

/* ---------- Écran 1 : le champ du code (6 cases) ---------- */
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

/* ---------- Les boutons des écrans ---------- */
$("btn-creer").addEventListener("click", creerSalle);
$("btn-nouvelle").addEventListener("click", creerSalle);
$("btn-retour").addEventListener("click", () => afficherEcran("accueil"));

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

$("btn-rester").addEventListener("click", () => ($("alerte-inactivite").hidden = true));

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
