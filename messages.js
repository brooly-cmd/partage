/* =========================================================
   Partage éphémère — le fil de messages et l'envoi de texte
   Chaque message (texte ou fichier) est une « carte » ajoutée en bas du fil.
   ========================================================= */
"use strict";

// Un petit bouton (« Copier », « Télécharger », « Annuler »…) qui fait quelque chose au clic
function petitBouton(texte, quandClic) {
  const bouton = creer("button", "mini", texte);
  bouton.type = "button";
  bouton.addEventListener("click", quandClic);
  return bouton;
}

// La rangée de boutons sous une carte de fichier
function rangeeBoutons(...boutons) {
  const rangee = creer("div", "msg-actions");
  rangee.append(...boutons);
  return rangee;
}

function carteMessage(m) {
  const carte = creer("article", "msg");
  const tete = creer("div", "msg-tete");
  tete.append(creer("b", "", m.de), creer("time", "", m.heure));
  const corps = creer("div", "msg-corps");
  carte.append(tete, corps);

  if (m.type === "texte") {
    const copier = petitBouton("Copier", () => {
      copierTexte(m.texte).then(() => {
        copier.textContent = "Copié ✓";
        setTimeout(() => (copier.textContent = "Copier"), 1500);
      }, () => {});
    });
    corps.append(creer("span", "msg-texte", m.texte), copier);
    return carte;
  }

  // Fichiers
  const nom = creer("span", "msg-fichier", m.nom);
  corps.append(creer("span", "ft", m.ext), nom);

  if (m.type === "fichier") {
    nom.append(creer("small", "", m.taille));
    corps.append(petitBouton("Télécharger", () => telechargerFichier(m.blob, m.nom)));
  }

  if (m.type === "envoi") {
    nom.append(creer("small", "", m.taille));
    corps.append(creer("span", "pourcent", m.pourcent + " %"));
    const barre = creer("div", "barre");
    barre.setAttribute("role", "progressbar");
    barre.setAttribute("aria-label", m.nom);
    barre.setAttribute("aria-valuenow", m.pourcent);
    const rempli = creer("b");
    rempli.style.width = m.pourcent + "%";
    barre.append(rempli);
    carte.append(barre, creer("p", "msg-note", "Garde cet écran ouvert pendant l'envoi."),
      rangeeBoutons(petitBouton("Annuler", m.annuler)));
  }

  if (m.type === "interrompu") {
    carte.classList.add("interrompu");
    nom.append(creer("small", "", "Envoi interrompu. Réessayer ?"));
    carte.append(rangeeBoutons(
      petitBouton("Réessayer", () => { retirer(carte); m.reessayer(); }),
      petitBouton("Annuler", () => retirer(carte)),
    ));
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

// Ajoute un message en bas du fil (en enlevant « Rien pour l'instant… ») et descend jusqu'à lui
function ajouterAuFil(role, m) {
  const fil = $("fil-" + role);
  fil.querySelector(".vide")?.remove();
  const carte = carteMessage({ heure: heureMaintenant(), ...m });
  fil.append(carte);
  fil.scrollTop = fil.scrollHeight;
  return carte;
}

function heureMaintenant() {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Remet un fil à zéro : « Rien pour l'instant… » et la zone d'écriture vide
function viderFil(role) {
  const fil = $("fil-" + role);
  const zone = fil.parentElement.querySelector("textarea");
  zone.value = "";
  ajusterHauteur(zone);
  fil.replaceChildren(messageVide(role));
}

// La salle ferme (ou on la quitte) : on efface tous les messages et fichiers de la page,
// comme on vide une table après le repas. Les fichiers gardés en mémoire disparaissent avec leurs cartes.
function viderSalles() {
  ["hote", "invite"].forEach(viderFil);
  $("liste-invites").textContent = "";
  if ($("confirmation").open) $("confirmation").close();
}

/* ---------- Envoyer du texte ---------- */
// L'hôte l'envoie à chaque invité ; l'invité l'envoie à l'hôte
function envoyerTexte(texte) {
  const paquet = { type: "texte", texte };
  if (etat.ecran === "hote") {
    envoyerA(autresInvites(), paquet);
    ajouterAuFil("hote", { type: "texte", de: "Moi", texte });
    return true;
  }
  if (!etat.connHote || !etat.connHote.open) {
    afficherToast(ERREURS.reseau);
    return false;
  }
  envoyer(etat.connHote, paquet);
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
