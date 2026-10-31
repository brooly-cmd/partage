// L'arrivée au défilement et les passages de caméra (mission 21).
// Lenis rend le défilement doux, GSAP fait les passages ; monde.js suit (vue, lumiere, minuteur).
// Les boutons sont factices : rien n'est envoyé, aucune vraie salle n'est créée.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { vue, lumiere, minuteur, reglages, pret, remettreDeFace, afficherEcran, relancerAnneau } from './monde.js';

gsap.registerPlugin(ScrollTrigger);
const CALME = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ETROIT = matchMedia('(max-width: 700px)');            // téléphone : le texte en bas, le monde en haut
const D = CALME ? 0.01 : 1;                                   // sans mouvement : les passages sont instantanés
const $ = id => document.getElementById(id);
const CODE = '482 915';

// ---------- Les places de la caméra (voir vue dans monde.js) ----------
// t1 = la platine et son monde, t2 = l'anneau du temps, t3 = l'atelier de près,
// salle = dans la pièce, fermee = la caméra a reculé hors de la pièce éteinte.
const places = etroit => ({
  t1: { x: 0, y: 2.4, z: 0, dist: 1, polaire: 70, azimut: 38, dx: etroit ? 0 : 0.14, dy: etroit ? 0.1 : 0 },
  t2: { x: 0, y: 1.76, z: 0, dist: etroit ? 0.78 : 0.62, polaire: 76, azimut: 12, dx: etroit ? 0 : -0.14, dy: etroit ? 0.12 : 0 },
  t3: { x: 0, y: 3.75, z: -0.15, dist: etroit ? 0.42 : 0.46, polaire: 63, azimut: 42, dx: etroit ? 0 : 0.2, dy: etroit ? 0.22 : 0 },
  salle: { x: 0.05, y: 3.98, z: -0.5, dist: etroit ? 0.24 : 0.2, polaire: 70, azimut: 40, dx: etroit ? 0 : -0.1, dy: etroit ? 0.04 : 0 },
  fermee: { x: 0, y: 2.5, z: 0, dist: 0.8, polaire: 66, azimut: 30, dx: 0, dy: etroit ? 0.08 : 0 },
});
const PLACES = { large: places(false), etroit: places(true) };

// histoire : 0 → 2 avec le défilement ; salle et ferme : 0 → 1 pendant les passages
const etat = { histoire: 0, salle: 0, ferme: 0 };
const melanger = (a, b, f, sortie) => { for (const k in a) sortie[k] = a[k] + (b[k] - a[k]) * f; return sortie; };
const tmp = {};
function viser() {
  const P = ETROIT.matches ? PLACES.etroit : PLACES.large;
  const i = Math.min(1, Math.floor(etat.histoire));
  let f = etat.histoire - i;
  f = f * f * (3 - 2 * f);                                    // la caméra s'attarde un peu sur chaque temps
  melanger(i ? P.t2 : P.t1, i ? P.t3 : P.t2, f, tmp);
  melanger(tmp, P.salle, etat.salle, tmp);
  melanger(tmp, P.fermee, etat.ferme, vue);
  $('aide').style.opacity = Math.max(0, 1 - etat.histoire * 2.5) * (1 - etat.salle);
}

