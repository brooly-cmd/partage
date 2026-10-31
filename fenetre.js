// La vue par la fenêtre (mission 22d) : la vitre de Blender reçoit une matière qui « peint » le dehors.
// Pour chaque point de la vitre, on suit le regard de la caméra à travers le verre : le ciel est très loin
// (il ne dépend que de la direction du regard), les collines sont plus près (elles glissent un peu quand on bouge).
// C'est cette différence qui donne la profondeur. Tout est calculé dans la carte graphique : aucune image à charger.
import * as THREE from 'three';

const NUIT = {
  haut: 0x05070f, bas: 0x1c2644, lueur: 0x3a4a70,      // ciel : en haut, près de l'horizon, lueur de la ville au loin
  loin: 0x0c1124, pres: 0x05070d,                      // collines lointaines, collines proches
  etoiles: 1, lune: 1, nuages: 0, lumieres: 1, reflet: 0x8090b0,
};
const JOUR = {
  haut: 0x3f76ad, bas: 0xbcd2e2, lueur: 0xe8e0d2,
  loin: 0x7f97a8, pres: 0x5b6e66,
  etoiles: 0, lune: 0, nuages: 1, lumieres: 0, reflet: 0xffffff,
};

export function creerFenetre({ calme }) {
  const u = {
    uDehors: { value: -1 }, uForce: { value: 1 }, uTemps: { value: 0 },
    uEtoiles: { value: 0 }, uLune: { value: 0 }, uNuages: { value: 0 }, uLumieres: { value: 0 },
  };
  for (const k of ['haut', 'bas', 'lueur', 'loin', 'pres', 'reflet']) u['u_' + k] = { value: new THREE.Color() };

  const matiere = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `varying vec3 vLocal; varying vec3 vCam;
      void main(){
        vLocal = position;
        vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;   // la caméra, vue depuis la vitre
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec3 vLocal; varying vec3 vCam;
      uniform float uDehors, uForce, uTemps, uEtoiles, uLune, uNuages, uLumieres;
      uniform vec3 u_haut, u_bas, u_lueur, u_loin, u_pres, u_reflet;
      const float HORIZON = -0.355;                         // hauteur de l'horizon (en angle) : la pièce est en hauteur
      float hasard(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float bruit(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hasard(i), hasard(i + vec2(1, 0)), f.x), mix(hasard(i + vec2(0, 1)), hasard(i + vec2(1, 1)), f.x), f.y);
      }
      float colline(float x, float graine){                 // une ligne de collines douces
        return 0.018 * sin(x * 9.0 + graine) + 0.011 * sin(x * 21.0 + graine * 2.0) + 0.005 * sin(x * 47.0 + graine * 3.0);
      }
      void main(){
        vec3 dir = normalize(vLocal - vCam);
        float vers = dir.x * uDehors;                        // > 0 : on regarde vers le dehors
        vec3 c;
        if (vers < 0.02) { c = u_pres * 0.6; }               // vue de l'extérieur : un verre sombre
        else {
          float x = atan(dir.z * uDehors, vers);             // l'angle à droite ou à gauche
          float y = asin(clamp(dir.y, -1.0, 1.0));           // l'angle en haut ou en bas
          // Le ciel : un dégradé, plus clair vers l'horizon
          float h = clamp((y - HORIZON) / 0.45, 0.0, 1.0);
          c = mix(u_bas, u_haut, sqrt(h));
          c = mix(c, u_lueur, exp(-max(y - HORIZON, 0.0) * 18.0) * 0.55);
          // Les étoiles (la nuit) : une case sur sept environ, qui scintille à peine
          vec2 g = vec2(x, y) * 60.0, cel = floor(g);
          float r = hasard(cel);
          if (r > 0.85) {
            vec2 centre = cel + 0.2 + 0.6 * vec2(hasard(cel + 7.0), hasard(cel + 3.0));
            float eclat = (0.4 + (r - 0.85) * 6.0) * (0.85 + 0.15 * sin(uTemps * (1.0 + r * 3.0) + r * 40.0));
            c += vec3(0.85, 0.9, 1.0) * smoothstep(0.13, 0.0, length(g - centre)) * eclat * h * uEtoiles;
          }
          vec2 g2 = vec2(x, y) * 160.0, cel2 = floor(g2);     // et une poussière d'étoiles plus pâles
          if (hasard(cel2 + 50.0) > 0.8) c += vec3(0.5, 0.55, 0.7) * smoothstep(0.12, 0.0, length(fract(g2) - 0.5)) * h * uEtoiles;
          // La lune : un disque doux avec son halo
          float d = length(vec2(x - 0.70, y + 0.25));
          vec3 lune = vec3(0.86, 0.83, 0.76) * (0.82 + 0.18 * bruit(vec2(x, y) * 140.0));
          c = mix(c, lune, smoothstep(0.0125, 0.0105, d) * uLune);
          c += u_lueur * exp(-d * 45.0) * 0.45 * uLune;
          // Quelques nuages pâles (le jour), étirés à l'horizontale
          float n = bruit(vec2(x * 4.0 + uTemps * 0.004, y * 14.0)) * 0.6 + bruit(vec2(x * 9.0, y * 30.0)) * 0.4;
          c = mix(c, vec3(1.0), smoothstep(0.55, 0.85, n) * smoothstep(0.0, 0.25, h) * 0.55 * uNuages);
          // Les collines lointaines (posées sur le ciel)
          if (y < HORIZON + 0.03 + colline(x, 1.0)) c = u_loin;
          // Les collines proches : à 3 m de la vitre, elles glissent un peu quand la caméra bouge
          vec3 p = vec3(0.0, vLocal.y, vLocal.z * uDehors) + vec3(vers, dir.y, dir.z * uDehors) * 3.0 / vers;
          float px = atan(p.z, p.x), py = asin(p.y / length(p));
          if (py < HORIZON - 0.06 + colline(px * 1.3, 4.0) * 1.2 + 0.006 * bruit(vec2(px * 260.0, 0.0))) {   // avec une lisière d'arbres
            c = u_pres;
            // de rares fenêtres allumées, très loin (la nuit)
            vec2 f = vec2(px, py) * vec2(160.0, 220.0), fc = floor(f);
            if (hasard(fc) > 0.985 && py < HORIZON - 0.08) c += vec3(1.0, 0.72, 0.4) * 0.5 * uLumieres * step(length(fract(f) - 0.5), 0.3);
          }
          // Le reflet du verre : plus fort quand on regarde la vitre de biais, et une bande claire en diagonale
          float bande = smoothstep(0.05, 0.0, abs(fract((vLocal.z * uDehors + vLocal.y) * 1.3 + dir.z * 0.4) - 0.5) - 0.12);
          c += u_reflet * ((1.0 - vers) * (1.0 - vers) * 0.12 + bande * 0.05);
        }
        gl_FragColor = vec4(c * uForce, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  return {
    matiere,
    // La vitre de Blender : on regarde de quel côté est le dehors (à l'opposé du milieu de la pièce)
    placer(vitre, milieu) {
      u.uDehors.value = vitre.worldToLocal(milieu.clone()).x > 0 ? -1 : 1;
    },
    regler(nuit) {
      const r = nuit ? NUIT : JOUR;
      for (const k of ['haut', 'bas', 'lueur', 'loin', 'pres', 'reflet']) u['u_' + k].value.set(r[k]);
      u.uEtoiles.value = r.etoiles; u.uLune.value = r.lune; u.uNuages.value = r.nuages; u.uLumieres.value = r.lumieres;
    },
    // force : la lumière de la vue (elle baisse quand la salle ferme)
    image(t, force) {
      u.uForce.value = force;
      u.uTemps.value = calme ? 0 : t % 1000;
    },
  };
}
