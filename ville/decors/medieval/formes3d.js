// Formes 3D du « Village médiéval » (vue en relief, voir rendu3d.js) : maisons à colombages au toit
// pentu de la couleur du quartier (taille selon la RAM), chaumières des processus, fumée de cheminée
// (processeur), château à courtine et donjon (processeur et mémoire), bannière qui flotte, greniers à
// blé (disques), port et voiliers sur la rivière (Internet), enceinte crénelée et ses torches, arbres
// et étals du marché. Le sol (prés, champs, rivière, rues, douves) reste celui du rendu 2D.

import { melanger } from '../../rendu3d.js';
import { LOT_L, RUE } from './modele.js';
import { cleCible } from './trafic.js';

const ROUGE = '#E0483E';
const OR = '#F2A541';
const BLEU_RAM = '#3F8FD8';
const TORCHIS = '#F4E8CF';   // couleurs de jour des façades (teintées ensuite selon la lumière)
const BOIS = '#76522F';
const VITRE = '#5A4A38';

const EP = 14;               // épaisseur de la muraille (comme en 2D)
const HAUT_MUR = 24;
const HAUT_TOUR = 36;

// Chaumières (processus) le long des bords de la parcelle : [x, y] depuis le coin haut gauche (comme en 2D).
const CHAUMIERES = [[3, 6], [LOT_L - 13, 6], [3, 22], [LOT_L - 13, 22], [3, 38], [LOT_L - 13, 38]];

// Ciel : brume claire sur la campagne le jour, dorée à l'aube et au crépuscule, bleu nuit la nuit.
export const ciel = p => {
  const o = p.obscurite ?? 0;
  const base = melanger(p.pre, melanger('#D4E4EC', '#151D2E', o), 0.55);
  return melanger(base, '#F0C890', 0.3 * Math.max(0, 1 - Math.abs(o - 0.3) / 0.3));
};

// ---------- Sol ----------

// Les arbres et l'enceinte deviennent des volumes : le sol est le décor 2D sans eux. Les arbres que le
// 2D aurait dessinés (bosquets, parc du château, campagne) sont relevés au passage pour extras().
let arbresSol = [];

export function sol(r2) {
  const arbres = [];
  const remplaces = {
    _arbre: (ctx, x, y, r) => arbres.push([x, y, r]),
    _dessinerEnceinte: () => {},
  };
  Object.assign(r2, remplaces);
  try {
    r2._dessinerDecor();
  } finally {
    for (const nom of Object.keys(remplaces)) delete r2[nom];
  }
  arbresSol = arbres;
  return r2._decor;
}

// ---------- Outils ----------

const css = (c, couleur) => c.melanger(couleur, couleur, 0);   // rgba() → rgb() pour three.js

// Prisme du toit à deux pans : arête le long de x, à la hauteur h ; pignons en second matériau.
function prisme(THREE, l, p, h, pignons = true) {
  const [x, z] = [l / 2, p / 2];
  const A = [-x, 0, -z], B = [x, 0, -z], C = [x, 0, z], D = [-x, 0, z], E = [-x, h, 0], F = [x, h, 0];
  const sommets = [A, E, F, A, F, B, D, C, F, D, F, E, A, D, E, B, F, C];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sommets.flat(), 3));
  geo.computeVertexNormals();
  if (pignons) { geo.addGroup(0, 12, 0); geo.addGroup(12, 6, 1); }
  return geo;
}

// Volume qui ne doit pas capter les clics (halos, lueurs, chemins rougis).
const muet = o => { o.raycast = () => {}; return o; };

// Tache plate posée au sol (halo de saturation, lueur du château), invisible au départ.
function tache(c, rx, rz, couleur, { additif = false, carte = null } = {}) {
  const { THREE } = c;
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({
    color: couleur, map: carte, transparent: true, opacity: 0, depthWrite: false,
    blending: additif ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.7;
  m.scale.set(rx, rz, 1);
  m.renderOrder = 1;
  return muet(m);
}

// Chemin rougi vers un grenier ou le port saturé : bandes posées sur le chemin (points relatifs au groupe).
function cheminRouge(c, points) {
  const { THREE } = c;
  const groupe = new THREE.Group();
  const materiau = new THREE.MeshBasicMaterial({ color: ROUGE, transparent: true, opacity: 0, depthWrite: false });
  for (let i = 1; i < points.length; i++) {
    const [[x1, z1], [x2, z2]] = [points[i - 1], points[i]];
    const [l, p] = [Math.abs(x2 - x1) + 20, Math.abs(z2 - z1) + 20];
    const bande = muet(new THREE.Mesh(new THREE.BoxGeometry(l, 0.3, p), materiau));
    bande.position.set((x1 + x2) / 2, 0.6, (z1 + z2) / 2);
    bande.renderOrder = 1;
    groupe.add(bande);
  }
  groupe.userData.materiau = materiau;
  return groupe;
}

// Dégradé radial blanc → transparent (lueurs), dessiné une fois.
let toileDegrade = null;
function degrade(THREE) {
  if (!toileDegrade) {
    toileDegrade = document.createElement('canvas');
    toileDegrade.width = toileDegrade.height = 64;
    const ctx = toileDegrade.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(toileDegrade);
}

// Créneaux : petits merlons (une seule maille instanciée) aux positions [x, y, z] données.
function creneaux(c, positions, taille, couleur) {
  const { THREE } = c;
  if (!positions.length) return null;
  const geo = new THREE.BoxGeometry(taille, taille, taille);
  geo.translate(0, taille / 2, 0);
  const maille = new THREE.InstancedMesh(geo, c.materiau(couleur), positions.length);
  const m = new THREE.Matrix4();
  positions.forEach(([x, y, z], i) => maille.setMatrixAt(i, m.makeTranslation(x, y, z)));
  maille.castShadow = true;
  maille.receiveShadow = true;
  return maille;
}

// Merlons répartis le long d'un segment, tous les « pas ».
function merlonsLigne(positions, x1, z1, x2, z2, y, pas = 12, garder = () => true) {
  const n = Math.max(1, Math.floor(Math.hypot(x2 - x1, z2 - z1) / pas));
  for (let i = 0; i <= n; i++) {
    const [x, z] = [x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n];
    if (garder(x, z)) positions.push([x, y, z]);
  }
}

// Couronne de merlons au sommet d'une tour ronde.
function merlonsCercle(positions, x, z, r, y, n) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    positions.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]);
  }
}

