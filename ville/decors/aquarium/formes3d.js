// Formes 3D du décor « Aquarium » (vue en relief, voir rendu3d.js).
//
// Le rendu 2D est une vue de côté (y = profondeur, le sable en bas) alors que la 3D pose le plan
// (x, y) au sol. On garde donc la coupe de l'aquarium couchée au sol, comme un plateau : au loin
// (y petit) la surface et le filtre, près de soi (y grand) le sable, les récifs et les coffres. Les
// positions restent celles du modèle (poissons, perles et bulles suivent la même carte qu'en 2D).
// La hauteur dans l'eau devient aussi une altitude : plus un poisson nage près de la surface, plus
// il flotte haut au-dessus du sol (altitudeEau). Le niveau de l'eau (la RAM) est un bloc d'eau
// translucide qui monte et s'étend vers le fond de la coupe ; la règle graduée à droite le mesure.
//
// Sol (fonction sol) : eau dégradée, rayons de lumière, sable et galets, cadre. Volumes : poissons
// (corps ellipsoïde, queue qui bat, nageoire, yeux), récifs (rochers, coraux, algues qui ondulent),
// coffres au trésor (disques), bulleur et sa colonne de bulles (processeur), filtre suspendu avec
// tuyau et cascade (Internet), vitres, cadre et meuble de l'aquarium.

import { SABLE, hacher } from './modele.js';

const ROUGE = '#E8504F';
const K_ALTITUDE = 0.14;        // altitude 3D par unité de profondeur 2D au-dessus du sable
const ALT_FOND = 6;             // altitude minimale (au ras du sable)
const ECHELLE_POISSON = 1.25;   // les poissons un peu plus gros qu'en 2D, pour se lire en volume
const MAX_BULLES = 50;
const BRANCHES_CORAIL = [[0, -26], [-10, -20], [10, -22]];   // comme en 2D (dx, dy du bout)

// ---------- Repères communs ----------

const fondDe = v => v.hauteur - SABLE;

// Altitude d'un point de la coupe : 0 au sable, d'autant plus haut qu'il est près de la surface.
function altitudeEau(v, y) {
  return ALT_FOND + Math.max(0, fondDe(v) - y) * K_ALTITUDE;
}

const niveauEau = v => altitudeEau(v, v.surface());
const hauteurVitre = v => altitudeEau(v, 30) + 10;   // eau au plus haut (RAM pleine) + rebord

// Couleur sans transparence (les palettes interpolées sont en rgba()).
const opaque = (c, couleur) => c.eclaircir(couleur, 0);

function alphaDe(couleur) {
  const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(couleur);
  return m ? Number(m[1]) : 1;
}

// ---------- Ciel et sol ----------

// Autour de l'aquarium : le mur de la pièce, comme le fond du rendu 2D.
export const ciel = p => p.fond;

// Fond fixe de la coupe couchée au sol : eau, rayons, sable, galets et cadre. Ni poissons, ni
// récifs, ni coffres (ce sont des volumes), ni noms. Le niveau de l'eau, qui suit la RAM, n'y est
// pas : le sol n'est redessiné qu'au changement de palette, c'est un volume qui le montre.
export function sol(r2, temps) {
  const ctx = r2.ctx;
  const p = r2.palette;
  const v = r2.ville;
  const cam = r2.camera;
  ctx.setTransform(r2.ratio, 0, 0, r2.ratio, 0, 0);
  ctx.fillStyle = p.fond;
  ctx.fillRect(0, 0, r2.largeur, r2.hauteur);
  if (!v.bornes) return r2.canvas;
  ctx.save();
  ctx.translate(r2.largeur / 2, r2.hauteur / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  const L = v.largeur;
  const H = v.hauteur;
  const fond = H - SABLE;
  // Eau, du bord de la surface (au loin) jusqu'au sable
  const eau = ctx.createLinearGradient(0, 0, 0, fond);
  eau.addColorStop(0, p.eauHaut);
  eau.addColorStop(1, p.eauBas);
  ctx.fillStyle = eau;
  ctx.fillRect(0, 0, L, H);
  r2._dessinerRayons(0, fond, temps);
  // Sable, avec ses ondulations et ses galets
  ctx.fillStyle = p.sable;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= L; x += 30) ctx.lineTo(x, fond + Math.sin(x / 90) * 6 + Math.sin(x / 37) * 3);
  ctx.lineTo(L, H);
  ctx.closePath();
  ctx.fill();
  r2._dessinerGalets(L, fond);
  ctx.strokeStyle = p.cadre;
  ctx.lineWidth = 8;
  ctx.strokeRect(-4, -4, L + 8, H + 8);
  ctx.restore();
  return r2.canvas;
}

