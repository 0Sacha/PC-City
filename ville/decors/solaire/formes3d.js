// Formes 3D du décor « Système solaire » (vue en relief, voir rendu3d.js) : tout le système flotte
// dans le plan des orbites, au-dessus d'un fond d'étoiles. Soleil en sphère (le processeur) qui
// grossit, s'embrase et éclaire les planètes ; planètes (quartiers) avec leurs anneaux de lunes et,
// pour les grosses, un anneau à la Saturne ; lunes (applications) ; stations spatiales (disques) aux
// panneaux solaires qui tournent ; trou de ver (Internet) en entonnoir parcouru de spirales.

import { R_SOLEIL, INCLINAISON, ENTRE_ANNEAUX } from './modele.js';
import { cleCible } from './trafic.js';

const PLAN = 48;               // altitude du plan des orbites (tout le système y flotte)
const ECHELLE_SOLEIL = 0.72;   // le Soleil en sphère serait énorme à la taille du disque 2D
const ECHELLE_LUNE = 1.2;
const PROFONDEUR_TROU = 40;    // le trou de ver plonge sous le plan des orbites
const ROUGE = '#FF4D5E';       // le rouge du décor 2D

export const ciel = p => p.fond;

// Les vaisseaux volent dans le plan des orbites.
export const altitudeVehicule = () => PLAN - 3;

// ---------- Sol : le fond étoilé seul ----------

// Le rendu 2D dessine son fond (nébuleuses, étoiles, orbites) dans _dessinerDecor. Les orbites sont
// ici tracées en 3D, à l'altitude des planètes : on dessine le fond avec une vue du rendu 2D qui ne
// voit aucune planète (objet dérivé de r2 : caméra, taille et palette restent celles de r2).
const vuesFond = new WeakMap();

export function sol(r2) {
  let vue = vuesFond.get(r2);
  if (!vue) {
    vue = Object.create(r2);
    vue.ville = Object.create(r2.ville, { planetes: { value: [] } });
    vuesFond.set(r2, vue);
  }
  vue._dessinerDecor();
  return vue._decor;
}

// ---------- Outils ----------