// ---------- Le défilement doux (Lenis) relié à GSAP ----------
history.scrollRestoration = 'manual';
scrollTo(0, 0);
const lenis = new Lenis({ duration: 1.2, smoothWheel: !CALME, prevent: () => false,
  easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add(time => { lenis.raf(time * 1000); viser(); });
gsap.ticker.lagSmoothing(0);
lenis.stop();                                                 // pas de défilement pendant le chargement

ScrollTrigger.create({ trigger: '#histoire', start: 'top top', end: 'bottom bottom',
  onUpdate: s => { etat.histoire = s.progress * 2; } });
// Chaque texte apparaît quand son temps arrive au milieu de l'écran, puis s'efface
const textes = gsap.utils.toArray('.temps');
textes.forEach((section, n) => {
  const texte = section.querySelector('.texte');
  ScrollTrigger.create({ trigger: section, start: 'top bottom', end: 'bottom top', onUpdate: s => {
    let ecart = s.progress - 0.5;                             // 0 = le temps est en plein écran
    if ((n === 0 && ecart < 0) || (n === textes.length - 1 && ecart > 0)) ecart = 0;
    const o = gsap.utils.clamp(0, 1, 1 - (Math.abs(ecart) - 0.08) / 0.2);
    gsap.set(texte, { opacity: o, y: ecart * -80, pointerEvents: o > 0.5 ? 'auto' : 'none' });
  } });
});

pret.then(async () => {
  await document.fonts.ready;
  ScrollTrigger.refresh();
  lenis.start();
});

// ---------- Les passages ----------
let passage = null;                                            // le passage en cours (un seul à la fois)
const jouer = tl => { passage?.progress(1); passage = tl; return tl; };
const fige = oui => {                                          // dans la salle, la page ne défile pas
  oui ? lenis.stop() : lenis.start();
  reglages.tourner = !oui;
  document.documentElement.classList.toggle('fige', oui);
};

function entrer(invite) {
  fige(true);
  remettreDeFace();
  $('titre-salle').textContent = invite ? `Salle ${CODE} · Connecté à l'hôte` : 'Ta salle';
  $('sortir').textContent = invite ? 'Quitter la salle' : 'Fermer la salle';
  $('sortir').className = invite ? 'secondaire' : 'danger';
  $('panneau-code').hidden = invite;
  $('sortir').dataset.invite = invite ? '1' : '';
  jouer(gsap.timeline({ defaults: { ease: 'power3.out' } })
    .to('#histoire', { autoAlpha: 0, duration: 0.5 * D }, 0)
    .to(etat, { salle: 1, duration: 1.4 * D }, 0)
    .to(lumiere, { piece: 1, duration: 1 * D }, 0.5 * D)       // la lampe et l'écran s'allument
    .call(() => afficherEcran(invite ? ['Salle', CODE] : [CODE], invite ? 38 : 64), null, 0.6 * D)
    .call(relancerAnneau, null, 0.7 * D)                        // l'anneau se remplit d'un coup puis se vide
    .to('#salle', { autoAlpha: 1, duration: 0.8 * D }, 1.2 * D));
}

function revenir() {                                           // la caméra ressort et revient au 3e temps
  const tl = jouer(gsap.timeline({ defaults: { ease: 'power3.out' } }));
  // depuis « Salle fermée », on part de la place fermee ; depuis la salle (Quitter), de la pièce
  if (etat.ferme > 0) tl.set(etat, { salle: 0 }, 0).to(etat, { ferme: 0, duration: 1.4 * D }, 0);
  else tl.to(etat, { salle: 0, duration: 1.4 * D }, 0);
  tl.to(['#salle', '#fermee'], { autoAlpha: 0, duration: 0.4 * D }, 0)
    .to(lumiere, { piece: 0, allume: 1, point: 0, duration: 1 * D }, 0)
    .call(() => { afficherEcran(['Partage', 'éphémère']); relancerAnneau(); }, null, 0.3 * D)
    .to('#histoire', { autoAlpha: 1, duration: 0.8 * D }, 1 * D)
    .call(() => fige(false), null, 1 * D);
}

function fermer() {                                            // la pièce s'éteint et se vide
  jouer(gsap.timeline({ defaults: { ease: 'power3.out' } })
    .to('#salle', { autoAlpha: 0, duration: 0.4 * D }, 0)
    .call(() => { minuteur.demo = false; minuteur.valeur = 0; }, null, 0)
    .to(etat, { ferme: 1, duration: 1.6 * D, ease: 'power3.inOut' }, 0)
    .to(lumiere, { allume: 0, duration: 1.2 * D }, 0.2 * D)
    .call(() => afficherEcran([]), null, 0.9 * D)
    .to(lumiere, { point: 1, duration: 0.8 * D }, 1.2 * D)
    .to('#fermee', { autoAlpha: 1, duration: 0.8 * D }, 1.4 * D));
}

function rouvrir() {                                           // « Créer une nouvelle salle » : on rentre
  afficherEcran([CODE], 64);
  relancerAnneau();
  jouer(gsap.timeline({ defaults: { ease: 'power3.out' } })
    .to('#fermee', { autoAlpha: 0, duration: 0.4 * D }, 0)
    .to(lumiere, { allume: 1, point: 0, duration: 1 * D }, 0.2 * D)
    .to(etat, { ferme: 0, duration: 1.4 * D }, 0)
    .to('#salle', { autoAlpha: 1, duration: 0.8 * D }, 1.2 * D));
}

// ---------- Les boutons factices ----------
$('creer').addEventListener('click', () => entrer(false));
$('rejoindre').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('code').value.replace(/\D/g, '');
  $('erreur').textContent = code.length === 6 ? '' : 'Le code contient 6 chiffres.';
  if (code.length === 6) { $('code').blur(); entrer(true); }
});
$('sortir').addEventListener('click', () => $('sortir').dataset.invite ? revenir() : fermer());
$('retour').addEventListener('click', revenir);
$('nouvelle').addEventListener('click', rouvrir);
