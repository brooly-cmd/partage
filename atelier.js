// Un pont de lecture entre l'app et son décor. Le fil HTML reste la source des objets.
import { objets, lumiere } from './monde.js';

let numero = 0, precedents = [];
const identites = new WeakMap();
function reflet() {
  const role = document.body.dataset.ecran;
  if (role !== 'hote' && role !== 'invite') return;
  const cartes = [...document.querySelectorAll('#fil-' + role + ' .msg')].slice(-6);
  const messages = cartes.map((carte, index) => {
    const texte = carte.querySelector('.msg-texte');
    const fichier = carte.querySelector('.msg-fichier');
    const contenu = texte?.textContent || fichier?.firstChild?.textContent || '';
    const de = carte.querySelector('.msg-tete b').textContent;
    const signature = de + carte.querySelector('time').textContent + contenu;
    if (!identites.has(carte)) {
      // La carte « Télécharger » remplace celle de progression à la même place.
      identites.set(carte, precedents[index]?.signature === signature ? precedents[index].id : ++numero);
    }
    return { id: identites.get(carte), signature, de, texte: contenu, type: texte ? 'texte' : 'fichier',
      ext: carte.querySelector('.ft')?.textContent || '',
      enCours: Boolean(carte.querySelector('.progres')), pourcent: Number(carte.dataset.pourcent || 0) };
  });
  precedents = messages.map(({ id, signature }) => ({ id, signature }));
  objets.reflet(messages);
  objets.qr(role === 'hote' ? document.querySelector('#qr svg')?.outerHTML || '' : '');
  // L'hôte affiche les noms exacts ; côté invité, seul le nombre est transmis à la page.
  const invites = role === 'hote'
    ? [...document.querySelectorAll('#liste-invites .pers')].map(p => p.title)
    : Array.from({ length: Math.min(7, Number.parseInt(document.getElementById('nombre-invite').textContent, 10) || 0) },
      (_, i) => 'place-' + (i + 1));
  objets.presence(invites);
}
document.querySelectorAll('.fil, #qr, #nombre-hote, #nombre-invite, #liste-invites').forEach(element => {
  new MutationObserver(reflet).observe(element, { childList: true, subtree: true,
    attributes: true, attributeFilter: ['data-pourcent', 'title'], characterData: true });
});
document.addEventListener('partage:ecran', e => {
  if (e.detail.nom === 'hote' || e.detail.nom === 'invite') reflet();
  else { precedents = []; objets.vider(); }
});
reflet();

// Le voile d'alerte d'inactivité fait vaciller la lumière de la pièce.
function synchroniserAlerte() {
  const role = document.body.dataset.ecran;
  lumiere.alerte = (role === 'hote' || role === 'invite') && !document.getElementById('alerte-inactivite').hidden ? 1 : 0;
}
new MutationObserver(synchroniserAlerte).observe(document.getElementById('alerte-inactivite'),
  { attributes: true, attributeFilter: ['hidden'] });
document.addEventListener('partage:ecran', synchroniserAlerte);
synchroniserAlerte();
