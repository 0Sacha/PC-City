// Formes 3D du décor « Fourmilière » (vue en relief, voir rendu3d.js).
//
// Le 2D est une coupe de côté ; la 3D la couche sur le sol, comme une ferme à fourmis posée à plat
// dont on aurait ôté la vitre : on regarde la fourmilière par-dessus, comme un chantier de fouilles.
// Le haut de la coupe (y < 0, le ciel) devient la prairie, avec ses brins d'herbe ; dessous, les
// couches de terre s'assombrissent en s'éloignant de la surface, et les galeries y sont creusées.
// Les chambres deviennent des cuvettes : un bourrelet de terre déblayée autour d'un fond clair où
// travaillent les fourmis. La reine est un volume (abdomen énorme et rayé, thorax, tête, pattes,
// antennes) couchée dans sa grande chambre, entourée de ses œufs et de l'anneau de la RAM. Les
// réserves (disques) sont des cuvettes où monte un tas de graines ; l'entrée (Internet) est un
// monticule de terre percé d'un trou, avec son halo vert. Les fourmis porteuses remplacent les
// véhicules : elles sont dessinées ici (formes.dynamique) avec leur charge colorée, et grimpent le
// monticule jusqu'au trou.

import { hacher, segmentPuits, REINE } from './modele.js';
import { GABARITS, ZONE_BOUCHON, cleCible } from './trafic.js';

const ROUGE = '#E8504F';
const COUCHE = 170;               // épaisseur d'une couche de terre (comme en 2D)
const MARGE_SOL = 0.2;            // comme rendu3d.js : le sol déborde des bornes de cette part
const MONTICULE = { x: 0, y: -30, rx: 64, ry: 44, haut: 24 };   // entrée (Internet)
const MAX_FOURMIS = 700;          // porteuses et ouvrières des chambres, toutes ensemble
const ECHELLE_FOURMI = 1.25;      // un peu plus grosses qu'en 2D, pour se lire en relief
const MAX_OEUFS = 22;

// Au-delà de la carte : la terre profonde (on est sous terre).
export const ciel = p => p.terre4;

export function cleApplication(lot, c) {
  const d = lot.app.donnees;
  const alveoles = Math.min(12, Math.max(0, (d.nb_processus ?? 1) - 1));
  return [d.etat, d.alerte ? 1 : 0, Math.round(lot.rx), lot.quartier.couleur, alveoles, c.nuitArrondie].join('|');
}

// ---------- Outils ----------

// Couleur CSS opaque (les palettes interpolées sont en rgba, que three.js n'aime pas).
function css(couleur) {
  const m = couleur.startsWith('#')
    ? (n => [(n >> 16) & 255, (n >> 8) & 255, n & 255])(parseInt(couleur.slice(1, 7), 16))
    : couleur.match(/[\d.]+/g).slice(0, 3).map(Number);
  return `rgb(${m.map(Math.round).join(',')})`;
}

// Matériaux de terre vus des deux côtés (cuvettes, monticule), partagés par couleur.
const materiauxTerre = new Map();
function terre(c, couleur) {
  const cle = css(couleur);
  let m = materiauxTerre.get(cle);
  if (!m) {
    if (materiauxTerre.size > 200) materiauxTerre.clear();
    m = new c.THREE.MeshLambertMaterial({ color: new c.THREE.Color(cle), side: c.THREE.DoubleSide });
    m.userData.partage = true;   // rendu3d.js ne le libère pas avec un volume
    materiauxTerre.set(cle, m);
  }
  return m;
}

function generateur(graine) {
  return () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
}

// Cuvette elliptique : bourrelet de terre déblayée (pente douce dehors, plus raide dedans) et fond plat.
// Renvoie le groupe, son fond (pour la lueur) et la hauteur de la crête.
function cuvette(c, rx, ry, haut, couleurMur, materiauFond) {
  const { THREE } = c;
  const groupe = new THREE.Group();
  const pied = 1 + (3 + 1.3 * haut) / rx;
  const profil = [[pied, 0], [1 + 1.5 / rx, haut], [1, haut * 0.72], [1 - 1 / rx, 0.3]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const mur = new THREE.Mesh(new THREE.LatheGeometry(profil, 56), terre(c, couleurMur));
  mur.scale.set(rx, 1, ry);
  mur.castShadow = mur.receiveShadow = true;
  const geoFond = new THREE.CircleGeometry(1, 48);
  geoFond.rotateX(-Math.PI / 2);
  const fond = new THREE.Mesh(geoFond, materiauFond);
  fond.scale.set(rx, 1, ry);
  fond.position.y = 0.35;
  fond.receiveShadow = true;
  groupe.add(mur, fond);
  return { groupe, fond, crete: haut, pied };
}

// Tube posé le long d'une ellipse (crête d'une chambre, anneau de la RAM). Départ au nord, sens des
// aiguilles d'une montre vu du ciel, comme en 2D ; « part » de 0 à 1.
function arcEllipse(THREE, rx, ry, rayon, part, y) {
  const ferme = part >= 0.999;
  const n = Math.max(8, Math.round(72 * part));
  const points = [];
  for (let i = 0; i < (ferme ? n : n + 1); i++) {
    const a = (part * Math.PI * 2 * i) / n;
    points.push(new THREE.Vector3(Math.sin(a) * rx, y, -Math.cos(a) * ry));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, ferme), n * 2, rayon, 6, ferme);
}

