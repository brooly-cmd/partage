// Le monde 3D (mission 20) : la platine, la planète en nacre, l'anneau du temps et l'atelier.
// Les objets viennent de 3d/atelier.glb (fabriqué dans Blender par 3d/fabrique-atelier.py) ;
// ici on leur donne leurs vraies matières, la lumière et le mouvement.
// Mission 21 : passages.js pilote la caméra (vue), les lumières (lumiere) et l'anneau (minuteur).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DOSSIER = '3d/';
const TELEPHONE = matchMedia('(pointer: coarse)').matches;
const CALME = matchMedia('(prefers-reduced-motion: reduce)').matches;
const NUIT = matchMedia('(prefers-color-scheme: dark)');
const amortir = (de, vers, f) => de + (vers - de) * f;   // « lerp » : on fait une petite part du chemin

// ---------- Le moteur de rendu ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, TELEPHONE ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;   // l'ombre n'est recalculée que quand un objet bouge (voir la boucle)

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const monde = new THREE.Group();            // tout ce qui tourne quand on glisse
scene.add(monde);

// ---------- Le chargement (avec pourcentage) ----------
const ecranChargement = document.getElementById('chargement');
const gestion = new THREE.LoadingManager();
gestion.onProgress = (_, fait, total) => {
  const p = Math.round((fait / total) * 100);
  document.getElementById('pourcent').textContent = p + ' %';
  document.getElementById('barre').style.width = p + '%';
};
const draco = new DRACOLoader(gestion).setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
const photos = new THREE.TextureLoader(gestion);
const photo = (nom, repetition) => {
  const t = photos.load(DOSSIER + nom);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repetition, repetition);
  t.anisotropy = 8;
  return t;
};

const envPret = new RGBELoader(gestion).loadAsync(DOSSIER + 'studio_small_09_1k.hdr').then(hdr => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose(); pmrem.dispose();
});
const modelePret = new GLTFLoader(gestion).setDRACOLoader(draco).loadAsync(DOSSIER + 'atelier.glb');

// ---------- L'écran bombé de l'ordinateur : une image dessinée qui brille ----------
const toile = document.createElement('canvas');
toile.width = 512; toile.height = 400;
const texteEcran = new THREE.CanvasTexture(toile);
texteEcran.colorSpace = THREE.SRGBColorSpace;
let curseurVisible = true;
let lignesEcran = ['Partage', 'éphémère'], tailleEcran = 38;
function dessinerEcran() {
  const c = toile.getContext('2d');
  c.fillStyle = '#1b2a1f'; c.fillRect(0, 0, 512, 400);
  c.fillStyle = '#9dffb0';
  c.font = `600 ${tailleEcran}px ui-monospace, Menlo, Consolas, monospace`;
  lignesEcran.forEach((l, i) => c.fillText(l, 56, 150 + i * tailleEcran * 1.3));
  if (curseurVisible && lignesEcran.length) c.fillRect(56, 150 + (lignesEcran.length - 1) * tailleEcran * 1.3 + 30, 24, 6);
  c.fillStyle = 'rgba(0,0,0,.22)';                 // fines lignes, comme un vieil écran
  for (let y = 0; y < 400; y += 4) c.fillRect(0, y, 512, 2);
  texteEcran.needsUpdate = true;
}
dessinerEcran();
// Ce que l'écran bombé affiche (une liste vide = écran noir)
export function afficherEcran(lignes, taille = 38) { lignesEcran = lignes; tailleEcran = taille; dessinerEcran(); }

