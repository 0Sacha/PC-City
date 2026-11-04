// Fourmilière vue en coupe, comme une ferme à fourmis : la surface en haut (y = 0), la terre dessous.
// Un puits central descend de l'entrée (Internet, sur le monticule) jusqu'aux réserves (les disques),
// en passant par la chambre de la reine (le processeur). De chaque côté, les quartiers sont des ailes
// de chambres (une par application) reliées au puits par leurs galeries.
// Les places des chambres ne dépendent que du quartier et du numéro de place : elles ne bougent pas
// d'un relevé à l'autre, et les galeries peuvent être dessinées une fois pour toutes.

export { nomVisible, normaliser } from '../ville/modele.js';
import { normaliser, nomVisible } from '../ville/modele.js';

export const REINE = { rx: 118, ry: 66 };   // chambre de la reine
const X_INTERIEUR = 200;   // du puits au bord intérieur des ailes
const Y_DEBUT = 92;        // profondeur du haut des premières ailes
export const CELLULE_L = 92;
export const CELLULE_H = 82;
const ENTETE = 30;         // bande du nom du quartier en haut de chaque aile
const ENTRE_AILES = 44;
const COLONNES_MAX = 7;
const PAS = 14;            // espacement des points le long d'une galerie
export const SOUS_RESERVES = 84;  // de la galerie des réserves au centre d'une réserve

// Petite valeur pseudo-aléatoire stable (0 → 1) tirée d'un texte et d'un numéro.
export function hacher(texte, i = 0) {
  let h = 2166136261 ^ i;
  for (let k = 0; k < texte.length; k++) h = Math.imul(h ^ texte.charCodeAt(k), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

// Abscisse du puits central à la profondeur y : droit près de la surface, il serpente ensuite.
export const puits = y => 16 * Math.sin(y / 70) * Math.min(1, Math.max(0, y) / 60);

// Points du puits entre deux profondeurs (dans l'ordre demandé, vers le haut ou vers le bas).
export function segmentPuits(y1, y2) {
  const n = Math.max(1, Math.round(Math.abs(y2 - y1) / PAS));
  return Array.from({ length: n + 1 }, (_, i) => {
    const y = y1 + ((y2 - y1) * i) / n;
    return [puits(y), y];
  });
}

// Galerie sinueuse de a à b : ondulation perpendiculaire, nulle aux deux bouts pour bien se raccorder.
export function sinueux(a, b, amplitude, graine) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const longueur = Math.hypot(dx, dy);
  if (longueur < 1) return [a];
  const n = Math.max(1, Math.round(longueur / PAS));
  const [px, py] = [-dy / longueur, dx / longueur];
  const frequence = longueur / (50 + 30 * graine);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const ecart = amplitude * Math.sin(Math.PI * t) * Math.sin(t * frequence + graine * 6.283);
    return [a[0] + dx * t + px * ecart, a[1] + dy * t + py * ecart];
  });
}