// Disque plat elliptique posé au sol (halos de saturation).
function nappe(THREE, rx, ry, materiau, y = 0.5) {
  const geo = new THREE.CircleGeometry(1, 48);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, materiau);
  m.scale.set(rx, 1, ry);
  m.position.y = y;
  return m;
}

function rougeTransparent(THREE) {
  return new THREE.MeshBasicMaterial({ color: ROUGE, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
}

// Cylindre fin d'un point à un autre (pattes et antennes de la reine).
function segment(THREE, a, b, rayon, materiau) {
  const [va, vb] = [new THREE.Vector3(...a), new THREE.Vector3(...b)];
  const dir = vb.clone().sub(va);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rayon * 0.8, rayon, dir.length(), 8), materiau);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

// Hauteur du monticule de l'entrée en un point du plan (les fourmis le gravissent).
function altitudeMonticule(x, y) {
  const d = Math.hypot((x - MONTICULE.x) / MONTICULE.rx, (y - MONTICULE.y) / MONTICULE.ry);
  return d < 1 ? MONTICULE.haut * Math.pow(1 - d * d, 1.2) : 0;
}

// « z » du sommeil : texture partagée, deux matériaux partagés (deux phases de l'animation).
let texteZ = null;
const materiauxZ = [];
function spriteZ(c) {
  const { THREE } = c;
  if (!texteZ) {
    const toile = document.createElement('canvas');
    toile.width = toile.height = 64;
    const ctx = toile.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 54px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('z', 32, 30);
    texteZ = new THREE.CanvasTexture(toile);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.SpriteMaterial({ map: texteZ, transparent: true, depthWrite: false });
      m.userData.partage = true;
      materiauxZ.push(m);
    }
  }
  return materiauxZ.map(m => new THREE.Sprite(m));
}

// ---------- Chambres (applications) ----------

