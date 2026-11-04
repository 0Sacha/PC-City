// Village médiéval : le château au centre (le processeur et la mémoire), entouré des quartiers du bourg,
// le tout dans une enceinte. Chaque quartier occupe une case d'une grille de 3 colonnes, séparée des autres
// par des rues pavées ; ses applications sont des maisons à colombages alignées le long de ruelles.
// Hors les murs : la rivière et son port au nord (Internet), les greniers à blé au sud (les disques).

export { nomVisible, normaliser } from '../ville/modele.js';
import { normaliser, nomVisible } from '../ville/modele.js';

export const LOT_L = 66;          // largeur d'une parcelle de maison
export const LOT_H = 56;          // hauteur d'une parcelle
export const RUELLE = 16;         // ruelle sous chaque rangée de maisons
export const RUE = 36;            // rue pavée entre deux quartiers
export const BORD = 14;           // bande d'herbe en haut d'un quartier
const COLONNES = 3;
const CHATEAU = [1, 1];           // case du château : colonne, rangée
const CHATEAU_L = 300;            // taille minimale de la case du château
const CHATEAU_H = 270;
export const MUR = 40;            // de la rue de ronde à la muraille
export const RIVIERE = 120;       // de la muraille au milieu de la rivière
export const LARGEUR_RIVIERE = 84;
const GRENIERS = 135;             // de la muraille aux greniers
const ENTRE_GRENIERS = 150;
const SORTIE = 55;                // la route des greniers se sépare à cette distance de la porte sud

// Cases de la grille dans l'ordre où les quartiers les occupent (le château garde la case du milieu).
function casesLibres(n) {
  const cases = [];
  for (let r = 0; cases.length < n || r < 3; r++) {
    for (let c = 0; c < COLONNES; c++) if (c !== CHATEAU[0] || r !== CHATEAU[1]) cases.push([c, r]);
  }
  return cases;
}