function versRgb(couleur) {
  if (couleur.startsWith('#')) {
    const n = parseInt(couleur.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return couleur.match(/[\d.]+/g).slice(0, 3).map(Number);
}

// Couleur sans transparence (three.js ignore l'alpha) et transparence seule d'une couleur rgba().
const rgb = couleur => `rgb(${versRgb(couleur).map(Math.round).join(',')})`;
function alpha(couleur) {
  const m = couleur.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/);
  return m ? Number(m[1]) : 1;
}

// Lueur : disque flou toujours tourné vers la caméra, en lumière additive. Il ne capte pas les clics.
let texteLueur = null;
function lueur(c, couleur, opacite) {
  const { THREE } = c;
  if (!texteLueur) {
    const toile = document.createElement('canvas');
    toile.width = toile.height = 128;
    const ctx = toile.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    texteLueur = new THREE.CanvasTexture(toile);
  }
  // Copie qui partage l'image : chaque lueur peut être libérée sans priver les autres.
  const carte = texteLueur.clone();
  carte.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: carte, color: rgb(couleur), transparent: true,
    opacity: opacite, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.raycast = () => {};
  return sprite;
}

// Arc couché dans le plan des orbites : départ au nord, sens des aiguilles d'une montre vu du ciel,
// comme les jauges du 2D.
function arc(c, rayon, tube, part, couleur) {
  const { THREE } = c;
  const m = new THREE.Mesh(new THREE.TorusGeometry(rayon, tube, 8, 64, Math.max(0.02, part) * Math.PI * 2),
    new THREE.MeshBasicMaterial({ color: rgb(couleur) }));
  m.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
  m.raycast = () => {};
  return m;
}

// Cercle de fond d'une jauge (anneau pâle complet).
function fondJauge(c, rayon, tube, opacite) {
  const { THREE } = c;
  const m = new THREE.Mesh(new THREE.TorusGeometry(rayon, tube, 8, 64), c.materiau('#FFFFFF', { transparent: true, opacite }));
  m.rotation.x = Math.PI / 2;
  m.raycast = () => {};
  return m;
}

// Jauge en arc qui se refait quand sa valeur change d'un pour cent.
function jauge(c, rayon, tube, lire) {
  const groupe = new c.THREE.Group();
  let maille = null;
  let cle = '';
  groupe.userData.maj = (temps, ctx) => {
    const [part, couleur] = lire(ctx);
    const nouvelle = `${Math.round(part * 100)}|${couleur}`;
    if (nouvelle === cle) return;
    cle = nouvelle;
    if (maille) { groupe.remove(maille); maille.geometry.dispose(); maille.material.dispose(); }
    maille = arc(c, rayon, tube, part, couleur);
    groupe.add(maille);
  };
  return groupe;
}

// Ellipse (ou cercle) couchée dans le plan, en trait fin, éventuellement pointillé.
function ellipse(c, rx, rz, couleur, opacite, pointille = false) {
  const { THREE } = c;
  const n = 128;
  const points = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const options = { color: rgb(couleur), transparent: true, opacity: opacite, depthWrite: false };
  const ligne = new THREE.LineLoop(geo, pointille
    ? new THREE.LineDashedMaterial({ ...options, dashSize: 6, gapSize: 6 })
    : new THREE.LineBasicMaterial(options));
  if (pointille) ligne.computeLineDistances();
  ligne.raycast = () => {};
  return ligne;
}

// ---------- Lunes (applications) ----------

export function cleApplication(lot, c) {
  const d = lot.app.donnees;
  return [d.etat, d.alerte ? 1 : 0, Math.round(lot.taille * 2), lot.quartier.couleur, c.nuitArrondie].join('|');
}

// Une lune par application : taille selon la RAM, lueur selon le processeur ; pâle et translucide
// en veille, petit caillou gris une fois fermée ; cerclage rouge et épingle en cas d'alerte.
export function application(lot, c) {
  const { THREE } = c;
  const p = c.palette;
  const app = lot.app;
  const d = app.donnees;
  const ferme = d.etat === 'ferme';
  const veille = d.etat === 'veille';
  const r = (ferme ? Math.max(2.5, lot.taille * 0.55) : lot.taille) * ECHELLE_LUNE;
  const couleur = ferme ? p.ferme : c.eclaircir(lot.quartier.couleur, 0.25);
  const groupe = new THREE.Group();
  const centre = new THREE.Group();
  centre.position.y = PLAN;
  groupe.add(centre);

  const matiere = ferme ? c.materiau(couleur)
    : c.materiau(couleur, { lumineux: true, transparent: veille, opacite: veille ? 0.45 : 1 });
  const corps = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), matiere);
  corps.castShadow = !veille;
  corps.receiveShadow = true;
  centre.add(corps);

  let halo = null;
  if (!ferme) {
    halo = lueur(c, couleur, 0);
    centre.add(halo);
  }
  let cerclage = null;
  if (d.alerte) {
    cerclage = new THREE.Mesh(new THREE.TorusGeometry(r + 5, 0.9, 8, 48),
      new THREE.MeshBasicMaterial({ color: ROUGE, transparent: true, opacity: 0.8 }));
    cerclage.rotation.x = Math.PI / 2;
    centre.add(cerclage);
    const epingle = c.epingle(PLAN + r + 3);
    epingle.scale.setScalar(0.7);
    groupe.add(epingle);
  }

  groupe.userData.hauteur = PLAN + r + (d.alerte ? 18 : 4);
  if (ferme) return groupe;
  groupe.userData.maj = temps => {
    const cpu = Math.min(1, app.donnees.cpu / 25);
    matiere.emissiveIntensity = 0.12 + 0.5 * cpu;
    halo.visible = cpu > 0.02;
    halo.scale.setScalar(2 * r * (1.8 + cpu));
    halo.material.opacity = 0.2 + 0.45 * cpu;
    if (cerclage) cerclage.material.opacity = 0.5 + 0.4 * Math.sin(temps / 180);
  };
  return groupe;
}