export function application(lot, c) {
  const { THREE } = c;
  const p = c.palette;
  const app = lot.app;
  const d = app.donnees;
  const q = lot.quartier;
  const ferme = d.etat === 'ferme';
  const veille = d.etat === 'veille';
  const { rx, ry } = lot;
  const part = Math.sqrt(Math.min(1, d.ram / c.ramMax));
  const haut = ferme ? 3 : 5 + 9 * part;   // les grosses chambres ont plus de terre déblayée

  // Couleurs comme en 2D : bord sombre, fond teinté du quartier ; pâle en veille, gris si fermé.
  const pali = col => (veille ? c.melanger(col, p.galerie, 0.45) : col);
  const couleurMur = pali(p.bord);
  const couleurFond = ferme ? css(p.ferme) : pali(c.melanger(p.cavite, q.couleur, 0.22));
  const materiauFond = new THREE.MeshLambertMaterial({ color: couleurFond, emissive: css(q.couleur), emissiveIntensity: 0 });
  const { groupe, fond, crete } = cuvette(c, rx, ry, haut, couleurMur, materiauFond);

  // Liseré de la couleur du quartier sur la crête (gris foncé si fermé)
  const lisere = new THREE.Mesh(arcEllipse(THREE, rx + 1.5, ry + 1.5 * ry / rx, 1.1, 1, crete),
    c.materiau(ferme ? c.eclaircir(p.ferme, -0.2) : pali(css(q.couleur))));
  groupe.add(lisere);

  // Alvéoles des processus (au-delà du premier), petites cellules autour de la chambre
  const alveoles = ferme ? 0 : Math.min(12, Math.max(0, (d.nb_processus ?? 1) - 1));
  if (alveoles) {
    const bords = new THREE.InstancedMesh(new THREE.CylinderGeometry(5.2, 5.6, 3, 12).translate(0, 1.5, 0), terre(c, couleurMur), alveoles);
    const coeurs = new THREE.InstancedMesh(new THREE.CylinderGeometry(3.6, 3.6, 3.4, 12).translate(0, 1.7, 0),
      c.materiau(pali(c.eclaircir(q.couleur, 0.35))), alveoles);
    const m = new THREE.Matrix4();
    const ecart = 3 + 1.3 * haut + 6;
    for (let k = 0; k < alveoles; k++) {
      const a = -Math.PI * 0.85 + (k / 12) * Math.PI * 2 + hacher(app.id, 1) * 0.5;
      m.makeTranslation(Math.cos(a) * (rx + ecart), 0, Math.sin(a) * (ry + ecart * ry / rx));
      bords.setMatrixAt(k, m);
      coeurs.setMatrixAt(k, m);
    }
    bords.castShadow = true;
    groupe.add(bords, coeurs);
  }

  if (ferme) {
    // Éboulis : pierres grises tombées au fond de la chambre
    const pierres = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), c.materiau('#FFFFFF'), 9);
    const m = new THREE.Matrix4();
    const teinte = new THREE.Color();
    for (let i = 0; i < 9; i++) {
      const z = (hacher(app.id, i + 50) * 2 - 1) * ry * 0.7;
      const x = (hacher(app.id, i) * 2 - 1) * rx * 0.85 * Math.sqrt(1 - (z / ry) ** 2);
      const r = 4 + 5 * hacher(app.id, i + 90);
      m.compose(new THREE.Vector3(x, r * 0.35, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i),
        new THREE.Vector3(r, r * 0.7, r * 0.8));
      pierres.setMatrixAt(i, m);
      pierres.setColorAt(i, teinte.set(i % 2 ? '#8A837A' : '#77706A'));
    }
    pierres.castShadow = true;
    groupe.add(pierres);
  }

  // Veille : deux « z » qui montent au-dessus de la fourmi endormie (dessinée avec les autres fourmis)
  const zs = veille ? spriteZ(c) : [];
  for (const z of zs) groupe.add(z);

  // Alerte : anneau rouge qui pulse autour de la chambre, et l'épingle
  let anneauAlerte = null;
  if (d.alerte) {
    anneauAlerte = new THREE.Mesh(arcEllipse(THREE, rx + 7, ry + 7 * ry / rx, 1.6, 1, crete + 1.5),
      new THREE.MeshBasicMaterial({ color: ROUGE, transparent: true }));
    groupe.add(anneauAlerte, c.epingle(crete + 16));
  }

  groupe.userData.hauteur = crete + 6;
  groupe.userData.maj = (temps, ctx) => {
    const donnees = app.donnees;
    const pal = ctx.palette;
    const cpu = Math.min(1, donnees.cpu / 25);
    // La nuit, les chambres actives luisent de la couleur de leur quartier, selon le processeur
    const actif = donnees.etat !== 'veille' && donnees.etat !== 'ferme';
    fond.material.emissiveIntensity = actif && cpu > 0.02 ? 0.55 * (pal.lueur ?? 0) * (0.3 + cpu) : 0;
    if (anneauAlerte) anneauAlerte.material.opacity = 0.55 + 0.4 * Math.sin(temps / 180);
    zs.forEach((z, i) => {
      const t = ((temps / 1600) + i / 2) % 1;
      z.position.set(6 + t * 10, crete + 4 + t * 18, ry * 0.3);
      z.scale.set(7, 7, 1);
      z.material.opacity = 0.75 * (1 - t);
      z.material.color.set(css(pal.texte));
    });
  };
  return groupe;
}

// ---------- Chambre de la reine (processeur et mémoire) ----------

