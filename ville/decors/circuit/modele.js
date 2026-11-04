// Circuit imprimé : la ville vue comme une carte mère. Le processeur est la grosse puce au centre,
// chaque quartier une zone sérigraphiée de la carte (à gauche et à droite de la puce), chaque
// application un composant soudé sur sa propre empreinte. Les disques sont des barrettes en bas,
// Internet un port RJ45 en haut. Les pistes de cuivre sont routées à angles droits, coins à 45°.

export { nomVisible, normaliser } from '../ville/modele.js';
import { normaliser, nomVisible } from '../ville/modele.js';

export const CPU = 92;          // demi-côté de la puce du processeur
export const CELLULE = 64;      // une empreinte de composant par cellule
const COLONNES = 4;             // composants par rangée dans une zone (au moins)
const COLONNES_MAX = 8;
const MARGE_ZONE = 16;          // bord intérieur d'une zone
export const ENTETE = 44;       // bandeau du haut d'une zone (nom sérigraphié)
const ENTRE_ZONES = 44;
const BUS = 200;                // de la puce au bord intérieur des zones
const COLLECTEUR = 24;          // le bus vertical passe à cette distance du bord intérieur des zones
const AU_DELA = 70;             // des zones aux bus du haut et du bas
export const CHANFREIN = 9;     // coins des pistes coupés à 45°

// Les trois pistes parallèles d'un même bus : une par sens de flux.
export const VOIES = { lecture: -6, ecriture: 0, recu: 6, envoye: 6 };

