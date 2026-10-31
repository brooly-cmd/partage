// Le transfert reste utilisable même si un module ou une image 3D ne charge pas.
let erreurMonde = false;
function replierMonde() {
  if (document.documentElement.classList.contains('sans-3d')) return;
  clearTimeout(chargementMonde);
  document.documentElement.classList.add('sans-3d');
  document.getElementById('chargement').classList.add('fini');
  document.querySelectorAll('.ecran').forEach(e => { e.inert = false; });
  document.dispatchEvent(new Event('atelier:repli'));
}
// performance.now() part du début de la page, y compris le chargement des scripts.
const chargementMonde = setTimeout(replierMonde, Math.max(0, 4000 - performance.now()));
document.addEventListener('atelier:pret', () => {
  clearTimeout(chargementMonde);
  if (!erreurMonde) document.documentElement.classList.remove('sans-3d');
}, { once: true });
function echouerMonde() { erreurMonde = true; replierMonde(); }
document.addEventListener('atelier:erreur', echouerMonde);
document.getElementById('scene').addEventListener('webglcontextlost', e => {
  e.preventDefault();
  echouerMonde();
});
import('./passages.js').catch(erreur => {
  echouerMonde();
  console.warn('Décor indisponible :', erreur);
});
