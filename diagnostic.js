// Diagnostic temporaire (seulement avec ?diag dans l'adresse) : affiche en haut de l'écran
// les erreurs et l'état des panneaux de la salle, pour comprendre un souci vu sur iPhone.
const boite = document.createElement('pre');
boite.style.cssText = 'position:fixed;z-index:99;top:0;left:0;right:0;margin:0;padding:6px;max-height:45vh;overflow:hidden;' +
  'font:10px/1.3 monospace;background:rgba(255,255,0,.92);color:#000;pointer-events:none;white-space:pre-wrap';
document.documentElement.append(boite);
const erreurs = [];
addEventListener('error', e => erreurs.push('ERR ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
addEventListener('unhandledrejection', e => erreurs.push('PROMESSE ' + (e.reason && (e.reason.message || e.reason))));
for (const niveau of ['warn', 'error']) {
  const avant = console[niveau];
  console[niveau] = (...a) => { erreurs.push(niveau.toUpperCase() + ' ' + a.map(String).join(' ')); avant(...a); };
}
let images = 0;
(function compter() { images++; requestAnimationFrame(compter); })();
setInterval(() => {
  const ecran = document.body.dataset.ecran;
  const p = document.getElementById('ecran-' + ecran);
  const lignes = [navigator.userAgent.replace(/.*(iPhone OS [\d_]+).*Version\/([\d.]+).*/, '$1 Safari $2'),
    'ecran=' + ecran + ' images/s=' + images + ' vue=' + innerWidth + 'x' + innerHeight];
  images = 0;
  if (p) {
    const s = getComputedStyle(p), r = p.getBoundingClientRect();
    lignes.push('panneau hidden=' + p.hidden + ' inert=' + p.inert + ' display=' + s.display + ' opacity=' + s.opacity +
      ' (style ' + (p.style.opacity || '-') + ') visibility=' + s.visibility);
    lignes.push('rect=' + [r.x, r.y, r.width, r.height].map(Math.round) + ' z=' + s.zIndex + ' position=' + s.position);
    const t = p.querySelector('textarea');
    if (t) {
      const q = t.getBoundingClientRect(), dessus = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
      lignes.push('champ rect=' + [q.x, q.y, q.width, q.height].map(Math.round) + ' dessus=' +
        (dessus === t ? 'le champ' : dessus ? dessus.tagName + '#' + dessus.id + '.' + dessus.className : 'rien'));
    }
  }
  boite.textContent = lignes.concat(erreurs.slice(-8)).join('\n');
}, 500);
