// Formes 3D du décor « Ville néon » (vue en relief, voir rendu3d.js) : blocs sombres aux arêtes
// lumineuses de la couleur du quartier, fenêtres qui s'allument avec le processeur, cœur du
// processeur en réacteur (anneaux CPU et RAM, noyau qui tourne), coffres de données en verre avec
// leur jauge, portail Internet en vortex, impulsions vers le cœur et traînées de lumière au sol.
//
// Le sol (grille, secteurs, routes lumineuses) vient de Rendu._dessinerDecor() du rendu 2D, qui ne
// dessine que le fond fixe : pas besoin d'exporter sol().
//
// Les lueurs sont des matériaux « basiques » (insensibles à l'éclairage) en mélange additif, comme
// les traits superposés en mode « lighter » du rendu 2D.

import { cleCible, GABARITS, TRAINEE } from './trafic.js';

const ROUGE = '#FF3B5C';
const CYAN = '#29E6FF';
const VERT = '#7CFF6B';
const HAUT_COEUR = 78;            // hauteur de la colonne du réacteur
const MAX_IMPULSIONS = 200;
const MAX_SOMMETS_TRAINEES = 48000;
const PAS_TRAINEE = 7;            // longueur d'un tronçon de traînée

export const ciel = p => p.fond;

export function cleApplication(lot, c) {
  const d = lot.app.donnees;
  const part = Math.sqrt(Math.min(1, d.ram / c.ramMax));
  return [d.etat, d.alerte ? 1 : 0, Math.round(part * 24), lot.app.quartier.couleur,
    Math.min(9, d.nb_processus), c.nuitArrondie].join('|');
}

// ---------- Matériaux lumineux ----------

// Lueurs partagées (une par couleur et opacité) : additives, ni éclairées ni écrites en profondeur.
// « partage » évite que rendu3d.js les libère avec le premier volume qui les utilise.
const lueursPartagees = new Map();
function lueur(THREE, couleur, opacite) {
  const cle = `${couleur}|${opacite}`;
  let m = lueursPartagees.get(cle);
  if (!m) {
    m = lueurPropre(THREE, couleur, opacite);
    m.userData.partage = true;
    lueursPartagees.set(cle, m);
  }
  return m;
}

// Lueur propre à un volume (son opacité ou sa couleur s'anime).
function lueurPropre(THREE, couleur, opacite) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(couleur), transparent: true, opacity: opacite,
    blending: THREE.AdditiveBlending, depthWrite: false });
}

// Arêtes lumineuses d'une géométrie (le filet néon du contour en 2D).
function aretes(THREE, geo, couleur, { pointilles = false, opacite = 0.95 } = {}) {
  const materiau = pointilles
    ? new THREE.LineDashedMaterial({ color: new THREE.Color(couleur), dashSize: 3, gapSize: 3, transparent: true, opacity: opacite })
    : new THREE.LineBasicMaterial({ color: new THREE.Color(couleur), transparent: true, opacity: opacite });
  const lignes = new THREE.LineSegments(new THREE.EdgesGeometry(geo), materiau);
  if (pointilles) lignes.computeLineDistances();
  return lignes;
}

// Disque posé au sol (halo), à plat.
function disque(THREE, rayon, materiau, y) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(rayon, 48), materiau);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

// Fenêtres : une grille de carreaux (blancs sur noir) servant de carte d'émission. Une texture par
// découpage (colonnes × étages), partagée par tous les blocs qui ont le même.
let carreau = null;
const grillesFenetres = new Map();
function fenetres(THREE, colonnes, etages) {
  const cle = `${colonnes}x${etages}`;
  if (grillesFenetres.has(cle)) return grillesFenetres.get(cle);
  if (!carreau) {
    carreau = document.createElement('canvas');
    carreau.width = carreau.height = 32;
    const ctx = carreau.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(7, 7, 18, 18);
  }
  const texture = new THREE.CanvasTexture(carreau);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(colonnes, etages);
  grillesFenetres.set(cle, texture);
  return texture;
}

// ---------- Applications : blocs néon ----------

