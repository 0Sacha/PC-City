// Formes 3D du décor « Archipel » (vue en relief, voir rendu3d.js) : des îles posées sur la mer, des
// maisons-blocs aux coins arrondis comme en 2D (pastilles du processeur sur le toit, « z » qui
// s'envolent en veille), le hall central et ses anneaux, les ponts 2 × 2 voies qui enjambent la mer
// jusqu'à l'Étoile, le port et ses bateaux, l'aéroport, la centrale électrique (tours de
// refroidissement qui fument) et sa piste de course suspendue jusqu'à la tour, les feux tricolores
// et les arbres.

import { cleCible, decaler } from './trafic.js';

const ROUGE = '#E8504F';
const JAUNE = '#F2C230';
const HAUTEUR_PONT = 24;   // tablier des ponts au-dessus de la mer
const RAMPE = 0.18;        // part du pont où il monte (et redescend), comme l'ombre du 2D
const HAUTEUR_HALL = 34;   // hall central (la tour)
const HAUTEUR_USINE = 26;  // bâtiment de la centrale, d'où part la piste électrique
const BOSSE_PISTE = 38;    // la piste électrique s'élève au-dessus de la mer
const BORD_ANNEAU = 26;    // demi-largeur de la chaussée de l'Étoile (le pont s'arrête à son bord)
const EMPLACEMENTS_MAISONS = [
  [-2, 1], [2, 1], [-2, 2], [2, 2], [-2, 0], [2, 0], [-2, 3], [2, 3],
  [-1, 1], [1, 1], [-1, 2], [1, 2], [-1, 0], [1, 0], [-1, 3], [1, 3],
];
const PALIERS_CPU = [0.5, 3, 10, 25];
const MAX_COURSES = 40;

export const ciel = p => p.mer;

export function cleApplication(lot, c) {
  const d = lot.app.donnees;
  const part = Math.sqrt(Math.min(1, d.ram / c.ramMax));
  return [d.etat, d.alerte ? 1 : 0, Math.round(part * 24), lot.app.quartier.couleur,
    Math.min(d.nb_processus, EMPLACEMENTS_MAISONS.length), c.nuitArrondie].join('|');
}

// ---------- Sol : le décor fixe du 2D, sans ce qui devient volume (arbres, ponts) ----------