// ---------- Maisons à colombages (applications) ----------

// Façades : torchis et poutres, fenêtres (éclairées la nuit par la carte d'émission), porte au sud.
// Volets à moitié en veille, clos et porte barrée si le programme est fermé.
function toilesFacade(face, etat) {
  const [L, H] = face === 'cote' ? [40, 40] : [72, 40];
  const creer = () => { const t = document.createElement('canvas'); t.width = L; t.height = H; return t; };
  const image = creer();
  const lumiere = creer();
  const ctx = image.getContext('2d');
  const lum = lumiere.getContext('2d');
  ctx.fillStyle = TORCHIS;
  ctx.fillRect(0, 0, L, H);
  lum.fillStyle = '#000000';
  lum.fillRect(0, 0, L, H);
  // Colombages : sablières, poteaux et croix de Saint-André
  ctx.fillStyle = BOIS;
  ctx.fillRect(0, 0, L, 3);
  ctx.fillRect(0, H - 3, L, 3);
  ctx.fillRect(0, H / 2 - 1, L, 3);
  const travees = face === 'cote' ? 2 : 3;
  for (let k = 0; k <= travees; k++) ctx.fillRect(Math.min(L - 3, (k * L) / travees - 1.5), 0, 3, H);
  ctx.strokeStyle = BOIS;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (face !== 'cote') {
    for (const x0 of [0, (2 * L) / 3]) {
      ctx.moveTo(x0, H / 2); ctx.lineTo(x0 + L / 3, H);
      ctx.moveTo(x0 + L / 3, H / 2); ctx.lineTo(x0, H);
    }
  } else {
    ctx.moveTo(0, H / 2); ctx.lineTo(L, H);
    ctx.moveTo(L, H / 2); ctx.lineTo(0, H);
  }
  ctx.stroke();
  // Fenêtres de l'étage
  const centres = face === 'cote' ? [L / 2] : [L / 6, L / 2, (5 * L) / 6];
  for (const cx of centres) {
    const [fx, fy, fl, fh] = [cx - 6, 7, 12, 11];
    ctx.fillStyle = VITRE;
    ctx.fillRect(fx, fy, fl, fh);
    if (etat === 'actif') {
      lum.fillStyle = '#FFFFFF';
      lum.fillRect(fx + 1, fy + 1, fl - 2, fh - 2);
    } else {
      ctx.fillStyle = '#846342';
      ctx.fillRect(fx - 1, fy - 1, fl + 2, etat === 'ferme' ? fh + 2 : fh / 2 + 1);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(cx - 0.5, fy - 1, 1, etat === 'ferme' ? fh + 2 : fh / 2 + 1);
    }
  }
  // Porte au sud, barrée d'une planche si le programme est fermé
  if (face === 'facade') {
    ctx.fillStyle = '#5E4226';
    ctx.fillRect(L / 2 - 6, H - 17, 12, 14);
    if (etat === 'ferme') {
      ctx.save();
      ctx.translate(L / 2, H - 10);
      ctx.rotate(-0.45);
      ctx.fillStyle = '#B08A5A';
      ctx.fillRect(-10, -1.5, 20, 3);
      ctx.restore();
    }
  }
  return [image, lumiere];
}

// Matériaux des façades, partagés entre toutes les maisons (un par face et par état).
const materiauxMaisons = new Map();
let obscuriteMaisons = -1;

function materiauMaison(c, face, etat) {
  const cle = `${face}|${etat}`;
  let m = materiauxMaisons.get(cle);
  if (!m) {
    const { THREE } = c;
    const [image, lumiere] = toilesFacade(face, etat);
    const carte = new THREE.CanvasTexture(image);
    carte.colorSpace = THREE.SRGBColorSpace;
    const carteLumiere = new THREE.CanvasTexture(lumiere);
    carteLumiere.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshLambertMaterial({ map: carte, emissive: '#FFD36B', emissiveMap: carteLumiere, emissiveIntensity: 0 });
    m.userData.partage = true;
    materiauxMaisons.set(cle, m);
    obscuriteMaisons = -1;
  }
  return m;
}