// Bloc carré (orienté vers son avenue comme en 2D), d'autant plus haut que l'application occupe de
// mémoire ; arêtes et fenêtres de la couleur du quartier, plus vives quand le processeur travaille ;
// pâle et clignotant en veille ; bloc bas, gris et contour en pointillés une fois fermé.
export function application(lot, c) {
  const { THREE } = c;
  const p = c.palette;
  const app = lot.app;
  const d = app.donnees;
  const ferme = d.etat === 'ferme';
  const couleur = ferme ? p.ferme : app.quartier.couleur;
  const part = Math.sqrt(Math.min(1, d.ram / c.ramMax));
  const cote = lot.l;
  const haut = ferme ? 4 : 10 + 70 * part;
  const groupe = new THREE.Group();
  groupe.rotation.y = -(lot.angle + Math.PI / 2);   // même orientation que le carré du rendu 2D

  // Alerte : épingle et cercle rouge qui pulse au pied du bloc
  const alerte = () => {
    if (!d.alerte) return;
    groupe.add(c.epingle(haut + 8));
    const cercle = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), lueurPropre(THREE, ROUGE, 0.6));
    cercle.rotation.x = -Math.PI / 2;
    cercle.position.y = 0.7;
    cercle.scale.set(cote * 0.85, cote * 0.85, 1);
    cercle.userData.maj = temps => { cercle.material.opacity = 0.5 + 0.4 * Math.sin(temps / 180); };
    groupe.add(cercle);
  };

  if (ferme) {
    const corps = c.boite(cote, haut, cote, c.melanger(p.fond, p.ferme, 0.5));
    groupe.add(corps);
    groupe.add(aretes(THREE, corps.geometry, c.eclaircir(p.ferme, 0.25), { pointilles: true, opacite: 0.7 }));
    alerte();
    groupe.userData.hauteur = haut;
    return groupe;
  }

  // Corps sombre teinté, fenêtres en carte d'émission : une colonne par racine du nombre de
  // processus (comme la grille de fenêtres vue du ciel en 2D), un étage tous les 12 px.
  const n = Math.max(1, Math.min(9, d.nb_processus));
  const colonnes = Math.ceil(Math.sqrt(n));
  const etages = Math.max(1, Math.round(haut / 12));
  const teinteCorps = c.melanger(p.fond, couleur, 0.22);
  const flanc = new THREE.MeshLambertMaterial({ color: new THREE.Color(teinteCorps), emissive: new THREE.Color(couleur),
    emissiveMap: fenetres(THREE, colonnes, etages), emissiveIntensity: 0 });
  const toit = new THREE.MeshLambertMaterial({ color: new THREE.Color(teinteCorps), emissive: new THREE.Color(couleur),
    emissiveMap: fenetres(THREE, colonnes, colonnes), emissiveIntensity: 0 });
  const geo = new THREE.BoxGeometry(cote, haut, cote);
  geo.translate(0, haut / 2, 0);
  const corps = new THREE.Mesh(geo, [flanc, flanc, toit, toit, flanc, flanc]);
  corps.castShadow = corps.receiveShadow = true;
  groupe.add(corps);

  // Filet néon sur les arêtes, et une gaine lumineuse un peu plus large (la lueur du trait épais)
  const filet = aretes(THREE, geo, couleur);
  groupe.add(filet);
  const gaine = c.boite(cote + 3, haut + 1.5, cote + 3, '#000000', { ombre: false });
  gaine.material = lueurPropre(THREE, couleur, 0.1);
  groupe.add(gaine);

  alerte();
  groupe.userData.hauteur = haut;
  groupe.userData.maj = temps => {
    const donnees = app.donnees;
    const cpu = Math.min(1, donnees.cpu / 25);
    const enVeille = donnees.etat === 'veille';
    const eclat = enVeille ? 0.35 + 0.15 * Math.sin(temps / 900 + lot.cx) : 0.75 + 0.25 * cpu;
    const allume = enVeille ? 0.15 : (0.3 + 0.7 * cpu) * (0.8 + 0.2 * Math.sin(temps / 400 + lot.cx));
    flanc.emissiveIntensity = allume;
    toit.emissiveIntensity = Math.min(1, allume * 1.15);
    filet.material.opacity = 0.95 * eclat;
    gaine.material.opacity = 0.12 * eclat;
  };
  return groupe;
}

