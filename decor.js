// La salle d'exposition autour de la pièce (mission 22c, inspirée de VALMORA) :
// un sol sombre et brillant qui reflète la pièce, de la brume (qui commence juste derrière la pièce), un projecteur en hauteur,
// son rayon de lumière et quelques poussières qui flottent dedans.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

const SOL = 3.055;                                   // le dessous du plancher de la pièce
const CIBLE = new THREE.Vector3(0, 3.9, -0.1);       // le milieu de la pièce
const PROJECTEUR = new THREE.Vector3(-3.4, 9.6, 3.2);

// Une petite tache ronde et floue, pour dessiner chaque poussière
function tache() {
  const toile = document.createElement('canvas');
  toile.width = toile.height = 64;
  const c = toile.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(toile);
}

export function creerDecor(scene, monde, { telephone, calme }) {
  // Le sol : un miroir caché dessous (PC seulement, il coûte une deuxième image),
  // recouvert d'une laque sombre presque opaque : le reflet n'en ressort qu'adouci.
  if (!telephone) {
    const miroir = new Reflector(new THREE.CircleGeometry(40, 96), {
      clipBias: 0.003, color: 0x8a8a8a,
      textureWidth: Math.round(innerWidth * 0.5), textureHeight: Math.round(innerHeight * 0.5) });
    miroir.rotation.x = -Math.PI / 2;
    miroir.position.y = SOL - 0.002;
    monde.add(miroir);
  }
  const laque = new THREE.MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 0.15,
    transparent: !telephone, opacity: 0.84 });
  const sol = new THREE.Mesh(new THREE.CircleGeometry(40, 96), laque);
  sol.rotation.x = -Math.PI / 2;
  sol.position.y = SOL;
  sol.receiveShadow = true;
  monde.add(sol);

  // Le projecteur : une lumière étroite et douce qui tombe d'en haut sur la pièce
  const projecteur = new THREE.SpotLight(0xffe4c4, 0, 22, 0.36, 0.85, 1.6);
  projecteur.position.copy(PROJECTEUR);
  projecteur.target.position.copy(CIBLE);
  projecteur.castShadow = true;
  projecteur.shadow.mapSize.set(telephone ? 512 : 2048, telephone ? 512 : 2048);
  projecteur.shadow.bias = -0.0003;
  projecteur.shadow.normalBias = 0.02;
  projecteur.shadow.radius = 6;
  monde.add(projecteur, projecteur.target);

  // Le rayon : un cône invisible, plus clair au cœur et vers le projecteur, qui s'efface en bas
  const sens = new THREE.Vector3().subVectors(PROJECTEUR, CIBLE);
  const longueur = sens.length() * 1.12;
  const rayon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 2.1, longueur, 64, 1, true),
    new THREE.ShaderMaterial({
      uniforms: { uCouleur: { value: new THREE.Color(0xffd9b0) }, uForce: { value: 0 } },
      vertexShader: `varying float vLong; varying float vCoeur;
        void main(){
          vLong = uv.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vCoeur = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uCouleur; uniform float uForce; varying float vLong; varying float vCoeur;
        void main(){
          float a = pow(vCoeur, 3.0) * smoothstep(0.0, 0.45, vLong) * (0.3 + 0.7 * vLong) * uForce;
          gl_FragColor = vec4(uCouleur * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  rayon.position.copy(PROJECTEUR).addScaledVector(sens.clone().normalize(), -longueur / 2);
  rayon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sens.normalize());
  monde.add(rayon);

  // Les poussières : elles montent très lentement et ondulent, dans le haut de la pièce
  const nombre = telephone ? 160 : 450;
  const places = new Float32Array(nombre * 3), phases = new Float32Array(nombre);
  const boite = { x: 3.2, y: 2.6, z: 3.0 };
  for (let i = 0; i < nombre; i++) {
    places[i * 3] = (Math.random() - 0.5) * boite.x;
    places[i * 3 + 1] = SOL + Math.random() * boite.y;
    places[i * 3 + 2] = (Math.random() - 0.5) * boite.z;
    phases[i] = Math.random() * Math.PI * 2;
  }
  const formePoussiere = new THREE.BufferGeometry();
  formePoussiere.setAttribute('position', new THREE.BufferAttribute(places, 3));
  const poussiere = new THREE.Points(formePoussiere, new THREE.PointsMaterial({ map: tache(), size: 0.022,
    color: 0xffe6c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  monde.add(poussiere);

  const base = {};
  let avant = 0;
  return {
    // Jour : une galerie de pierre claire ; nuit : la salle sombre
    regler(nuit) {
      const fond = nuit ? 0x0a0a0b : 0xe4e1db;
      scene.background = new THREE.Color(fond);
      scene.fog = new THREE.Fog(fond, 10, 20);
      laque.color.set(nuit ? 0x101012 : 0xcfcac2);
      Object.assign(base, { projecteur: nuit ? 55 : 28, rayon: nuit ? 0.12 : 0.04, poussiere: nuit ? 0.45 : 0.15 });
    },
    // allume : 1 = salle ouverte, 0 = salle fermée (la lumière baisse sans s'éteindre) ;
    // recul : la distance entre la caméra et la pièce (bien plus grande sur téléphone)
    image(t, allume, recul) {
      scene.fog.near = recul + 1.6;
      scene.fog.far = recul * 2.4;
      const f = 0.25 + 0.75 * allume;
      projecteur.intensity = base.projecteur * f;
      rayon.material.uniforms.uForce.value = base.rayon * f;
      poussiere.material.opacity = base.poussiere * f;
      const dt = Math.min(t - avant, 0.05); avant = t;
      if (calme) return;
      for (let i = 0; i < nombre; i++) {
        const k = i * 3;
        places[k + 1] += dt * 0.025;
        places[k] += Math.sin(t * 0.3 + phases[i]) * dt * 0.01;
        if (places[k + 1] > SOL + boite.y) places[k + 1] = SOL;
      }
      formePoussiere.attributes.position.needsUpdate = true;
    },
  };
}