// ---------- Les matières ----------
const bois = photo('wood_floor_diff_1k.jpg', 1);
const platre = photo('plaster_grey_04_diff_1k.jpg', 1);
// Nacre : les reflets arc-en-ciel sont calculés « à la main » (l'option iridescence de Three.js
// coûtait la moitié du temps d'une image sur une petite carte graphique).
const nacre = () => {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xf3f1ee, roughness: 0.12, metalness: 0.3,
    clearcoat: 1, clearcoatRoughness: 0.08 });
  m.onBeforeCompile = s => {
    s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', `
      float bord = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
      vec3 arcEnCiel = 0.5 + 0.5 * cos(6.2831853 * (bord * 1.4 + vec3(0.0, 0.33, 0.67)));
      outgoingLight = mix(outgoingLight, outgoingLight * (0.55 + arcEnCiel * 0.9), pow(bord, 1.2) * 0.7 + 0.12);
      #include <opaque_fragment>`);
  };
  return m;
};
const matieres = {
  laque: new THREE.MeshPhysicalMaterial({ color: 0x111112, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 }),
  alu: new THREE.MeshPhysicalMaterial({ color: 0xc8cacd, metalness: 1, roughness: 0.32 }),
  nacre: nacre(),
  parquet: new THREE.MeshStandardMaterial({ map: bois, color: 0xd9cfc4, roughness: 0.62 }),
  bois: new THREE.MeshStandardMaterial({ map: bois, color: 0xe2b88e, roughness: 0.5 }),
  platre: new THREE.MeshStandardMaterial({ map: platre, color: 0xf1efe9, roughness: 0.95 }),
  tapis: new THREE.MeshPhysicalMaterial({ color: 0xff6a3d, roughness: 1, sheen: 1, sheenColor: 0xffb08f, sheenRoughness: 0.6 }),
  beige: new THREE.MeshPhysicalMaterial({ color: 0xe6dccb, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
  ecran: new THREE.MeshPhysicalMaterial({ color: 0x0c140e, emissive: 0xffffff, emissiveMap: texteEcran,
    emissiveIntensity: 1.2, roughness: 0.08, clearcoat: 1 }),
  ampoule: new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 0 }),
  vitre: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xdfe9f2, emissiveIntensity: 1, roughness: 0.1 }),
  cadre: new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.4 }),
  noir: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }),
  terre: new THREE.MeshStandardMaterial({ color: 0xc9744f, roughness: 0.85 }),
  feuille: new THREE.MeshPhysicalMaterial({ color: 0x2f5d3a, roughness: 0.5, sheen: 0.4, sheenColor: 0x9fd6a8 }),
};

// ---------- La planète et l'anneau du temps ----------
const CENTRE_PLANETE = 1.76;
const planete = new THREE.Mesh(new THREE.SphereGeometry(1.45, 128, 64), matieres.nacre);
planete.position.y = CENTRE_PLANETE;
monde.add(planete);

// L'anneau est un disque épais et troué (comme un CD) ; une part se cache selon le temps qui reste.
const forme = new THREE.Shape().absarc(0, 0, 2.3, 0, Math.PI * 2);
forme.holes.push(new THREE.Path().absarc(0, 0, 1.78, 0, Math.PI * 2, true));
const disque = new THREE.ExtrudeGeometry(forme, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008,
  bevelSize: 0.008, bevelSegments: 4, curveSegments: 160 });
const temps = { value: 1 };                     // 1 = 30 minutes, 0 = salle fermée
function partDuDisque(materiau, plein) {
  materiau.side = THREE.DoubleSide;
  const avant = materiau.onBeforeCompile;
  materiau.customProgramCacheKey = () => 'anneau-' + plein;
  materiau.onBeforeCompile = s => {
    avant(s);
    s.uniforms.uTemps = temps;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAnneau;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAnneau = position.xy;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAnneau;\nuniform float uTemps;')
      .replace('void main() {', `void main() {
        float a = fract(atan(-vAnneau.x, vAnneau.y) / 6.2831853 + 1.0);
        if (${plein ? 'a > uTemps' : 'a < uTemps'}) discard;`);
  };
  const m = new THREE.Mesh(disque, materiau);
  m.rotation.x = -Math.PI / 2;
  return m;
}
const anneau = new THREE.Group();
anneau.position.y = CENTRE_PLANETE;
anneau.rotation.set(0.12, 0, -0.08);
const anneauPlein = partDuDisque(nacre(), true);
const anneauVide = partDuDisque(new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.2,
  transparent: true, opacity: 0.16, depthWrite: false }), false);
anneau.add(anneauPlein, anneauVide);
monde.add(anneau);