// ---------- Cœur du processeur ----------

// Anneaux du CPU (orange) et de la RAM (cyan, rouge au-delà de 90 %) : pistes pâles, et arcs qui se
// remplissent depuis le nord dans le sens des aiguilles d'une montre, avec leur lueur.
function anneauxCoeur(c, R, y) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  groupe.position.y = y;
  const piste = (r, tube, couleur) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 96), lueur(THREE, couleur, 0.18));
    m.rotation.x = -Math.PI / 2;
    return m;
  };
  groupe.add(piste(R * 0.95, 2.4, p.coeur), piste(R * 0.75, 1.7, p.ram));
  let arcs = [];
  let cle = '';
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    if (!s) return;
    const cpu = Math.max(0.01, Math.min(1, s.cpu / 100));
    const ram = Math.max(0.01, Math.min(1, s.ram_utilisee / s.ram_totale));
    const couleurRam = ram > 0.9 ? ROUGE : ctx.palette.ram;
    const nouvelle = `${Math.round(cpu * 200)}|${Math.round(ram * 200)}|${ctx.palette.coeur}|${couleurRam}`;
    if (nouvelle === cle) return;
    cle = nouvelle;
    for (const m of arcs) { groupe.remove(m); m.geometry.dispose(); m.material.dispose(); }
    arcs = [];
    const arc = (r, tube, part, couleur, opacite) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 96, part * Math.PI * 2), lueurPropre(THREE, couleur, opacite));
      // Départ au nord, sens des aiguilles d'une montre vu du ciel, comme en 2D.
      m.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
      arcs.push(m);
      groupe.add(m);
    };
    arc(R * 0.95, 2.6, cpu, ctx.palette.coeur, 0.95);
    arc(R * 0.95, 6, cpu, ctx.palette.coeur, 0.18);
    arc(R * 0.75, 1.9, ram, couleurRam, 0.95);
    arc(R * 0.75, 5, ram, couleurRam, 0.18);
  };
  return groupe;
}

// Le cœur : socle sombre, halo orange qui bat au sol, anneaux CPU et RAM, colonne du réacteur et
// noyau à trois arcs qui tourne plus vite quand le processeur travaille.
export function tour(t, c) {
  const { THREE } = c;
  const p = c.palette;
  const R = t.rayon ?? 70;
  const groupe = new THREE.Group();
  groupe.add(c.cylindre(R * 1.02, 3, c.eclaircir(p.fond, 0.06), { faces: 64 }));
  const halo = disque(THREE, R * 1.2, lueurPropre(THREE, p.coeur, 0.1), 3.2);
  groupe.add(halo);
  groupe.add(anneauxCoeur(c, R, 5));

  // Colonne du réacteur, sa gaine de lumière et la sphère au sommet
  const colonne = c.cylindre(R * 0.14, HAUT_COEUR, p.coeur, { lumineux: true, rHaut: R * 0.09, faces: 24 });
  const gaine = c.cylindre(R * 0.26, HAUT_COEUR * 0.9, p.coeur, { rHaut: R * 0.12, faces: 24, ombre: false });
  gaine.material = lueurPropre(THREE, p.coeur, 0.12);
  const sommet = new THREE.Mesh(new THREE.SphereGeometry(R * 0.13, 20, 14), lueurPropre(THREE, '#FFE2B8', 0.9));
  sommet.position.y = HAUT_COEUR + R * 0.06;
  groupe.add(colonne, gaine, sommet);

  // Noyau : trois arcs autour de la colonne, à deux hauteurs, qui tournent en sens contraires
  const noyaux = [];
  for (const [y, sens] of [[HAUT_COEUR * 0.3, 1], [HAUT_COEUR * 0.62, -1]]) {
    const noyau = new THREE.Group();
    noyau.position.y = y;
    noyau.userData.sens = sens;
    for (let i = 0; i < 3; i++) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(R * 0.4, 1.1, 6, 24, 1.2), lueur(THREE, p.coeur, 0.75));
      arc.rotation.set(-Math.PI / 2, 0, (i * Math.PI * 2) / 3);
      noyau.add(arc);
    }
    noyaux.push(noyau);
    groupe.add(noyau);
  }

  groupe.userData.hauteur = HAUT_COEUR - 10;
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    if (!s) return;
    const cpu = Math.min(1, s.cpu / 100);
    const battement = 0.5 + 0.5 * Math.sin(temps / (500 - 300 * cpu));
    halo.material.opacity = (0.06 + 0.16 * cpu) * (0.6 + 0.4 * battement);
    colonne.material.emissiveIntensity = 0.35 + 0.65 * (0.4 + 0.6 * cpu) * (0.6 + 0.4 * battement);
    gaine.material.opacity = (0.06 + 0.16 * cpu) * (0.6 + 0.4 * battement);
    sommet.scale.setScalar(0.85 + 0.3 * cpu * battement);
    for (const noyau of noyaux) noyau.rotation.y = -noyau.userData.sens * temps / (1400 - 1100 * cpu);
  };
  return groupe;
}