// Les façades suivent la lumière comme le torchis du 2D ; les fenêtres des programmes actifs s'allument
// au crépuscule (une seule mise à jour par changement de lumière).
function teinterMaisons(c) {
  const o = c.palette.obscurite ?? 0;
  if (Math.abs(o - obscuriteMaisons) < 0.004) return;
  obscuriteMaisons = o;
  const teinte = c.melanger('#FFFFFF', '#7E7A72', o);
  const lumiere = Math.max(0, (o - 0.15) / 0.85);
  for (const [cle, m] of materiauxMaisons) {
    m.color.set(teinte);
    m.emissiveIntensity = cle.endsWith('|actif') ? 1.1 * lumiere : 0;
  }
}

function nbChaumieres(d) {
  const n = d.nb_processus ?? 1;
  return d.etat === 'ferme' ? Math.min(2, n) : Math.min(CHAUMIERES.length, Math.max(0, n - 1));
}

export function cleApplication(lot, c) {
  const d = lot.app.donnees;
  const part = Math.sqrt(Math.min(1, d.ram / c.ramMax));
  return [d.etat, d.alerte ? 1 : 0, Math.round(part * 24), lot.app.quartier.couleur, nbChaumieres(d), c.nuitArrondie].join('|');
}

// Petit « z » de la veille.
let toileZ = null;
function texteZ(THREE) {
  if (!toileZ) {
    toileZ = document.createElement('canvas');
    toileZ.width = toileZ.height = 32;
    const ctx = toileZ.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 26px system-ui, "Segoe UI", sans-serif';
    ctx.fillText('z', 16, 15);
  }
  const t = new THREE.CanvasTexture(toileZ);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const matrice = { m: null };

export function application(lot, c) {
  const { THREE } = c;
  const p = c.palette;
  const app = lot.app;
  const d = app.donnees;
  const ferme = d.etat === 'ferme';
  const veille = d.etat === 'veille';
  const etat = ferme ? 'ferme' : veille ? 'veille' : 'actif';
  const part = Math.sqrt(Math.min(1, d.ram / c.ramMax));
  // Mêmes proportions qu'en 2D (largeur et profondeur selon la RAM), plus la hauteur
  const l = 20 + 20 * part;
  const pr = 14 + 12 * part;
  const hm = 8 + 16 * part;          // murs
  const ht = 6 + 10 * part;          // toit
  let toit = ferme ? p.ferme : c.melanger(app.quartier.couleur, p.fond, (p.obscurite ?? 0) * 0.35);
  if (veille) toit = c.melanger(toit, p.ferme, 0.3);
  const [cx, cy] = [lot.cx ?? lot.x + lot.l / 2, lot.cy ?? lot.y + lot.h / 2];
  const dz = lot.y + 26 - cy;        // la maison est au nord de sa parcelle, la ruelle au sud
  const groupe = new THREE.Group();

  // Corps de la maison : colombages, porte au sud
  const cote = materiauMaison(c, 'cote', etat);
  const geo = new THREE.BoxGeometry(l, hm, pr);
  geo.translate(0, hm / 2, 0);
  const corps = new THREE.Mesh(geo, [cote, cote, cote, cote, materiauMaison(c, 'facade', etat), materiauMaison(c, 'dos', etat)]);
  corps.castShadow = corps.receiveShadow = true;
  corps.position.z = dz;
  groupe.add(corps);

  // Toit pentu à deux pans, de la couleur du quartier (gris si fermé)
  const comble = new THREE.Mesh(prisme(THREE, l + 3, pr + 4, ht), [c.materiau(css(c, toit)), c.materiau(css(c, p.torchis))]);
  comble.castShadow = comble.receiveShadow = true;
  comble.position.set(0, hm, dz);
  groupe.add(comble);

  // Cheminée (côté est, pan nord)
  const [xc, zc] = [l / 2 - 6, dz - pr / 4];
  const hc = ht * 0.8 + 6;
  const cheminee = c.boite(4, hc, 4, ferme ? css(c, p.ferme) : '#9A6B4E');
  cheminee.position.set(xc, hm, zc);
  groupe.add(cheminee);
  const sommet = hm + hc;

  // Chaumières des processus, au toit de chaume (deux mailles instanciées)
  const n = nbChaumieres(d);
  if (n) {
    const m = (matrice.m ??= new THREE.Matrix4());
    const geoMur = new THREE.BoxGeometry(10, 4, 9);
    geoMur.translate(0, 2, 0);
    const murs = new THREE.InstancedMesh(geoMur, c.materiau(css(c, ferme ? p.ferme : p.torchis)), n);
    const toits = new THREE.InstancedMesh(prisme(THREE, 11, 10.5, 4.5, false), c.materiau(css(c, ferme ? p.ferme : p.chaume)), n);
    for (let i = 0; i < n; i++) {
      const [hx, hy] = CHAUMIERES[i];
      const [x, z] = [lot.x + hx + 5 - cx, lot.y + hy + 4.5 - cy];
      murs.setMatrixAt(i, m.makeTranslation(x, 0, z));
      toits.setMatrixAt(i, m.makeTranslation(x, 4, z));
    }
    for (const o of [murs, toits]) { o.castShadow = o.receiveShadow = true; groupe.add(o); }
  }

  const hauteur = hm + ht;
  groupe.userData.hauteur = hauteur;
  if (d.alerte) groupe.add(c.epingle(hauteur + 10));
  if (ferme) {
    groupe.userData.maj = (temps, ctx) => teinterMaisons(ctx);
    return groupe;
  }

  // Fumée de cheminée : des bouffées qui montent et s'élargissent, plus nombreuses et plus rapides
  // quand le processeur travaille.
  const fumee = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), c.materiau('#EBEBEB', { transparent: true, opacite: 0.6 }), 5);
  fumee.count = 0;
  fumee.frustumCulled = false;
  muet(fumee);
  groupe.add(fumee);
  let fumeeNuit = null;

  // « z » de la veille
  let z = null;
  if (veille) {
    z = muet(new THREE.Sprite(new THREE.SpriteMaterial({ map: texteZ(THREE), color: css(c, p.texte), transparent: true, depthWrite: false })));
    groupe.add(z);
  }

  const decal = (((cx * 7 + cy * 13) % 1000) + 1000) % 1000;
  groupe.userData.maj = (temps, ctx) => {
    teinterMaisons(ctx);
    const dd = app.donnees;
    const nuit = (ctx.palette.obscurite ?? 0) > 0.5;
    if (nuit !== fumeeNuit) {
      fumeeNuit = nuit;
      fumee.material = ctx.materiau(nuit ? '#AAAAB4' : '#EBEBEB', { transparent: true, opacite: 0.6 });
    }
    const nb = dd.etat !== 'veille' && dd.cpu > 0.3 ? 1 + Math.min(4, Math.floor(dd.cpu / 6)) : 0;
    fumee.count = nb;
    if (nb) {
      const m = matrice.m ?? (matrice.m = new THREE.Matrix4());
      const periode = 1800 - Math.min(1000, dd.cpu * 25);
      for (let i = 0; i < nb; i++) {
        const t = (temps / periode + i / nb + decal / 1000) % 1;
        const r = (2 + t * 5) * (t > 0.75 ? (1 - t) / 0.25 : 1);
        m.makeScale(r, r, r);
        m.setPosition(xc + Math.sin(t * 5 + i) * 3 + t * 6, sommet + 2 + t * 26, zc);
        fumee.setMatrixAt(i, m);
      }
      fumee.instanceMatrix.needsUpdate = true;
    }
    if (z) {
      const t = ((temps + decal * 3) / 2400) % 1;
      z.material.opacity = 1 - t;
      z.position.set(xc + 4 + t * 6, sommet + 6 + t * 14, zc);
      const s = 8 + t * 5;
      z.scale.set(s, s, 1);
    }
  };
  return groupe;
}

