// Formes 3D du décor « Ville » (vue en relief, voir rendu3d.js) : immeubles en maquette façon
// Mini Motorways, fenêtres qui s'allument la nuit, pastilles du processeur sur le toit, maisons des
// processus, tour à deux anneaux, entrepôts du port, aéroport avec son avion, arbres et autoroutes
// suspendues au-dessus de la ville.

import { cleCible } from './trafic.js';

const HAUTEUR_AUTOROUTE = 42;
const RAMPE = 0.18;   // part du ruban où l'autoroute monte (et redescend) depuis le sol
const EMPLACEMENTS_MAISONS = [
  [-2, 1], [2, 1], [-2, 2], [2, 2], [-2, 0], [2, 0], [-2, 3], [2, 3],
  [-1, 1], [1, 1], [-1, 2], [1, 2], [-1, 0], [1, 0], [-1, 3], [1, 3],
];
const PALIERS_CPU = [0.5, 3, 10, 25];

export const ciel = p => p.mer;

export function cleApplication(lot, c) {
  const d = lot.app.donnees;
  const part = Math.sqrt(Math.min(1, d.ram / c.ramMax));
  return [d.etat, d.alerte ? 1 : 0, Math.round(part * 24), lot.app.quartier.couleur,
    Math.min(d.nb_processus, EMPLACEMENTS_MAISONS.length), Math.round(c.nuit * 4)].join('|');
}

// Façades : une grille de fenêtres, qui ne se voit que la nuit (lumière émise par les fenêtres).
let texteFenetres = null;
function fenetres(c) {
  if (!texteFenetres) {
    const toile = document.createElement('canvas');
    toile.width = toile.height = 64;
    const ctx = toile.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(18, 16, 28, 30);
    texteFenetres = new c.THREE.CanvasTexture(toile);
    texteFenetres.wrapS = texteFenetres.wrapT = c.THREE.RepeatWrapping;
  }
  return texteFenetres;
}

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
  const haut = ferme ? 10 : 18 + 112 * part;
  const groupe = new THREE.Group();
  const decalageY = -2;   // comme en 2D, l'immeuble est un peu au nord de sa parcelle

  // Immeuble : flancs à fenêtres (allumées la nuit), toit plein
  const carte = fenetres(c).clone();
  carte.repeat.set(Math.max(1, Math.round(cote / 9)), Math.max(1, Math.round(haut / 11)));
  carte.needsUpdate = true;
  const flanc = new THREE.MeshLambertMaterial({ color: fonce === couleur ? couleur : c.melanger(couleur, fonce, 0.35),
    emissive: '#FFD58A', emissiveMap: carte, emissiveIntensity: 0 });
  const toit = new THREE.MeshLambertMaterial({ color: couleur });
  const geo = new THREE.BoxGeometry(cote, haut, cote);
  geo.translate(0, haut / 2, 0);
  const immeuble = new THREE.Mesh(geo, [flanc, flanc, toit, toit, flanc, flanc]);
  immeuble.castShadow = immeuble.receiveShadow = true;
  immeuble.position.z = decalageY;
  groupe.add(immeuble);

  // Maisons : les processus, en petits blocs autour de l'immeuble (comme en 2D)
  const nbMaisons = ferme ? 0 : Math.min(d.nb_processus, EMPLACEMENTS_MAISONS.length);
  const [cxLot, cyLot] = [lot.x + lot.l / 2, lot.y + lot.h / 2];
  for (let i = 0; i < nbMaisons; i++) {
    const [colonne, rangee] = EMPLACEMENTS_MAISONS[i];
    const mx = colonne < 0 ? lot.x + 2 + (-colonne - 1) * 10 : lot.x + lot.l - 10 - (colonne - 1) * 10;
    const my = lot.y + 6 + rangee * 13;
    const maison = c.boite(8, 6 + (i % 3) * 2, 8, couleur);
    maison.position.set(mx + 4 - cxLot, 0, my + 4 - cyLot);
    groupe.add(maison);
  }

  if (ferme) {
    // Rideau baissé et panneau « FERMÉ » sur la façade sud
    const panneau = c.texteSur('FERMÉ', 22, 7);
    panneau.position.set(0, haut * 0.55, decalageY + cote / 2 + 0.3);
    groupe.add(panneau);
    groupe.userData.hauteur = haut;
    return groupe;
  }

  // Pastilles du toit : s'allument selon l'activité du processeur
  const pastilles = [];
  const ecart = cote / 4.5;
  for (let i = 0; i < 4; i++) {
    const pastille = c.cylindre(Math.max(2.2, cote / 13), 1.2, '#FFFFFF', { lumineux: true, faces: 16, ombre: false });
    pastille.position.set(i % 2 ? ecart : -ecart, haut, decalageY + (i < 2 ? -ecart : ecart));
    pastilles.push(pastille);
    groupe.add(pastille);
  }
  if (d.alerte) groupe.add(c.epingle(haut + 10));

  groupe.userData.hauteur = haut;
  groupe.userData.maj = (temps, ctx) => {
    const donnees = app.donnees;
    const allumees = donnees.etat === 'veille' ? 0 : PALIERS_CPU.filter(s => donnees.cpu >= s).length;
    const pulsation = allumees ? 0.75 + 0.25 * Math.sin(temps / 300 + lot.x) : 1;
    pastilles.forEach((m, i) => {
      m.material.emissiveIntensity = i < allumees ? 0.9 * pulsation : 0;
      m.material.color.set(i < allumees ? '#FFFFFF' : '#D8D2C6');
    });
    // Fenêtres : allumées avec la nuit, moins nombreuses pour un programme en veille
    flanc.emissiveIntensity = (ctx.palette.phares ?? 0) * (donnees.etat === 'veille' ? 0.25 : 0.85);
  };
  return groupe;
}

