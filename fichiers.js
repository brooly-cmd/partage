/* =========================================================
   Partage éphémère — envoyer un fichier, petit ou gros
   Le fichier part en petits morceaux, comme un déménagement en plusieurs cartons :
   on lit un morceau, on l'envoie, on attend qu'il y ait de la place dans le tuyau, puis le suivant.
   Ainsi, le fichier entier n'est jamais chargé d'un coup en mémoire.
   ========================================================= */
"use strict";

const MORCEAU = 64 * 1024;             // 64 Ko par morceau
const LECTURE = 1024 * 1024;           // on lit le fichier sur le disque par blocs d'1 Mo (16 morceaux)
const TUYAU_PLEIN = 4 * 1024 * 1024;   // on ne laisse jamais plus de 4 Mo en attente dans le tuyau
// Quand un invité envoie, l'hôte fait suivre aux autres. Pour que l'hôte ne soit jamais débordé,
// il dit « bien reçu » (accusé de réception, voir reception.js), et l'invité n'a jamais plus de 32 Mo d'avance.
const AVANCE_MAX = 32 * 1024 * 1024;

const TEXTE_TROP_GROS_ENVOI = "Ce fichier est trop gros pour cet appareil. Essaie un fichier plus petit.";

/* ---------- Les cartes de fichier ---------- */
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
  // Diagnostic de vitesse (provisoire) : « 318 / 512 Mo · 9,2 Mo/s · direct (host-host) »
  if (!carte.debut) carte.debut = performance.now();
  const secondes = (performance.now() - carte.debut) / 1000;
  const vitesse = secondes > 0.5 ? " · " + (fait / 1048576 / secondes).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " Mo/s" : "";
  const liaison = carte.liaison ? " · " + carte.liaison : "";
  carte.querySelector(".msg-fichier small").textContent = tailleProgression(fait, total) + vitesse + liaison;
}

// (diagnostic, provisoire) Par où passe le tuyau : en direct sur le réseau de la maison,
// par l'adresse internet de la box, ou par un relais sur internet (le détour le plus lent)
async function noterLiaison(carte, conn) {
  try {
    const stats = await conn.peerConnection.getStats();
    let paire;
    stats.forEach((s) => {
      if (s.type === "transport" && s.selectedCandidatePairId) paire = stats.get(s.selectedCandidatePairId);
    });
    if (!paire) stats.forEach((s) => { if (s.type === "candidate-pair" && s.selected) paire = s; });
    const types = [stats.get(paire.localCandidateId).candidateType, stats.get(paire.remoteCandidateId).candidateType];
    const nom = types.includes("relay") ? "par relais internet" : types.includes("srflx") ? "via la box" : "direct";
    carte.liaison = nom + " (" + types.join("-") + ")";
  } catch {
    carte.liaison = "liaison inconnue";
  }
}

// Remplace une carte « en cours » par la carte finale avec le bouton Télécharger
function terminerCarte(carte, de, nom, blob, heure) {
  carte.replaceWith(carteMessage({ ...carteFichier(de, nom, blob), heure }));
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

/* ---------- Le tuyau ---------- */
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

// La salle ferme : on oublie tout ce qui était en route
function oublierTransferts() {
  etat.envois.clear();
  etat.recus.clear();
  enAvance.clear();
}

/* ---------- Envoyer ---------- */
// Les fichiers partent un par un, dans l'ordre (comme une file d'attente au guichet)
let fileEnvois = Promise.resolve();

// L'hôte l'envoie à chaque invité ; l'invité l'envoie à l'hôte (comme le texte)
function envoyerFichier(fichier) {
  const role = etat.ecran;
  if (!dansLaSalle()) return;
  if (role === "invite" && (!etat.connHote || !etat.connHote.open)) {
    afficherToast(ERREURS.reseau);
    return;
  }
  const cibles = role === "hote" ? autresInvites() : [etat.connHote];
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
  noterLiaison(envoi.carte, cibles[0]);
  etat.envois.set(envoi.id, envoi);
  fileEnvois = fileEnvois.then(() => transmettre(envoi));
}

// « Annuler » chez celui qui envoie : on prévient les autres et on retire la carte
function annulerEnvoi(envoi) {
  envoi.annule = true;
  envoi.reveil?.();
  etat.envois.delete(envoi.id);
  envoyerA(envoi.cibles, { type: "annule", id: envoi.id });
  retirer(envoi.carte);
}

async function transmettre(envoi) {
  const { fichier, id } = envoi;
  const salleOuverte = () => etat.peer === envoi.peer && etat.ecran === envoi.role;
  const continuer = () => !envoi.annule && salleOuverte() && envoi.cibles.size > 0;
  if (!continuer()) return;

  envoyerA(envoi.cibles, { type: "fichier-debut", id, nom: fichier.name, mime: fichier.type, taille: fichier.size });
  let envoye = 0;
  let bloc = new ArrayBuffer(0); // le dernier bloc lu sur le disque
  let debutBloc = 0;
  let lectureRatee = false;
  try {
    while (envoye < fichier.size) {
      retirerCoupes(envoi);
      // On attend que les tuyaux se vident un peu avant d'ajouter un morceau
      while (continuer() && [...envoi.cibles].some(ciblePleine)) {
        await Promise.all([...envoi.cibles].map(attendrePlaceCible));
        retirerCoupes(envoi);
      }
      // L'invité attend que l'hôte suive (il fait passer le fichier aux autres en même temps)
      while (continuer() && envoi.role === "invite" && envoye - envoi.accuse > AVANCE_MAX) {
        await attendreAccuse(envoi);
        retirerCoupes(envoi);
      }
      if (!continuer()) break;
      if (envoye >= debutBloc + bloc.byteLength) {
        bloc = await fichier.slice(envoye, envoye + LECTURE).arrayBuffer();
        debutBloc = envoye;
        if (!bloc.byteLength) throw new Error("fichier raccourci");
        if (!continuer()) break;
      }
      const donnees = bloc.slice(envoye - debutBloc, envoye - debutBloc + MORCEAU);
      // Chaque appareil reçoit le morceau par son tuyau le moins rempli
      envoi.cibles.forEach((c) => envoyer(tuyauLibre(c), { type: "morceau", id, position: envoye, donnees }));
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
    envoyerA(envoi.cibles, { type: "fichier-fin", id });
    terminerCarte(envoi.carte, "Moi", fichier.name, fichier, envoi.heure);
    return;
  }
  if (lectureRatee || envoi.coupe) {
    // Le tuyau s'est coupé (ou le fichier est illisible) : on propose de réessayer
    envoyerA(envoi.cibles, { type: "annule", id });
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

/* ---------- Choisir un fichier ---------- */
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