// ---------- Soleil (processeur et mémoire) ----------

// Plus le processeur travaille, plus le Soleil grossit, brille et lance des éruptions. Il éclaire les
// planètes (face tournée vers lui). Autour, l'anneau de la RAM (bleu, rouge au-delà de 90 %).
export function tour(t, c) {
  const { THREE } = c;
  const p = c.palette;
  const groupe = new THREE.Group();
  const centre = new THREE.Group();
  centre.position.y = PLAN;
  groupe.add(centre);

  const lumiere = new THREE.PointLight(rgb(p.soleil), 1.5, 0, 0);
  centre.add(lumiere);
  const halo = lueur(c, p.soleil, 0.5);
  centre.add(halo);
  const matiere = new THREE.MeshLambertMaterial({ color: '#F07A1A', emissive: rgb(p.soleil), emissiveIntensity: 0.9 });
  const corps = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), matiere);
  centre.add(corps);

  // Éruptions : langues de feu (cônes) qui tournent lentement, plus longues avec le processeur
  const eruptions = new THREE.Group();
  const geoLangue = new THREE.ConeGeometry(1, 1, 10);
  geoLangue.translate(0, 0.5, 0);
  geoLangue.rotateZ(-Math.PI / 2);   // pointe vers +x
  const matLangue = new THREE.MeshBasicMaterial({ color: rgb(p.soleil), transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const langues = [];
  for (let i = 0; i < 12; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.set(0, (i / 12) * Math.PI * 2, (i % 2 ? 1 : -1) * 0.25);
    const langue = new THREE.Mesh(geoLangue, matLangue);
    langue.raycast = () => {};
    pivot.add(langue);
    eruptions.add(pivot);
    langues.push(langue);
  }
  centre.add(eruptions);

  // Anneau de la RAM, à la même distance qu'en 2D
  const rr = R_SOLEIL * 1.25 + 14;
  centre.add(fondJauge(c, rr, 2.5, 0.1));
  centre.add(jauge(c, rr, 2.6, ctx => {
    const s = ctx.ville.systeme;
    const ram = s ? s.ram_utilisee / s.ram_totale : 0;
    return [ram, ram > 0.9 ? ROUGE : ctx.palette.ram];
  }));

  groupe.userData.hauteur = PLAN + R_SOLEIL * 1.1 * ECHELLE_SOLEIL;
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    if (!s) return;
    const soleil = rgb(ctx.palette.soleil);
    const cpu = Math.min(1, s.cpu / 100);
    const R = R_SOLEIL * (0.85 + 0.25 * cpu) * ECHELLE_SOLEIL;
    corps.scale.setScalar(R);
    matiere.emissive.set(soleil);
    matiere.emissiveIntensity = 0.75 + 0.35 * cpu;
    halo.scale.setScalar(2 * R * (2.2 + 1.2 * cpu));
    halo.material.color.set(soleil);
    halo.material.opacity = 0.45 + 0.3 * cpu;
    lumiere.color.set(soleil);
    lumiere.intensity = 1.2 + 1.5 * cpu;
    matLangue.color.set(soleil);
    eruptions.rotation.y = -temps / 9000;
    langues.forEach((langue, i) => {
      const l = R * (0.15 + cpu * (0.3 + 0.3 * Math.sin(temps / 300 + i * 2.1)));
      langue.position.x = R * 0.93;
      langue.scale.set(l, R * 0.11, R * 0.11);
    });
  };
  return groupe;
}

// ---------- Stations spatiales (disques) ----------