// ---------- Château (processeur et mémoire) ----------

// Courtine carrée et tours d'angle, donjon rond au centre. La courtine se couvre de bleu à mesure que
// la mémoire se remplit (départ au milieu du côté nord, sens des aiguilles d'une montre, rouge au-delà de
// 90 %) ; l'anneau orange du donjon est le processeur, et la bannière flotte d'autant plus vite qu'il
// travaille. Une lueur dorée monte autour du château avec le processeur.
export function tour(t, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  const [L, H] = [200, 180];
  const HC = 30;                     // hauteur de la courtine
  const R = 46;                      // rayon du donjon
  const HD = 72;                     // hauteur du donjon
  const mur = css(c, p.mur);
  const murClair = css(c, p.murClair);
  const merlons = [];

  const lueur = tache(c, 1, 1, OR, { additif: true, carte: degrade(THREE) });
  groupe.add(lueur);

  // Courtine
  for (const [x, z, l, pr] of [[0, -H / 2, L + EP, EP], [0, H / 2, L + EP, EP], [-L / 2, 0, EP, H], [L / 2, 0, EP, H]]) {
    const pan = c.boite(l, HC, pr, mur);
    pan.position.set(x, 0, z);
    groupe.add(pan);
  }
  const exterieur = 5;
  merlonsLigne(merlons, -L / 2, -H / 2 - exterieur, L / 2, -H / 2 - exterieur, HC);
  merlonsLigne(merlons, -L / 2, H / 2 + exterieur, L / 2, H / 2 + exterieur, HC);
  merlonsLigne(merlons, -L / 2 - exterieur, -H / 2, -L / 2 - exterieur, H / 2, HC);
  merlonsLigne(merlons, L / 2 + exterieur, -H / 2, L / 2 + exterieur, H / 2, HC);
  // Porte du château, au sud
  const porte = c.boite(28, 18, 4, css(c, p.bois));
  porte.position.z = H / 2 + EP / 2;
  groupe.add(porte);

  // Bande de la mémoire sur le chemin de ronde (5 tronçons étirés selon le remplissage)
  const contour = [[0, -H / 2], [L / 2, -H / 2], [L / 2, H / 2], [-L / 2, H / 2], [-L / 2, -H / 2], [0, -H / 2]];
  const interieur = [[0, 1], [-1, 0], [0, -1], [1, 0], [0, 1]];
  const materiauRam = new THREE.MeshLambertMaterial({ color: BLEU_RAM, emissive: BLEU_RAM, emissiveIntensity: 0.35 });
  const geoBande = new THREE.BoxGeometry(1, 1, 1);
  geoBande.translate(0, 0.5, 0);
  const troncons = interieur.map(() => {
    const m = new THREE.Mesh(geoBande, materiauRam);
    m.position.y = HC;
    m.visible = false;
    groupe.add(m);
    return m;
  });

  // Tours d'angle
  for (const [x, z] of [[-L / 2, -H / 2], [L / 2, -H / 2], [-L / 2, H / 2], [L / 2, H / 2]]) {
    const t2 = c.cylindre(20, 44, mur, { faces: 24 });
    t2.position.set(x, 0, z);
    const toit = c.cylindre(16, 0.6, murClair, { faces: 24, ombre: false });
    toit.position.set(x, 44, z);
    groupe.add(t2, toit);
    merlonsCercle(merlons, x, z, 17, 44, 8);
  }

  // Donjon : merlons tout autour, anneau du processeur sur la terrasse
  const donjon = c.cylindre(R, HD, mur, { faces: 40 });
  const terrasse = c.cylindre(R - 6, 0.6, murClair, { faces: 40, ombre: false });
  terrasse.position.y = HD;
  groupe.add(donjon, terrasse);
  merlonsCercle(merlons, 0, 0, R - 3, HD, 14);
  const fondCpu = new THREE.Mesh(new THREE.TorusGeometry(R - 15, 2.6, 8, 64), c.materiau('#FFFFFF', { transparent: true, opacite: 0.3 }));
  fondCpu.rotation.x = -Math.PI / 2;
  fondCpu.position.y = HD + 2;
  groupe.add(fondCpu);
  const materiauCpu = new THREE.MeshLambertMaterial({ color: OR, emissive: OR, emissiveIntensity: 0.4 });
  let arcCpu = null;
  let cleCpu = '';

  groupe.add(creneaux(c, merlons, 6, murClair));

  // Bannière sur son mât (nord-est de la terrasse) : un drapeau qui ondule
  const [mx, mz] = [R * 0.55, -R * 0.62];
  const mat = c.cylindre(0.9, 36, '#4A3A2A', { faces: 8 });
  mat.position.set(mx, HD, mz);
  groupe.add(mat);
  const geoDrapeau = new THREE.PlaneGeometry(30, 12, 10, 1);
  geoDrapeau.translate(15, -6, 0);
  const base = Float32Array.from(geoDrapeau.attributes.position.array);
  const materiauDrapeau = new THREE.MeshLambertMaterial({ color: OR, side: THREE.DoubleSide });
  const drapeau = new THREE.Mesh(geoDrapeau, materiauDrapeau);
  drapeau.position.set(mx, HD + 36, mz);
  drapeau.castShadow = true;
  groupe.add(drapeau);

  groupe.userData.hauteur = HD + 20;
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    if (!s) return;
    const cpu = Math.max(0, Math.min(1, s.cpu / 100));
    const ram = Math.max(0.01, Math.min(1, s.ram_utilisee / s.ram_totale));

    // Lueur dorée
    lueur.visible = cpu > 0.05;
    lueur.material.opacity = 0.12 + 0.35 * cpu;
    const r = 120 + 60 * cpu;
    lueur.scale.set(r, r, 1);

    // Mémoire : tronçons de la bande, le long du contour
    materiauRam.color.set(ram > 0.9 ? ROUGE : BLEU_RAM);
    materiauRam.emissive.set(ram > 0.9 ? ROUGE : BLEU_RAM);
    let reste = (2 * L + 2 * H) * ram;
    troncons.forEach((m, i) => {
      const [[x1, z1], [x2, z2]] = [contour[i], contour[i + 1]];
      const longueur = Math.hypot(x2 - x1, z2 - z1);
      const part = Math.max(0, Math.min(1, reste / longueur));
      reste -= longueur;
      m.visible = part > 0;
      if (!m.visible) return;
      const [ex, ez] = [x1 + (x2 - x1) * part, z1 + (z2 - z1) * part];
      const [nx, nz] = interieur[i];
      m.position.x = (x1 + ex) / 2 + nx * 2;
      m.position.z = (z1 + ez) / 2 + nz * 2;
      m.scale.set(Math.max(7, Math.abs(ex - x1)), 2.5, Math.max(7, Math.abs(ez - z1)));
    });

    // Processeur : arc orange (rouge au-delà de 90 %), refait quand le pourcentage change
    const cle = `${Math.round(cpu * 100)}`;
    if (cle !== cleCpu) {
      cleCpu = cle;
      if (arcCpu) { groupe.remove(arcCpu); arcCpu.geometry.dispose(); }
      arcCpu = new THREE.Mesh(new THREE.TorusGeometry(R - 15, 3, 8, 64, Math.max(0.02, cpu) * Math.PI * 2), materiauCpu);
      // Départ en haut (nord), sens des aiguilles d'une montre vu du ciel, comme en 2D.
      arcCpu.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
      arcCpu.position.y = HD + 2;
      groupe.add(arcCpu);
      const couleur = cpu > 0.9 ? ROUGE : OR;
      materiauCpu.color.set(couleur);
      materiauCpu.emissive.set(couleur);
      materiauDrapeau.color.set(couleur);
    }

    // Bannière : ondule plus vite avec le processeur
    const phase = temps * (0.003 + 0.02 * cpu);
    const pos = geoDrapeau.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const k = x / 30;
      pos.setY(i, base[i * 3 + 1] + (base[i * 3 + 1] < -6 ? -4 * k : 0));
      pos.setZ(i, Math.sin(phase + k * 4) * 3 * k);
    }
    pos.needsUpdate = true;
    geoDrapeau.computeVertexNormals();
  };
  return groupe;
}

