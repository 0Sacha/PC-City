// Système solaire : le Soleil au centre (le processeur), une planète par quartier sur sa propre orbite,
// une lune par application autour de sa planète. Les disques sont des stations spatiales (en bas),
// Internet un trou de ver (en haut), tous deux immobiles au-delà de la dernière orbite.
// Tout tourne : animer(temps) calcule les positions du moment (temps de la ville, figé en pause).

export { nomVisible, normaliser } from '../ville/modele.js';
import { normaliser, nomVisible } from '../ville/modele.js';

export const R_SOLEIL = 62;
export const INCLINAISON = 0.6;  // orbites vues en légère perspective : ellipses aplaties en hauteur
const PREMIERE_ORBITE = 170;    // rayon de l'orbite de la première planète
const ENTRE_SYSTEMES = 10;      // espace libre entre deux systèmes planète + lunes voisins
export const PREMIER_ANNEAU = 34;  // distance planète → premier anneau de lunes
export const ENTRE_ANNEAUX = 15;
const AU_DELA = 110;            // de la dernière orbite aux stations et au trou de ver

// Lunes par anneau : 8 sur le premier, puis 6 de plus à chaque anneau.
const capacite = j => 8 + 6 * j;

export class Ville {
  constructor(quartiers) {
    this.quartiers = new Map(quartiers.map((q, i) => [q.id, { ...q, apps: [], rang: i }]));
    this.ordre = quartiers.map(q => q.id);
    this.apps = new Map();
    this.disques = [];
    this.systeme = null;
    this.lots = [];
    this.tour = { x: 0, y: 0, rayon: R_SOLEIL };
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
    this.animer(this._temps ?? 0);
  }

  // Orbites et anneaux de lunes. Un système ne rétrécit jamais (les orbites ne bougent pas à chaque relevé).
  _placer() {
    let rayonOrbite = PREMIERE_ORBITE;
    let precedent = 0;
    this.planetes = [];
    this.lots = [];
    for (const id of this.ordre) {
      const q = this.quartiers.get(id);
      const n = q.apps.length;
      let anneaux = 0;
      for (let reste = n; reste > 0; anneaux++) reste -= capacite(anneaux);
      q.anneaux = Math.max(q.anneaux ?? 1, anneaux, 1);
      q.rayonPlanete = 16 + Math.min(12, Math.sqrt(n) * 2.2);
      q.premierAnneau = q.rayonPlanete + PREMIER_ANNEAU - 16;
      const etendue = q.premierAnneau + (q.anneaux - 1) * ENTRE_ANNEAUX + 12;
      if (this.planetes.length) rayonOrbite += precedent + etendue + ENTRE_SYSTEMES;
      precedent = etendue;
      q.orbite = rayonOrbite;
      q.etendue = etendue;
      // Les planètes intérieures tournent plus vite (comme Kepler) ; phases réparties à l'angle d'or.
      q.vitesse = 0.03 * (PREMIERE_ORBITE / rayonOrbite) ** 1.5;
      q.phase = q.rang * 2.39996;
      this.planetes.push(q);
      // Lunes : réparties sur leurs anneaux ; plus l'anneau est loin, plus il tourne lentement.
      q.apps.forEach((app, i) => {
        if (!app) return;
        let j = 0;
        let k = i;
        while (k >= capacite(j)) { k -= capacite(j); j++; }
        const taille = 4.5 + 7 * Math.sqrt(Math.min(1, app.donnees.ram / this.ramMax));
        const lot = app.lot ?? {};
        Object.assign(lot, { app, quartier: q, anneau: q.premierAnneau + j * ENTRE_ANNEAUX,
          phase: (k / capacite(j)) * 2 * Math.PI + j * 0.5, vitesse: 0.16 / (1 + j * 0.45) * (j % 2 ? -1 : 1),
          taille, l: Math.max(16, 2 * taille + 6), h: Math.max(16, 2 * taille + 6) });
        app.lot = lot;
        this.lots.push(lot);
      });
    }
    this.rOrbites = rayonOrbite + precedent;
    // Stations sous le système, trou de ver au-dessus (dans le plan aplati des orbites).
    const yDehors = this.rOrbites * INCLINAISON + AU_DELA;
    const nd = Math.max(1, this.disques.length);
    this.entrepots = this.disques.map((disque, i) => {
      const [cx, cy] = [(i - (nd - 1) / 2) * 190, yDehors];
      return { disque, cx, cy, x: cx - 40, y: cy - 40, l: 80, h: 80, toit: '#9AD1FF' };
    });
    this.aeroport = { cx: 0, cy: -yDehors, rayon: 58, x: -70, y: -yDehors - 70, l: 140, h: 140 };
    const [L, H] = [Math.max(this.rOrbites + 40, nd * 95 + 80), yDehors + 95];
    this.bornes = { x: -L, y: -H, l: 2 * L, h: 2 * H };
    const signature = [this.rOrbites, ...this.planetes.map(q => q.anneaux), ...this.entrepots.map(e => e.disque.id)].join('|');
    if (signature !== this._signature) {
      this._signature = signature;
      this.version = (this.version ?? 0) + 1;
    }
  }

  // Positions du moment (temps en ms, celui de la ville : il s'arrête pendant la pause).
  animer(temps) {
    this._temps = temps;
    const t = temps / 1000;
    for (const q of this.planetes ?? []) {
      const a = q.phase + q.vitesse * t;
      q.x = Math.cos(a) * q.orbite;
      q.y = Math.sin(a) * q.orbite * INCLINAISON;
    }
    for (const lot of this.lots) {
      const a = lot.phase + lot.vitesse * t;
      lot.cx = lot.quartier.x + Math.cos(a) * lot.anneau;
      lot.cy = lot.quartier.y + Math.sin(a) * lot.anneau * INCLINAISON;
      lot.devant = Math.sin(a) >= 0;   // moitié avant de l'orbite : la lune passe devant sa planète
      lot.x = lot.cx - lot.l / 2;
      lot.y = lot.cy - lot.h / 2;
    }
  }

  // ---------- Recherche d'éléments ----------

  elementEn(x, y) {
    let meilleur = null;
    let distance = Infinity;
    for (const lot of this.lots) {
      const d = Math.hypot(x - lot.cx, y - lot.cy);
      if (d <= lot.l / 2 && d < distance) { distance = d; meilleur = lot; }
    }
    if (meilleur) return { type: 'app', app: meilleur.app };
    if (Math.hypot(x, y) <= R_SOLEIL + 12) return { type: 'tour' };
    for (const e of this.entrepots ?? []) {
      if (x >= e.x && x <= e.x + e.l && y >= e.y && y <= e.y + e.h) return { type: 'entrepot', entrepot: e };
    }
    const a = this.aeroport;
    if (a && Math.hypot(x - a.cx, y - a.cy) <= a.rayon + 12) return { type: 'aeroport' };
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