export function sol(r2) {
  const ctx = r2.ctx;
  const p = r2.palette;
  const v = r2.ville;
  const cam = r2.camera;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = p.mer;
  ctx.fillRect(0, 0, r2.canvas.width, r2.canvas.height);
  ctx.translate(r2.largeur / 2, r2.hauteur / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  r2._dessinerMer();
  r2._dessinerTerre();
  r2._dessinerBassin();
  for (const parc of v.parcs ?? []) { ctx.fillStyle = p.pelouse; rectArrondi(ctx, parc.x, parc.y, parc.l, parc.h, 16); ctx.fill(); }
  for (const e of v.etangs ?? []) r2._dessinerEtang(e);
  for (const z of v.zones ?? []) {
    ctx.fillStyle = teinte(z.quartier.couleur, p.zoneAlpha);
    rectArrondi(ctx, z.x, z.y, z.l, z.h, 26);
    ctx.fill();
  }
  if (v.pelouseCentrale) {
    ctx.fillStyle = p.pelouse;
    ctx.beginPath(); ctx.arc(v.pelouseCentrale.x, v.pelouseCentrale.y, v.pelouseCentrale.r, 0, Math.PI * 2); ctx.fill();
  }
  r2._dessinerRoutes();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return r2.canvas;
}

// ---------- Outils ----------

// Bloc aux coins arrondis (comme les rectArrondi du 2D), posé au sol : toit et flancs de deux couleurs.
function bloc(c, l, haut, p, rayon, couleurToit, couleurFlanc) {
  const { THREE } = c;
  const r = Math.max(0.5, Math.min(rayon, l / 2 - 0.1, p / 2 - 0.1));
  const [x, y] = [-l / 2, -p / 2];
  const forme = new THREE.Shape();
  forme.moveTo(x + r, y);
  forme.lineTo(x + l - r, y); forme.quadraticCurveTo(x + l, y, x + l, y + r);
  forme.lineTo(x + l, y + p - r); forme.quadraticCurveTo(x + l, y + p, x + l - r, y + p);
  forme.lineTo(x + r, y + p); forme.quadraticCurveTo(x, y + p, x, y + p - r);
  forme.lineTo(x, y + r); forme.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(forme, { depth: haut, bevelEnabled: false, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);   // l'extrusion monte ; groupe 0 = toit et dessous, groupe 1 = flancs
  const m = new THREE.Mesh(geo, [c.materiau(couleurToit), c.materiau(couleurFlanc ?? couleurToit)]);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// Panneau de texte couché sur un toit (lisible vu du ciel, le haut du texte vers le nord).
function panneauToit(c, texte, l, h, y, options) {
  const m = c.texteSur(texte, l, h, options);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y + 0.3;
  return m;
}

// Couleur CSS sans transparence (les palettes interpolées sont en rgba).
const opaque = (c, couleur) => c.melanger(couleur, couleur, 0);

// Halo rouge qui pulse au pied d'un disque ou de l'aéroport saturé (embouteillage).
function halo(c, l, h, cle) {
  const { THREE } = c;
  const anneau = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48),
    new THREE.MeshBasicMaterial({ color: ROUGE, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  anneau.rotation.x = -Math.PI / 2;
  anneau.position.y = 0.8;
  const rayon = Math.max(l, h) * 0.72;
  anneau.userData.maj = (temps, ctx) => {
    const saturation = ctx.trafic.saturation.get(cle) ?? 0;
    const pulse = (Math.sin(temps / 400) + 1) / 2;
    anneau.material.opacity = saturation > 0 ? 0.35 + 0.5 * saturation * pulse : 0;
    const r = rayon * (1 + 0.06 * pulse);
    anneau.scale.set(r, r, 1);
  };
  return anneau;
}

// « z » du sommeil (texture partagée, créée une fois).
let texteZ = null;
function textureZ(c) {
  if (!texteZ) {
    const toile = document.createElement('canvas');
    toile.width = toile.height = 64;
    const ctx = toile.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 52px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('z', 32, 30);
    texteZ = new c.THREE.CanvasTexture(toile);
    texteZ.colorSpace = c.THREE.SRGBColorSpace;
  }
  return texteZ;
}

// ---------- Applications : maisons-blocs arrondies et leurs petites maisons (processus) ----------

export function application(lot, c) {
  const { THREE } = c;
  const p = c.palette;
  const app = lot.app;
  const d = app.donnees;
  const ferme = d.etat === 'ferme';
  const veille = d.etat === 'veille';
  let couleur = ferme ? p.ferme : app.quartier.couleur;
  if (veille) couleur = c.melanger(couleur, p.ferme, 0.45);
  const fonce = ferme ? p.fermeFonce : c.eclaircir(couleur, -0.22);
  const part = Math.sqrt(Math.min(1, d.ram / c.ramMax));
  const cote = ferme ? 32 : 26 + 16 * part;
  const haut = ferme ? 10 : 14 + 76 * part;
  const dz = -2;   // comme en 2D, le bâtiment est un peu au nord de sa parcelle
  const groupe = new THREE.Group();

  const batiment = bloc(c, cote, haut, cote, 7, couleur, fonce);
  batiment.position.z = dz;
  groupe.add(batiment);

  // Maisons : les processus, en petits blocs de part et d'autre (une seule maille instanciée)
  const nbMaisons = ferme ? 0 : Math.min(d.nb_processus, EMPLACEMENTS_MAISONS.length);
  if (nbMaisons) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const maisons = new THREE.InstancedMesh(geo, c.materiau(couleur), nbMaisons);
    const matrice = new THREE.Matrix4();
    const [cx, cy] = [lot.x + lot.l / 2, lot.y + lot.h / 2];
    for (let i = 0; i < nbMaisons; i++) {
      const [colonne, rangee] = EMPLACEMENTS_MAISONS[i];
      const decalage = (hacher(app.id, i) - 0.5) * 3;
      const mx = (colonne < 0 ? lot.x + 2 + (-colonne - 1) * 10 : lot.x + lot.l - 10 - (colonne - 1) * 10) + decalage;
      const my = lot.y + 6 + rangee * 13 + decalage;
      matrice.makeScale(8, 5 + (i % 3) * 1.5, 8);
      matrice.setPosition(mx + 4 - cx, 0, my + 4 - cy);
      maisons.setMatrixAt(i, matrice);
    }
    maisons.castShadow = maisons.receiveShadow = true;
    groupe.add(maisons);
  }

  if (ferme) {
    // Rideau baissé (lattes sur le toit) et panneau « FERMÉ » sur la façade sud
    for (let i = 1; i < 4; i++) {
      const latte = c.boite(cote - 10, 0.6, 2, p.fermeFonce, { ombre: false });
      latte.position.set(0, haut, dz - cote / 2 + (i * cote) / 4);
      groupe.add(latte);
    }
    const panneau = c.texteSur('FERMÉ', 22, 7);
    panneau.position.set(0, haut * 0.5, dz + cote / 2 + 0.3);
    groupe.add(panneau);
    groupe.userData.hauteur = haut;
    return groupe;
  }

  // Pastilles du toit : s'allument selon l'activité du processeur
  const pastilles = [];
  const ecart = cote / 4.5;
  for (let i = 0; i < 4; i++) {
    const pastille = c.cylindre(Math.max(2.2, cote / 13), 1.2, '#FFFFFF', { lumineux: true, faces: 16, ombre: false });
    pastille.position.set(i % 2 ? ecart : -ecart, haut, dz + (i < 2 ? -ecart : ecart));
    pastilles.push(pastille);
    groupe.add(pastille);
  }

  // En veille : deux « z » qui s'envolent doucement
  const zs = [];
  if (veille) {
    for (let i = 0; i < 2; i++) {
      const z = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureZ(c), color: opaque(c, p.texte), transparent: true, depthWrite: false }));
      groupe.add(z);
      zs.push(z);
    }
  }
  if (d.alerte) groupe.add(c.epingle(haut + 10));

  groupe.userData.hauteur = haut;
  groupe.userData.maj = temps => {
    const donnees = app.donnees;
    const allumees = donnees.etat === 'veille' ? 0 : PALIERS_CPU.filter(s => donnees.cpu >= s).length;
    const pulsation = allumees ? 0.75 + 0.25 * Math.sin(temps / 300 + lot.x) : 1;
    pastilles.forEach((m, i) => {
      m.material.emissiveIntensity = i < allumees ? 0.9 * pulsation : 0;
      m.material.color.set(i < allumees ? '#FFFFFF' : '#D8D2C6');
    });
    zs.forEach((z, i) => {
      const t = (temps / 2200 + i / 2 + hacher(app.id, 0)) % 1;
      const taille = 7 + i * 3;
      z.position.set(8 + t * 8, haut + 6 + t * 16, dz);
      z.scale.set(taille, taille, 1);
      z.material.opacity = 1 - t;
    });
  };
  return groupe;
}

