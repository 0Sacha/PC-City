// Ville isométrique : plan en cases (i, j), dessiné en perspective isométrique.
// Un grand boulevard (j = 0) traverse la ville d'ouest en est ; les quartiers s'alignent de part
// et d'autre comme des pâtés de maisons, chacun desservi par des rues perpendiculaires, avec un
// immeuble par application de chaque côté de la rue. À l'ouest : la tour du processeur et l'antenne
// Internet ; à l'est : les data centers (un par disque).
// Les positions « écran » (x, y) sont la projection à l'échelle 1 : c'est le repère de la caméra.

export { nomVisible, normaliser } from '../ville/modele.js';
import { normaliser, nomVisible } from '../ville/modele.js';

export const TW = 64;            // largeur d'une case à l'écran
export const TH = 32;            // hauteur d'une case à l'écran

// Projection isométrique d'un point (i, j) à l'altitude z (px).
export const projeter = (i, j, z = 0) => [(i - j) * TW / 2, (i + j) * TH / 2 - z];

const EMPRISE = 0.72;            // côté d'un immeuble, en cases
const ECART_QUARTIERS = 1;       // cases libres entre deux quartiers voisins
const OUEST = 9;                 // cases à l'ouest du boulevard : tour du CPU, antenne Internet

export class Ville {
  constructor(quartiers) {
    this.quartiers = new Map(quartiers.map((q, i) => [q.id, { ...q, apps: [], rang: i }]));
    this.ordre = quartiers.map(q => q.id);
    this.apps = new Map();
    this.disques = [];
    this.systeme = null;
    this.lots = [];
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

  // Dimensions d'un quartier : rangées (profondeur) et rues ; un quartier ne rétrécit jamais.
  _dimensionner(q) {
    const n = Math.max(1, q.apps.length);
    const rangees = Math.max(2, Math.min(7, Math.ceil(Math.sqrt(n * 0.9))));
    q.rangees = Math.max(q.rangees ?? 0, rangees);
    q.rues = Math.max(q.rues ?? 0, Math.ceil(n / (2 * q.rangees)));
    q.largeur = q.rues * 3;
  }

  _placer() {
    const quartiers = this.ordre.map(id => this.quartiers.get(id));
    for (const q of quartiers) this._dimensionner(q);
    // Répartition nord / sud : chaque quartier va du côté le moins long (le boulevard reste court).
    const cotes = { '-1': 0, '1': 0 };
    for (const q of quartiers) {
      const cote = cotes['-1'] <= cotes['1'] ? -1 : 1;
      q.cote = cote;
      q.i0 = cotes[cote];
      cotes[cote] += q.largeur + ECART_QUARTIERS;
    }
    this.longueur = Math.max(cotes['-1'], cotes['1']) + 1;

    this.lots = [];
    this.rues = [];       // { i, j0, j1 } : rue perpendiculaire au boulevard
    this.blocs = [];      // sols des quartiers
    for (const q of quartiers) {
      const c = q.cote;
      const [jA, jB] = c > 0 ? [1, q.rangees + 1] : [-q.rangees - 1, -1];
      this.blocs.push({ quartier: q, i0: q.i0, i1: q.i0 + q.largeur, j0: jA, j1: jB });
      for (let r = 0; r < q.rues; r++) this.rues.push({ i: q.i0 + r * 3 + 1.5, j0: 0, j1: c * (q.rangees + 0.6) });
      q.apps.forEach((app, k) => {
        if (!app) return;
        // Rue, côté de la rue, rangée (en s'éloignant du boulevard)
        const rue = Math.floor(k / (2 * q.rangees));
        const reste = k % (2 * q.rangees);
        const cote = reste % 2 === 0 ? -1 : 1;
        const rangee = Math.floor(reste / 2);
        const iRue = q.i0 + rue * 3 + 1.5;
        const ci = iRue + cote;
        const cj = c * (rangee + 1.5);
        const d = app.donnees;
        const lot = app.lot ?? {};
        Object.assign(lot, { app, quartier: q, ci, cj, iRue, s: EMPRISE,
          hauteurCible: d.etat === 'ferme' ? 8 : 16 + 150 * Math.sqrt(Math.min(1, d.ram / this.ramMax)) });
        this._cadre(lot, lot.hauteurAffichee ?? lot.hauteurCible);
        app.lot = lot;
        this.lots.push(lot);
      });
    }

    // Ouest : tour du processeur au bord du boulevard, antenne Internet plus loin au nord-ouest.
    this.tour = { ci: -4, cj: 2.8, s: 2.2, hauteur: 230 };
    const [tx, ty] = projeter(-4, 2.8);
    Object.assign(this.tour, { x: tx, y: ty - 60, rayon: 70 });
    this.aeroport = { ci: -8, cj: -2.5 };
    const [ax, ay] = projeter(-8, -2.5);
    Object.assign(this.aeroport, { cx: ax, cy: ay - 90, x: ax - 40, y: ay - 200, l: 80, h: 210, rayon: 50 });
    // Est : un data center par disque, au bout du boulevard
    this.entrepots = this.disques.map((disque, i) => {
      const ci = this.longueur + 2;
      const cj = (i - (this.disques.length - 1) / 2) * 3.5;
      const [x, y] = projeter(ci, cj);
      return { disque, ci, cj, s: 2.4, hauteur: 46, cx: x, cy: y - 23, x: x - 80, y: y - 90, l: 160, h: 120, toit: '#3FA9E0' };
    });
    // Bornes (repère écran) : tous les coins du plan projetés
    const coins = [[-OUEST - 2, -9], [-OUEST - 2, 9], [this.longueur + 6, -9], [this.longueur + 6, 9]].map(([i, j]) => projeter(i, j));
    const xs = coins.map(p => p[0]);
    const ys = coins.map(p => p[1]);
    this.bornes = { x: Math.min(...xs), y: Math.min(...ys) - 260, l: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + 260 };

    const signature = [this.longueur, ...quartiers.map(q => `${q.i0},${q.cote},${q.rangees},${q.rues}`),
      ...this.lots.map(l => `${l.app.id}:${l.ci},${l.cj}`), ...this.entrepots.map(e => e.disque.id)].join('|');
    if (signature !== this._signature) {
      this._signature = signature;
      this.version = (this.version ?? 0) + 1;
    }
  }

  // Rectangle écran d'un immeuble (pour le clic, la recherche, les noms) à la hauteur donnée.
  _cadre(lot, hauteur) {
    const [x, y] = projeter(lot.ci, lot.cj);
    const demi = (lot.s / 2) * TW;
    Object.assign(lot, { cx: x, cy: y - hauteur / 2, x: x - demi, y: y - hauteur - (lot.s / 2) * TH, l: 2 * demi, h: hauteur + lot.s * TH });
  }

  // Trajet en cases (i, j) : immeuble → sa rue → boulevard → bout ouest (Internet) ou est (disques).
  trajet(app, cible) {
    const lot = app.lot;
    if (!lot) return null;
    const points = [[lot.ci, lot.cj], [lot.iRue, lot.cj], [lot.iRue, 0]];
    if (cible.type === 'aeroport') {
      points.push([-8, 0], [-8, -1.6]);
    } else {
      const e = this.entrepots.find(x => x.disque.id === cible.entrepot.disque.id) ?? cible.entrepot;
      points.push([this.longueur + 0.5, 0], [this.longueur + 0.5, e.cj], [e.ci - 1.2, e.cj]);
    }
    return points;
  }

  // ---------- Recherche d'éléments ----------

  elementEn(x, y) {
    // Le plus en avant d'abord (i + j le plus grand) : c'est celui qu'on voit devant.
    const touches = this.lots.filter(l => x >= l.x && x <= l.x + l.l && y >= l.y && y <= l.y + l.h);
    if (touches.length) return { type: 'app', app: touches.sort((a, b) => (b.ci + b.cj) - (a.ci + a.cj))[0].app };
    const t = this.tour;
    if (Math.abs(x - t.x) < 70 && y > t.y - 200 && y < t.y + 110) return { type: 'tour' };
    for (const e of this.entrepots ?? []) {
      if (x >= e.x && x <= e.x + e.l && y >= e.y && y <= e.y + e.h) return { type: 'entrepot', entrepot: e };
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