// ---------- Poissons (applications) ----------

export function cleApplication(lot, c) {
  const d = lot.app.donnees;
  return [d.etat, d.alerte ? 1 : 0, Math.round(lot.taille * 2), lot.quartier.couleur].join('|');
}

// Silhouette plate extrudée (queue, nageoire) : points [x, y] dans le plan du flanc.
function nageoire(THREE, points, epaisseur, courbe) {
  const forme = new THREE.Shape();
  forme.moveTo(...points[0]);
  if (courbe) forme.quadraticCurveTo(...courbe, ...points[1]);
  for (const pt of points.slice(courbe ? 2 : 1)) forme.lineTo(...pt);
  forme.closePath();
  const geo = new THREE.ExtrudeGeometry(forme, { depth: epaisseur, bevelEnabled: false });
  geo.translate(0, 0, -epaisseur / 2);
  return geo;
}

// « z » du poisson endormi : une petite toile partagée, une texture par poisson.
let toileZ = null;
function texteZ(THREE) {
  if (!toileZ) {
    toileZ = document.createElement('canvas');
    toileZ.width = toileZ.height = 64;
    const ctx = toileZ.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 52px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('z', 32, 34);
  }
  const texture = new THREE.CanvasTexture(toileZ);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Poisson : corps de la couleur du quartier (taille selon la RAM), queue qui bat d'autant plus vite
// que le processeur travaille, rayures et yeux. En veille : pâle, œil fermé, « z » qui monte, près du
// sable. Fermé : gris, ventre en l'air, yeux en croix, à la surface (retourne / terne : du modèle).
// Il nage à l'altitude de sa profondeur ; épingle et anneau rouge en cas d'alerte.
export function application(lot, c) {
  const { THREE } = c;
  const app = lot.app;
  const d = app.donnees;
  const veille = d.etat === 'veille';
  const L = lot.taille * ECHELLE_POISSON;
  const base = lot.quartier.couleur;
  const groupe = new THREE.Group();
  const nageur = new THREE.Group();     // altitude et cap
  const corps = new THREE.Group();      // roulis (ventre en l'air)
  groupe.add(nageur);
  nageur.add(corps);

  const options = { lumineux: true, transparent: veille, opacite: veille ? 0.6 : 1 };
  const matCorps = c.materiau(base, options);
  const matNageoires = c.materiau(c.eclaircir(base, -0.2), options);

  const ventre = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), matCorps);
  ventre.scale.set(L * 0.5, L * 0.3, L * 0.2);
  ventre.castShadow = true;
  corps.add(ventre);
  // Rayures claires : deux disques à peine plus larges que le corps
  const blanc = c.materiau('#FFFFFF', { transparent: true, opacite: 0.45 });
  for (const [x, ry, rz] of [[-0.15, 0.29, 0.195], [0.05, 0.305, 0.205]]) {
    const rayure = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), blanc);
    rayure.scale.set(L * 0.025, L * ry, L * rz);
    rayure.position.x = L * x;
    corps.add(rayure);
  }
  // Queue (pivot à l'arrière du corps) et nageoire dorsale
  const queue = new THREE.Group();
  queue.position.x = -L * 0.42;
  const nageoireQueue = new THREE.Mesh(nageoire(THREE, [[0, 0], [-L * 0.4, L * 0.3], [-L * 0.32, 0], [-L * 0.4, -L * 0.3]], L * 0.05), matNageoires);
  nageoireQueue.castShadow = true;
  queue.add(nageoireQueue);
  corps.add(queue);
  const dorsale = new THREE.Mesh(nageoire(THREE, [[-L * 0.15, L * 0.25], [L * 0.15, L * 0.24]], L * 0.04, [0, L * 0.48]), matNageoires);
  corps.add(dorsale);

  // Yeux, des deux côtés : ouverts, fermés (veille) ou en croix (mort, selon « terne »)
  const fonce = c.materiau('#1D2430');
  const ouverts = new THREE.Group();
  const croix = new THREE.Group();
  for (const s of [-1, 1]) {
    const oeil = new THREE.Mesh(new THREE.SphereGeometry(L * 0.07, 10, 8), c.materiau('#FFFFFF'));
    oeil.position.set(L * 0.28, L * 0.07, s * L * 0.15);
    const pupille = new THREE.Mesh(new THREE.SphereGeometry(L * 0.04, 8, 6), fonce);
    pupille.position.set(L * 0.31, L * 0.07, s * L * 0.2);
    if (veille) {
      const paupiere = new THREE.Mesh(new THREE.BoxGeometry(L * 0.13, L * 0.025, L * 0.02), fonce);
      paupiere.position.set(L * 0.28, L * 0.07, s * L * 0.19);
      ouverts.add(paupiere);
    } else {
      ouverts.add(oeil, pupille);
    }
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const trait = new THREE.Mesh(new THREE.BoxGeometry(L * 0.14, L * 0.025, L * 0.02), fonce);
      trait.position.set(L * 0.28, L * 0.07, s * L * 0.19);
      trait.rotation.z = angle;
      croix.add(trait);
    }
  }
  corps.add(ouverts, croix);

  // Endormi : un « z » qui monte et s'efface
  let z = null;
  if (veille) {
    z = new THREE.Sprite(new THREE.SpriteMaterial({ map: texteZ(THREE), transparent: true, depthWrite: false }));
    const taille = L * 0.35 + 6;
    z.scale.set(taille, taille, 1);
    nageur.add(z);
  }

  // Alerte : épingle au-dessus, anneau rouge qui pulse autour du poisson
  let anneau = null;
  if (d.alerte) {
    nageur.add(c.epingle(L * 0.35 + 4));
    anneau = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 40), c.materiau(ROUGE, { lumineux: true, transparent: true }));
    anneau.material.emissiveIntensity = 0.5;
    anneau.scale.set(L * 0.75, L * 0.5, L * 0.75);
    nageur.add(anneau);
  }

  let cap = (lot.sens ?? 1) > 0 ? 0 : Math.PI;
  let derniereCouleur = '';
  groupe.userData.hauteur = altitudeEau(c.ville, lot.cy) + L * 0.4;
  groupe.userData.maj = (temps, ctx) => {
    const p = ctx.palette;
    const donnees = app.donnees;
    const terne = lot.terne ?? 0;
    const cpu = terne > 0.5 ? 0 : Math.min(1, donnees.cpu / 20);
    // Profondeur → altitude ; cap qui pivote en douceur au demi-tour
    const altitude = Math.max(L * 0.35, altitudeEau(ctx.ville, lot.cy));
    nageur.position.y = altitude;
    cap += (((lot.sens ?? 1) > 0 ? 0 : Math.PI) - cap) * 0.15;
    nageur.rotation.y = cap;
    corps.rotation.x = (lot.retourne ?? 0) * Math.PI;
    // Couleur qui ternit à la mort ; lueur la nuit (LED de l'aquarium)
    const couleur = terne > 0 ? c.melanger(base, p.ferme, 0.85 * terne) : base;
    if (couleur !== derniereCouleur) {
      derniereCouleur = couleur;
      matCorps.color.set(opaque(ctx, couleur));
      matCorps.emissive.set(opaque(ctx, couleur));
      matNageoires.color.set(ctx.eclaircir(couleur, -0.2));
    }
    matCorps.emissiveIntensity = terne < 0.5 ? 0.3 * (p.lueur ?? 0) * (0.5 + cpu) : 0;
    // Battement de la queue, plus vif quand le processeur travaille
    const lent = donnees.etat === 'veille' || terne > 0.5;
    queue.rotation.y = Math.sin(temps / (lent ? 600 : 140 - 70 * cpu)) * 0.35 * (1 - 0.85 * terne);
    ouverts.visible = terne <= 0.5;
    croix.visible = terne > 0.5;
    if (z) {
      const t = (temps / 1500 + (lot.phase ?? 0)) % 1;
      z.visible = terne < 0.5;
      z.position.set(L * 0.4, L * 0.4 + t * 14, 0);
      z.material.opacity = 1 - t;
      z.material.color.set(opaque(ctx, p.texte));
    }
    if (anneau) anneau.material.opacity = 0.5 + 0.4 * Math.sin(temps / 180);
    groupe.userData.hauteur = altitude + L * 0.4;
  };
  return groupe;
}