// ---------- Greniers à blé (disques) ----------

// Grange de bois ouverte, charpente apparente : le tas de grain monte avec l'espace utilisé (doré,
// rouge au-delà de 90 %). Halo rouge et chemin rougi si le disque sature.
export function entrepot(e, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  const [L, H, HM, ep] = [e.l, e.h, 30, 7];
  const bois = css(c, p.bois);
  for (const [x, z, l, pr] of [[0, -H / 2 + ep / 2, L, ep], [0, H / 2 - ep / 2, L, ep], [-L / 2 + ep / 2, 0, ep, H - 2 * ep], [L / 2 - ep / 2, 0, ep, H - 2 * ep]]) {
    const pan = c.boite(l, HM, pr, bois);
    pan.position.set(x, 0, z);
    groupe.add(pan);
  }
  const [il, ih] = [L - 2 * ep, H - 2 * ep];
  groupe.add(c.boite(il, 1, ih, c.eclaircir(bois, 0.25)));
  const geoGrain = new THREE.BoxGeometry(il - 1, 1, ih - 1);
  geoGrain.translate(0, 0.5, 0);
  const grain = new THREE.Mesh(geoGrain, new THREE.MeshLambertMaterial({ color: '#E8BE4E' }));
  grain.castShadow = grain.receiveShadow = true;
  groupe.add(grain);
  // Poutres de la charpente
  for (const x of [-il / 4, 0, il / 4]) {
    const poutre = c.boite(3, 3, H, c.eclaircir(bois, -0.3));
    poutre.position.set(x, HM, 0);
    groupe.add(poutre);
  }
  // Enseigne au nom du disque, sur le mur sud
  const enseigne = c.texteSur(e.disque.nom, 40, 10, { fond: '#F4E8CF', couleur: '#3C2F22' });
  enseigne.position.set(0, HM * 0.5, H / 2 + 0.3);
  groupe.add(enseigne);

  // Saturation : halo et chemin rougi depuis la porte sud
  const cle = cleCible({ type: 'entrepot', entrepot: e });
  const halo = tache(c, 80, 62, ROUGE);
  groupe.add(halo);
  const v = c.ville;
  const en = v.enceinte;
  const chemin = en ? cheminRouge(c, [[0, en.y + en.h], [0, v.routeGreniers], [e.cx, v.routeGreniers], [e.cx, e.y + 10]]
    .map(([x, y]) => [x - e.cx, y - e.cy])) : null;
  if (chemin) groupe.add(chemin);

  groupe.userData.hauteur = HM + 8;
  groupe.userData.maj = (temps, ctx, o) => {
    const d = (o.userData.entrepot ?? e).disque;
    const rempli = d.total ? Math.max(0, Math.min(1, d.utilise / d.total)) : 0;
    grain.scale.y = 2 + 26 * Math.max(0.04, rempli);
    grain.material.color.set(rempli > 0.9 ? ROUGE : '#E8BE4E');
    const saturation = ctx.trafic.saturation.get(cle) ?? 0;
    const pulse = 0.5 + 0.5 * Math.sin(temps / 250);
    halo.material.opacity = saturation > 0 ? 0.18 + 0.25 * saturation * pulse : 0;
    if (chemin) chemin.userData.materiau.opacity = saturation > 0 ? 0.25 + 0.25 * saturation * pulse : 0;
  };
  return groupe;
}