// ---------- Hall central : tambour sombre, anneaux CPU / RAM, halo orange, enseigne ----------

export function tour(t, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  const r = t.rayon;
  const geo = new THREE.CylinderGeometry(r, r, HAUTEUR_HALL, 64);
  geo.translate(0, HAUTEUR_HALL / 2, 0);
  const tambour = new THREE.Mesh(geo, [c.materiau(p.tourFlanc), c.materiau(p.tour), c.materiau(p.tour)]);
  tambour.castShadow = tambour.receiveShadow = true;
  groupe.add(tambour);
  groupe.add(c.anneaux(r * 1.05, HAUTEUR_HALL));

  // Halo au sol qui pulse plus vite et plus fort quand le processeur travaille
  const haloCpu = new THREE.Mesh(new THREE.CircleGeometry(1, 64),
    new THREE.MeshBasicMaterial({ color: '#F2A541', transparent: true, opacity: 0.12, depthWrite: false }));
  haloCpu.rotation.x = -Math.PI / 2;
  haloCpu.position.y = 0.5;
  groupe.add(haloCpu);

  // Enseigne « HALL CENTRAL » sur deux mâts, côté nord (la piste électrique arrive par le sud)
  const enseigne = c.texteSur('HALL CENTRAL', 104, 20, { fond: '#4C5DA8' });
  enseigne.material.side = THREE.DoubleSide;
  enseigne.position.set(0, HAUTEUR_HALL + 22, -r + 6);
  groupe.add(enseigne);
  for (const x of [-40, 40]) {
    const mat = c.boite(2.5, 22, 2.5, '#2B303B');
    mat.position.set(x, HAUTEUR_HALL, -r + 5);
    groupe.add(mat);
  }

  groupe.userData.hauteur = HAUTEUR_HALL + 34;
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    if (!s) return;
    const cpu = s.cpu / 100;
    const pulse = (Math.sin(temps / (600 - 400 * cpu)) + 1) / 2;
    const rayon = r + 10 + 14 * cpu * pulse;
    haloCpu.scale.set(rayon, rayon, 1);
    haloCpu.material.opacity = 0.12 + 0.35 * cpu * pulse;
  };
  return groupe;
}

// ---------- Port : entrepôts (un par disque) ----------