// ---------- Coffres de données (disques) ----------

// Caisson de verre sombre aux arêtes cyan ; à l'intérieur, la jauge (bloc lumineux qui monte avec
// l'espace utilisé, rouge au-delà de 90 %) ; halo rouge qui pulse au sol quand le disque sature.
export function entrepot(e, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  groupe.rotation.y = -(e.angle + Math.PI / 2);
  const l = e.l ?? 70;
  const haut = 34;
  const caisson = c.boite(l, haut, l, p.fond, { transparent: true, opacite: 0.55 });
  caisson.castShadow = false;
  groupe.add(caisson);
  groupe.add(aretes(THREE, caisson.geometry, CYAN));
  const gaine = c.boite(l + 4, haut + 2, l + 4, '#000000', { ombre: false });
  gaine.material = lueur(THREE, CYAN, 0.07);
  groupe.add(gaine);

  // Jauge : volume translucide et dalle vive à son niveau
  const interieur = l - 12;
  const jauge = c.boite(interieur, 1, interieur, CYAN, { ombre: false });
  jauge.material = lueurPropre(THREE, CYAN, 0.28);
  const niveau = c.boite(interieur, 1.2, interieur, CYAN, { ombre: false });
  niveau.material = lueurPropre(THREE, CYAN, 0.9);
  groupe.add(jauge, niveau);

  const halo = disque(THREE, l * 0.85, lueurPropre(THREE, ROUGE, 0), 0.6);
  groupe.add(halo);

  groupe.userData.hauteur = haut + 6;
  groupe.userData.maj = (temps, ctx) => {
    const d = (groupe.userData.entrepot ?? e).disque;   // le disque est renouvelé à chaque relevé
    const rempli = Math.max(0.02, Math.min(1, d.utilise / d.total));
    const h = Math.max(0.5, (haut - 3) * rempli);
    jauge.scale.y = h;
    niveau.position.y = h;
    const couleur = rempli > 0.9 ? ROUGE : CYAN;
    jauge.material.color.set(couleur);
    niveau.material.color.set(couleur);
    const saturation = ctx.trafic.saturation.get(cleCible({ type: 'entrepot', entrepot: { disque: d } })) ?? 0;
    halo.material.opacity = saturation > 0 ? 0.2 + 0.25 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)) : 0;
  };
  return groupe;
}

// ---------- Portail Internet ----------

// Anneau en tirets (une maille instanciée pour tous les tirets).
function anneauTirets(THREE, rayon, tiret, ecart, tube, materiau) {
  const n = Math.max(4, Math.floor((2 * Math.PI * rayon) / (tiret + ecart)));
  const geo = new THREE.TorusGeometry(rayon, tube, 6, 6, tiret / rayon);
  geo.rotateX(-Math.PI / 2);
  const maille = new THREE.InstancedMesh(geo, materiau, n);
  const matrice = new THREE.Matrix4();
  for (let i = 0; i < n; i++) maille.setMatrixAt(i, matrice.makeRotationY((i * Math.PI * 2) / n));
  return maille;
}