// ---------- Port (Internet) ----------

function voilier(c, couleurVoile) {
  const { THREE } = c;
  const p = c.palette;
  const bateau = new THREE.Group();
  const coque = c.boite(22, 4, 9, css(c, p.bois));
  const proue = c.boite(6, 4, 6, css(c, p.bois));
  proue.position.x = 11;
  proue.rotation.y = Math.PI / 4;
  const mat = c.cylindre(0.6, 22, '#4A3A2A', { faces: 6 });
  mat.position.y = 4;
  const geoVoile = new THREE.BufferGeometry();
  geoVoile.setAttribute('position', new THREE.Float32BufferAttribute([0, 7, 0, -1, 25, 0, -13, 7, 0], 3));
  geoVoile.computeVertexNormals();
  const voile = new THREE.Mesh(geoVoile, new THREE.MeshLambertMaterial({ color: couleurVoile, side: THREE.DoubleSide }));
  voile.castShadow = true;
  const fanion = c.boite(4, 2, 0.6, '#4FB860');
  fanion.position.set(2, 24, 0);
  bateau.add(coque, proue, mat, voile, fanion);
  return bateau;
}

// Ponton de bois sur la berge, voilier amarré, voiliers qui vont et viennent sur la rivière, plus
// nombreux et plus rapides quand le réseau travaille. Halo et chemin rougi si la connexion sature.
export function internet(a, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  const bois = css(c, p.bois);
  const pilotis = c.eclaircir(bois, -0.3);
  const ponton = c.boite(100, 2, 16, bois);
  ponton.position.set(0, 2.5, 2);
  const jetee = c.boite(20, 2, 40, bois);
  jetee.position.set(0, 2.5, -20);
  groupe.add(ponton, jetee);
  for (const [x, z] of [[-48, -4], [48, -4], [-48, 8], [48, 8], [-9, -38], [9, -38], [-9, -20], [9, -20]]) {
    const pieu = c.cylindre(1.4, 5, pilotis, { faces: 6 });
    pieu.position.set(x, 0, z);
    groupe.add(pieu);
  }
  const amarre = voilier(c, '#EDE6D6');
  amarre.position.set(30, 0, -26);
  groupe.add(amarre);

  const voiles = ['#F4EEDC', '#E8DCC0', '#F6E3B0'];
  const flotte = Array.from({ length: 6 }, (_, i) => {
    const b = voilier(c, voiles[i % 3]);
    b.visible = false;
    groupe.add(b);
    return b;
  });

  const halo = tache(c, 110, 60, ROUGE);
  halo.position.z = -10;
  groupe.add(halo);
  const en = c.ville.enceinte;
  const chemin = en ? cheminRouge(c, [[0, en.y - a.cy], [0, 0]]) : null;
  if (chemin) groupe.add(chemin);

  groupe.userData.hauteur = 30;
  groupe.userData.maj = (temps, ctx) => {
    const v = ctx.ville;
    const s = v.systeme;
    const b = v.bornes;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    const n = 2 + Math.round(activite * 4);
    const course = b.l + 400;
    flotte.forEach((bateau, i) => {
      bateau.visible = i < n;
      if (!bateau.visible) return;
      const sens = i % 2 ? 1 : -1;
      const vitesse = 0.012 + 0.03 * activite;
      const x = b.x - 200 + ((((temps * vitesse * sens) + i * 397) % course) + course) % course;
      bateau.position.set(x - a.cx, 0, v.riviere + (sens > 0 ? 14 : -14) - a.cy);
      bateau.rotation.y = sens > 0 ? 0 : Math.PI;
    });
    const saturation = ctx.trafic.saturation.get('aeroport') ?? 0;
    const pulse = 0.5 + 0.5 * Math.sin(temps / 250);
    halo.material.opacity = saturation > 0 ? 0.18 + 0.25 * saturation * pulse : 0;
    if (chemin) chemin.userData.materiau.opacity = saturation > 0 ? 0.25 + 0.25 * saturation * pulse : 0;
  };
  return groupe;
}