export class Ville {
  constructor(quartiers) {
    this.quartiers = new Map(quartiers.map((q, i) => [q.id, { ...q, apps: [], rang: i }]));
    this.ordre = quartiers.map(q => q.id);
    this.apps = new Map();
    this.disques = [];
    this.systeme = null;
    this.lots = [];
    this.tour = { x: 0, y: Y_DEBUT + 110, rayon: REINE.rx };
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

  // Centre de la chambre n° k d'un quartier : grille de l'aile, un peu dérangée pour faire naturel.
  _centre(q, k) {
    const r = Math.floor(k / q.colonnes);
    const c = k % q.colonnes;
    const b = q.bloc;
    return [
      q.cote * (X_INTERIEUR + 40 + CELLULE_L * (c + 0.5)) + (hacher(q.id, k) - 0.5) * 18,
      b.y + ENTETE + CELLULE_H * (r + 0.5) + (hacher(q.id, k + 97) - 0.5) * 16,
    ];
  }

  // Galerie du puits jusqu'à la chambre n° k : branche principale de l'aile, couloir le long du bord
  // intérieur, puis rangée de chambres (on traverse les chambres plus proches du puits).
  _galerie(q, k) {
    const r = Math.floor(k / q.colonnes);
    const c = k % q.colonnes;
    const bord = q.cote * (X_INTERIEUR + 12);
    const yRangee = q.bloc.y + ENTETE + CELLULE_H * (r + 0.5);
    const jonction = [puits(q.yGalerie), q.yGalerie];
    const points = [
      ...sinueux(jonction, [bord, q.yGalerie], 7, hacher(q.id, 500)),
      ...sinueux([bord, q.yGalerie], [bord, yRangee], 4, hacher(q.id, 600 + r)),
    ];
    let precedent = [bord, yRangee];
    for (let i = 0; i <= c; i++) {
      const centre = this._centre(q, r * q.colonnes + i);
      points.push(...sinueux(precedent, centre, 5, hacher(q.id, 700 + r * 10 + i)));
      precedent = centre;
    }
    return points;
  }

  // Ailes de chaque côté du puits (le côté le moins profond reçoit l'aile suivante), reine en haut,
  // réserves en bas. Une aile ne rétrécit jamais : les chambres gardent leur place.
  _placer() {
    const profondeur = { [-1]: Y_DEBUT, 1: Y_DEBUT };
    this.lots = [];
    this.ailes = [];
    for (const id of this.ordre) {
      const q = this.quartiers.get(id);
      const n = Math.max(1, q.apps.length);
      q.colonnes = Math.max(q.colonnes ?? 2, Math.min(COLONNES_MAX, Math.ceil(Math.sqrt(n * 2.4))));
      q.rangees = Math.max(q.rangees ?? 1, Math.ceil(n / q.colonnes));
      q.cote ??= profondeur[-1] <= profondeur[1] ? -1 : 1;
      const largeur = q.colonnes * CELLULE_L + 50;
      const hauteur = ENTETE + q.rangees * CELLULE_H;
      const y = profondeur[q.cote];
      q.bloc = { x: q.cote < 0 ? -X_INTERIEUR - largeur : X_INTERIEUR, y, l: largeur, h: hauteur };
      q.yGalerie = y + ENTETE + (q.rangees * CELLULE_H) / 2;
      profondeur[q.cote] = y + hauteur + ENTRE_AILES;
      this.ailes.push(q);
      q.apps.forEach((app, k) => {
        if (!app) return;
        const [cx, cy] = this._centre(q, k);
        const ram = Math.min(1, app.donnees.ram / this.ramMax);
        const rx = app.donnees.etat === 'ferme' ? 17 : 15 + 22 * Math.sqrt(ram);
        const ry = rx * 0.64;
        const lot = app.lot ?? {};
        Object.assign(lot, { app, quartier: q, cx, cy, rx, ry, x: cx - rx - 6, y: cy - ry - 6,
          l: 2 * rx + 12, h: 2 * ry + 12, chemin: this._galerie(q, k).reverse(), jonction: q.yGalerie });
        app.lot = lot;
        this.lots.push(lot);
      });
    }
    this.tour = { x: 0, y: Y_DEBUT + 110, rayon: REINE.rx };
    // Réserves (disques) sous la plus profonde des ailes, côte à côte de part et d'autre du puits.
    this.yReserves = Math.max(profondeur[-1], profondeur[1], this.tour.y + REINE.ry + 60) + 20;
    const nd = Math.max(1, this.disques.length);
    this.entrepots = this.disques.map((disque, i) => {
      const cx = (i - (nd - 1) / 2) * 250;
      const cy = this.yReserves + SOUS_RESERVES;
      const depart = [puits(this.yReserves), this.yReserves];
      const chemin = [...sinueux(depart, [cx, this.yReserves], 5, hacher(disque.id, 3)), [cx, cy]];
      return { disque, cx, cy, rx: 92, ry: 54, x: cx - 96, y: cy - 58, l: 192, h: 116, toit: '#E0B04A', chemin };
    });
    // Internet : l'entrée de la fourmilière, au sommet du monticule.
    this.aeroport = { cx: 0, cy: -30, rayon: 46, x: -64, y: -84, l: 128, h: 92, entree: [[0, -12], [0, -28]] };
    const largeurAiles = Math.max(0, ...this.ailes.map(q => q.bloc.l));
    const L = Math.max(X_INTERIEUR + largeurAiles + 40, nd * 110 + 80);
    const bas = this.yReserves + SOUS_RESERVES + 130;
    this.bornes = { x: -L, y: -150, l: 2 * L, h: bas + 150 };
    const signature = [...this.ailes.map(q => `${q.cote}:${q.colonnes}x${q.rangees}`), ...this.entrepots.map(e => e.disque.id)].join('|');
    if (signature !== this._signature) {
      this._signature = signature;
      this.version = (this.version ?? 0) + 1;
    }
  }

  // ---------- Recherche d'éléments ----------

  elementEn(x, y) {
    let meilleur = null;
    let distance = Infinity;
    for (const lot of this.lots) {
      const d = Math.hypot((x - lot.cx) / (lot.rx + 6), (y - lot.cy) / (lot.ry + 6));
      if (d <= 1 && d < distance) { distance = d; meilleur = lot; }
    }
    if (meilleur) return { type: 'app', app: meilleur.app };
    const t = this.tour;
    if (Math.hypot(x / (REINE.rx + 14), (y - t.y) / (REINE.ry + 14)) <= 1) return { type: 'tour' };
    for (const e of this.entrepots ?? []) {
      if (Math.hypot((x - e.cx) / (e.rx + 6), (y - e.cy) / (e.ry + 6)) <= 1) return { type: 'entrepot', entrepot: e };
    }
    const a = this.aeroport;
    if (a && x >= a.x && x <= a.x + a.l && y >= a.y && y <= a.y + a.h) return { type: 'aeroport' };
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