// ---------- La lumière : la photo HDR du studio + une lumière douce ----------
const soleil = new THREE.DirectionalLight(0xfff6ec, 1.6);
soleil.position.set(4.5, 9, 5.5);
soleil.castShadow = true;
soleil.shadow.mapSize.set(TELEPHONE ? 1024 : 2048, TELEPHONE ? 1024 : 2048);
Object.assign(soleil.shadow.camera, { left: -4, right: 4, top: 5, bottom: -3, near: 1, far: 25 });
soleil.shadow.bias = -0.0004;
soleil.shadow.normalBias = 0.02;
soleil.shadow.radius = 4;
monde.add(soleil, soleil.target);   // la lumière tourne avec la platine : l'ombre reste la même
const lampe = new THREE.SpotLight(0xffc98a, 0, 3.5, 0.75, 0.6, 1.5);   // allumée la nuit
const arriere = new THREE.PointLight(0xff6a3d, 0, 9, 1.5);               // lueur orange de la nuit (PC)
arriere.position.set(-3, 5.5, -5);
scene.add(arriere);

// Les lumières de la pièce, réglées par passages.js :
// piece 0 → 1 = la lampe et l'écran s'allument (on entre) ; allume 1 → 0 = la pièce s'éteint (salle fermée) ;
// point 0 → 1 = le point orange qui respire apparaît.
export const lumiere = { piece: 0, allume: 1, point: 0 };
const base = {};                                  // les valeurs du jour ou de la nuit, avant ces réglages
function reglerJourNuit() {
  const nuit = NUIT.matches;
  scene.background = new THREE.Color(nuit ? 0x0d0d0d : 0xecebe6);
  Object.assign(base, { env: nuit ? 0.28 : 1, soleil: nuit ? (TELEPHONE ? 0 : 0.35) : 1.6,
    lampe: nuit ? 9 : 0, lampeSalle: nuit ? 11 : 6, ampoule: nuit ? 4 : 0.2, vitre: nuit ? 0.7 : 1.1 });
  soleil.color.set(nuit ? 0xb8c4ff : 0xfff6ec);
  arriere.intensity = nuit && !TELEPHONE ? 8 : 0;
  matieres.vitre.emissive.set(nuit ? 0x1c2a4a : 0xdfe9f2);
}
function appliquerLumieres() {
  const { piece, allume } = lumiere;
  scene.environmentIntensity = base.env * (0.55 + 0.45 * allume);
  soleil.intensity = base.soleil * (0.6 + 0.4 * allume);
  lampe.intensity = amortir(base.lampe, base.lampeSalle, piece) * allume;
  matieres.ampoule.emissiveIntensity = amortir(base.ampoule, 4, piece) * allume;
  matieres.ecran.emissiveIntensity = (0.7 + 0.7 * piece) * allume;
  matieres.vitre.emissiveIntensity = base.vitre * (0.5 + 0.5 * allume);
}
reglerJourNuit();
NUIT.addEventListener('change', reglerJourNuit);

// Le point orange de « Salle fermée » : il respire entre la planète et l'anneau, du côté de la caméra
const point = new THREE.Mesh(new THREE.SphereGeometry(0.07, 48, 24),
  new THREE.MeshPhysicalMaterial({ color: 0xff5a1f, emissive: 0xff5a1f, emissiveIntensity: 0.6, roughness: 0.3, clearcoat: 1 }));
scene.add(point);                                 // toujours là (préparé au chargement), mais minuscule

// ---------- Le modèle de Blender ----------
const survolables = [];
function recentrer(groupe) {                       // pour qu'un objet tourne sur lui-même
  const centre = new THREE.Box3().setFromObject(groupe).getCenter(new THREE.Vector3());
  groupe.children.forEach(e => e.position.sub(centre));
  groupe.position.add(centre);
}
modelePret.then(gltf => {
  const atelier = gltf.scene;
  atelier.traverse(o => {
    if (!o.isMesh) return;
    const nom = o.material.name;
    if (matieres[nom]) o.material = nom === 'nacre' ? nacre() : matieres[nom];
    o.castShadow = !['vitre', 'tapis', 'ecran'].includes(nom);
    o.receiveShadow = true;
  });
  monde.add(atelier);
  for (const nom of ['Ordinateur', 'Lampe', 'CD', 'Plante']) {
    const g = atelier.getObjectByName(nom);
    recentrer(g);
    g.userData.base = g.rotation.y;
    g.userData.cible = 0;
    survolables.push(g);
  }
  // La lampe éclaire depuis son ampoule, vers le bas de l'abat-jour
  const ampoule = atelier.getObjectByName('Lampe_ampoule');
  const abatjour = atelier.getObjectByName('Lampe_abatjour');
  ampoule.getWorldPosition(lampe.position);
  const sens = new THREE.Vector3(0, 0, 1).applyQuaternion(abatjour.getWorldQuaternion(new THREE.Quaternion()));
  lampe.target.position.copy(lampe.position).addScaledVector(sens, 1.2);
  monde.add(lampe, lampe.target);
});

