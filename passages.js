// L'arrivée au défilement et les passages de caméra (mission 21).
// Lenis rend le défilement doux, GSAP fait les passages ; monde.js suit (vue, lumiere).
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import './atelier.js';
import { vue, lumiere, reglages, pret, remettreDeFace, afficherEcran } from './monde.js';

gsap.registerPlugin(ScrollTrigger);
const CALME = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ETROIT = matchMedia('(max-width: 899px)');            // téléphone : le texte en bas, le monde en haut
const D = CALME ? 0.01 : 1;                                   // sans mouvement : les passages sont instantanés
const $ = id => document.getElementById(id);
// ---------- Les places de la caméra (voir vue dans monde.js) ----------
// t1 = la pièce seule au centre, t2 = la pièce de plus près (« Tout disparaît à la fermeture. »),
// t3 = l'atelier de près avec les boutons, salle = dans la pièce, fermee = la caméra recule devant la pièce éteinte.
const places = etroit => ({
  t1: { x: 0, y: 3.9, z: -0.1, dist: etroit ? 0.56 : 0.58, polaire: 72, azimut: 38, dx: etroit ? 0 : 0.2, dy: etroit ? 0.12 : 0.1 },
  t2: { x: 0, y: 3.85, z: -0.1, dist: etroit ? 0.5 : 0.38, polaire: 68, azimut: 18, dx: etroit ? 0 : -0.16, dy: etroit ? 0.14 : 0 },
  t3: { x: 0, y: 3.75, z: -0.15, dist: etroit ? 0.42 : 0.46, polaire: 63, azimut: 42, dx: etroit ? 0 : 0.2, dy: etroit ? 0.22 : 0 },
  salle: { x: 0, y: 3.9, z: -0.1, dist: etroit ? 0.46 : 0.43, polaire: 68, azimut: 36, dx: etroit ? 0 : -0.05, dy: etroit ? 0.06 : 0 },
  fermee: { x: 0, y: 3.9, z: -0.1, dist: etroit ? 0.7 : 0.5, polaire: 70, azimut: 30, dx: 0, dy: etroit ? 0.08 : 0 },
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
const lenis = new Lenis({ duration: 1.2, smoothWheel: !CALME, prevent: node => node.closest('.fil, dialog, textarea'),
  easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add(time => { lenis.raf(time * 1000); viser(); });
gsap.ticker.lagSmoothing(0);

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

pret.then(() => ScrollTrigger.refresh());
document.fonts.ready.then(() => ScrollTrigger.refresh());

// Les boutons sont branchés une seule fois, dans ecrans.js : ici, on écoute leur résultat.
let passage = null;
let courant = 'accueil';
const fige = oui => {
  oui ? lenis.stop() : lenis.start();
  reglages.tourner = !oui;
  document.documentElement.classList.toggle('fige', oui);
};
function changer(nom, initial = false) {
  if (nom === courant && !initial) return;
  passage?.kill();
  document.querySelectorAll('.ecran').forEach(e => { e.inert = false; e.style.opacity = ''; });
  const avant = courant;
  courant = nom;
  fige(nom !== 'accueil');
  reglages.zoom = nom === 'hote' || nom === 'invite';   // dans la salle, on peut zoomer
  const panneau = $('ecran-' + nom);
  const tl = passage = gsap.timeline({ defaults: { ease: 'power3.out' } });
  if (nom === 'hote' || nom === 'invite') {
    if (document.activeElement?.matches('input, textarea')) document.activeElement.blur();
    etat.histoire = 2;
    remettreDeFace();
    const code = nom === 'hote' ? $('plaques-hote').getAttribute('aria-label').split(': ')[1] : $('code-invite').textContent;
    afficherEcran(nom === 'hote' ? [code] : ['Salle', code], nom === 'hote' ? 64 : 38);
    panneau.inert = true;
    tl.set(panneau, { opacity: 0 })
      .to(etat, { salle: 1, ferme: 0, duration: 1.4 * D }, 0)
      .to(lumiere, { piece: 1, allume: 1, duration: D }, 0)
      .to(panneau, { opacity: 1, duration: 0.8 * D }, 1.2 * D)
      .call(() => {
        panneau.inert = false;
        const titre = panneau.querySelector('h2');
        titre.tabIndex = -1; titre.focus({ preventScroll: true });
      });
  } else if (nom === 'fermee') {
    panneau.inert = true;
    tl.set(panneau, { opacity: 0 })
      .to(etat, { ferme: 1, duration: 1.6 * D, ease: 'power3.inOut' }, 0)
      .to(lumiere, { allume: 0, duration: 1.2 * D }, 0.2 * D)
      .call(() => afficherEcran([]), null, 0.9 * D)
      .to(panneau, { opacity: 1, duration: 0.8 * D }, 1.4 * D)
      .call(() => { panneau.inert = false; $('btn-retour').focus({ preventScroll: true }); });
  } else {
    afficherEcran(['Partage', 'éphémère']);
    if (!initial || avant !== 'accueil') allerAuxBoutons();
    tl.to(etat, { salle: 0, ferme: 0, duration: 1.4 * D }, 0)
      .to(lumiere, { piece: 0, allume: 1, duration: D }, 0);
  }
}
function allerAuxBoutons() {
  if (courant !== 'accueil') return;
  lenis.resize();
  ScrollTrigger.refresh();
  lenis.scrollTo($('t3'), { immediate: true });
  etat.histoire = 2;
}
document.addEventListener('partage:ecran', e => changer(e.detail.nom));
changer(document.body.dataset.ecran, true);
// Un lien QR erroné doit montrer l'erreur au lieu de laisser le visiteur au premier temps.
new MutationObserver(() => { if (!$('erreur-code').hidden) allerAuxBoutons(); })
  .observe($('erreur-code'), { attributes: true, childList: true });
if (!$('erreur-code').hidden) allerAuxBoutons();