// ---------- Enceinte, arbres et marché ----------

// Tours de l'enceinte : aux angles, puis environ toutes les 260 px (comme en 2D).
function toursEnceinte(e) {
  const tours = [[e.x, e.y], [e.x + e.l, e.y], [e.x, e.y + e.h], [e.x + e.l, e.y + e.h]];
  const nx = Math.max(1, Math.round(e.l / 260));
  const ny = Math.max(1, Math.round(e.h / 260));
  for (let i = 1; i < nx; i++) {
    const x = e.x + (e.l * i) / nx;
    if (Math.abs(x) < 60) continue;   // laisse la place des portes
    tours.push([x, e.y], [x, e.y + e.h]);
  }
  for (let i = 1; i < ny; i++) tours.push([e.x, e.y + (e.h * i) / ny], [e.x + e.l, e.y + (e.h * i) / ny]);
  return tours;
}

function enceinte(v, c) {
  const { THREE } = c;
  const p = c.palette;
  const e = v.enceinte;
  const groupe = new THREE.Group();
  const mur = css(c, p.mur);
  const murClair = css(c, p.murClair);
  const merlons = [];
  const porte = RUE / 2;

  // Muraille, ouverte au nord et au sud pour les portes
  const pan = (x1, z1, x2, z2) => {
    const horizontal = z1 === z2;
    const m = c.boite(horizontal ? Math.abs(x2 - x1) : EP, HAUT_MUR, horizontal ? EP : Math.abs(z2 - z1), mur);
    m.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
    groupe.add(m);
  };
  for (const y of [e.y, e.y + e.h]) {
    pan(e.x - EP / 2, y, -porte, y);
    pan(porte, y, e.x + e.l + EP / 2, y);
  }
  pan(e.x, e.y, e.x, e.y + e.h);
  pan(e.x + e.l, e.y, e.x + e.l, e.y + e.h);

  // Créneaux sur le bord extérieur (rien devant les portes)
  const horsPorte = x => Math.abs(x) > porte + 4;
  const bord = EP / 2 - 3;
  merlonsLigne(merlons, e.x - bord, e.y - bord, e.x + e.l + bord, e.y - bord, HAUT_MUR, 12, horsPorte);
  merlonsLigne(merlons, e.x - bord, e.y + e.h + bord, e.x + e.l + bord, e.y + e.h + bord, HAUT_MUR, 12, horsPorte);
  merlonsLigne(merlons, e.x - bord, e.y - bord, e.x - bord, e.y + e.h + bord, HAUT_MUR);
  merlonsLigne(merlons, e.x + e.l + bord, e.y - bord, e.x + e.l + bord, e.y + e.h + bord, HAUT_MUR);

  // Tours rondes et portes (deux tours et un linteau au-dessus du passage des charrettes)
  const feux = [];
  for (const [x, z] of toursEnceinte(e)) {
    const t = c.cylindre(17, HAUT_TOUR, mur, { faces: 20 });
    t.position.set(x, 0, z);
    groupe.add(t);
    merlonsCercle(merlons, x, z, 14, HAUT_TOUR, 8);
    feux.push([x, HAUT_TOUR, z]);
  }
  for (const y of [e.y, e.y + e.h]) {
    for (const s of [-1, 1]) {
      const t = c.cylindre(15, HAUT_TOUR + 4, mur, { faces: 20 });
      t.position.set(s * (porte + 12), 0, y);
      groupe.add(t);
      merlonsCercle(merlons, s * (porte + 12), y, 12, HAUT_TOUR + 4, 8);
      feux.push([s * (porte + 12), HAUT_TOUR + 4, y]);
    }
    const linteau = c.boite(RUE + 8, 8, EP + 2, murClair);
    linteau.position.set(0, HAUT_MUR, y);
    const herse = c.boite(RUE, 2, 3, css(c, p.bois));
    herse.position.set(0, HAUT_MUR - 2, y);
    groupe.add(linteau, herse);
  }
  groupe.add(creneaux(c, merlons, 5, murClair));

  // Torches : flammes et lueurs qui s'allument au crépuscule
  const geoFlamme = new THREE.BoxGeometry(2.4, 5, 2.4);
  geoFlamme.translate(0, 2.5, 0);
  const materiauFlamme = new THREE.MeshLambertMaterial({ color: '#FFE08A', emissive: '#FFB347', emissiveIntensity: 0 });
  const flammes = muet(new THREE.InstancedMesh(geoFlamme, materiauFlamme, feux.length));
  const m = new THREE.Matrix4();
  feux.forEach(([x, y, z], i) => flammes.setMatrixAt(i, m.makeTranslation(x, y, z)));
  const geoLueurs = new THREE.BufferGeometry();
  geoLueurs.setAttribute('position', new THREE.Float32BufferAttribute(feux.flatMap(([x, y, z]) => [x, y + 4, z]), 3));
  const lueurs = muet(new THREE.Points(geoLueurs, new THREE.PointsMaterial({
    size: 70, map: degrade(THREE), color: '#FFB347', transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  })));
  groupe.add(flammes, lueurs);
  lueurs.userData.maj = (temps, ctx) => {
    const o = ctx.palette.obscurite ?? 0;
    const allume = o >= 0.25;
    flammes.visible = lueurs.visible = allume;
    if (!allume) return;
    const f = 0.75 + 0.25 * Math.sin(temps / 110);
    materiauFlamme.emissiveIntensity = 1.2 * o * f;
    lueurs.material.opacity = 0.5 * o * f;
  };
  return groupe;
}

