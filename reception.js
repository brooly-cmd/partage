/* =========================================================
   Partage éphémère — recevoir un fichier, morceau par morceau
   Les paquets possibles : « fichier-debut », « morceau », « fichier-fin », « annule », « refus », « accuse ».
   L'hôte qui reçoit le fichier d'un invité le fait suivre, morceau par morceau, aux autres invités (« relais »).
   Il peut faire suivre sans garder le fichier pour lui (« garder » = false) : s'il a annulé, ou s'il manque de place.
   ========================================================= */
"use strict";

const PAQUET_RECU = 16 * 1024 * 1024;  // à l'arrivée, on range les morceaux par paquets de 16 Mo
const ACCUSE = 1024 * 1024;            // (hôte) on dit « bien reçu » à l'invité qui envoie tous les 1 Mo
// L'iPhone a peu de mémoire pour les pages web : au-delà de 500 Mo, il refuse de recevoir
// (le fichier entier doit tenir dans la mémoire de Safari avant d'être téléchargé).
const LIMITE_RECEPTION = estIOS ? 500 * 1024 * 1024 : Infinity;

// Un morceau peut arriver par un renfort avant l'annonce « fichier-debut » (partie par le tuyau principal) :
// on le garde de côté 10 secondes, le temps que l'annonce arrive
const enAvance = new Map(); // numéro d'envoi → { conn, morceaux, minuteur }

const TEXTE_TROP_GROS_RECU = "Ce fichier est trop gros pour être reçu sur cet appareil.";

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
      jeterReception(recu);
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
    envoyerA(relais, { type: "fichier-debut", id, nom, mime, taille: msg.taille, de });
    const tropGros = msg.taille > LIMITE_RECEPTION;
    if (tropGros) afficherToast(TEXTE_TROP_GROS_RECU);
    if (tropGros && relais.size === 0) {
      envoyer(conn, { type: "refus", id });
      return;
    }
    const recu = {
      id, conn, de, nom, mime, garder: !tropGros, relais, accuse: 0,
      taille: msg.taille, recu: 0, morceaux: [], tailleMorceaux: 0, paquets: [],
      enAttente: new Map(), // les morceaux arrivés en avance, rangés par position
    };
    if (recu.garder) {
      recu.carte = ajouterAuFil(role, carteEnCours(de, nom, recu.taille, () => arreterDeGarder(recu, "annule")));
      recu.heure = recu.carte.querySelector("time").textContent;
      noterLiaison(recu.carte, conn);
    }
    etat.recus.set(id, recu);
    const attente = enAvance.get(id);
    if (attente) {
      enAvance.delete(id);
      clearTimeout(attente.minuteur);
      attente.morceaux.forEach((m) => recevoirPaquetFichier(role, de, attente.conn, m));
    }
    return;
  }

  const recu = etat.recus.get(id);
  if (!recu) {
    if (msg.type === "morceau") garderEnAvance(id, conn, msg);
    return;
  }
  if (recu.conn !== conn) return;

  if (msg.type === "morceau") {
    if (!(msg.donnees instanceof ArrayBuffer) || !(msg.position >= recu.recu)) return;
    // Les morceaux arrivent par plusieurs tuyaux, parfois dans le désordre : on les remet dans l'ordre
    recu.enAttente.set(msg.position, msg.donnees);
    while (recu.enAttente.has(recu.recu) && etat.recus.get(id) === recu) {
      const donnees = recu.enAttente.get(recu.recu);
      recu.enAttente.delete(recu.recu);
      rangerMorceau(role, recu, donnees);
    }
    finirReception(recu);
    return;
  }

  if (msg.type === "fichier-fin") {
    // La fin peut arriver avant les derniers morceaux (ils passent par d'autres tuyaux) : on attend qu'ils soient tous là
    recu.finRecue = true;
    finirReception(recu);
  }
}

function garderEnAvance(id, conn, msg) {
  if (!enAvance.has(id)) {
    enAvance.set(id, { conn, morceaux: [], minuteur: setTimeout(() => enAvance.delete(id), 10000) });
  }
  enAvance.get(id).morceaux.push(msg);
}

// Range un morceau arrivé dans l'ordre, le fait suivre aux autres invités et fait avancer la barre
function rangerMorceau(role, recu, donnees) {
  const position = recu.recu;
  recu.recu += donnees.byteLength;
  if (recu.relais.size > 0) faireSuivre(recu, { type: "morceau", id: recu.id, position, donnees });
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
}

// Le fichier est complet (la fin est annoncée et tous les morceaux sont là) : on fabrique le fichier
function finirReception(recu) {
  if (!recu.finRecue || recu.recu < recu.taille || etat.recus.get(recu.id) !== recu) return;
  etat.recus.delete(recu.id);
  if (recu.relais.size > 0) faireSuivre(recu, { type: "fichier-fin", id: recu.id });
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

// (hôte) Fait suivre un paquet aux invités qui reçoivent ce fichier par moi
function faireSuivre(recu, paquet) {
  recu.relais.forEach((c) => {
    // Les morceaux passent par le tuyau le moins rempli, les messages par le tuyau principal
    if (c.open) envoyer(paquet.type === "morceau" ? tuyauLibre(c) : c, paquet);
    else recu.relais.delete(c);
  });
  lacherSiPersonne(recu);
}

// (hôte) Dit « bien reçu » à l'expéditeur, mais seulement quand les tuyaux vers les autres
// ont de la place : ainsi l'expéditeur ralentit au rythme du plus lent, et rien ne s'entasse chez l'hôte
async function envoyerAccuse(recu) {
  if (recu.accuseEnCours) return;
  recu.accuseEnCours = true;
  const pleins = () => [...recu.relais].filter((c) => c.open && ciblePleine(c));
  while (etat.recus.get(recu.id) === recu && pleins().length > 0) {
    await Promise.all(pleins().map(attendrePlaceCible));
  }
  recu.accuseEnCours = false;
  if (etat.recus.get(recu.id) !== recu || !recu.conn.open) return;
  recu.accuse = recu.recu;
  envoyer(recu.conn, { type: "accuse", id: recu.id, n: recu.recu });
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
  if (recu.conn.open) envoyer(recu.conn, { type: raison, id: recu.id });
}

// L'appareil n'a plus assez de place pour garder le fichier : on arrête et on l'explique
function echecReception(recu) {
  arreterDeGarder(recu, "refus");
  afficherToast(TEXTE_TROP_GROS_RECU);
}

// Un fichier à moitié arrivé n'arrivera jamais : on le jette, chez moi et chez ceux à qui je le faisais suivre
function jeterReception(recu) {
  etat.recus.delete(recu.id);
  envoyerA(recu.relais, { type: "annule", id: recu.id });
  if (recu.garder) retirer(recu.carte);
}

// Un invité est parti en plein envoi : ses fichiers à moitié arrivés sont jetés
function abandonnerReceptions(conn) {
  etat.recus.forEach((recu) => {
    if (recu.conn === conn) jeterReception(recu);
  });
}

// (hôte) Un invité est parti : on arrête de lui faire suivre des fichiers
function oublierCible(conn) {
  etat.recus.forEach((recu) => {
    if (recu.relais.delete(conn)) lacherSiPersonne(recu);
  });
}
