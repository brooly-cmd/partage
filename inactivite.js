/* =========================================================
   Partage éphémère — la fermeture automatique (mission 12)
   Comme un réveil de cuisine : chaque activité de l'hôte le remonte à 30 minutes.
   Seul l'hôte compte : ce que font les invités ne remonte pas le réveil.
   L'hôte dit aux invités combien de temps il reste.
   ========================================================= */
"use strict";

const DELAI = 30 * 60 * 1000; // 30 minutes sans activité, et la salle se ferme
const AVANT = 2 * 60 * 1000; // l'avertissement apparaît 2 minutes avant

let finPrevue = null;  // l'heure à laquelle la salle se fermera si rien ne bouge
let dernierEnvoi = 0;  // la dernière fois qu'on a prévenu les invités

// (hôte) Remonte le réveil et prévient les invités
// (pas plus d'une fois toutes les 5 secondes, sauf si on force).
function noterActivite(forcer) {
  if (etat.ecran !== "hote") return;
  finPrevue = Date.now() + DELAI;
  $("alerte-inactivite").hidden = true;
  majRebours();
  if (!forcer && Date.now() - dernierEnvoi < 5000) return;
  dernierEnvoi = Date.now();
  prevenirInvites();
}

// (hôte) Dit à chaque invité combien de temps il reste
function prevenirInvites() {
  envoyerA(autresInvites(), { type: "minuteur", reste: finPrevue - Date.now() });
}

// (invité) L'hôte nous dit combien de temps il reste
function recevoirMinuteur(reste) {
  finPrevue = Date.now() + reste;
  $("alerte-inactivite").hidden = true;
  majRebours();
}

// « · Fermeture automatique dans 24 min », sur la ligne d'état
function majRebours() {
  const min = Math.max(1, Math.ceil((finPrevue - Date.now()) / 60000));
  document.querySelectorAll("[data-rebours]").forEach((s) => {
    s.textContent = " · Fermeture automatique dans " + min + " min";
  });
}

// Un toucher, un clic ou une touche du clavier de l'hôte compte comme une activité
["pointerdown", "keydown"].forEach((geste) => {
  document.addEventListener(geste, () => noterActivite(), { capture: true, passive: true });
});

// Chaque seconde, on regarde le réveil
setInterval(() => {
  if (!dansLaSalle() || !finPrevue) return;
  const hote = etat.ecran === "hote";
  if (hote && etat.envois.size) noterActivite(); // un fichier envoyé par l'hôte compte comme une activité
  const reste = finPrevue - Date.now();
  majRebours();
  if (reste <= AVANT && $("alerte-inactivite").hidden) {
    $("alerte-inactivite").hidden = false;
    $("btn-rester").hidden = !hote; // seul l'hôte peut rester : les invités sont juste prévenus
    if (hote) $("btn-rester").focus();
  }
  if (reste <= 0 && hote) {
    finPrevue = null;
    fermerSalleHote(false, "inactivite");
    fermerAvecEffet("inactiviteHote");
  }
}, 1000);
