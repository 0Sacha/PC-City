// Ville néon : plan circulaire. Au centre, le cœur du processeur ; autour, un secteur par quartier,
// chacun avec son avenue en rayon bordée de ses applications ; un périphérique fait le tour ;
// dehors, les coffres de données (disques) et le portail Internet, reliés au périphérique.
// Les positions sont stables : une application garde sa place tant que la page est ouverte.

export { nomVisible, normaliser } from '../ville/modele.js';
import { normaliser, nomVisible } from '../ville/modele.js';

const R_COEUR = 70;          // rayon du cœur (réacteur CPU / RAM)
const R_INTERIEUR = 130;     // anneau autour du cœur, d'où partent les avenues
const RANGEE = 60;           // distance entre deux rangées d'applications (arcs successifs)
const PLACE = 58;            // largeur d'une place le long d'une rangée
const DEGAGEMENT = 14;       // entre l'avenue et la première place
const AVANT_PREMIER = 66;    // de l'anneau intérieur à la première rangée
const AU_DELA = 56;          // de la dernière rangée au périphérique
const DEHORS = 110;          // du périphérique aux coffres et au portail

export class Ville {
  constructor(quartiers) {
    this.quartiers = new Map(quartiers.map(q => [q.id, { ...q, apps: [] }]));
    this.ordre = quartiers.map(q => q.id);
    this.apps = new Map();        // id -> { donnees, quartier, emplacement, lot }
    this.disques = [];
    this.systeme = null;
  }

  mettreAJour(etat) {
    this.systeme = etat.systeme;
    this.disques = etat.disques;
    const presents = new Set(etat.applications.map(a => a.id));
    for (const id of [...this.apps.keys()]) if (!presents.has(id)) this.apps.delete(id);
    for (const q of this.quartiers.values()) q.apps = [];
    for (const donnees of etat.applications) {
      let app = this.apps.get(donnees.id);
      if (!app) {
        app = { id: donnees.id, nouveau: this.dejaAffiche === true };
        this.apps.set(donnees.id, app);
      }
      const quartier = this.quartiers.get(donnees.quartier) ?? this.quartiers.get('divers') ?? [...this.quartiers.values()][0];
      let emplacement = donnees.emplacement ?? 0;
      while (quartier.apps[emplacement]) emplacement++;
      quartier.apps[emplacement] = app;
      Object.assign(app, { quartier, emplacement, donnees });
    }
    this.ramMax = Math.max(1, ...etat.applications.map(a => a.ram));
    this.dejaAffiche = true;
    this._placer();
  }

  // ---------- Placement ----------

  // Chaque quartier a un secteur dont l'angle suit son nombre d'applications (le plus grand nombre
  // vu : le plan ne rétrécit jamais, les blocs ne bougent pas à chaque relevé). Dans un secteur, les
  // applications se rangent sur des arcs successifs, de part et d'autre de l'avenue, chaque rangée
  // desservie par sa rue en arc : une toile d'araignée lumineuse.
  _placer() {
    const quartiers = this.ordre.map(id => this.quartiers.get(id));
    for (const q of quartiers) q.poids = Math.max(q.poids ?? 0, 3 + q.apps.length);
    const total = quartiers.reduce((s, q) => s + q.poids, 0);
    // Ouverture minimale : une place de chaque côté de l'avenue dès la première rangée.
    const r0 = R_INTERIEUR + AVANT_PREMIER;
    const minimum = Math.min((2 * (DEGAGEMENT + PLACE / 2 + 22)) / r0, (2 * Math.PI) / quartiers.length);
    const reste = 2 * Math.PI - minimum * quartiers.length;
    this.rInterieur = R_INTERIEUR;
    this.tour = { x: 0, y: 0, rayon: R_COEUR };

    this.avenues = [];
    this.rues = [];
    this.lots = [];
    this.secteurs = [];
    let debut = -Math.PI / 2;
    let rMax = R_INTERIEUR + AVANT_PREMIER;
    for (const q of quartiers) {
      const ouverture = minimum + (reste * q.poids) / total;
      const angle = debut + ouverture / 2;
      q.angle = angle;
      const secteur = { quartier: q, angle, de: debut, a: debut + ouverture };
      this.secteurs.push(secteur);
      debut += ouverture;
      // Places des rangées successives, côté droit puis côté gauche de l'avenue, en s'éloignant d'elle.
      const places = [];
      for (let k = 0; places.length < q.apps.length; k++) {
        const r = R_INTERIEUR + AVANT_PREMIER + k * RANGEE;
        const parCote = Math.max(1, Math.floor((r * ouverture / 2 - DEGAGEMENT - 14) / PLACE));
        for (let j = 0; j < parCote; j++) for (const cote of [1, -1]) places.push({ r, k, cote, j, a: angle + cote * (DEGAGEMENT + (j + 0.5) * PLACE) / r });
      }
      q.rangees = Math.max(q.rangees ?? 0, places.length ? places[places.length - 1].k + 1 : 1);
      rMax = Math.max(rMax, R_INTERIEUR + AVANT_PREMIER + (q.rangees - 1) * RANGEE);
      const plusLoin = new Map();   // rangée|côté -> angle de la place la plus éloignée de l'avenue
      q.apps.forEach((app, i) => {
        if (!app) return;
        const place = places[i];
        const taille = 16 + 24 * Math.sqrt(Math.min(1, app.donnees.ram / this.ramMax));
        const [cx, cy] = [Math.cos(place.a) * place.r, Math.sin(place.a) * place.r];
        const rRue = place.r - RANGEE / 2 + 4;
        const lot = { x: cx - taille / 2, y: cy - taille / 2, l: taille, h: taille, cx, cy, app,
          angle: place.a, angleAvenue: angle, rRue, acces: [Math.cos(place.a) * rRue, Math.sin(place.a) * rRue] };
        app.lot = lot;
        this.lots.push(lot);
        const cle = `${place.k}|${place.cote}`;
        if (Math.abs(place.a - angle) > Math.abs((plusLoin.get(cle) ?? angle) - angle)) plusLoin.set(cle, place.a);
      });
      for (const [cle, a] of plusLoin) this.rues.push({ r: R_INTERIEUR + AVANT_PREMIER + Number(cle.split('|')[0]) * RANGEE - RANGEE / 2 + 4, de: angle, a });
      secteur.rues = q.rangees;
    }
    this.rExterieur = Math.max(this.rExterieur ?? 0, rMax + AU_DELA);
    for (const s of this.secteurs) {
      const [ux, uy] = [Math.cos(s.angle), Math.sin(s.angle)];
      this.avenues.push({ quartier: s.quartier, angle: s.angle, de: [ux * this.rInterieur, uy * this.rInterieur], a: [ux * this.rExterieur, uy * this.rExterieur] });
    }

    // Coffres de données (disques) en bas, portail Internet en haut, dehors.
    const rDehors = this.rExterieur + DEHORS;
    const nd = Math.max(1, this.disques.length);
    this.entrepots = this.disques.map((disque, i) => {
      const angle = Math.PI / 2 + (i - (nd - 1) / 2) * 0.32;
      const taille = 70;
      const [cx, cy] = [Math.cos(angle) * rDehors, Math.sin(angle) * rDehors];
      return { disque, angle, cx, cy, x: cx - taille / 2, y: cy - taille / 2, l: taille, h: taille,
        toit: '#3FA9E0', bretelle: [Math.cos(angle) * this.rExterieur, Math.sin(angle) * this.rExterieur] };
    });
    const ap = { angle: -Math.PI / 2, cx: 0, cy: -rDehors, rayon: 46 };
    this.aeroport = { ...ap, x: ap.cx - 60, y: ap.cy - 60, l: 120, h: 120,
      bretelle: [0, -this.rExterieur] };

    const R = rDehors + 90;
    this.bornes = { x: -R, y: -R, l: 2 * R, h: 2 * R };

    const signature = [this.rExterieur, ...this.secteurs.map(s => s.de.toFixed(3)),
      ...this.lots.map(l => `${l.app.id}:${Math.round(l.cx)},${Math.round(l.cy)},${Math.round(l.l)}`),
      ...this.entrepots.map(e => e.disque.id)].join('|');
    if (signature !== this._signature) {
      this._signature = signature;
      this.version = (this.version ?? 0) + 1;
    }
  }