export function entrepot(e, c) {
  const p = c.palette;
  const groupe = new c.THREE.Group();
  const haut = 26;
  groupe.add(bloc(c, e.l, haut, e.h, 10, p.entrepot, p.entrepotFonce));
  // Bandeau de toit coloré (côté nord), comme en 2D
  const bandeau = bloc(c, e.l, haut + 3, 26, 10, e.toit, c.eclaircir(e.toit, -0.2));
  bandeau.position.z = -e.h / 2 + 13;
  groupe.add(bandeau);

  // Piles de caisses : hauteur selon l'espace utilisé (rouge au-delà de 90 %). Le modèle recrée les
  // entrepôts à chaque relevé : on relit le disque à jour plutôt que celui de la construction.
  const zone = e.h - 38;
  const caisses = c.boite(e.l - 16, 1, zone, e.toit, { propre: true });
  caisses.position.set(0, haut, -e.h / 2 + 32 + zone / 2);
  groupe.add(caisses);
  caisses.userData.maj = (temps, ctx) => {
    const actuel = ctx.ville.entrepots?.find(x => x.disque.id === e.disque.id) ?? e;
    const occupe = Math.max(0.02, Math.min(1, actuel.disque.utilise / actuel.disque.total));
    caisses.scale.y = 2 + 30 * occupe;
    caisses.material.color.set(occupe > 0.9 ? ROUGE : c.eclaircir(e.toit, 0.25));
  };
  groupe.add(halo(c, e.l, e.h, cleCible({ type: 'entrepot', entrepot: e })));
  groupe.userData.hauteur = haut + 32;
  return groupe;
}

// ---------- Aéroport (Internet) : piste, terminal bleu « INTERNET », avion qui roule puis décolle ----------

export function internet(a, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  const [ox, oy] = [a.x + a.l / 2, a.y + a.h / 2];
  const r = a.piste;
  const piste = bloc(c, r.l, 1, r.h, 8, p.piste);
  piste.position.set(r.x + r.l / 2 - ox, 0, r.y + r.h / 2 - oy);
  piste.castShadow = false;
  groupe.add(piste);
  // Marquage central en tirets
  for (let x = r.x + 16; x + 14 <= r.x + r.l - 16; x += 24) {
    const tiret = c.boite(14, 0.3, 2.5, '#FFFFFF', { ombre: false });
    tiret.position.set(x + 7 - ox, 1, piste.position.z);
    groupe.add(tiret);
  }

  const t = a.terminal;
  const hautTerminal = 22;
  const terminal = bloc(c, t.l, hautTerminal, t.h, 10, '#5BC8E8', c.eclaircir('#5BC8E8', -0.22));
  terminal.position.set(t.x + t.l / 2 - ox, 0, t.y + t.h / 2 - oy);
  groupe.add(terminal);
  const enseigne = panneauToit(c, 'INTERNET', t.l - 20, 22, hautTerminal, { fond: '#5BC8E8' });
  enseigne.position.x = terminal.position.x;
  enseigne.position.z = terminal.position.z;
  groupe.add(enseigne);
  const haloTerminal = halo(c, t.l, t.h, 'aeroport');
  haloTerminal.position.set(terminal.position.x, 0.8, terminal.position.z);
  groupe.add(haloTerminal);

  // Avion : fuselage, ailes et dérive
  const avion = new THREE.Group();
  avion.add(c.boite(26, 5, 5, '#FFFFFF'));
  const ailes = c.boite(6, 1.2, 26, '#FFFFFF');
  ailes.position.set(-2, 2, 0);
  const derive = c.boite(4, 7, 1, ROUGE);
  derive.position.set(-11, 4, 0);
  avion.add(ailes, derive);
  groupe.add(avion);
  avion.userData.maj = temps => {
    const progres = (temps / 9000) % 1;
    const x = r.x + 30 + progres * (r.l - 60) - ox;
    const envol = Math.max(0, (progres - 0.6) / 0.4);
    avion.position.set(x, 1 + envol * envol * 80, piste.position.z);
    avion.rotation.z = envol > 0 ? 0.25 : 0;
    avion.visible = progres < 0.97;
  };

  groupe.userData.hauteur = 40;
  return groupe;
}

// ---------- Volumes fixes : arbres, ponts, feux, bateaux, centrale et piste électrique ----------

export function extras(v, c) {
  const groupe = new c.THREE.Group();
  const morceaux = [arbres(v, c), ponts(v, c), feux(v, c), bateaux(v, c), centrale(v, c)];
  for (const m of morceaux) if (m) groupe.add(m);
  return groupe;
}

// Arbres ronds, avec leur reflet clair (deux mailles instanciées pour tous).
function arbres(v, c) {
  const { THREE } = c;
  const liste = v.arbres ?? [];
  if (!liste.length) return null;
  const p = c.palette;
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const couronnes = new THREE.InstancedMesh(geo, c.materiau(p.arbre), liste.length);
  const reflets = new THREE.InstancedMesh(geo, c.materiau(p.arbreClair), liste.length);
  const matrice = new THREE.Matrix4();
  liste.forEach((a, i) => {
    const r = a.r ?? 8;
    matrice.makeScale(r, r * 1.1, r);
    matrice.setPosition(a.x, r * 1.1 + 1.5, a.y);
    couronnes.setMatrixAt(i, matrice);
    const k = r * 0.45;
    matrice.makeScale(k, k, k);
    matrice.setPosition(a.x - r * 0.3, r * 1.1 + 1.5 + r * 0.72, a.y - r * 0.3);
    reflets.setMatrixAt(i, matrice);
  });
  couronnes.castShadow = couronnes.receiveShadow = true;
  reflets.receiveShadow = true;
  const groupe = new THREE.Group();
  groupe.add(couronnes, reflets);
  return groupe;
}