export function tour(t, c) {
  const { THREE } = c;
  const p = c.palette;
  const { rx, ry } = REINE;
  const materiauFond = new THREE.MeshLambertMaterial({ color: css(p.cavite), emissive: '#FFC86E', emissiveIntensity: 0 });
  const { groupe, fond, crete } = cuvette(c, rx, ry, 16, p.bord, materiauFond);

  // Anneau de la RAM sur la crête : fond sombre, arc bleu (rouge au-delà de 90 %)
  const [rxA, ryA] = [rx + 6, ry + 6 * ry / rx];
  const fondAnneau = new THREE.Mesh(arcEllipse(THREE, rxA, ryA, 3.4, 1, crete - 1),
    c.materiau('#000000', { transparent: true, opacite: 0.18 }));
  groupe.add(fondAnneau);
  let arcRam = null;
  let cleRam = '';

  // Œufs autour de la reine (une seule maille instanciée)
  const oeufs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), c.materiau(css(p.oeuf)), MAX_OEUFS);
  oeufs.castShadow = true;
  oeufs.frustumCulled = false;
  groupe.add(oeufs);

  // La reine, tête vers l'est comme en 2D : abdomen énorme et rayé, thorax, tête, six pattes, antennes
  const corps = c.materiau(css(p.fourmi));
  const reine = new THREE.Group();
  reine.position.set(-6, 0, 4);
  const l = 88;
  const ab = 1.8;
  const ellipsoide = (x, y, ax, ay, az, materiau = corps) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), materiau);
    m.position.set(x, y, 0);
    m.scale.set(ax, ay, az);
    m.castShadow = true;
    return m;
  };
  const [aLong, aHaut, aLarge] = [0.24 * l * ab, 0.13 * l * Math.sqrt(ab), 0.15 * l * Math.sqrt(ab)];
  const abdomen = new THREE.Group();
  abdomen.position.set(-0.13 * l - 0.24 * l * ab * 0.6, 17, 0);
  abdomen.add(ellipsoide(0, 0, aLong, aHaut, aLarge));
  const rayure = c.materiau(c.melanger(css(p.fourmi), '#FFFFFF', 0.22));
  for (let i = -2; i <= 2; i++) {
    const dx = i * 0.07 * l * ab;
    const f = Math.sqrt(Math.max(0, 1 - (dx / aLong) ** 2)) * 1.02;
    const bague = new THREE.Group();
    bague.position.x = dx;
    bague.scale.set(1, aHaut * f, aLarge * f);
    const tore = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 40), rayure);
    tore.rotation.y = Math.PI / 2;
    bague.add(tore);
    abdomen.add(bague);
  }
  const tete = 0.12 * l;
  reine.add(abdomen,
    ellipsoide(0, 15, 0.13 * l, 8, 0.075 * l),                      // thorax
    ellipsoide(0.17 * l + tete * 0.5, 15, tete, tete * 0.8, tete * 0.85));  // tête
  // Pattes : hanche → genou relevé → pied au sol ; elles battent en trépied
  const pattes = [];
  for (let k = -1; k <= 1; k++) {
    for (const s of [-1, 1]) {
      const patte = new THREE.Group();
      patte.position.set(k * l * 0.06, 12, s * 5);
      patte.add(
        segment(THREE, [0, 0, 0], [k * l * 0.08, 8, s * l * 0.2 - s * 5], 1.6, corps),
        segment(THREE, [k * l * 0.08, 8, s * l * 0.2 - s * 5], [k * l * 0.2, -11.5, s * l * 0.34 - s * 5], 1.3, corps),
      );
      pattes.push({ patte, phase: (k + (s > 0 ? 1 : 0)) * Math.PI, s });
      reine.add(patte);
    }
  }
  // Antennes coudées, vers l'avant
  const xt = 0.17 * l + tete * 1.2;
  for (const s of [-1, 1]) {
    reine.add(segment(THREE, [xt, 18, s * 4], [xt + 16, 28, s * 12], 1.1, corps),
      segment(THREE, [xt + 16, 28, s * 12], [xt + 30, 24, s * 20], 0.9, corps));
  }
  groupe.add(reine);

  groupe.userData.hauteur = 40;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const haut = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const taille = new THREE.Vector3();
  groupe.userData.maj = (temps, ctx) => {
    const sys = ctx.ville.systeme;
    if (!sys) return;
    const cpu = Math.min(1, sys.cpu / 100);
    const ram = Math.min(1, sys.ram_utilisee / sys.ram_totale);
    // L'abdomen pulse au rythme du processeur ; les pattes s'agitent avec lui
    const pulse = 1 + (0.03 + 0.08 * cpu) * Math.sin(temps / (500 - 380 * cpu));
    abdomen.scale.setScalar(pulse);
    const pas = temps / (260 - 180 * cpu);
    for (const { patte, phase, s } of pattes) patte.rotation.y = s * 0.18 * Math.sin(pas + phase);
    // Œufs : plus nombreux et plus agités quand le processeur travaille
    const n = Math.min(MAX_OEUFS, 6 + Math.round(cpu * 16));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const tremble = Math.sin(temps / (300 - 200 * cpu) + i) * 1.5 * cpu;
      pos.set(Math.cos(a) * rx * 0.78 + tremble, 3.4, Math.sin(a) * ry * 0.7);
      q.setFromAxisAngle(haut, -a);
      taille.set(5, 3.4, 3.4);
      oeufs.setMatrixAt(i, m.compose(pos, q, taille));
    }
    oeufs.count = n;
    oeufs.instanceMatrix.needsUpdate = true;
    // La nuit, la chambre luit d'autant plus que le processeur travaille
    fond.material.emissiveIntensity = 0.5 * (ctx.palette.lueur ?? 0) * (0.4 + cpu);
    // Arc de la RAM, refait quand le pourcentage change
    const cle = String(Math.round(ram * 100));
    if (cle !== cleRam) {
      cleRam = cle;
      if (arcRam) { groupe.remove(arcRam); arcRam.geometry.dispose(); arcRam.material.dispose(); }
      const couleur = ram > 0.9 ? ROUGE : css(ctx.palette.ram);
      arcRam = new THREE.Mesh(arcEllipse(THREE, rxA, ryA, 3.8, Math.max(0.02, ram), crete - 1),
        new THREE.MeshLambertMaterial({ color: couleur, emissive: couleur, emissiveIntensity: 0.35 }));
      groupe.add(arcRam);
    }
  };
  return groupe;
}

// ---------- Réserves (disques) ----------