export function tour(t, c) {
  const p = c.palette;
  const groupe = new c.THREE.Group();
  const r = t.rayon * 0.8;
  const haut = 150;
  groupe.add(c.cylindre(r * 1.15, 10, p.tourFlanc));
  const fut = c.cylindre(r * 0.78, haut, p.tour, { rHaut: r * 0.62, propre: true });
  groupe.add(fut);
  const couronne = c.cylindre(r, 8, p.tourFlanc);
  couronne.position.y = haut - 8;
  groupe.add(couronne);
  groupe.add(c.anneaux(r * 1.1, haut));
  // Balise au sommet : pulse plus vite et plus fort quand le processeur travaille
  const balise = c.cylindre(3, 26, '#F2A541', { lumineux: true, rHaut: 0.8, faces: 12 });
  balise.position.y = haut;
  groupe.add(balise);
  groupe.userData.hauteur = haut + 26;
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    if (!s) return;
    const cpu = s.cpu / 100;
    const pulse = (Math.sin(temps / (600 - 400 * cpu)) + 1) / 2;
    balise.material.emissiveIntensity = 0.3 + 1.2 * cpu * pulse;
    fut.material.color.set(ctx.palette.tour);
  };
  return groupe;
}

// Halo rouge qui pulse au pied d'un disque ou de l'aéroport saturé (embouteillage).
function halo(c, l, h, cle) {
  const { THREE } = c;
  const anneau = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48),
    new THREE.MeshBasicMaterial({ color: '#E8504F', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  anneau.rotation.x = -Math.PI / 2;
  anneau.position.y = 0.8;
  const rayon = Math.max(l, h) * 0.72;
  anneau.scale.set(rayon, rayon, 1);
  anneau.userData.maj = (temps, ctx) => {
    const saturation = ctx.trafic.saturation.get(cle) ?? 0;
    const pulse = (Math.sin(temps / 400) + 1) / 2;
    anneau.material.opacity = saturation > 0 ? 0.35 + 0.5 * saturation * pulse : 0;
    const r = rayon * (1 + 0.06 * pulse);
    anneau.scale.set(r, r, 1);
  };
  return anneau;
}

export function entrepot(e, c) {
  const p = c.palette;
  const groupe = new c.THREE.Group();
  const haut = 30;
  groupe.add(c.boite(e.l, haut, e.h, p.entrepot));
  // Bandeau de toit coloré (côté nord), comme en 2D
  const bandeau = c.boite(e.l, haut + 4, 26, e.toit);
  bandeau.position.z = -e.h / 2 + 13;
  groupe.add(bandeau);
  // Piles de caisses sur le toit : hauteur selon l'espace utilisé
  const jauge = c.jaugeDisque(e, e.l - 16, e.h - 40, haut);
  jauge.position.z = 10;
  groupe.add(jauge);
  groupe.add(halo(c, e.l, e.h, cleCible({ type: 'entrepot', entrepot: e })));
  groupe.userData.hauteur = haut + 30;
  return groupe;
}

// L'aéroport (Internet) : piste, terminal, tour de contrôle et un avion qui roule puis décolle.
export function internet(a, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  const [ox, oy] = [a.x + a.l / 2, a.y + a.h / 2];
  const r = a.piste;
  const piste = c.boite(r.l, 1, r.h, p.piste, { ombre: false });
  piste.position.set(r.x + r.l / 2 - ox, 0, r.y + r.h / 2 - oy);
  groupe.add(piste);
  const marque = c.boite(r.l - 32, 0.3, 2.5, '#FFFFFF', { ombre: false });
  marque.position.set(piste.position.x, 1, piste.position.z);
  groupe.add(marque);

  const t = a.terminal;
  const terminal = c.boite(t.l, 24, t.h, '#5BC8E8');
  terminal.position.set(t.x + t.l / 2 - ox, 0, t.y + t.h / 2 - oy);
  groupe.add(terminal);
  const tourControle = c.cylindre(5, 52, '#E6E8EE');
  tourControle.position.set(t.x + t.l + 18 - ox, 0, t.y + 14 - oy);
  const vigie = c.cylindre(10, 8, '#2BA3C9', { rHaut: 12 });
  vigie.position.set(tourControle.position.x, 52, tourControle.position.z);
  groupe.add(tourControle, vigie);
  const haloTerminal = halo(c, t.l, t.h, 'aeroport');
  haloTerminal.position.set(terminal.position.x, 0.8, terminal.position.z);
  groupe.add(haloTerminal);

  // Avion : fuselage et ailes
  const avion = new THREE.Group();
  avion.add(c.boite(26, 5, 5, '#FFFFFF'));
  const ailes = c.boite(6, 1.2, 26, '#FFFFFF');
  ailes.position.y = 2;
  const derive = c.boite(4, 7, 1, '#E8504F');
  derive.position.set(-11, 4, 0);
  avion.add(ailes, derive);
  groupe.add(avion);
  avion.userData.maj = temps => {
    const progres = (temps / 9000) % 1;
    const x = r.x + 30 + progres * (r.l - 60) - ox;
    const envol = Math.max(0, (progres - 0.55) / 0.45);
    avion.position.set(x, 1 + envol * envol * 90, piste.position.z);
    avion.rotation.z = envol > 0 ? 0.25 : 0;
    avion.visible = progres < 0.97;
  };

  groupe.userData.hauteur = 60;
  return groupe;
}

// Arbres en volume, posés sur ceux du sol (une seule maille instanciée pour tous).
export function extras(v, c) {
  const { THREE } = c;
  const arbres = v.arbres ?? [];
  if (!arbres.length) return null;
  const p = c.palette;
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const maille = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: p.arbre }), arbres.length);
  const matrice = new THREE.Matrix4();
  arbres.forEach((a, i) => {
    const r = a.r ?? 8;
    matrice.makeScale(r, r * 1.15, r);
    matrice.setPosition(a.x, r * 1.15 + 2, a.y);
    maille.setMatrixAt(i, matrice);
  });
  maille.castShadow = true;
  maille.receiveShadow = true;
  maille.userData.maj = (temps, ctx) => maille.material.color.set(ctx.palette.arbre);
  return maille;
}