// ---------- Bulleur (processeur et mémoire) ----------

// Pierre au fond, anneaux CPU / RAM sur le sable, plaque « CPU » (rouge au-delà de 90 %) et colonne
// de bulles qui monte jusqu'au niveau de l'eau, d'autant plus dense que le processeur travaille.
export function tour(t, c) {
  const { THREE } = c;
  const k = c.ville.echelle ?? 1;
  const groupe = new THREE.Group();
  const pierre = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), c.materiau('#6E6A63'));
  pierre.scale.set(22 * k, 12 * k, 16 * k);
  pierre.castShadow = true;
  groupe.add(pierre);
  groupe.add(c.anneaux(t.rayon * 1.6, 0));
  const plaques = ['#F2A541', ROUGE].map(fond => {
    const plaque = c.texteSur('CPU', 56 * k, 20 * k, { fond });
    plaque.position.set(0, 10 * k, 26 * k);
    groupe.add(plaque);
    return plaque;
  });

  const bulles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshLambertMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.55, depthWrite: false }), MAX_BULLES);
  bulles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bulles.frustumCulled = false;
  groupe.add(bulles);
  const matrice = new THREE.Matrix4();

  groupe.userData.hauteur = niveauEau(c.ville);
  groupe.userData.maj = (temps, ctx) => {
    const v = ctx.ville;
    const s = v.systeme;
    if (!s) return;
    const cpu = s.cpu / 100;
    plaques[0].visible = cpu <= 0.9;
    plaques[1].visible = cpu > 0.9;
    const niveau = niveauEau(v);
    const depart = 10 * k;
    const profondeur2d = Math.max(1, fondDe(v) - v.surface());   // même rythme qu'en 2D
    const n = Math.min(MAX_BULLES, Math.round(5 + cpu * 45));
    for (let i = 0; i < n; i++) {
      const h = hacher(`b${i}`);
      const vitesse = 60 + (h % 60);
      const u = ((temps / 1000) * vitesse / profondeur2d + (h % 1000) / 1000) % 1;
      const x = Math.sin(u * 9 + i) * (6 + u * 18) + ((h >>> 8) % 20 - 10);
      const zz = Math.cos(u * 7 + i) * (4 + u * 10);
      const r = 1.5 + ((h >>> 12) % 4) * 0.8 + u * 2;
      matrice.makeScale(r, r, r);
      matrice.setPosition(x, depart + u * Math.max(0, niveau - depart), zz);
      bulles.setMatrixAt(i, matrice);
    }
    bulles.count = n;
    bulles.instanceMatrix.needsUpdate = true;
    groupe.userData.hauteur = niveau;
  };
  return groupe;
}