export function entrepot(e, c) {
  const { THREE } = c;
  const p = c.palette;
  const { rx, ry } = e;
  const { groupe, crete } = cuvette(c, rx, ry, 12, p.bord, c.materiau(css(p.cavite)));

  // Halo rouge de saturation, sous la réserve (comme la tache rouge du 2D)
  const halo = nappe(THREE, rx + 22, ry + 22, rougeTransparent(THREE), 0.25);
  groupe.add(halo);

  // Tas de graines : dôme qui monte avec l'espace utilisé (rouge au-delà de 90 %), grains en surface
  const tas = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: e.toit }));
  tas.position.y = 0.35;
  tas.castShadow = tas.receiveShadow = true;
  groupe.add(tas);
  const NB_GRAINS = 60;
  const grains = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), c.materiau(c.eclaircir(e.toit, -0.4)), NB_GRAINS);
  grains.frustumCulled = false;
  groupe.add(grains);
  const [ax, az] = [rx * 0.86, ry * 0.86];
  let cle = '';
  const m = new THREE.Matrix4();

  groupe.userData.hauteur = crete + 34;
  groupe.userData.maj = (temps, ctx, o) => {
    const ent = o.userData.entrepot ?? e;   // les disques sont renouvelés à chaque relevé
    const d = ent.disque;
    const rempli = Math.max(0.02, Math.min(1, d.utilise / d.total));
    const saturation = ctx.trafic.saturation.get(cleCible({ type: 'entrepot', entrepot: ent })) ?? 0;
    halo.material.opacity = saturation > 0 ? 0.15 + 0.3 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)) : 0;
    const nouvelle = String(Math.round(rempli * 100));
    if (nouvelle === cle) return;
    cle = nouvelle;
    const h = 3 + 34 * rempli;
    tas.scale.set(ax, h, az);
    tas.material.color.set(rempli > 0.9 ? '#D9785A' : e.toit);
    for (let i = 0; i < NB_GRAINS; i++) {
      const a = hacher(d.id, i) * Math.PI * 2;
      const r = Math.sqrt(hacher(d.id, i + 300)) * 0.95;
      const [u, v] = [Math.cos(a) * r, Math.sin(a) * r];
      m.makeRotationY(hacher(d.id, i + 600) * 3);
      m.scale(new THREE.Vector3(3, 1.6, 2));
      m.setPosition(u * ax, 0.35 + h * Math.sqrt(Math.max(0, 1 - r * r)), v * az);
      grains.setMatrixAt(i, m);
    }
    grains.instanceMatrix.needsUpdate = true;
  };
  return groupe;
}

// ---------- Entrée (Internet) : le monticule ----------

export function internet(a, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  // rendu3d.js place ce groupe en (a.cx, a.cy) : le centre du monticule
  const { rx, ry, haut } = MONTICULE;
  const profil = [];
  for (let i = 0; i <= 14; i++) {
    const d = 1 - i / 14;
    profil.push(new THREE.Vector2(Math.max(0.001, d), haut * Math.pow(1 - d * d, 1.2)));
  }
  const dome = new THREE.Mesh(new THREE.LatheGeometry(profil, 48), terre(c, p.terre1));
  dome.scale.set(rx, 1, ry);
  dome.castShadow = dome.receiveShadow = true;
  groupe.add(dome);

  // Cailloux sur ses flancs
  const NB = 40;
  const cailloux = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), c.materiau(css(p.bord)), NB);
  const m = new THREE.Matrix4();
  for (let i = 0; i < NB; i++) {
    const ang = hacher('m', i) * Math.PI * 2;
    const r = 0.35 + 0.6 * hacher('r', i);
    const [x, z] = [Math.cos(ang) * r * rx, Math.sin(ang) * r * ry];
    const t = 1 + 1.6 * hacher('n', i);
    m.makeScale(t, t * 0.7, t);
    m.setPosition(x, altitudeMonticule(x + MONTICULE.x, z + MONTICULE.y) + 0.3, z);
    cailloux.setMatrixAt(i, m);
  }
  groupe.add(cailloux);

  // Le trou de l'entrée, au sommet, cerclé de terre tassée
  const trou = nappe(THREE, 13, 9, c.materiau(css(p.trou)), haut + 0.3);
  const levre = new THREE.Mesh(arcEllipse(THREE, 14, 10, 2.2, 1, haut - 0.3), terre(c, p.bord));
  groupe.add(trou, levre);

  // Halo vert autour du trou, qui grandit avec le réseau (rouge s'il sature)
  const lueur = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#7EE29A', transparent: true, opacity: 0.2, depthWrite: false }));
  lueur.position.y = haut - 2;
  groupe.add(lueur);
  // Halo de saturation au pied du monticule
  const halo = nappe(THREE, rx + 18, ry + 18, rougeTransparent(THREE), 0.25);
  groupe.add(halo);

  groupe.userData.hauteur = haut + 6;
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    const saturation = ctx.trafic.saturation.get('aeroport') ?? 0;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    const r = 18 + 22 * activite + (saturation > 0 ? 5 * Math.sin(temps / 250) : 0);
    lueur.scale.set(r, r * 0.55, r);
    lueur.material.color.set(saturation > 0 ? ROUGE : '#7EE29A');
    lueur.material.opacity = 0.12 + 0.25 * activite;
    halo.material.opacity = saturation > 0 ? 0.15 + 0.3 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)) : 0;
  };
  return groupe;
}