// ---------- Retouche d'image légère (PC seulement) : lueur, grain, vignette ----------
let composer = null;
if (!TELEPHONE) {
  const cible = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, cible);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth || 1, innerHeight || 1), 0.35, 0.5, 0.92));
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTemps: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTemps; varying vec2 vUv;
      float hasard(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTemps) * 43758.5453); }
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float v = smoothstep(0.95, 0.35, distance(vUv, vec2(0.5)));
        c.rgb *= mix(0.86, 1.0, v);
        c.rgb += (hasard(vUv) - 0.5) * 0.04;
        gl_FragColor = c;
      }`,
  }));
}
const grain = composer?.passes.at(-1);

// ---------- La caméra : cadrage, respiration, souris, doigt ----------
const regard = new THREE.Vector3(0, 2.4, 0);
let distance = 14;
function cadrer() {
  const l = innerWidth, h = innerHeight;
  if (!l || !h) return;                     // fenêtre réduite : rien à cadrer
  renderer.setSize(l, h, false);
  composer?.setSize(l, h);
  camera.aspect = l / h;
  const demi = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  distance = Math.max(6.6 / 2 / demi, 7.0 / 2 / (demi * camera.aspect)) * 1.05;
  camera.updateProjectionMatrix();
}
cadrer();
addEventListener('resize', cadrer);

// Où la caméra doit aller (réglé par passages.js) : le point regardé (x, y, z), la distance
// (1 = tout le monde visible), les angles en degrés, et un décalage de l'image (dx, dy, en part de l'écran).
export const vue = { x: 0, y: 2.4, z: 0, dist: 1, polaire: 70, azimut: 38, dx: 0, dy: 0 };
const cam = { ...vue };                       // où elle est vraiment : elle s'approche de vue à chaque image

const souris = { x: 0, y: 0, lisseX: 0, lisseY: 0 };
const tour = { cible: 0, actuel: 0, elan: 0, glisse: false, dernierX: 0 };
export const reglages = { tourner: true };    // false dans la salle : la platine ne tourne plus au doigt
// Remet la platine de face (la pièce ouverte vers la caméra), par le plus court chemin
export function remettreDeFace() {
  tour.elan = 0;
  tour.cible = Math.round(tour.cible / (Math.PI * 2)) * Math.PI * 2;
}
const rayon = new THREE.Raycaster();
const pointeur = new THREE.Vector2(-9, -9);

canvas.addEventListener('pointerdown', e => {
  if (!reglages.tourner) return;
  tour.glisse = true; tour.dernierX = e.clientX; tour.elan = 0;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  souris.x = (e.clientX / innerWidth) * 2 - 1;
  souris.y = (e.clientY / innerHeight) * 2 - 1;
  pointeur.set(souris.x, -souris.y);
  if (!tour.glisse) return;
  const dx = e.clientX - tour.dernierX;
  tour.dernierX = e.clientX;
  tour.cible += dx * 0.006;
  tour.elan = dx * 0.006;
});
const lacher = () => { tour.glisse = false; };
canvas.addEventListener('pointerup', lacher);
canvas.addEventListener('pointercancel', lacher);
canvas.addEventListener('pointerleave', () => pointeur.set(-9, -9));

// ---------- La boucle (s'arrête quand la page est cachée) ----------
const horloge = new THREE.Clock();
const DUREE_DEMO = 45;            // démonstration : l'anneau se vide en 45 s, puis se remplit en 1,2 s
let tempsDemo = 0, remplissage = 1;
export const minuteur = { demo: true, valeur: 1 };   // demo false : l'anneau va vers valeur (0 = vide)
export function relancerAnneau() { tempsDemo = 0; minuteur.demo = true; }
const sphere = new THREE.Spherical();
const compteur = new URLSearchParams(location.search).has('fps') ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'fps' })) : null;
let images = 0, depuis = performance.now();

function image() {
  const dt = Math.min(horloge.getDelta(), 0.05);
  const t = horloge.elapsedTime;

  // Le doigt ou la souris fait tourner la platine, avec un peu d'élan
  if (!tour.glisse && !CALME) { tour.cible += tour.elan; tour.elan *= 0.92; }
  tour.actuel = amortir(tour.actuel, tour.cible, 0.08);
  monde.rotation.y = tour.actuel + (CALME ? 0 : Math.sin(t * 0.25) * 0.05);

  // La caméra suit la souris avec retard (environ 4°) et respire doucement
  souris.lisseX = amortir(souris.lisseX, TELEPHONE ? 0 : souris.x, 0.05);
  souris.lisseY = amortir(souris.lisseY, TELEPHONE ? 0 : souris.y, 0.05);
  const souffle = CALME ? 0 : Math.sin(t * 0.6);
  for (const k in vue) cam[k] = CALME ? vue[k] : amortir(cam[k], vue[k], 0.06);
  regard.set(cam.x, cam.y, cam.z);
  sphere.set(distance * cam.dist * (1 + souffle * 0.012),
    THREE.MathUtils.degToRad(cam.polaire + souris.lisseY * 2.5 + souffle * 0.6),
    THREE.MathUtils.degToRad(cam.azimut + souris.lisseX * 4));
  camera.position.setFromSpherical(sphere).add(regard);
  camera.lookAt(regard);
  camera.setViewOffset(innerWidth, innerHeight, -cam.dx * innerWidth, cam.dy * innerHeight, innerWidth, innerHeight);

  // L'anneau du temps se vide, puis se remplit d'un coup (démonstration)
  tempsDemo += dt;
  if (tempsDemo > DUREE_DEMO + 2) tempsDemo = 0;
  const vise = !minuteur.demo ? minuteur.valeur : tempsDemo < 1.2 ? 1 : Math.max(0, 1 - (tempsDemo - 1.2) / DUREE_DEMO);
  remplissage = CALME ? vise : amortir(remplissage, vise, 0.06);
  temps.value = remplissage;
  if (!CALME) anneau.rotation.y += dt * 0.03;

  // L'objet survolé tourne doucement
  if (!TELEPHONE && survolables.length) {
    rayon.setFromCamera(pointeur, camera);
    const touche = rayon.intersectObjects(survolables, true)[0];
    for (const g of survolables) {
      let o = touche?.object; while (o && o !== g) o = o.parent;
      g.userData.cible = o ? Math.sin(t * 1.5) * 0.12 + 0.18 : 0;
      const avant = g.rotation.y;
      g.rotation.y = amortir(avant, g.userData.base + g.userData.cible, 0.06);
      if (Math.abs(g.rotation.y - avant) > 1e-4) renderer.shadowMap.needsUpdate = true;
    }
  }

  appliquerLumieres();
  {
    const respire = CALME ? 1 : 1 + 0.25 * Math.sin(t * Math.PI * 2 / 2.4);
    point.scale.setScalar(Math.max(1e-4, lumiere.point * respire));
    point.material.emissiveIntensity = 0.4 + 0.5 * respire;
    point.position.set(camera.position.x, 0, camera.position.z).setLength(1.62);
    point.position.y = CENTRE_PLANETE;
  }

  // Le curseur de l'écran clignote
  const visible = Math.floor(t * 1.6) % 2 === 0;
  if (visible !== curseurVisible) { curseurVisible = visible; dessinerEcran(); }

  if (composer) { grain.uniforms.uTemps.value = t % 10; composer.render(); }
  else renderer.render(scene, camera);

  if (compteur) {
    images++;
    const maintenant = performance.now();
    if (maintenant - depuis > 1000) { compteur.textContent = images + ' images/s'; images = 0; depuis = maintenant; }
  }
}

function demarrer() { horloge.getDelta(); renderer.setAnimationLoop(image); }
document.addEventListener('visibilitychange', () => document.hidden ? renderer.setAnimationLoop(null) : demarrer());

// Tout est chargé : on prépare les matières (pas d'à-coup), puis la scène apparaît en fondu
export const pret = Promise.all([envPret, modelePret]).then(async () => {
  await renderer.compileAsync(scene, camera);
  renderer.shadowMap.needsUpdate = true;
  demarrer();
  ecranChargement.classList.add('fini');
}).catch(err => {
  console.error(err);
  document.getElementById('pourcent').textContent = 'La 3D ne charge pas';
});
