// Le transfert reste utilisable même si un module ou une image 3D ne charge pas.
if (new URLSearchParams(location.search).has('diag')) import('./diagnostic.js');
const chargementMonde = setTimeout(() => document.getElementById('chargement').classList.add('fini'), 4000);
import('./passages.js').catch(erreur => {
  clearTimeout(chargementMonde);
  document.getElementById('chargement').classList.add('fini');
  console.warn('Décor indisponible :', erreur);
});