// ---------- Prairie : brins d'herbe en volume au-dessus de la fourmilière ----------

export function extras(v, c) {
  const { THREE } = c;
  const b = v.bornes;
  if (!b) return null;
  const marge = Math.max(b.l, b.h) * MARGE_SOL;
  const [x0, x1, y0, y1] = [b.x - marge, b.x + b.l + marge, b.y - marge, -8];
  const pas = 13;
  const places = [];
  const alea = generateur(47);
  for (let y = y0; y < y1; y += pas) {
    for (let x = x0; x < x1; x += pas) {
      const [px, py] = [x + alea() * pas, y + alea() * pas];
      if (py > y1 || altitudeMonticule(px, py) > 0 || Math.hypot((px - MONTICULE.x) / (MONTICULE.rx + 10), (py - MONTICULE.y) / (MONTICULE.ry + 10)) < 1) continue;
      places.push([px, py, alea(), alea(), alea()]);
      if (places.length >= 5000) break;
    }
    if (places.length >= 5000) break;
  }
  if (!places.length) return null;
  const geo = new THREE.ConeGeometry(1.3, 1, 4);
  geo.translate(0, 0.5, 0);
  const brins = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: css(c.palette.herbe) }), places.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  places.forEach(([x, y, h, penche, tourne], i) => {
    q.setFromEuler(e.set((penche - 0.5) * 0.6, tourne * 6.28, (h - 0.5) * 0.5));
    m.compose(new THREE.Vector3(x, 0, y), q, new THREE.Vector3(1, 5 + 9 * h, 1));
    brins.setMatrixAt(i, m);
  });
  brins.castShadow = true;
  brins.receiveShadow = true;
  brins.userData.maj = (temps, ctx) => brins.material.color.set(css(ctx.palette.herbe));
  return brins;
}

// ---------- Sol : prairie, couches de terre, cailloux, racines et galeries ----------

// Le _dessinerDecor du 2D peint le ciel, le soleil, le monticule et le trou, qui n'ont pas de sens
// (ou sont des volumes) vus d'en haut : on peint ici seulement le fond fixe.
export function sol(r2) {
  const toile = r2.canvas;
  const ctx = toile.getContext('2d');
  const p = r2.palette;
  const v = r2.ville;
  const b = v.bornes;
  const cam = r2.camera;
  const z = cam.zoom;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(toile.width / 2, toile.height / 2);
  ctx.scale(z, z);
  ctx.translate(-cam.x, -cam.y);
  const [x0, x1] = [cam.x - toile.width / 2 / z, cam.x + toile.width / 2 / z];
  const [y0, y1] = [cam.y - toile.height / 2 / z, cam.y + toile.height / 2 / z];

  // Prairie (la surface), mouchetée de touffes plus sombres
  if (y0 < 0) {
    ctx.fillStyle = p.herbe;
    ctx.fillRect(x0, y0, x1 - x0, -y0 + 1);
    const alea = generateur(31);
    ctx.fillStyle = p.herbeFoncee;
    const n = Math.min(3000, Math.round((x1 - x0) * -y0 / 180));
    for (let i = 0; i < n; i++) {
      const [x, y, r] = [x0 + alea() * (x1 - x0), y0 + alea() * -y0, 2 + alea() * 5];
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, alea() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Couches de terre, de plus en plus sombres en s'éloignant de la surface, bords ondulés
  const terres = [p.terre1, p.terre2, p.terre3, p.terre4];
  ctx.fillStyle = p.terre1;
  ctx.fillRect(x0, 0, x1 - x0, y1 + 2);
  const pas = 12;
  for (let k = 1; k <= 3; k++) {
    const haut = k * COUCHE;
    ctx.fillStyle = terres[k];
    ctx.beginPath();
    ctx.moveTo(x0 - pas, y1 + 10);
    for (let x = x0 - pas; x <= x1 + pas; x += pas) ctx.lineTo(x, haut + 10 * Math.sin(x / 110 + k * 1.7) + 6 * Math.sin(x / 37 + k));
    ctx.lineTo(x1 + pas, y1 + 10);
    ctx.closePath();
    ctx.fill();
  }

  // Cailloux et racines (même tirage que le 2D)
  const alea = generateur(23);
  ctx.fillStyle = p.caillou;
  for (let i = 0; i < 420; i++) {
    const [x, y, r] = [b.x - 300 + alea() * (b.l + 600), 24 + alea() * (b.y + b.h + 200), 2 + alea() * 6];
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, alea() * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = p.racine;
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    let [x, y] = [b.x - 200 + alea() * (b.l + 400), 4];
    if (Math.abs(x) < 120) continue;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x, y);
    const n = 4 + Math.floor(alea() * 5);
    for (let j = 0; j < n; j++) { x += (alea() - 0.5) * 30; y += 10 + alea() * 14; ctx.lineTo(x, y); }
    ctx.stroke();
  }

  // Lisière : la bande d'herbe dense au bord de la prairie
  ctx.fillStyle = p.herbeFoncee;
  ctx.fillRect(x0, -3, x1 - x0, 8);
  ctx.fillStyle = p.herbe;
  ctx.fillRect(x0, -3, x1 - x0, 3);

  // Galeries : bord sombre partout, puis intérieur clair, pour des raccords nets
  const chemins = [
    segmentPuits(-30, v.yReserves),
    ...v.lots.map(lot => lot.chemin),
    ...(v.entrepots ?? []).map(e => e.chemin),
  ];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [couleur, epaisseur] of [[p.bord, 21], [p.galerie, 14]]) {
    ctx.strokeStyle = couleur;
    ctx.lineWidth = epaisseur;
    for (const points of chemins) {
      if (!points.length) continue;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
      ctx.stroke();
    }
  }
  return toile;
}

