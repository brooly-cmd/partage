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
  // Les places de l'hôte restent identiques chez tous, y compris les arrivants tardifs.
  const pastilles = role === 'hote' ? [...document.querySelectorAll('#liste-invites .pers')] : [];
  const compteur = document.getElementById('nombre-invite');
  const invites = role === 'hote'
    ? pastilles.map(p => p.title)
    : compteur.dataset.noms ? JSON.parse(compteur.dataset.noms)
      : Array.from({ length: Math.min(7, Number.parseInt(compteur.textContent, 10) || 0) }, (_, i) => 'place-' + (i + 1));
  const places = role === 'hote' ? pastilles.map(p => Number(p.dataset.place))
    : compteur.dataset.places ? JSON.parse(compteur.dataset.places) : undefined;
  objets.presence(invites, places);
}
document.querySelectorAll('.fil, #qr, #nombre-hote, #nombre-invite, #liste-invites').forEach(element => {
  new MutationObserver(reflet).observe(element, { childList: true, subtree: true,
    attributes: true, attributeFilter: ['data-pourcent', 'title', 'data-noms', 'data-places', 'data-place'], characterData: true });
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