export class Ville {
  constructor(quartiers) {
    this.quartiers = new Map(quartiers.map((q, i) => [q.id, { ...q, apps: [], rang: i }]));
    this.ordre = quartiers.map(q => q.id);
    this.apps = new Map();
    this.disques = [];
    this.systeme = null;
    this.lots = [];
    this.zones = [];
    this.tour = { x: 0, y: 0, rayon: CPU };
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

  // Zones en deux colonnes de part et d'autre de la puce, alignées sur leur bord intérieur. Les gros
  // quartiers s'élargissent plutôt que de s'allonger. Une zone ne rétrécit jamais et garde son côté.
  _placer() {
    const colonnes = [[], []];
    const hauteurs = [0, 0];
    for (const id of this.ordre) {
      const q = this.quartiers.get(id);
      const n = q.apps.length;
      q.colonnes = Math.max(q.colonnes ?? COLONNES, Math.min(COLONNES_MAX, Math.ceil(Math.sqrt(n * 1.6))));
      q.rangees = Math.max(q.rangees ?? 1, Math.ceil(n / q.colonnes), 1);
      q.l = q.colonnes * CELLULE + 2 * MARGE_ZONE;
      q.h = ENTETE + q.rangees * CELLULE + MARGE_ZONE;
      // Côté choisi une fois pour toutes : la colonne la moins haute à ce moment-là.
      q.cote ??= hauteurs[0] <= hauteurs[1] ? -1 : 1;
      const c = q.cote < 0 ? 0 : 1;
      colonnes[c].push(q);
      hauteurs[c] += q.h + ENTRE_ZONES;
    }
    this.zones = [];
    colonnes.forEach(zones => {
      const total = zones.reduce((n, q) => n + q.h, 0) + ENTRE_ZONES * Math.max(0, zones.length - 1);
      let y = -total / 2;
      for (const q of zones) {
        const cote = q.cote;
        q.x = cote < 0 ? -CPU - BUS - q.l : CPU + BUS;
        q.y = y;
        q.bordInterieur = cote < 0 ? q.x + q.l : q.x;
        q.collecteur = q.bordInterieur - cote * COLLECTEUR;
        y += q.h + ENTRE_ZONES;
        this.zones.push(q);
      }
    });
    this.lots = [];
    for (const q of this.zones) {
      q.apps.forEach((app, i) => {
        if (!app) return;
        const [col, rangee] = [i % q.colonnes, Math.floor(i / q.colonnes)];
        // Les zones de gauche se remplissent depuis le bord le plus proche de la puce.
        const colonne = q.cote < 0 ? q.colonnes - 1 - col : col;
        const x = q.x + MARGE_ZONE + colonne * CELLULE;
        const y = q.y + ENTETE + rangee * CELLULE;
        const lot = app.lot ?? {};
        Object.assign(lot, {
          app, quartier: q, rangee, x: x + 6, y: y + 6, l: CELLULE - 12, h: CELLULE - 12,
          cx: x + CELLULE / 2, cy: y + CELLULE / 2 - 3,
          // Piste qui longe le bas de la rangée jusqu'au bus vertical de la zone
          voieRangee: y + CELLULE - 2,
          taille: 9 + 12 * Math.sqrt(Math.min(1, app.donnees.ram / this.ramMax)),
          forme: forme(app),
        });
        app.lot = lot;
        this.lots.push(lot);
      });
    }
    const haut = Math.min(-CPU, ...this.zones.map(q => q.y));
    const bas = Math.max(CPU, ...this.zones.map(q => q.y + q.h));
    this.busHaut = haut - AU_DELA;
    this.busBas = bas + AU_DELA;
    // Barrettes des disques sous le bus du bas, port Internet au-dessus du bus du haut.
    const nd = Math.max(1, this.disques.length);
    this.entrepots = this.disques.map((disque, i) => {
      const cx = (i - (nd - 1) / 2) * 210;
      const cy = this.busBas + 90;
      return { disque, cx, cy, x: cx - 100, y: cy - 42, l: 200, h: 84, toit: '#5CC8FF' };
    });
    const cyNet = this.busHaut - 90;
    this.aeroport = { cx: 0, cy: cyNet, rayon: 56, x: -64, y: cyNet - 48, l: 128, h: 96 };
    // La carte épouse ses zones (les deux colonnes n'ont pas forcément la même largeur).
    const gauche = Math.min(-CPU - BUS, ...this.zones.map(q => q.x), -nd * 120) - 70;
    const droite = Math.max(CPU + BUS, ...this.zones.map(q => q.x + q.l), nd * 120) + 70;
    const [L, H] = [droite - gauche, Math.max(-(cyNet - 80), this.busBas + 170)];
    this.bornes = { x: gauche, y: -H, l: L, h: 2 * H };
    const signature = [L, H, ...this.zones.map(q => `${q.id}:${q.colonnes}x${q.rangees}`), ...this.entrepots.map(e => e.disque.id),
      ...this.lots.map(l => `${l.app.id}@${l.cx},${l.cy}`)].join('|');
    if (signature !== this._signature) {
      this._signature = signature;
      this.version = (this.version ?? 0) + 1;
    }
  }

  // Piste suivie par un flux, de l'application vers sa cible (disque ou Internet), coins chanfreinés.
  // Gardée en mémoire tant que la carte ne change pas.
  route(lot, cible, flux) {
    const cle = `${this.version}|${cible.type === 'aeroport' ? 'net' : cible.entrepot.disque.id}|${flux}`;
    lot.routes ??= new Map();
    let route = lot.routes.get(cle);
    if (route) return route;
    if (lot.routes.size > 12) lot.routes.clear();
    const o = VOIES[flux] ?? 0;
    const q = lot.quartier;
    const xBus = q.collecteur + q.cote * o;
    const yRangee = lot.voieRangee + o * 0.35;
    const points = [[lot.cx, lot.cy], [lot.cx, yRangee], [xBus, yRangee]];
    if (cible.type === 'aeroport') {
      const a = this.aeroport;
      const yBus = this.busHaut - o;
      points.push([xBus, yBus], [a.cx + o * 2, yBus], [a.cx + o * 2, a.y + a.h]);
    } else {
      const e = this.entrepots.find(x => x.disque.id === cible.entrepot.disque.id) ?? cible.entrepot;
      const yBus = this.busBas + o;
      points.push([xBus, yBus], [e.cx + o * 2, yBus], [e.cx + o * 2, e.y]);
    }
    route = mesurer(chanfreiner(points, CHANFREIN));
    lot.routes.set(cle, route);
    return route;
  }

  // ---------- Recherche d'éléments ----------

  elementEn(x, y) {
    for (const lot of this.lots) {
      if (x >= lot.x && x <= lot.x + lot.l && y >= lot.y && y <= lot.y + lot.h) return { type: 'app', app: lot.app };
    }
    if (Math.abs(x) <= CPU + 14 && Math.abs(y) <= CPU + 14) return { type: 'tour' };
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

// Forme du composant, stable pour une application : les plus gourmandes en mémoire sont de grosses
// puces carrées, les autres des puces étroites ou des condensateurs.
function forme(app) {
  if (app.donnees.ram > 400 * 1024 * 1024) return 'puce';
  let h = 2166136261;
  for (let k = 0; k < app.id.length; k++) h = Math.imul(h ^ app.id.charCodeAt(k), 16777619);
  return ['puce', 'etroite', 'condensateur'][(h >>> 0) % 3];
}

// Coupe chaque coin d'une ligne brisée à 45° (comme un routage de circuit imprimé).
export function chanfreiner(points, r) {
  const nets = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.5);
  if (nets.length < 3) return nets;
  const res = [nets[0]];
  for (let i = 1; i < nets.length - 1; i++) {
    const [a, b, c] = [nets[i - 1], nets[i], nets[i + 1]];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const k = Math.min(r, l1 / 2, l2 / 2);
    res.push([b[0] - ((b[0] - a[0]) / l1) * k, b[1] - ((b[1] - a[1]) / l1) * k]);
    res.push([b[0] + ((c[0] - b[0]) / l2) * k, b[1] + ((c[1] - b[1]) / l2) * k]);
  }
  res.push(nets[nets.length - 1]);
  return res;
}

// Longueurs cumulées d'une ligne brisée, pour y placer un point à une distance donnée.
export function mesurer(points) {
  const cumul = [0];
  for (let i = 1; i < points.length; i++) {
    cumul.push(cumul[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return { points, cumul, longueur: cumul[cumul.length - 1] };
}

// Point et direction à la distance d le long d'une route mesurée.
export function pointA(route, d) {
  const { points, cumul } = route;
  if (points.length < 2) return { x: points[0]?.[0] ?? 0, y: points[0]?.[1] ?? 0, angle: 0 };
  let i = 1;
  while (i < cumul.length - 1 && cumul[i] < d) i++;
  const [a, b] = [points[i - 1], points[i]];
  const seg = cumul[i] - cumul[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (d - cumul[i - 1]) / seg));
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