  // ---------- Trajets ----------

  // De l'application à la cible : allée jusqu'à l'avenue, avenue jusqu'au périphérique, arc du
  // périphérique (le plus court), puis la bretelle jusqu'au coffre ou au portail.
  trajet(app, cible) {
    const lot = app.lot;
    if (!lot) return null;
    const angleCible = cible.type === 'aeroport' ? this.aeroport.angle : cible.entrepot.angle;
    const arrivee = cible.type === 'aeroport'
      ? [this.aeroport.cx, this.aeroport.cy + this.aeroport.rayon]
      : pointVers(cible.entrepot, this.rExterieur);
    // Bloc → sa rue en arc → l'avenue → le périphérique
    const points = [[lot.cx, lot.cy], ...arc(lot.rRue, lot.angle, lot.angleAvenue)];
    points.push(...arc(this.rExterieur, lot.angleAvenue, angleCible));
    points.push(arrivee);
    return points;
  }

  // ---------- Recherche d'éléments ----------

  elementEn(x, y) {
    for (const lot of this.lots) {
      if (x >= lot.x - 4 && x <= lot.x + lot.l + 4 && y >= lot.y - 4 && y <= lot.y + lot.h + 4) return { type: 'app', app: lot.app };
    }
    if (Math.hypot(x, y) <= R_COEUR + 10) return { type: 'tour' };
    for (const e of this.entrepots ?? []) {
      if (x >= e.x && x <= e.x + e.l && y >= e.y && y <= e.y + e.h) return { type: 'entrepot', entrepot: e };
    }
    const a = this.aeroport;
    if (a && Math.hypot(x - a.cx, y - a.cy) <= a.rayon + 14) return { type: 'aeroport' };
    return null;
  }

  chercher(texte, discret = false) {
    const t = normaliser(texte);
    if (!t) return null;
    const apps = [...this.apps.values()].filter(a => a.lot);
    const noms = a => [a.donnees.nom, ...(discret ? [nomVisible(a, true)] : [])].map(normaliser);
    return apps.find(a => noms(a).some(n => n === t))
      ?? apps.find(a => noms(a).some(n => n.startsWith(t)))
      ?? apps.find(a => noms(a).some(n => n.includes(t)))
      ?? null;
  }
}

// Côté du coffre qui fait face au périphérique.
function pointVers(e, r) {
  const d = Math.hypot(e.cx, e.cy) - e.l / 2;
  return [Math.cos(e.angle) * d, Math.sin(e.angle) * d];
}

// Points d'un arc de cercle de rayon r, de l'angle a1 à a2, par le chemin le plus court.
export function arc(r, a1, a2) {
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(d) / 0.08));
  const points = [];
  for (let i = 0; i <= n; i++) {
    const a = a1 + (d * i) / n;
    points.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return points;
}