// Ponts 2 × 2 voies : tablier saumon (comme en 2D) qui monte au-dessus de la mer, ligne blanche au
// centre, piles dans l'eau.
function ponts(v, c) {
  const { THREE } = c;
  if (!v.ponts?.length) return null;
  const groupe = new THREE.Group();
  const tablier = new THREE.MeshLambertMaterial({ color: '#F4B39A', side: THREE.DoubleSide });
  const ligne = new THREE.MeshBasicMaterial({ color: '#FFFFFF', side: THREE.DoubleSide });
  const piles = [];
  for (const pont of v.ponts) {
    const [de, a] = boutsPont(pont);
    const points = echantillonner([de, a], 12);
    const hauteurs = fractions(points).map(t => hauteurPont(t) + 0.4);
    const m = new THREE.Mesh(ruban(THREE, points, hauteurs, 40), tablier);
    m.castShadow = m.receiveShadow = true;
    groupe.add(m);
    groupe.add(new THREE.Mesh(ruban(THREE, points, hauteurs.map(h => h + 0.25), 1.5), ligne));
    for (const t of [0.3, 0.5, 0.7]) {
      const [x, y] = [de[0] + (a[0] - de[0]) * t, de[1] + (a[1] - de[1]) * t];
      piles.push([x, y, hauteurPont(t)]);
    }
  }
  groupe.add(colonnes(c, piles, 4, '#D9C9BE'));
  return groupe;
}

// Feux tricolores : deux têtes par carrefour (rue verticale, rue horizontale), lampes instanciées
// dont la couleur suit l'état du feu.
function feux(v, c) {
  const { THREE } = c;
  const liste = v.feux ?? [];
  if (!liste.length) return null;
  const tetes = liste.flatMap(feu => [
    { feu, axe: 'v', x: feu.x + 17, y: feu.y - 17 },
    { feu, axe: 'h', x: feu.x - 17, y: feu.y + 17 },
  ]);
  const groupe = new THREE.Group();
  groupe.add(colonnes(c, tetes.map(t => [t.x, t.y, 12]), 0.8, '#5B6170'));
  const geoBoite = new THREE.BoxGeometry(4, 11, 4);
  geoBoite.translate(0, 5.5, 0);
  const boitiers = new THREE.InstancedMesh(geoBoite, c.materiau('#2B303B'), tetes.length);
  const lampes = new THREE.InstancedMesh(new THREE.SphereGeometry(2.3, 10, 8), new THREE.MeshBasicMaterial({ color: '#FFFFFF' }), tetes.length * 3);
  const matrice = new THREE.Matrix4();
  const eteinte = new THREE.Color('#4A4F58');
  tetes.forEach((t, i) => {
    matrice.makeTranslation(t.x, 12, t.y);
    boitiers.setMatrixAt(i, matrice);
    for (let k = 0; k < 3; k++) {
      matrice.makeTranslation(t.x, 20.5 - k * 3.5, t.y);   // rouge en haut, puis orange, puis vert
      lampes.setMatrixAt(i * 3 + k, matrice);
      lampes.setColorAt(i * 3 + k, eteinte);
    }
  });
  boitiers.castShadow = true;
  groupe.add(boitiers, lampes);
  const couleurs = { rouge: new THREE.Color('#FF3B30'), orange: new THREE.Color('#FFB020'), vert: new THREE.Color('#34C759') };
  const ordre = ['rouge', 'orange', 'vert'];
  let cle = '';
  lampes.userData.maj = (temps, ctx) => {
    const etats = tetes.map(t => ctx.trafic.etatFeu?.(t.feu, t.axe) ?? 'eteint');
    const nouvelle = etats.join();
    if (nouvelle === cle) return;
    cle = nouvelle;
    etats.forEach((etat, i) => ordre.forEach((nom, k) => lampes.setColorAt(i * 3 + k, nom === etat ? couleurs[nom] : eteinte)));
    lampes.instanceColor.needsUpdate = true;
  };
  return groupe;
}