// Socle sombre, lueur verte (rouge si le réseau sature) qui s'intensifie avec le débit, deux anneaux
// en tirets qui tournent en sens contraires, et un faisceau qui monte du centre : un vortex.
export function internet(a, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  const r = a.rayon ?? 46;
  groupe.add(c.cylindre(r, 3, c.eclaircir(p.fond, 0.05), { faces: 48 }));
  const fond = disque(THREE, r, lueurPropre(THREE, VERT, 0.3), 3.2);
  const vif = lueurPropre(THREE, VERT, 0.95);
  const doux = lueurPropre(THREE, VERT, 0.15);
  const anneaux = [];
  for (const [rayon, sens, tiret, ecart, y] of [[r, 1, 10, 6, 7], [r * 0.72, -1, 4, 8, 19]]) {
    const anneau = new THREE.Group();
    anneau.position.y = y;
    anneau.userData.sens = sens;
    anneau.add(anneauTirets(THREE, rayon, tiret, ecart, 1.3, vif), anneauTirets(THREE, rayon, tiret, ecart, 3.4, doux));
    anneaux.push(anneau);
    groupe.add(anneau);
  }
  const faisceau = c.cylindre(r * 0.22, 70, VERT, { rHaut: r * 0.05, faces: 24, ombre: false });
  faisceau.material = lueurPropre(THREE, VERT, 0.2);
  groupe.add(fond, faisceau);

  groupe.userData.hauteur = 50;
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    const sature = (ctx.trafic.saturation.get('aeroport') ?? 0) > 0;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    const couleur = sature ? ROUGE : VERT;
    for (const m of [fond.material, vif, doux, faisceau.material]) m.color.set(couleur);
    fond.material.opacity = 0.2 + 0.3 * activite;
    faisceau.material.opacity = 0.08 + 0.25 * activite;
    for (const anneau of anneaux) anneau.rotation.y = -anneau.userData.sens * temps / (3000 - 2400 * activite);
  };
  return groupe;
}

// ---------- Impulsions et traînées de lumière ----------

// Volumes tenus à jour à chaque image : les impulsions du processeur (de l'application vers le
// cœur, le long de l'avenue) et les traînées des flux disque et réseau, en rubans au ras du sol.
// Les véhicules de rendu3d.js forment la tête de chaque traînée.
export function dynamique(groupe, c, temps) {
  const { THREE } = c;
  let n = groupe.userData.neon;
  if (!n) {
    n = creerDynamique(THREE);
    groupe.userData.neon = n;
    groupe.add(n.impulsions, n.trainees);
  }
  majImpulsions(n, c);
  majTrainees(n, c, temps);
}