// ---------- Halo de saturation ----------

// Anneau rouge qui pulse au pied d'un coffre ou du filtre saturé (embouteillage).
function halo(c, rayon, cle) {
  const { THREE } = c;
  const anneau = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48),
    new THREE.MeshBasicMaterial({ color: ROUGE, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  anneau.rotation.x = -Math.PI / 2;
  anneau.position.y = 0.8;
  anneau.scale.set(rayon, rayon, 1);
  anneau.userData.maj = (temps, ctx) => {
    const saturation = ctx.trafic.saturation.get(cle) ?? 0;
    const pulse = (Math.sin(temps / 250) + 1) / 2;
    anneau.material.opacity = saturation > 0 ? 0.35 + 0.5 * saturation * pulse : 0;
    const r = rayon * (1 + 0.06 * pulse);
    anneau.scale.set(r, r, 1);
  };
  return anneau;
}

// ---------- Coffres au trésor (disques) ----------

// Coffre en bois cerclé d'or : le couvercle s'ouvre et l'or luit quand le disque travaille ; un dôme
// de pièces monte avec l'espace utilisé (rouge au-delà de 90 %) ; halo rouge si le disque sature.
export function entrepot(e, c) {
  const { THREE } = c;
  const k = c.ville.echelle ?? 1;
  const groupe = new THREE.Group();
  const [l, p, h] = [e.l, 44 * k, 30 * k];
  groupe.add(c.boite(l, h, p, '#7B4F2A'));
  const cerclage = c.boite(l + 1, 4 * k, p + 1, '#E8B04A');
  cerclage.position.y = h * 0.6;
  groupe.add(cerclage);
  const serrure = c.boite(10 * k, 12 * k, 2, '#E8B04A');
  serrure.position.set(0, h * 0.5, p / 2);
  groupe.add(serrure);
  const nom = c.texteSur(e.disque.nom, 30 * k, 11 * k, { fond: '#7B4F2A' });
  nom.position.set(0, h * 0.25, p / 2 + 0.3);
  groupe.add(nom);

  // Pièces d'or : demi-sphère posée dans le coffre
  const or = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    c.materiau('#F6CF5A', { lumineux: true }));
  or.position.y = h;
  or.material.emissive.set('#FFD25A');
  groupe.add(or);

  // Couvercle, articulé à l'arrière
  const charniere = new THREE.Group();
  charniere.position.set(0, h, -p / 2);
  const couvercle = c.boite(l, 10 * k, p, '#8E5E33');
  couvercle.position.z = p / 2;
  const bord = c.boite(l + 1, 3, 3, '#E8B04A');
  bord.position.set(0, 3 * k, p);
  charniere.add(couvercle, bord);
  groupe.add(charniere);

  groupe.add(halo(c, Math.max(l, p) * 0.75, `disque:${e.disque.id}`));
  groupe.userData.hauteur = h + 36;
  groupe.userData.maj = () => {
    // Les disques sont des objets renouvelés à chaque relevé : on lit celui du moment.
    const d = (groupe.userData.entrepot ?? e).disque;
    const activite = Math.min(1, (d.occupation ?? 0) / 60);
    const rempli = Math.max(0.02, Math.min(1, d.utilise / d.total));
    charniere.rotation.x = -(0.7 + 0.8 * activite);
    or.scale.set((l / 2 - 6) * 0.85 * rempli + 6, 4 + 26 * rempli, (p / 2 - 6) * 0.85 * rempli + 5);
    or.material.color.set(rempli > 0.9 ? ROUGE : '#F6CF5A');
    or.material.emissiveIntensity = 0.12 + 0.3 * activite;
  };
  return groupe;
}