// Module central (nom du disque sur le dessus), bras et panneaux solaires qui tournent lentement,
// jauge de remplissage en arc ; lueur rouge qui pulse quand le disque sature.
export function entrepot(e, c) {
  const { THREE } = c;
  const groupe = new THREE.Group();
  const centre = new THREE.Group();
  centre.position.y = PLAN;
  groupe.add(centre);
  const actuel = () => groupe.userData.entrepot ?? e;

  const halo = lueur(c, ROUGE, 0);
  halo.scale.setScalar(150);
  centre.add(halo);

  const bras = new THREE.Group();
  for (const s of [-1, 1]) {
    const poutre = c.boite(24, 3, 6, '#2C3550');
    poutre.position.set(s * 34, -1.5, 0);
    const panneau = c.boite(24, 1.5, 28, '#3F6FB5');
    panneau.position.set(s * 58, -0.75, 0);
    bras.add(poutre, panneau);
    for (const k of [-6, 0, 6]) {
      const trait = c.boite(0.8, 0.3, 28, '#A0C8FF', { ombre: false });
      trait.position.set(s * 58 + k, 0.75, 0);
      bras.add(trait);
    }
  }
  centre.add(bras);

  const module = c.cylindre(24, 16, '#D6DEEE');
  module.position.y = -8;
  centre.add(module);
  const plaque = c.texteSur(e.disque.nom, 30, 15, { fond: '#D6DEEE', couleur: '#26304A' });
  plaque.rotation.x = -Math.PI / 2;
  plaque.position.y = 8.2;
  centre.add(plaque);

  centre.add(fondJauge(c, 29, 2, 0.12));
  centre.add(jauge(c, 29, 2.2, () => {
    const d = actuel().disque;
    const rempli = d.utilise / d.total;
    return [rempli, rempli > 0.9 ? ROUGE : actuel().toit];
  }));

  groupe.userData.hauteur = PLAN + 12;
  groupe.userData.maj = (temps, ctx) => {
    bras.rotation.y = -temps / 12000;
    const saturation = ctx.trafic.saturation.get(cleCible({ type: 'entrepot', entrepot: actuel() })) ?? 0;
    halo.visible = saturation > 0;
    halo.material.opacity = 0.25 + 0.35 * saturation * (0.5 + 0.5 * Math.sin(temps / 250));
  };
  return groupe;
}

// ---------- Trou de ver (Internet) ----------

// Entonnoir qui plonge sous le plan des orbites, parcouru de cinq spirales qui tournent plus vite
// quand le réseau travaille ; vert, rouge quand Internet sature.
export function internet(a, c) {
  const { THREE } = c;
  const groupe = new THREE.Group();
  const R = a.rayon ?? 58;
  const rMin = R * 0.12;
  // Profondeur de l'entonnoir à la distance r du centre (profil en trompette)
  const fond = r => PROFONDEUR_TROU * (rMin / r - rMin / R) / (1 - rMin / R);

  const profil = [];
  for (let i = 0; i <= 24; i++) {
    const r = rMin + (R - rMin) * (i / 24) ** 1.6;
    profil.push(new THREE.Vector2(r, PLAN - fond(r)));
  }
  const matEntonnoir = new THREE.MeshLambertMaterial({ color: '#06120A', emissive: '#8CF29B', emissiveIntensity: 0.3,
    transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
  const entonnoir = new THREE.Mesh(new THREE.LatheGeometry(profil, 56), matEntonnoir);
  groupe.add(entonnoir);
  const gouffre = new THREE.Mesh(new THREE.SphereGeometry(rMin * 1.2, 16, 12), new THREE.MeshBasicMaterial({ color: '#000000' }));
  gouffre.position.y = PLAN - PROFONDEUR_TROU;
  groupe.add(gouffre);

  // Spirales : une seule courbe, répétée cinq fois en rosace
  const points = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const r = R * (0.15 + 0.85 * t);
    const angle = t * 2.4;
    points.push(new THREE.Vector3(Math.cos(angle) * r, PLAN - fond(r) + 0.8, Math.sin(angle) * r));
  }
  const geoSpirale = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 1.1, 6);
  const matSpirale = new THREE.MeshBasicMaterial({ color: '#8CF29B', transparent: true, opacity: 0.8 });
  const tourbillon = new THREE.Group();
  for (let k = 0; k < 5; k++) {
    const spirale = new THREE.Mesh(geoSpirale, matSpirale);
    spirale.rotation.y = (k / 5) * Math.PI * 2;
    tourbillon.add(spirale);
  }
  groupe.add(tourbillon);

  const halo = lueur(c, '#8CF29B', 0.4);
  halo.position.y = PLAN;
  halo.scale.setScalar(2 * R * 1.3);
  groupe.add(halo);

  let precedent = null;
  groupe.userData.hauteur = PLAN + 10;
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    const saturation = ctx.trafic.saturation.get('aeroport') ?? 0;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    const couleur = saturation > 0 ? ROUGE : '#8CF29B';
    matSpirale.color.set(couleur);
    matEntonnoir.emissive.set(couleur);
    matEntonnoir.emissiveIntensity = 0.25 + 0.35 * activite;
    halo.material.color.set(couleur);
    halo.material.opacity = 0.35 + 0.3 * activite + (saturation > 0 ? 0.2 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)) : 0);
    if (precedent !== null) tourbillon.rotation.y += (temps - precedent) / (2600 - 2000 * activite);
    precedent = temps;
  };
  return groupe;
}