export class Ville {
  constructor(quartiers) {
    this.quartiers = new Map(quartiers.map((q, i) => [q.id, { ...q, apps: [], rang: i }]));
    this.ordre = quartiers.map(q => q.id);
    this.apps = new Map();
    this.disques = [];
    this.systeme = null;
    this.lots = [];
    this.tour = { x: 0, y: 0, rayon: 110 };
    this._colonnes = [];
    this._rangees = [];
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

  // Grille des quartiers. Colonnes et rangées ne rétrécissent jamais : les maisons ne bougent pas à chaque relevé.
  _placer() {
    const cases = casesLibres(this.ordre.length);
    const nbRangees = Math.max(3, ...cases.map(([, r]) => r + 1));
    // Largeur souhaitée de chaque colonne : un quartier plutôt carré
    const largeurs = Array(COLONNES).fill(0);
    largeurs[CHATEAU[0]] = CHATEAU_L;
    this.ordre.forEach((id, i) => {
      const q = this.quartiers.get(id);
      const n = Math.max(1, q.apps.length);
      const voulues = Math.max(2, Math.min(10, Math.ceil(Math.sqrt(n * 1.6))));
      q.case = cases[i];
      largeurs[q.case[0]] = Math.max(largeurs[q.case[0]], voulues * LOT_L + 2 * BORD);
    });
    largeurs.forEach((l, c) => { this._colonnes[c] = Math.max(this._colonnes[c] ?? 0, l); });
    // Puis chaque quartier remplit la largeur de sa colonne, en autant de rangées qu'il faut
    const hauteurs = Array(nbRangees).fill(LOT_H + RUELLE + BORD);
    hauteurs[CHATEAU[1]] = CHATEAU_H;
    for (const id of this.ordre) {
      const q = this.quartiers.get(id);
      q.colonnes = Math.max(1, Math.floor((this._colonnes[q.case[0]] - 2 * BORD) / LOT_L));
      q.rangees = Math.max(q.rangees ?? 1, Math.ceil(q.apps.length / q.colonnes), 1);
      hauteurs[q.case[1]] = Math.max(hauteurs[q.case[1]], BORD + q.rangees * (LOT_H + RUELLE));
    }
    hauteurs.forEach((h, r) => { this._rangees[r] = Math.max(this._rangees[r] ?? 0, h); });
    const L = this._colonnes;
    const H = this._rangees.slice(0, nbRangees);

    // Rues : axes des rues verticales (XS) et horizontales (YS), le château centré en (0, 0)
    const xs = [];
    const ys = [];
    let x = RUE;
    L.forEach(l => { xs.push(x); x += l + RUE; });
    let y = RUE;
    H.forEach(h => { ys.push(y); y += h + RUE; });
    const dx = -(xs[CHATEAU[0]] + L[CHATEAU[0]] / 2);
    const dy = -(ys[CHATEAU[1]] + H[CHATEAU[1]] / 2);
    this.XS = [xs[0] - RUE / 2 + dx, ...L.map((l, c) => xs[c] + l + RUE / 2 + dx)];
    this.YS = [ys[0] - RUE / 2 + dy, ...H.map((h, r) => ys[r] + h + RUE / 2 + dy)];

    // Cases : celles des quartiers, la place du marché dans celles qui restent
    this.cases = [];
    for (let r = 0; r < H.length; r++) {
      for (let c = 0; c < COLONNES; c++) {
        if (c === CHATEAU[0] && r === CHATEAU[1]) continue;
        const q = this.ordre.map(id => this.quartiers.get(id)).find(q => q.case[0] === c && q.case[1] === r) ?? null;
        const zone = { x: xs[c] + dx, y: ys[r] + dy, l: L[c], h: H[r], colonne: c, quartier: q };
        if (q) q.zone = zone;
        this.cases.push(zone);
      }
    }

    // Parcelles des maisons
    this.lots = [];
    for (const id of this.ordre) {
      const q = this.quartiers.get(id);
      const z = q.zone;
      const x0 = z.x + (z.l - q.colonnes * LOT_L) / 2;
      q.apps.forEach((app, i) => {
        if (!app) return;
        const [c, r] = [i % q.colonnes, Math.floor(i / q.colonnes)];
        const lot = app.lot ?? {};
        Object.assign(lot, { app, quartier: q, x: x0 + c * LOT_L, y: z.y + BORD + r * (LOT_H + RUELLE), l: LOT_L, h: LOT_H });
        lot.cx = lot.x + LOT_L / 2;
        lot.cy = lot.y + LOT_H / 2;
        lot.ruelle = lot.y + LOT_H + RUELLE / 2;
        lot.zone = z;
        app.lot = lot;
        this.lots.push(lot);
      });
    }

    // Enceinte, portes, rivière et port (Internet) au nord, greniers (disques) au sud
    const [g, d] = [this.XS[0] - RUE / 2 - MUR, this.XS.at(-1) + RUE / 2 + MUR];
    const [h, b] = [this.YS[0] - RUE / 2 - MUR, this.YS.at(-1) + RUE / 2 + MUR];
    this.enceinte = { x: g, y: h, l: d - g, h: b - h };
    this.riviere = h - RIVIERE;
    this.aeroport = { cx: 0, cy: this.riviere + LARGEUR_RIVIERE / 2 + 6, rayon: 50 };
    Object.assign(this.aeroport, { x: -60, y: this.aeroport.cy - 60, l: 120, h: 100 });
    const nd = Math.max(1, this.disques.length);
    this.routeGreniers = b + SORTIE;
    this.entrepots = this.disques.map((disque, i) => {
      const [cx, cy] = [(i - (nd - 1) / 2) * ENTRE_GRENIERS, b + GRENIERS];
      return { disque, cx, cy, x: cx - 46, y: cy - 34, l: 92, h: 76, toit: '#C98B4A' };
    });
    const marge = 170;
    const xMin = Math.min(g, -nd * ENTRE_GRENIERS / 2) - marge;
    const xMax = Math.max(d, nd * ENTRE_GRENIERS / 2) + marge;
    this.bornes = { x: xMin, y: this.riviere - LARGEUR_RIVIERE / 2 - 90, l: xMax - xMin, h: 0 };
    this.bornes.h = b + GRENIERS + 110 - this.bornes.y;
    const signature = [...this.XS, ...this.YS, ...this.entrepots.map(e => e.disque.id)].join('|');
    if (signature !== this._signature) {
      this._signature = signature;
      this.version = (this.version ?? 0) + 1;
    }
  }

  // Trajet d'une charrette, de la maison vers le port ou un grenier : ruelle, rue vers le centre, rue de ronde,
  // porte de la ville, puis le chemin hors les murs.
  route(lot, cible) {
    const versPort = cible.type === 'aeroport';
    const z = lot.zone;
    const gauche = this.XS[z.colonne];
    const droite = this.XS[z.colonne + 1];
    let rue = Math.abs(gauche) < Math.abs(droite) ? gauche : droite;
    if (Math.abs(Math.abs(gauche) - Math.abs(droite)) < 1) rue = lot.cx < 0 ? gauche : droite;
    const ronde = versPort ? this.YS[0] : this.YS.at(-1);
    const points = [[lot.cx, lot.cy + 8], [lot.cx, lot.ruelle], [rue, lot.ruelle], [rue, ronde], [0, ronde]];
    const e = this.enceinte;
    if (versPort) {
      points.push([0, e.y], [0, this.aeroport.cy]);
    } else {
      const grenier = this.entrepots.find(x => x.disque.id === cible.entrepot.disque.id) ?? cible.entrepot;
      points.push([0, e.y + e.h], [0, this.routeGreniers], [grenier.cx, this.routeGreniers], [grenier.cx, grenier.y]);
    }
    return points;
  }

  // ---------- Recherche d'éléments ----------

  elementEn(x, y) {
    for (const lot of this.lots) {
      if (x >= lot.x && x <= lot.x + lot.l && y >= lot.y && y <= lot.y + lot.h) return { type: 'app', app: lot.app };
    }
    if (Math.abs(x) <= 115 && Math.abs(y) <= 105) return { type: 'tour' };
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