// ---------- Filtre (Internet) ----------

// Boîtier accroché à la vitre du fond (en haut à gauche en 2D), tuyau d'aspiration qui plonge
// jusqu'au point où arrivent les bulles du réseau, cascade de retour jusqu'au bord de l'eau et
// remous, qui s'emballent avec le débit. Rouge et halo quand le réseau sature.
export function internet(a, c) {
  const { THREE } = c;
  const v = c.ville;
  const k = v.echelle ?? 1;
  const groupe = new THREE.Group();
  const vitre = hauteurVitre(v);
  const zVitre = -a.cy;                     // la vitre du fond (y = 0) dans le repère du filtre
  const [l, haut, prof] = [a.l, 46 * k, 40 * k];
  const bas = vitre - 22 * k;

  const boitier = c.boite(l, haut, prof, '#4B5563', { propre: true });
  boitier.position.set(0, bas, zVitre);
  groupe.add(boitier);
  const enseigne = c.texteSur('INTERNET', l * 0.8, 16 * k, { fond: '#4B5563', couleur: '#9BE7C4' });
  enseigne.position.set(0, bas + haut / 2, zVitre + prof / 2 + 0.3);
  groupe.add(enseigne);

  // Tuyau : à l'horizontale depuis le boîtier, puis vers le bas jusqu'à la crépine
  const tuyau = c.materiau('#C8DCE6', { transparent: true, opacite: 0.75 });
  const hautTuyau = bas + 6 * k;
  const crepineY = Math.max(4, altitudeEau(v, a.cy) - 6 * k);
  const horizontal = new THREE.Mesh(new THREE.CylinderGeometry(5 * k, 5 * k, Math.abs(zVitre), 12), tuyau);
  horizontal.rotation.x = Math.PI / 2;
  horizontal.position.set(0, hautTuyau, zVitre / 2);
  const vertical = c.cylindre(5 * k, hautTuyau - crepineY, '#C8DCE6', { transparent: true, opacite: 0.75 });
  vertical.position.y = crepineY;
  const crepine = c.cylindre(8 * k, 10 * k, '#9AA5B1');
  crepine.position.y = crepineY - 5 * k;
  groupe.add(horizontal, vertical, crepine);

  // Cascade de retour (orientée chaque image vers le bord de l'eau) et remous
  const xSortie = l / 2 - 18 * k;
  const cascade = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.5, depthWrite: false }));
  groupe.add(cascade);
  const remous = [];
  for (let i = 0; i < 4; i++) {
    const rond = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 6, 32),
      new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, depthWrite: false }));
    rond.rotation.x = -Math.PI / 2;
    remous.push(rond);
    groupe.add(rond);
  }

  const haloFiltre = halo(c, l * 0.72, 'aeroport');
  groupe.add(haloFiltre);

  groupe.userData.hauteur = vitre + 30 * k;
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    const saturation = ctx.trafic.saturation.get('aeroport') ?? 0;
    boitier.material.color.set(saturation > 0 ? '#C0504F' : '#4B5563');
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    // De la sortie du boîtier jusqu'au bord de l'eau (y de la surface, à l'altitude du niveau)
    const niveau = niveauEau(ctx.ville);
    const z0 = zVitre + prof / 2;
    const z1 = Math.max(z0 + 4, ctx.ville.surface() - a.cy);
    const y0 = bas + haut * 0.3;
    const [dy, dz] = [niveau - y0, z1 - z0];
    cascade.position.set(xSortie, (y0 + niveau) / 2, (z0 + z1) / 2);
    cascade.rotation.x = Math.atan2(-dy, dz);
    cascade.scale.set((16 + 6 * activite) * k, 1.5, Math.hypot(dy, dz));
    cascade.material.opacity = 0.35 + 0.3 * activite;
    remous.forEach((rond, i) => {
      const t = ((temps / (700 - 400 * activite)) + i / remous.length) % 1;
      const r = (6 + t * 24) * k;
      rond.position.set(xSortie, niveau + 0.5, z1);
      rond.scale.set(r, r, r);
      rond.material.opacity = 0.5 * (1 - t);
    });
  };
  return groupe;
}