// ---------- Planètes (quartiers) et orbites ----------

// Les planètes ne sont pas des éléments de rendu3d.js : elles sont ici, avec leurs orbites en
// pointillés, et suivent leur position du moment (elles tournent autour du Soleil).
export function extras(v, c) {
  const { THREE } = c;
  const p = c.palette;
  const planetes = v.planetes ?? [];
  if (!planetes.length) return null;
  const groupe = new THREE.Group();
  const opaciteOrbite = Math.min(0.5, alpha(p.orbite) * 2);

  for (const q of planetes) {
    const orbite = ellipse(c, q.orbite, q.orbite * INCLINAISON, p.orbite, opaciteOrbite, true);
    orbite.position.y = PLAN;
    groupe.add(orbite);
    const rayonTrace = q.orbite;
    orbite.userData.maj = () => {
      const k = q.orbite / rayonTrace;
      orbite.scale.set(k, 1, k);
    };

    const systeme = new THREE.Group();
    systeme.position.y = PLAN;
    const corps = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 22), c.materiau(q.couleur));
    corps.castShadow = corps.receiveShadow = true;
    systeme.add(corps);

    // Anneau à la Saturne des gros quartiers (penché comme en 2D)
    const pivot = new THREE.Group();
    pivot.rotation.y = 0.4;
    const saturne = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.9, 64),
      new THREE.MeshLambertMaterial({ color: rgb(c.eclaircir(q.couleur, 0.3)), transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    saturne.rotation.x = -Math.PI / 2 + 0.45;
    saturne.castShadow = true;
    pivot.add(saturne);
    systeme.add(pivot);

    // Anneaux où tournent les lunes (ellipses aplaties, comme leurs trajectoires)
    const anneaux = [];
    for (let j = 0; j < (q.anneaux ?? 1); j++) {
      const anneau = ellipse(c, 1, INCLINAISON, q.couleur, 0.22);
      systeme.add(anneau);
      anneaux.push(anneau);
    }

    systeme.userData.maj = () => {
      systeme.position.x = q.x ?? 0;
      systeme.position.z = q.y ?? 0;
      const r = q.rayonPlanete;
      corps.scale.setScalar(r);
      pivot.visible = q.apps.length >= 8;
      pivot.scale.setScalar(r);
      anneaux.forEach((anneau, j) => {
        const ra = q.premierAnneau + j * ENTRE_ANNEAUX;
        anneau.scale.set(ra, 1, ra);
      });
    };
    groupe.add(systeme);
  }
  return groupe;
}