// Bateaux du bassin du port : coque blanche, cabine colorée, qui se balancent.
function bateaux(v, c) {
  const { THREE } = c;
  if (!v.bateaux?.length) return null;
  const groupe = new THREE.Group();
  for (const b of v.bateaux) {
    const bateau = new THREE.Group();
    const coque = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), c.materiau('#FFFFFF'));
    coque.scale.set(17, 5, 6);
    coque.castShadow = true;
    const cabine = c.boite(10, 5, 7, b.couleur);
    cabine.position.set(-2, 3, 0);
    bateau.add(coque, cabine);
    bateau.userData.maj = temps => {
      bateau.position.set(b.x + Math.sin(temps / 2500 + b.phase) * 8, 0, b.y + Math.sin(temps / 900 + b.phase) * 2);
      bateau.rotation.x = Math.sin(temps / 900 + b.phase) * 0.06;
      bateau.rotation.z = Math.sin(temps / 1300 + b.phase) * 0.04;
    };
    groupe.add(bateau);
  }
  return groupe;
}

// Centrale électrique : usine jaune (⚡ et watts sur le toit), tours de refroidissement qui fument plus
// vite quand la consommation monte, et piste de course suspendue jusqu'au hall central.
function centrale(v, c) {
  const { THREE } = c;
  const ce = v.centrale;
  if (!ce) return null;
  const p = c.palette;
  const groupe = new THREE.Group();
  const u = ce.usine;
  const usine = bloc(c, u.l, HAUTEUR_USINE, u.h, 10, JAUNE, '#B88A1E');
  usine.position.set(u.x + u.l / 2, 0, u.y + u.h / 2);
  groupe.add(usine);
  const eclair = panneauToit(c, '⚡', 36, 28, HAUTEUR_USINE, { fond: JAUNE });
  eclair.position.x = usine.position.x;
  eclair.position.z = usine.position.z - 8;
  groupe.add(eclair);
  // Consommation estimée, refaite quand elle change
  let watts = null;
  let panneauWatts = null;
  usine.userData.maj = (temps, ctx) => {
    const w = Math.round(ctx.trafic.watts ?? 0);
    if (w === watts) return;
    watts = w;
    if (panneauWatts) {
      groupe.remove(panneauWatts);
      panneauWatts.geometry.dispose();
      panneauWatts.material.map.dispose();
      panneauWatts.material.dispose();
    }
    panneauWatts = panneauToit(c, `≈ ${w} W`, 60, 14, HAUTEUR_USINE, { fond: JAUNE });
    panneauWatts.position.x = usine.position.x;
    panneauWatts.position.z = usine.position.z + 18;
    groupe.add(panneauWatts);
  };

  // Tours de refroidissement (profil hyperbolique) et leurs bouffées de vapeur
  const flanc = new THREE.MeshLambertMaterial({ color: '#C9CCD6', side: THREE.DoubleSide });
  for (const t of ce.tours) {
    const haut = t.r * 2.4;
    const profil = [[1, 0], [0.86, 0.3], [0.72, 0.62], [0.7, 0.75], [0.76, 1]]
      .map(([r, h]) => new THREE.Vector2(t.r * r, haut * h));
    const tourRefroidissement = new THREE.Mesh(new THREE.LatheGeometry(profil, 32), flanc);
    tourRefroidissement.position.set(t.x, 0, t.y);
    tourRefroidissement.castShadow = tourRefroidissement.receiveShadow = true;
    const fond = new THREE.Mesh(new THREE.CircleGeometry(t.r * 0.7, 32), c.materiau('#8E95A6'));
    fond.rotation.x = -Math.PI / 2;
    fond.position.set(t.x, haut * 0.75, t.y);
    groupe.add(tourRefroidissement, fond);
    for (let i = 0; i < 3; i++) {
      const bouffee = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), c.materiau('#FFFFFF', { transparent: true, opacite: 0.5, propre: true }));
      bouffee.material.depthWrite = false;
      bouffee.userData.maj = (temps, ctx) => {
        const rythme = 2600 - Math.min(1800, (ctx.trafic.watts ?? 0) * 25);
        const k = (temps / rythme + i / 3 + t.x * 0.01) % 1;
        const r = t.r * (0.45 + k * 0.5);
        bouffee.position.set(t.x + k * 10, haut + k * 40, t.y);
        bouffee.scale.set(r, r * 0.8, r);
        bouffee.material.opacity = 0.55 * (1 - k);
      };
      groupe.add(bouffee);
    }
  }

  // Piste électrique : chaussée sombre, lueur jaune dessous, bordures en damier rouge et blanc qui défilent
  const points = echantillonner(ce.piste, 4);
  const hauteurs = fractions(points).map(hauteurPiste);
  const lueur = new THREE.Mesh(ruban(THREE, points, hauteurs.map(h => h - 0.4), 15),
    new THREE.MeshBasicMaterial({ color: JAUNE, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  const chaussee = new THREE.Mesh(ruban(THREE, points, hauteurs, 9), new THREE.MeshLambertMaterial({ color: '#3A3F4B', side: THREE.DoubleSide }));
  chaussee.castShadow = true;
  groupe.add(lueur, chaussee);
  const toile = document.createElement('canvas');
  toile.width = 2;
  toile.height = 1;
  const ctx2 = toile.getContext('2d');
  ctx2.fillStyle = ROUGE; ctx2.fillRect(0, 0, 1, 1);
  ctx2.fillStyle = '#FFFFFF'; ctx2.fillRect(1, 0, 1, 1);
  const damier = new THREE.CanvasTexture(toile);
  damier.colorSpace = THREE.SRGBColorSpace;
  damier.magFilter = damier.minFilter = THREE.NearestFilter;
  damier.wrapS = damier.wrapT = THREE.RepeatWrapping;
  const matBordure = new THREE.MeshBasicMaterial({ map: damier, side: THREE.DoubleSide });
  for (const cote of [-5.5, 5.5]) {
    const bord = decaler(points, cote);
    groupe.add(new THREE.Mesh(ruban(THREE, bord, hauteurs.map(h => h + 0.3), 1.6, 12), matBordure));
  }
  chaussee.userData.maj = temps => { damier.offset.x = -temps / 40 / 12; };
  // Piliers sous la piste
  const piliers = [];
  let dernier = -Infinity;
  const longueurs = cumul(points);
  points.forEach(([x, y], i) => {
    if (hauteurs[i] < 8 || longueurs[i] - dernier < 70) return;
    dernier = longueurs[i];
    piliers.push([x, y, hauteurs[i]]);
  });
  groupe.add(colonnes(c, piliers, 2, p.tourFlanc));
  return groupe;
}

// ---------- Véhicules : sur les ponts, ils montent avec le tablier ----------

let segmentsPonts = { version: null, liste: [] };

export function altitudeVehicule(v, c, p) {
  const ville = c.ville;
  if (segmentsPonts.version !== ville.version) {
    segmentsPonts = {
      version: ville.version,
      liste: (ville.ponts ?? []).map(pont => {
        const [de, a] = boutsPont(pont);
        const [dx, dy] = [a[0] - de[0], a[1] - de[1]];
        return { de, dx, dy, l2: dx * dx + dy * dy || 1 };
      }),
    };
  }
  for (const s of segmentsPonts.liste) {
    const t = ((p.x - s.de[0]) * s.dx + (p.y - s.de[1]) * s.dy) / s.l2;
    if (t <= 0 || t >= 1) continue;
    const ecart = Math.abs((p.x - s.de[0]) * s.dy - (p.y - s.de[1]) * s.dx) / Math.sqrt(s.l2);
    if (ecart < 24) return hauteurPont(t) + 0.6;
  }
  return 0;
}

// Voitures de course de la piste électrique (une maille instanciée, plus leur traînée lumineuse).
export function dynamique(groupe, c) {
  const { THREE } = c;
  let course = groupe.userData.courses;
  if (!course) {
    const voitures = new THREE.InstancedMesh(new THREE.BoxGeometry(14, 3.5, 5), new THREE.MeshLambertMaterial(), MAX_COURSES);
    const trainees = new THREE.InstancedMesh(new THREE.BoxGeometry(10, 1.2, 2.4),
      new THREE.MeshBasicMaterial({ color: JAUNE, transparent: true, opacity: 0.55, depthWrite: false }), MAX_COURSES);
    for (const m of [voitures, trainees]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
    }
    voitures.castShadow = true;
    voitures.setColorAt(0, new THREE.Color('#FFFFFF'));
    groupe.add(voitures, trainees);
    course = groupe.userData.courses = { voitures, trainees, matrice: new THREE.Matrix4(), q: new THREE.Quaternion(),
      axe: new THREE.Vector3(0, 1, 0), pos: new THREE.Vector3(), un: new THREE.Vector3(1, 1, 1), couleur: new THREE.Color() };
  }
  const t = c.trafic;
  const piste = t._piste;
  const { voitures, trainees, matrice, q, axe, pos, un, couleur } = course;
  let n = 0;
  if (piste && t.courses?.length && c.ville.centrale) {
    for (const v of t.courses) {
      if (n >= MAX_COURSES) break;
      const { x, y, angle } = t.positionCourse(v);
      if (!Number.isFinite(x)) continue;
      const h = hauteurPiste(Math.min(1, v.distance / (piste.longueurTotale || 1)));
      q.setFromAxisAngle(axe, -angle);
      pos.set(x, h + 2.2, y);
      matrice.compose(pos, q, un);
      voitures.setMatrixAt(n, matrice);
      voitures.setColorAt(n, couleur.set(v.couleur));
      pos.set(x - Math.cos(angle) * 12, h + 1.2, y - Math.sin(angle) * 12);
      matrice.compose(pos, q, un);
      trainees.setMatrixAt(n, matrice);
      n++;
    }
  }
  voitures.count = trainees.count = n;
  voitures.instanceMatrix.needsUpdate = trainees.instanceMatrix.needsUpdate = true;
  if (voitures.instanceColor) voitures.instanceColor.needsUpdate = true;
}

// ---------- Profils et géométrie ----------

const douce = h => h * h * (3 - 2 * h);

// Le pont touche terre sur l'avenue de son île et au bord extérieur de l'Étoile (pas en son milieu :
// le tablier ne doit pas flotter au-dessus de l'anneau).
function boutsPont(pont) {
  const [ax, ay] = pont.a;
  const d = Math.hypot(ax, ay) || 1;
  return [pont.de, [ax + (ax / d) * BORD_ANNEAU, ay + (ay / d) * BORD_ANNEAU]];
}

function hauteurPont(t) {
  return HAUTEUR_PONT * douce(Math.max(0, Math.min(1, t / RAMPE, (1 - t) / RAMPE)));
}

// De la toiture de l'usine au flanc du hall, en passant haut au-dessus de la mer.
function hauteurPiste(t) {
  const fin = HAUTEUR_HALL - 6;
  return HAUTEUR_USINE + 0.5 + (fin - HAUTEUR_USINE) * t + BOSSE_PISTE * Math.sin(Math.PI * t);
}

function cumul(points) {
  const longueurs = [0];
  for (let i = 1; i < points.length; i++) {
    longueurs.push(longueurs[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return longueurs;
}

function fractions(points) {
  const longueurs = cumul(points);
  const total = longueurs[longueurs.length - 1] || 1;
  return longueurs.map(l => l / total);
}

// Ligne brisée redécoupée en pas réguliers (pour suivre un profil en hauteur).
function echantillonner(points, pas) {
  const res = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / pas));
    for (let k = 1; k <= n; k++) res.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
  }
  return res;
}

// Ruban de largeur donnée le long d'une ligne, à la hauteur donnée en chaque point (u = distance / echelleU).
function ruban(THREE, points, hauteurs, largeur, echelleU = 1) {
  const demi = largeur / 2;
  const longueurs = cumul(points);
  const sommets = [];
  const uv = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    const [px, py] = points[Math.max(0, i - 1)];
    const [nx, ny] = points[Math.min(points.length - 1, i + 1)];
    const n = Math.hypot(nx - px, ny - py) || 1;
    const [ox, oy] = [-(ny - py) / n * demi, (nx - px) / n * demi];
    sommets.push(x + ox, hauteurs[i], y + oy, x - ox, hauteurs[i], y - oy);
    uv.push(longueurs[i] / echelleU, 0, longueurs[i] / echelleU, 1);
    if (i > 0) {
      const b = i * 2;
      indices.push(b - 2, b - 1, b, b - 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sommets, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Colonnes (piles, mâts) du sol à la hauteur donnée : [[x, y, hauteur]…], une maille instanciée.
function colonnes(c, liste, rayon, couleur) {
  const { THREE } = c;
  const geo = new THREE.CylinderGeometry(rayon, rayon, 1, 8);
  geo.translate(0, 0.5, 0);
  const m = new THREE.InstancedMesh(geo, c.materiau(couleur), Math.max(1, liste.length));
  const matrice = new THREE.Matrix4();
  liste.forEach(([x, y, h], i) => {
    matrice.makeScale(1, Math.max(0.1, h), 1);
    matrice.setPosition(x, 0, y);
    m.setMatrixAt(i, matrice);
  });
  m.count = liste.length;
  m.castShadow = true;
  return m;
}

function rectArrondi(ctx, x, y, l, h, r) {
  r = Math.max(0, Math.min(r, l / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + l, y, x + l, y + h, r);
  ctx.arcTo(x + l, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + l, y, r);
  ctx.closePath();
}

function teinte(couleur, alpha) {
  const [r, g, b] = couleur.startsWith('#')
    ? [0, 8, 16].map(k => (parseInt(couleur.slice(1, 7), 16) >> (16 - k)) & 255)
    : couleur.match(/[\d.]+/g).slice(0, 3).map(Number);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Petite valeur pseudo-aléatoire stable pour une application (même dispersion des maisons qu'en 2D).
function hacher(texte, i) {
  let h = 2166136261 ^ i;
  for (let k = 0; k < texte.length; k++) h = Math.imul(h ^ texte.charCodeAt(k), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