// ---------- Autoroutes (ruban suspendu, rampes au départ et à l'arrivée) ----------

const douce = h => h * h * (3 - 2 * h);

function profil(t) {
  return douce(Math.max(0, Math.min(1, t / RAMPE, (1 - t) / RAMPE)));
}

// Les véhicules sur une autoroute montent sur le ruban.
export function altitudeVehicule(v) {
  if (!v.hauteur) return 0;
  const [d0, d1] = v.hauteur;
  if (v.distance <= d0 || v.distance >= d1) return 0;
  return HAUTEUR_AUTOROUTE * profil((v.distance - d0) / (d1 - d0)) + 2;
}

export function dynamique(groupe, c, temps, liberer) {
  const { THREE } = c;
  const autoroutes = c.trafic.autoroutes;
  if (!autoroutes) return;
  const vues = new Set();
  for (const a of autoroutes.values()) {
    if (a.numero === undefined) continue;
    const g = c.trafic.geometrieAutoroute(a);
    if (!g || g.a <= g.de) continue;
    vues.add(a);
    const cle = `${c.ville.version}|${g.de.toFixed(2)}|${g.a.toFixed(2)}`;
    let maille = groupe.children.find(m => m.userData.autoroute === a);
    if (maille?.userData.cle === cle) continue;
    if (maille) { groupe.remove(maille); liberer(maille); }
    maille = ruban(THREE, g.points, g.de, g.a);
    if (!maille) continue;
    maille.userData.autoroute = a;
    maille.userData.cle = cle;
    groupe.add(maille);
  }
  for (const m of [...groupe.children]) {
    if (vues.has(m.userData.autoroute)) continue;
    groupe.remove(m);
    liberer(m);
  }
}