// ---------- Aquarium : vitres, cadre, eau, récifs ----------

// Volumes fixes, refaits quand le plan change ; l'eau et l'air suivent la RAM à chaque image.
export function extras(v, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  const L = v.largeur;
  const H = v.hauteur;
  const fond = fondDe(v);
  const vitre = hauteurVitre(v);

  // Montants et rebords du cadre, vitres teintées
  for (const [x, z] of [[0, 0], [L, 0], [0, H], [L, H]]) {
    const montant = c.boite(8, vitre, 8, p.cadre);
    montant.position.set(x, 0, z);
    groupe.add(montant);
  }
  const verre = { transparent: true, opacite: 0.12, ombre: false };
  for (const z of [0, H]) {
    for (const y of [0, vitre - 5]) {
      const rebord = c.boite(L + 8, y ? 5 : 6, 8, p.cadre);
      rebord.position.set(L / 2, y, z);
      groupe.add(rebord);
    }
    const vitreLong = c.boite(L, vitre, 2, '#CFEFFF', verre);
    vitreLong.position.set(L / 2, 0, z);
    groupe.add(vitreLong);
  }
  for (const x of [0, L]) {
    for (const y of [0, vitre - 5]) {
      const rebord = c.boite(8, y ? 5 : 6, H + 8, p.cadre);
      rebord.position.set(x, y, H / 2);
      groupe.add(rebord);
    }
    const vitreCote = c.boite(2, vitre, H, '#CFEFFF', verre);
    vitreCote.position.set(x, 0, H / 2);
    groupe.add(vitreCote);
  }
  // Meuble sous l'avant de l'aquarium
  const meuble = c.boite(L + 28, 14, 30, p.cadre);
  meuble.position.set(L / 2, 0, H + 17);
  groupe.add(meuble);

  // Air au-dessus de l'eau (du bord du fond jusqu'à la surface) : voile pâle comme en 2D
  const air = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false }));
  air.rotation.x = -Math.PI / 2;
  // Eau : bloc translucide de la surface au sable, aussi haut que le niveau (la RAM)
  const geoEau = new THREE.BoxGeometry(1, 1, 1);
  geoEau.translate(0, 0.5, 0);
  const eau = new THREE.Mesh(geoEau, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.2, depthWrite: false }));
  const ligne = c.boite(1, 1, 1, '#FFFFFF', { transparent: true, opacite: 0.6, ombre: false, propre: true });
  groupe.add(air, eau, ligne);

  // Règle graduée sur le côté droit : niveau de l'eau = RAM utilisée
  const xRegle = L + 14;
  const zRegle = H - 20;
  const tige = c.cylindre(1.5, vitre, '#FFFFFF', { transparent: true, opacite: 0.7 });
  tige.position.set(xRegle, 0, zRegle);
  groupe.add(tige);
  for (let j = 0; j <= 10; j++) {
    const cran = c.boite(j % 5 ? 6 : 12, 1.2, 2, '#FFFFFF', { ombre: false });
    cran.position.set(xRegle - (j % 5 ? 3 : 6), altitudeEau(v, fond - (fond - 30) * (j / 10)), zRegle);
    groupe.add(cran);
  }
  const repereRam = c.boite(18, 6, 8, '#3FA9E0', { propre: true });
  repereRam.position.set(xRegle, 0, zRegle);
  groupe.add(repereRam);

  groupe.userData.maj = (temps, ctx) => {
    const pal = ctx.palette;
    const surface = v.surface();
    const niveau = niveauEau(v);
    air.material.color.set(ctx.melanger(pal.fond, opaque(ctx, pal.air), alphaDe(pal.air)));
    air.material.opacity = 0.85;
    air.scale.set(L, surface, 1);
    air.position.set(L / 2, 0.6, surface / 2);
    eau.material.color.set(opaque(ctx, pal.eauHaut));
    eau.scale.set(L - 4, niveau, H - surface);
    eau.position.set(L / 2, 0, (surface + H) / 2);
    ligne.scale.set(L - 4, 0.8, 3);
    ligne.position.set(L / 2, niveau, surface);
    const s = v.systeme;
    const ram = s ? s.ram_utilisee / s.ram_totale : 0;
    repereRam.position.y = niveau - 3;
    repereRam.material.color.set(ram > 0.9 ? ROUGE : '#3FA9E0');
  };

  groupe.add(recifs(v, c));
  return groupe;
}