// Arbres ronds sur un tronc court, là où le 2D les dessine (une maille instanciée pour les feuillages,
// une pour les troncs). Teinte variée entre les deux verts de la palette.
function arbres(c) {
  const { THREE } = c;
  const p = c.palette;
  const liste = arbresSol;
  if (!liste.length) return null;
  const groupe = new THREE.Group();
  const feuillages = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshLambertMaterial({ color: '#FFFFFF' }), liste.length);
  const geoTronc = new THREE.CylinderGeometry(1, 1, 1, 6);
  geoTronc.translate(0, 0.5, 0);
  const troncs = new THREE.InstancedMesh(geoTronc, c.materiau(css(c, p.bois)), liste.length);
  const m = new THREE.Matrix4();
  const couleur = new THREE.Color();
  const [fonce, clair] = [css(c, p.arbre), css(c, p.arbreClair)];
  liste.forEach(([x, y, r], i) => {
    const tronc = r * 0.5;
    m.makeScale(r * 0.14, tronc + 2, r * 0.14);
    m.setPosition(x, 0, y);
    troncs.setMatrixAt(i, m);
    m.makeScale(r, r * 0.9, r);
    m.setPosition(x, tronc + r * 0.8, y);
    feuillages.setMatrixAt(i, m);
    const k = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    feuillages.setColorAt(i, couleur.set(c.melanger(fonce, clair, Math.abs(k) * 0.7)));
  });
  for (const o of [feuillages, troncs]) { o.castShadow = o.receiveShadow = true; groupe.add(o); }
  return groupe;
}

// Place du marché (cases libres) : puits et étals à toile colorée, aux places du 2D.
function marches(v, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  const couleurs = ['#D9534F', '#4A90C2', '#E8B23A', '#5BAA5B'];
  for (const z of v.cases ?? []) {
    if (z.quartier) continue;
    const [cx, cy] = [z.x + z.l / 2, z.y + z.h / 2];
    const margelle = c.cylindre(13, 7, css(c, p.mur), { faces: 20 });
    const eau = c.cylindre(8, 7.3, css(c, p.eau), { faces: 20, ombre: false });
    margelle.position.set(cx, 0, cy);
    eau.position.set(cx, 0, cy);
    groupe.add(margelle, eau);
    const n = Math.max(2, Math.min(6, Math.floor(z.l / 70)));
    for (let i = 0; i < n; i++) {
      for (const [y, k] of [[z.y + 16, i], [z.y + z.h - 40, i + 1]]) {
        if (y < z.y + 4 || y + 24 > z.y + z.h) continue;
        const x = z.x + (z.l - n * 50) / 2 + i * 50 + 6;
        const etal = c.boite(30, 7, 8, '#E9DCC0');
        etal.position.set(x + 17, 0, y + 15);
        const toile = c.boite(34, 1.5, 22, couleurs[k % couleurs.length]);
        toile.position.set(x + 17, 13, y + 11);
        toile.rotation.x = 0.12;
        groupe.add(etal, toile);
        for (const dx of [2, 32]) {
          const poteau = c.cylindre(0.8, 13, css(c, p.bois), { faces: 6 });
          poteau.position.set(x + dx, 0, y + 21);
          groupe.add(poteau);
        }
      }
    }
  }
  return groupe;
}

export function extras(v, c) {
  if (!v.enceinte) return null;
  const groupe = new c.THREE.Group();
  groupe.add(enceinte(v, c));
  const bois = arbres(c);
  if (bois) groupe.add(bois);
  groupe.add(marches(v, c));
  return groupe;
}