// ---------- Fourmis (à la place des véhicules) ----------

// Les boîtes des véhicules de rendu3d.js passent sous le sol : les porteuses sont dessinées ici.
export const altitudeVehicule = () => -400;

// Mailles instanciées de toutes les fourmis : corps (abdomen, thorax, tête), pattes, charges.
function creerFourmis(THREE) {
  const corps = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshLambertMaterial(), MAX_FOURMIS * 3);
  const pattes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), corps.material, MAX_FOURMIS * 3);
  const charges = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshLambertMaterial({ color: '#FFFFFF' }), MAX_FOURMIS);
  for (const m of [corps, pattes, charges]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = true;
    m.count = 0;
  }
  return { corps, pattes, charges, nCorps: 0, nPattes: 0, nCharges: 0,
    m: new THREE.Matrix4(), q: new THREE.Quaternion(), pos: new THREE.Vector3(), taille: new THREE.Vector3(),
    haut: new THREE.Vector3(0, 1, 0), couleur: new THREE.Color() };
}

// Pose une fourmi (tête vers « angle », dans le plan de la carte), avec sa charge éventuelle.
function poserFourmi(f, x, y, alt, angle, l, pas, { tete = 1, charge = null, couleur = null, feuille = false } = {}) {
  const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
  const ellipsoide = (dx, dy, ax, ay, az, maille, i, lacet = 0) => {
    f.pos.set(x + ca * dx, alt + dy, y + sa * dx);
    f.q.setFromAxisAngle(f.haut, -angle + lacet);
    f.taille.set(ax, ay, az);
    maille.setMatrixAt(i, f.m.compose(f.pos, f.q, f.taille));
  };
  const t = l * 0.12 * tete;
  ellipsoide(-0.13 * l - 0.144 * l, 0.17 * l, 0.24 * l, 0.13 * l, 0.15 * l, f.corps, f.nCorps++);   // abdomen
  ellipsoide(0, 0.15 * l, 0.13 * l, 0.08 * l, 0.075 * l, f.corps, f.nCorps++);                      // thorax
  ellipsoide(0.17 * l + t * 0.5, 0.15 * l, t, t * 0.8, t * 0.85, f.corps, f.nCorps++);              // tête
  // Trois paires de pattes, en barres qui pivotent : elles battent en trépied
  for (let k = -1; k <= 1; k++) {
    const bat = Math.sin(pas + k * Math.PI) * 0.35;
    ellipsoide(k * l * 0.1, 0.06 * l, l * 0.06, l * 0.05, l * 0.7, f.pattes, f.nPattes++, bat);
  }
  if (!charge) return;
  if (feuille) {
    // Feuille tenue au-dessus du corps
    ellipsoide(l * 0.15, 0.36 * l, l * 0.55, l * 0.05, l * 0.32, f.charges, f.nCharges, 0.25);
  } else {
    const r = charge * l;
    ellipsoide(l * 0.62 + r * 0.6, Math.max(0.15 * l, r), r, r, r, f.charges, f.nCharges);
  }
  f.charges.setColorAt(f.nCharges++, f.couleur.set(couleur));
}