// Récifs des quartiers sur la ligne du sable : rochers teintés, coraux branchus de la couleur du
// quartier et algues qui ondulent (trois mailles instanciées pour tout l'aquarium).
function recifs(v, c) {
  const { THREE } = c;
  const p = c.palette;
  const k = v.echelle ?? 1;
  const fond = fondDe(v);
  const rochers = [];
  const branches = [];
  const algues = [];
  for (const r of v.recifs ?? []) {
    const q = r.quartier;
    const n = Math.max(3, Math.round(r.l / (70 * k)));
    const teinteAlgue = c.melanger('#3FA35B', q.couleur, 0.35);
    for (let i = 0; i < n; i++) {
      const h = hacher(`${q.id}${i}`);
      const x = r.x + (i + 0.5) * (r.l / n) + ((h % 30) - 15);
      rochers.push({ x, rx: (22 + (h % 14)) * k, ry: (14 + (h >>> 4) % 10) * k, couleur: c.melanger(p.roche, q.couleur, 0.25) });
      for (let j = 0; j < 2 + (h % 2); j++) {
        algues.push({ x: x + (-12 + j * 10) * k, z: fond - (4 + (j % 2) * 6) * k, haut: (50 + ((h >>> (j * 3)) % 50)) * 0.55 * k,
          phase: i + j, couleur: teinteAlgue });
      }
      // Corail : chaque branche en deux segments, comme le tracé 2D
      const cx = x + 14 * k;
      for (const [dx, dy] of BRANCHES_CORAIL) {
        const coude = [cx + dx * 0.4 * k, -dy * 0.5 * k];
        const bout = [cx + dx * k, -dy * k];
        branches.push({ de: [cx, 0], a: coude, couleur: q.couleur });
        branches.push({ de: coude, a: bout, couleur: q.couleur });
      }
    }
  }
  const groupe = new THREE.Group();
  if (!rochers.length) return groupe;
  const matrice = new THREE.Matrix4();
  const couleur = new THREE.Color();
  const rot = new THREE.Quaternion();
  const haut = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const taille = new THREE.Vector3();

  const mailleRochers = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshLambertMaterial({ color: '#FFFFFF' }), rochers.length);
  rochers.forEach((r, i) => {
    matrice.makeScale(r.rx, r.ry, r.ry * 1.1);
    matrice.setPosition(r.x, 0, fond - 2 * k);
    mailleRochers.setMatrixAt(i, matrice);
    mailleRochers.setColorAt(i, couleur.set(r.couleur));
  });

  const geoBranche = new THREE.CylinderGeometry(1, 1, 1, 6);
  geoBranche.translate(0, 0.5, 0);
  const mailleCoraux = new THREE.InstancedMesh(geoBranche, new THREE.MeshLambertMaterial({ color: '#FFFFFF' }), branches.length);
  const zCorail = fond - 4 * k;
  branches.forEach((b, i) => {
    const dir = new THREE.Vector3(b.a[0] - b.de[0], b.a[1] - b.de[1], 0);
    const longueur = dir.length();
    rot.setFromUnitVectors(haut, dir.normalize());
    matrice.compose(pos.set(b.de[0], b.de[1], zCorail), rot, taille.set(2 * k, longueur, 2 * k));
    mailleCoraux.setMatrixAt(i, matrice);
    mailleCoraux.setColorAt(i, couleur.set(b.couleur));
  });

  const geoAlgue = new THREE.CylinderGeometry(0.45, 1, 1, 5);
  geoAlgue.translate(0, 0.5, 0);
  const mailleAlgues = new THREE.InstancedMesh(geoAlgue, new THREE.MeshLambertMaterial({ color: '#FFFFFF' }), algues.length);
  mailleAlgues.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mailleAlgues.frustumCulled = false;
  algues.forEach((a, i) => mailleAlgues.setColorAt(i, couleur.set(a.couleur)));
  const euler = new THREE.Euler();
  mailleAlgues.userData.maj = temps => {
    algues.forEach((a, i) => {
      const ondule = Math.sin(temps / 900 + a.phase);
      euler.set(0.12 * Math.cos(temps / 1300 + a.phase), 0, -0.22 * ondule);
      rot.setFromEuler(euler);
      matrice.compose(pos.set(a.x, 0, a.z), rot, taille.set(1.6 * k, a.haut, 1.6 * k));
      mailleAlgues.setMatrixAt(i, matrice);
    });
    mailleAlgues.instanceMatrix.needsUpdate = true;
  };

  for (const m of [mailleRochers, mailleCoraux, mailleAlgues]) {
    m.castShadow = true;
    m.receiveShadow = true;
    groupe.add(m);
  }
  return groupe;
}

// ---------- Perles et bulles (flux) ----------

// Elles voyagent dans l'eau : leur altitude suit leur profondeur, comme celle des poissons.
export function altitudeVehicule(veh, c, p) {
  return altitudeEau(c.ville, p.y);
}
