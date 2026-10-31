// Les reflets du fil dans l'atelier : six objets au maximum, sans conserver de fichier.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import gsap from 'gsap';

const CALME = matchMedia('(prefers-reduced-motion: reduce)').matches;
const texture = toile => {
  const t = new THREE.CanvasTexture(toile);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
function etiquette(message) {
  const toile = document.createElement('canvas');
  toile.width = 512; toile.height = 384;
  const c = toile.getContext('2d');
  c.fillStyle = '#f8f8f5'; c.fillRect(0, 0, 512, 384);
  c.fillStyle = '#121212'; c.font = '600 36px sans-serif';
  c.fillText(message.type === 'texte' ? message.de : message.ext, 32, 64, 448);
  c.font = '26px sans-serif';
  const lignes = message.texte.slice(0, 168).match(/.{1,28}/gu) || [];
  lignes.slice(0, 6).forEach((ligne, i) => c.fillText(ligne, 32, 115 + i * 38, 448));
  return texture(toile);
}
function liberer(groupe) {
  groupe.removeFromParent();
  groupe.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    o.material.map?.dispose();
    o.material.dispose();
  });
}

// Coordonnées locales de Piece, après l'export Blender : Y en haut, dessus de l'établi à 3,90.
export function creerObjets(piece, renderer, nacre) {
  const groupe = new THREE.Group();
  piece.add(groupe);
  const vivants = new Map();
  const cible = new THREE.Vector3();
  let disparition = null;
  const fiche = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }));
  fiche.rotation.x = -Math.PI / 2;
  fiche.position.set(0.58, 3.901, -0.57);
  fiche.visible = false;
  piece.add(fiche);
  let dernierQR = '', generationQR = 0;

  const billes = Array.from({ length: 7 }, () => {
    const bille = new THREE.Mesh(new THREE.SphereGeometry(0.06, 32, 24),
      new THREE.MeshPhysicalMaterial({ color: 0xff5a1f, clearcoat: 1, roughness: 0.2 }));
    bille.visible = false; piece.add(bille); return bille;
  });

  function fabriquer(m) {
    const objet = new THREE.Group();
    let arc = null;
    if (m.type === 'texte') {
      const papier = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.004, 0.10, 3, 0.002),
        new THREE.MeshStandardMaterial({ color: 0xf8f8f5, roughness: 0.85 }));
      papier.castShadow = papier.receiveShadow = true;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.09),
        new THREE.MeshStandardMaterial({ map: etiquette(m), roughness: 0.85 }));
      face.rotation.x = -Math.PI / 2; face.position.y = 0.0025;
      objet.add(papier, face);
    } else {
      const forme = new THREE.Shape().absarc(0, 0, 0.065, 0, Math.PI * 2);
      forme.holes.push(new THREE.Path().absarc(0, 0, 0.008, 0, Math.PI * 2, true));
      const cd = new THREE.Mesh(new THREE.ExtrudeGeometry(forme, { depth: 0.003, bevelEnabled: true,
        bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 3, curveSegments: 64 }), nacre());
      cd.rotation.x = -Math.PI / 2;
      cd.castShadow = cd.receiveShadow = true;
      const label = new THREE.Mesh(new THREE.RingGeometry(0.009, 0.04, 64),
        new THREE.MeshStandardMaterial({ map: etiquette(m), roughness: 0.5 }));
      label.rotation.x = -Math.PI / 2; label.position.y = 0.005;
      arc = new THREE.Mesh(new THREE.RingGeometry(0.052, 0.061, 96),
        new THREE.MeshStandardMaterial({ color: 0xff6a3d, emissive: 0xd63d12, emissiveIntensity: 0.3 }));
      arc.rotation.x = -Math.PI / 2; arc.rotation.z = Math.PI / 2; arc.position.y = 0.006;
      objet.add(cd, label, arc);
    }
    objet.rotation.y = 0.15;
    objet.position.set(0.20, 4.26, -0.01);
    groupe.add(objet);
    const v = { objet, arc, avance: CALME ? 1 : 0, part: 0, cible: 0, index: 0 };
    gsap.to(v, { avance: 1, duration: CALME ? 0 : 1, ease: 'power3.out' });
    return v;
  }

  return {
    reflet(messages) {
      disparition?.progress(1); disparition = null;
      const six = messages.slice(-6);
      const gardes = new Set(six.map(m => m.id));
      for (const [id, v] of vivants) if (!gardes.has(id)) {
        gsap.killTweensOf(v); liberer(v.objet); vivants.delete(id);
        renderer.shadowMap.needsUpdate = true;
      }
      six.forEach((m, index) => {
        let v = vivants.get(m.id);
        if (!v) { v = fabriquer(m); vivants.set(m.id, v); }
        v.index = index;
        v.cible = m.pourcent / 100;
        if (v.arc) v.arc.visible = m.enCours;
      });
    },
    qr(svg) {
      if (svg === dernierQR) return;
      dernierQR = svg;
      const version = ++generationQR;
      fiche.visible = false;
      fiche.material.map?.dispose(); fiche.material.map = null; fiche.material.needsUpdate = true;
      if (!svg) return;
      const image = new Image();
      image.onload = () => {
        if (version !== generationQR) return;
        const toile = document.createElement('canvas'); toile.width = toile.height = 512;
        const c = toile.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 512, 512);
        c.drawImage(image, 0, 0, 512, 512);
        fiche.material.map = texture(toile); fiche.material.needsUpdate = true; fiche.visible = true;
      };
      // Le même QR que le panneau HTML, avec son fond blanc et sa marge de quatre modules.
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<path ', '<path fill="#111" '));
    },
    presence(n) { billes.forEach((b, i) => { b.visible = i < n; }); },
    vider() {
      disparition?.progress(1);
      this.qr(''); this.presence(0);
      const anciens = [...vivants.values()]; vivants.clear();
      anciens.forEach(v => gsap.killTweensOf(v));
      const fondu = { valeur: 1 };
      disparition = gsap.to(fondu, { valeur: 0, duration: CALME ? 0 : 1.2, ease: 'power3.out',
        onUpdate: () => anciens.forEach(v => v.objet.scale.setScalar(Math.max(0.001, fondu.valeur))),
        onComplete: () => {
          anciens.forEach(v => liberer(v.objet));
          renderer.shadowMap.needsUpdate = true;
        } });
    },
    image(t) {
      for (const v of vivants.values()) {
        // Petite pile décalée dans l'espace libre devant les CD, sans traverser le clavier.
        const hauteur = v.arc ? 3.901 : 3.902;  // bas du CD (biseau compris) ou du papier sur le plateau
        cible.set(0.20 + v.index * 0.022, hauteur + v.index * 0.008, -0.41 - v.index * 0.002);
        cible.y += (1 - v.avance) * 0.35;
        cible.z += (1 - v.avance) * 0.4;
        if (v.objet.position.distanceToSquared(cible) > 1e-6) renderer.shadowMap.needsUpdate = true;
        if (CALME) v.objet.position.copy(cible);
        else v.objet.position.lerp(cible, 0.08);
        v.part = CALME ? v.cible : v.part + (v.cible - v.part) * 0.08;
        if (v.arc) v.arc.geometry.setDrawRange(0, Math.floor(v.part * 96) * 6);
      }
      billes.forEach((b, i) => {
        // Rayon 2,2 : au-delà des coins de la pièce (2,12 de côté), même avec le rayon des billes.
        const a = i * Math.PI * 2 / 7 + (CALME ? 0 : t * 0.12);
        b.position.set(Math.cos(a) * 2.2, 3.5 + Math.sin(a) * 0.12, Math.sin(a) * 2.2);
      });
    },
  };
}