function creerDynamique(THREE) {
  const impulsions = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_IMPULSIONS);
  impulsions.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  impulsions.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_IMPULSIONS * 3), 3);
  impulsions.instanceColor.setUsage(THREE.DynamicDrawUsage);
  impulsions.frustumCulled = false;
  impulsions.count = 0;

  const geo = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(MAX_SOMMETS_TRAINEES * 3), 3);
  const couleurs = new THREE.BufferAttribute(new Float32Array(MAX_SOMMETS_TRAINEES * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  couleurs.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', positions);
  geo.setAttribute('color', couleurs);
  geo.setDrawRange(0, 0);
  const trainees = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  trainees.frustumCulled = false;
  return { impulsions, trainees, matrice: new THREE.Matrix4(), couleur: new THREE.Color(), couleurs: new Map() };
}

// Couleurs déjà converties (les flux n'en ont que quelques-unes).
function couleurDe(n, texte) {
  let couleur = n.couleurs.get(texte);
  if (!couleur) {
    if (n.couleurs.size > 200) n.couleurs.clear();
    couleur = n.couleur.clone().set(texte);
    n.couleurs.set(texte, couleur);
  }
  return couleur;
}

function majImpulsions(n, c) {
  const v = c.ville;
  const m = n.impulsions;
  const R = v.tour?.rayon ?? 70;
  let k = 0;
  for (const i of c.trafic.impulsions ?? []) {
    if (k >= MAX_IMPULSIONS) break;
    const { acces, angle } = i.lot;
    if (!acces) continue;
    const fin = [Math.cos(angle) * R, Math.sin(angle) * R];
    const x = acces[0] + (fin[0] - acces[0]) * i.t;
    const y = acces[1] + (fin[1] - acces[1]) * i.t;
    const a = Math.sin(Math.PI * i.t);
    n.matrice.makeScale(2.6, 2.6, 2.6).setPosition(x, 3, y);
    m.setMatrixAt(k, n.matrice);
    m.setColorAt(k, n.couleur.copy(couleurDe(n, i.couleur)).multiplyScalar(a));
    k++;
  }
  m.count = k;
  m.instanceMatrix.needsUpdate = true;
  m.instanceColor.needsUpdate = true;
}

function majTrainees(n, c, temps) {
  const t = c.trafic;
  const geo = n.trainees.geometry;
  const pos = geo.attributes.position.array;
  const col = geo.attributes.color.array;
  const couleur = n.couleur;
  let s = 0;   // sommets écrits
  const sommet = (x, y, h, r, g, b) => {
    pos[s * 3] = x; pos[s * 3 + 1] = h; pos[s * 3 + 2] = y;
    col[s * 3] = r; col[s * 3 + 1] = g; col[s * 3 + 2] = b;
    s++;
  };
  for (const v of t.vehicules) {
    if (v.distance <= 0 || (v.app && !v.app.lot)) continue;
    const longueur = TRAINEE[v.gabarit] ?? 30;
    const debut = Math.max(0, v.distance - longueur);
    const points = [];
    for (let d = debut; d < v.distance; d += PAS_TRAINEE) { const q = t.position(v, d); points.push([q.x, q.y]); }
    const tete = t.position(v);
    points.push([tete.x, tete.y]);
    if (points.length < 2) continue;
    if (s + (points.length - 1) * 12 > MAX_SOMMETS_TRAINEES) break;
    // Apparition et disparition en fondu aux bouts du trajet
    const fondu = Math.max(0, Math.min(1, v.distance / 30, (v.longueurTotale - v.distance) / 30));
    const base = v.bouchon ? c.melanger(v.couleur, ROUGE, 0.5 + 0.5 * Math.sin(temps / 200)) : v.couleur;
    couleur.copy(couleurDe(n, base));
    const largeur = GABARITS[v.gabarit]?.largeur ?? 3;
    // Deux rubans : la lueur large et pâle, puis le trait vif
    for (const [l, alpha, h] of [[largeur * 3.5, 0.16, 1.1], [largeur, 0.85, 1.3]]) {
      const demi = l / 2;
      const dernier = points.length - 1;
      for (let j = 0; j < dernier; j++) {
        const [x1, y1] = points[j];
        const [x2, y2] = points[j + 1];
        const norme = Math.hypot(x2 - x1, y2 - y1) || 1;
        const [ox, oy] = [-(y2 - y1) / norme * demi, (x2 - x1) / norme * demi];
        // La traînée s'efface vers sa queue
        const a1 = alpha * fondu * (0.15 + 0.85 * (j / dernier));
        const a2 = alpha * fondu * (0.15 + 0.85 * ((j + 1) / dernier));
        const [r1, g1, b1] = [couleur.r * a1, couleur.g * a1, couleur.b * a1];
        const [r2, g2, b2] = [couleur.r * a2, couleur.g * a2, couleur.b * a2];
        sommet(x1 + ox, y1 + oy, h, r1, g1, b1);
        sommet(x1 - ox, y1 - oy, h, r1, g1, b1);
        sommet(x2 + ox, y2 + oy, h, r2, g2, b2);
        sommet(x1 - ox, y1 - oy, h, r1, g1, b1);
        sommet(x2 - ox, y2 - oy, h, r2, g2, b2);
        sommet(x2 + ox, y2 + oy, h, r2, g2, b2);
      }
    }
  }
  geo.setDrawRange(0, s);
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
}