// Ruban large de 4 voies, de la part « de » à la part « a » du trajet (il se déroule à l'ouverture
// et s'enroule à la fermeture), soutenu par des piliers.
function ruban(THREE, points, de, a) {
  if (points.length < 2) return null;
  const longueurs = [0];
  for (let i = 1; i < points.length; i++) {
    longueurs.push(longueurs[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const total = longueurs[longueurs.length - 1] || 1;
  const demi = 19;
  const sommets = [];
  const indices = [];
  const piliers = new THREE.Group();
  let dernierPilier = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const t = longueurs[i] / total;
    if (t < de - 1e-3 || t > a + 1e-3) continue;
    const [x, y] = points[i];
    const [px, py] = points[Math.max(0, i - 1)];
    const [nx, ny] = points[Math.min(points.length - 1, i + 1)];
    const n = Math.hypot(nx - px, ny - py) || 1;
    const [ox, oy] = [-(ny - py) / n * demi, (nx - px) / n * demi];
    const h = HAUTEUR_AUTOROUTE * profil(t);
    const base = sommets.length / 3;
    sommets.push(x + ox, h, y + oy, x - ox, h, y - oy);
    if (base > 0) indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
    if (h > 12 && longueurs[i] - dernierPilier > 90) {
      dernierPilier = longueurs[i];
      const pilier = new THREE.Mesh(new THREE.BoxGeometry(5, h, 5), new THREE.MeshLambertMaterial({ color: '#D9C9BE' }));
      pilier.position.set(x, h / 2, y);
      pilier.castShadow = true;
      piliers.add(pilier);
    }
  }
  if (sommets.length < 12) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sommets, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const tablier = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#F4B39A', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  tablier.castShadow = true;
  const groupe = new THREE.Group();
  groupe.add(tablier, piliers);
  return groupe;
}