export function dynamique(groupe, c, temps, liberer) {
  const { THREE } = c;
  const v = c.ville;
  const t = c.trafic;
  const p = c.palette;
  let f = groupe.userData.fourmis;
  if (!f) {
    f = creerFourmis(THREE);
    groupe.userData.fourmis = f;
    groupe.add(f.corps, f.pattes, f.charges);
  }
  f.nCorps = f.nPattes = f.nCharges = 0;
  f.corps.material.color.set(css(p.fourmi));
  let n = 0;

  // Porteuses : ouvrière (petite boule), soldat (grosse tête, boule plus grosse), porteuse de feuille.
  // Elles rougissent en clignotant dans un embouteillage, et gravissent le monticule de l'entrée.
  for (const veh of t.vehicules) {
    if (n >= MAX_FOURMIS) break;
    if (!veh.app?.lot || veh.s <= 0) continue;
    const q = t.position(veh);
    if (!q || !Number.isFinite(q.x)) continue;
    const L = t.route(veh).longueur;
    const fondu = Math.min(1, (veh.s * L) / 20, ((1 - veh.s) * L) / 20);
    if (fondu <= 0.05) continue;
    const gab = veh.gabarit;
    const l = (GABARITS[gab]?.longueur ?? 11) * ECHELLE_FOURMI * fondu;
    const couleur = veh.bouchon ? c.melanger(veh.couleur, ROUGE, 0.5 + 0.5 * Math.sin(temps / 200)) : veh.couleur;
    const pas = veh.bouchon ? temps / 160 : temps / 45 + veh.id;
    poserFourmi(f, q.x, q.y, altitudeMonticule(q.x, q.y) + 0.3, q.angle, l, pas, {
      tete: gab === 'camionnette' ? 1.5 : 1,
      charge: gab === 'camionnette' ? 0.26 : 0.22,
      feuille: gab === 'camion',
      couleur: css(couleur),
    });
    n++;
  }

  // Ouvrières des chambres : plus nombreuses et plus rapides avec le processeur ; une seule,
  // endormie, dans une chambre en veille ; aucune dans une chambre éboulée (programme fermé).
  for (const lot of v.lots ?? []) {
    const d = lot.app.donnees;
    if (d.etat === 'ferme') continue;
    if (d.etat === 'veille') {
      if (n++ >= MAX_FOURMIS) break;
      poserFourmi(f, lot.cx, lot.cy + lot.ry * 0.3, 0.4, 0, 11 * ECHELLE_FOURMI, 0);
      continue;
    }
    const cpu = Math.min(1, d.cpu / 25);
    const nb = 1 + Math.min(3, Math.floor(d.cpu / 4));
    for (let i = 0; i < nb && n < MAX_FOURMIS; i++, n++) {
      const a = hacher(lot.app.id, i + 7) * 6.28 + (temps / 1000) * (0.4 + 2.2 * cpu) * (i % 2 ? -1 : 1);
      const [x, y] = [lot.cx + Math.cos(a) * lot.rx * 0.55, lot.cy + Math.sin(a) * lot.ry * 0.5];
      poserFourmi(f, x, y, 0.4, a + (i % 2 ? -Math.PI / 2 : Math.PI / 2), 10 * ECHELLE_FOURMI, temps / (120 - 70 * cpu) + i);
    }
  }

  for (const [maille, nb] of [[f.corps, f.nCorps], [f.pattes, f.nPattes], [f.charges, f.nCharges]]) {
    maille.count = nb;
    maille.instanceMatrix.needsUpdate = true;
    if (maille.instanceColor) maille.instanceColor.needsUpdate = true;
  }

  majBouchons(groupe, c, temps, liberer);
}

// Galeries vers une cible saturée : la fin du trajet rougit en pulsant (rubans posés sur le sol).
function majBouchons(groupe, c, temps, liberer) {
  const { THREE } = c;
  const v = c.ville;
  const cle = `${v.version}|${(v.entrepots ?? []).map(e => e.disque.id).join(',')}|${v.yReserves}`;
  let b = groupe.userData.bouchons;
  if (!b || b.cle !== cle) {
    if (b) for (const m of b.mailles.values()) { groupe.remove(m); liberer(m); }
    b = { cle, mailles: new Map() };
    groupe.userData.bouchons = b;
    const chemins = [['aeroport', [...segmentPuits(ZONE_BOUCHON, 0), [0, -28]]]];
    for (const e of v.entrepots ?? []) {
      chemins.push([cleCible({ type: 'entrepot', entrepot: e }), [...segmentPuits(v.yReserves - ZONE_BOUCHON / 2, v.yReserves), ...e.chemin]]);
    }
    for (const [cible, points] of chemins) {
      const m = bande(THREE, points, 7, 0.7);
      if (!m) continue;
      m.visible = false;
      b.mailles.set(cible, m);
      groupe.add(m);
    }
  }
  const pulse = 0.5 + 0.5 * Math.sin(temps / 250);
  for (const [cible, m] of b.mailles) {
    const s = c.trafic.saturation.get(cible) ?? 0;
    m.visible = s > 0;
    m.material.opacity = (0.3 + 0.3 * pulse) * s;
  }
}

// Ruban plat le long d'une galerie, à la hauteur y.
function bande(THREE, points, demi, y) {
  if (points.length < 2) return null;
  const sommets = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const [px, pz] = points[Math.max(0, i - 1)];
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
    const n = Math.hypot(nx - px, nz - pz) || 1;
    const [ox, oz] = [-(nz - pz) / n * demi, (nx - px) / n * demi];
    const base = sommets.length / 3;
    sommets.push(x + ox, y, z + oz, x - ox, y, z - oz);
    if (base > 0) indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sommets, 3));
  geo.setIndex(indices);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ROUGE, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
}
