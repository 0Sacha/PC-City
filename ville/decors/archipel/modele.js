// Modèle de la ville : où se trouve chaque élément, indépendamment du dessin.
// Les positions sont stables : une application garde sa parcelle tant que la page est ouverte.
//
// La ville est un archipel : au centre, l'île du hall central, avec la tour (CPU et RAM) au milieu
// d'une grande place entourée d'un immense rond-point façon place de l'Étoile. Autour, une île par
// catégorie d'applications, une île « Port » (les disques), une île « Aéroport » (Internet) et une île
// électrique. Chaque île est reliée au rond-point central par un pont 2 × 2 voies (sauf l'île
// électrique : seulement la piste des voitures de course jusqu'à la tour).

export const LOT_L = 100;        // largeur d'une parcelle
export const LOT_H = 78;         // hauteur d'une parcelle
export const RUE = 30;           // bande de la rue intérieure entre deux rangées de parcelles
const BANDE = 2 * LOT_H + RUE;

const BORD = 36;                 // terre autour d'un quartier, dans son île
const AVENUE = 50;               // bande de l'avenue d'île, côté hall central
export const R_ANNEAU = 230;     // rayon du grand rond-point (axe de la chaussée)
const R_PLACE = 165;             // place centrale, à l'intérieur de l'anneau
const R_HUB = 320;               // rayon de l'île centrale
const MER = 140;                 // mer entre l'île centrale et les autres îles (au moins)
const ESPACE_ILES = 70;          // mer entre deux îles voisines (au moins)
const LARGE = 40;                // routes à 2 × 2 voies (ponts, port, aéroport)

// Ordre des îles autour du hall, dans le sens des aiguilles d'une montre depuis le nord.
const ORDRE = ['navigateurs', 'communication', 'bureautique', '#aeroport', 'multimedia', '#centrale',
  '#port', 'systeme', 'divers', 'developpement'];

export class Ville {
  constructor(quartiers) {
    this.quartiers = new Map(quartiers.map(q => [q.id, { ...q, apps: [], colonnes: 2, bandes: 1 }]));
    this.apps = new Map();        // id -> { donnees, quartier, emplacement, lot }
    this.disques = [];
    this.systeme = null;
  }

  mettreAJour(etat) {
    this.systeme = etat.systeme;
    this.disques = etat.disques;

    // Le serveur attribue à chaque application un emplacement stable dans son quartier,
    // mémorisé d'un lancement à l'autre ; les fermées gardent le leur (en gris).
    const presents = new Set(etat.applications.map(a => a.id));
    for (const id of [...this.apps.keys()]) if (!presents.has(id)) this.apps.delete(id);
    for (const q of this.quartiers.values()) q.apps = [];
    for (const donnees of etat.applications) {
      let app = this.apps.get(donnees.id);
      if (!app) {
        // Seules les applications apparues après le premier affichage « poussent » à l'écran.
        app = { id: donnees.id, nouveau: this.dejaAffiche === true };
        this.apps.set(donnees.id, app);
      }
      const quartier = this.quartiers.get(donnees.quartier) ?? this.quartiers.get('divers');
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

  _dimensionnerQuartier(q) {
    // Ne grandit que si nécessaire, pour que les bâtiments ne changent pas de place à chaque relevé.
    const n = Math.max(q.apps.length, 1);
    if (n <= 2 * q.colonnes * q.bandes && q.dejaPlace) return;
    let meilleur = null;
    for (let c = 2; c <= 7; c++) {
      const b = Math.max(1, Math.ceil(n / (2 * c)));
      const ecart = Math.abs((c * LOT_L) / (b * BANDE) - 1.4);
      if (!meilleur || ecart < meilleur.ecart - 0.01) meilleur = { c, b, ecart };
    }
    q.colonnes = meilleur.c;
    q.bandes = meilleur.b;
    q.dejaPlace = true;
  }

  // Taille de chaque île (sans sa position).
  _tailleIle(id) {
    if (id === '#aeroport') return { l: 300, h: 250 };
    if (id === '#centrale') return { l: 240, h: 230 };
    if (id === '#port') {
      const largeurs = this.disques.map(d => largeurEntrepot(d));
      return { l: Math.max(220, largeurs.reduce((s, x) => s + x + 24, 24)) + AVENUE, h: 270 };
    }
    const q = this.quartiers.get(id);
    this._dimensionnerQuartier(q);
    return { l: q.colonnes * LOT_L + 2 * BORD + AVENUE, h: q.bandes * BANDE + 2 * BORD };
  }

  _placer() {
    this.routes = [];      // { points: [[x,y]...], largeur, type }
    this.lots = [];
    this.arbres = [];
    this.zones = [];       // sols colorés des quartiers
    this.parcs = [];       // pelouses
    this.etangs = [];
    this.ponts = [];       // ponts 2 × 2 voies : { de (tête de pont sur l'île), a (entrée de l'anneau) }
    this.iles = new Map(); // id -> île { x, y, l, h, tete, xAvenue, ... }

    // Le hall central, à l'origine
    this.tour = { x: 0, y: 0, rayon: 72 };
    this.pelouseCentrale = { x: 0, y: 0, r: R_PLACE };
    this.rondsPoints = [{ x: 0, y: 0, r: R_ANNEAU, etoile: true }];
    this.hub = { x: 0, y: 0, r: R_HUB };

    this._disposerIles();
    for (const [id, ile] of this.iles) {
      if (id === '#aeroport') this._placerAeroport(ile);
      else if (id === '#port') this._placerPort(ile);
      else if (id === '#centrale') this._placerCentrale(ile);
      else this._placerQuartier(this.quartiers.get(id), ile);
    }
    this._placerCarrefours();
    this._placerTerre();
    this._planterArbres();
    this._eloignerArbresDesRoutes();

    // Version du plan : change quand une route ou un bâtiment bouge (un quartier qui s'agrandit…).
    // Le trafic s'en sert pour retracer les trajets en cours, le rendu pour redessiner le décor.
    const signature = [...[...this.iles.values()].map(i => `${i.x},${i.y},${i.l},${i.h}`),
      ...this.lots.map(l => `${l.app.id}:${l.x},${l.y}`), ...(this.entrepots ?? []).map(e => `${e.x},${e.l}`)].join('|');
    if (signature !== this._signature) {
      this._signature = signature;
      this.version = (this.version ?? 0) + 1;
    }
  }

  // Les îles en cercle autour du hall, assez loin pour ne toucher ni le hall ni leurs voisines.
  _disposerIles() {
    const tailles = ORDRE.map(id => ({ id, ...this._tailleIle(id) }));
    const n = tailles.length;
    const placer = rayonEnPlus => tailles.map((t, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
      const demi = Math.abs(ux) * t.l / 2 + Math.abs(uy) * t.h / 2;
      const d = R_HUB + MER + demi + rayonEnPlus;
      return { ...t, x: ux * d - t.l / 2, y: uy * d - t.h / 2, angle };
    });
    const chevauche = (a, b) => a.x < b.x + b.l + ESPACE_ILES && b.x < a.x + a.l + ESPACE_ILES
      && a.y < b.y + b.h + ESPACE_ILES && b.y < a.y + a.h + ESPACE_ILES;
    let iles = placer(0);
    for (let plus = 20; plus < 2000; plus += 20) {
      if (!iles.some((a, i) => chevauche(a, iles[(i + 1) % n]) || chevauche(a, iles[(i + 2) % n]))) break;
      iles = placer(plus);
    }
    for (const ile of iles) this.iles.set(ile.id, ile);
  }

  // Avenue d'île : le long du bord tourné vers le hall (à gauche si l'île est à droite du hall).
  // Tête de pont : le point de l'avenue le plus proche du hall ; le pont part de là vers l'anneau.
  _avenueEtPont(ile, yHaut, yBas, largeur = 20) {
    const aGauche = ile.x + ile.l / 2 > 0;
    ile.xAvenue = aGauche ? ile.x + AVENUE / 2 : ile.x + ile.l - AVENUE / 2;
    ile.tete = [ile.xAvenue, Math.max(yHaut, Math.min(yBas, 0))];
    const [y1, y2] = [Math.min(yHaut, ile.tete[1]), Math.max(yBas, ile.tete[1])];
    this.routes.push({ points: [[ile.xAvenue, y1], [ile.xAvenue, y2]], largeur, type: 'avenue' });
    const d = Math.hypot(ile.tete[0], ile.tete[1]) || 1;
    ile.entree = [(ile.tete[0] / d) * R_ANNEAU, (ile.tete[1] / d) * R_ANNEAU];
    this.ponts.push({ de: ile.tete, a: ile.entree, ile });
  }

  _placerQuartier(q, ile) {
    const l = q.colonnes * LOT_L;
    const h = q.bandes * BANDE;
    const aGauche = ile.x + ile.l / 2 > 0;
    const ox = aGauche ? ile.x + AVENUE + BORD : ile.x + BORD;
    const oy = ile.y + BORD;
    const zone = { quartier: q, x: ox - 10, y: oy - 10, l: l + 20, h: h + 20 };
    this.zones.push(zone);
    ile.quartier = q;

    const ruesY = [];
    for (let b = 0; b < q.bandes; b++) {
      const yRue = oy + b * BANDE + LOT_H + RUE / 2;
      ruesY.push(yRue);
      const xLoin = aGauche ? ox + l + 6 : ox - 6;
      const xAv = aGauche ? ile.x + AVENUE / 2 : ile.x + ile.l - AVENUE / 2;
      this.routes.push({ points: [[xAv, yRue], [xLoin, yRue]], largeur: 14, type: 'rue' });
    }
    this._avenueEtPont(ile, Math.min(...ruesY), Math.max(...ruesY));

    const capacite = 2 * q.colonnes * q.bandes;
    for (let i = 0; i < capacite; i++) {
      const bande = Math.floor(i / (2 * q.colonnes));
      const k = i % (2 * q.colonnes);
      // Les premières parcelles sont les plus proches de l'avenue.
      const col = aGauche ? Math.floor(k / 2) : q.colonnes - 1 - Math.floor(k / 2);
      const enHaut = k % 2 === 0;
      const x = ox + col * LOT_L;
      const y = oy + bande * BANDE + (enHaut ? 0 : LOT_H + RUE);
      const app = q.apps[i];
      if (!app) {
        // Parcelle libre : un petit square arboré.
        const parc = { x: x + 8, y: y + 8, l: LOT_L - 16, h: LOT_H - 16 };
        this.parcs.push(parc);
        this.arbres.push(...bosquet(parc, i + q.id.length * 31));
        continue;
      }
      const yRue = ruesY[bande];
      const lot = { x: x + 6, y: y + 6, l: LOT_L - 12, h: LOT_H - 12, enHaut, app, yRue, ile };
      lot.allee = [[x + LOT_L / 2, enHaut ? lot.y + lot.h - 14 : lot.y + 14], [x + LOT_L / 2, yRue]];
      app.lot = lot;
      this.lots.push(lot);
    }
  }

  // Île du port : une route de service au nord, les entrepôts (un par disque) le long du quai, un bassin.
  _placerPort(ile) {
    const aGauche = ile.x + ile.l / 2 > 0;
    const debut = aGauche ? ile.x + AVENUE + 24 : ile.x + 24;
    const service = ile.y + 40;
    const eY = service + 34;
    let x = debut;
    this.entrepots = this.disques.map((d, i) => {
      const l = largeurEntrepot(d);
      const e = { disque: d, x, y: eY, l, h: 84, toit: ['#3FA9E0', '#F2A541', '#E8504F', '#3DBE7A'][i % 4] };
      e.allee = [[x + l / 2, service], [x + l / 2, e.y]];
      this.routes.push({ points: e.allee, largeur: LARGE, type: 'allee' });
      x += l + 24;
      return e;
    });
    // Route de service : de l'avenue d'île jusqu'au dernier entrepôt.
    const xAv = aGauche ? ile.x + AVENUE / 2 : ile.x + ile.l - AVENUE / 2;
    const xLoin = aGauche ? Math.max(x - 12, debut + 40) : debut;
    this.routes.push({ points: [[xAv, service], [xLoin, service]], largeur: LARGE, type: 'service' });
    ile.service = service;
    this._avenueEtPont(ile, service, service + 60, LARGE);
    const bassinX = aGauche ? ile.x + AVENUE + 10 : ile.x + 10;
    this.bassin = { x: bassinX, y: eY + 84 + 24, l: ile.l - AVENUE - 20, h: ile.y + ile.h - (eY + 84 + 24) + 30 };
    this.bateaux = [
      { x: this.bassin.x + this.bassin.l * 0.3, y: this.bassin.y + 30, couleur: '#E8504F', phase: 0 },
      { x: this.bassin.x + this.bassin.l * 0.7, y: this.bassin.y + 44, couleur: '#3FA9E0', phase: 2 },
    ];
  }

  // Île de l'aéroport : terminal, piste, et une route de l'avenue d'île jusqu'au terminal.
  _placerAeroport(ile) {
    const aGauche = ile.x + ile.l / 2 > 0;
    const x0 = aGauche ? ile.x + AVENUE + 10 : ile.x + 20;
    const terminal = { x: x0 + 40, y: ile.y + 36, l: 120, h: 70 };
    const yRoute = terminal.y + terminal.h + 26;
    const entree = [terminal.x + terminal.l / 2, terminal.y + terminal.h];
    this.aeroport = {
      x: ile.x, y: ile.y, l: ile.l, h: ile.h,
      piste: { x: x0 + 10, y: yRoute + 40, l: 220, h: 34 },
      terminal, entree, yRoute,
    };
    const xAv = aGauche ? ile.x + AVENUE / 2 : ile.x + ile.l - AVENUE / 2;
    this.routes.push({ points: [[xAv, yRoute], [entree[0], yRoute], entree], largeur: LARGE, type: 'service' });
    this._avenueEtPont(ile, yRoute, yRoute, LARGE);
  }

  // Île électrique : une centrale ; une piste surélevée en part jusqu'à la tour centrale (l'ordinateur),
  // parcourue par des voitures de course (la consommation électrique estimée). Pas de pont.
  _placerCentrale(ile) {
    const usine = { x: ile.x + 65, y: ile.y + 50, l: 110, h: 70 };
    const depart = [usine.x + usine.l / 2, usine.y];
    // La piste aboutit au bord de la tour, du côté de la centrale.
    const vers = Math.atan2(depart[1] - this.tour.y, depart[0] - this.tour.x);
    const arrivee = [this.tour.x + Math.cos(vers) * this.tour.rayon, this.tour.y + Math.sin(vers) * this.tour.rayon];
    const distance = Math.hypot(arrivee[0] - depart[0], arrivee[1] - depart[1]);
    const [ux, uy] = [(arrivee[0] - depart[0]) / distance, (arrivee[1] - depart[1]) / distance];
    this.centrale = {
      ile,
      usine,
      tours: [{ x: ile.x + 60, y: ile.y + 170, r: 24 }, { x: ile.x + 130, y: ile.y + 176, r: 20 }],
      // Piste électrique : part vers le nord, puis file en courbe au-dessus de la mer jusqu'à la tour.
      piste: bezier(depart, [depart[0], depart[1] - distance * 0.3],
        [arrivee[0] - ux * distance * 0.3 + uy * distance * 0.15, arrivee[1] - uy * distance * 0.3 - ux * distance * 0.15],
        arrivee, Math.max(12, Math.round(distance / 25))),
    };
  }

  // Feux tricolores là où les rues des quartiers débouchent sur l'avenue de leur île.
  _placerCarrefours() {
    const feux = new Map();
    for (const route of this.routes) {
      if (route.type !== 'rue') continue;
      const [x, y] = route.points[0];
      const cle = `${Math.round(x)},${Math.round(y)}`;
      if (!feux.has(cle)) feux.set(cle, { x, y, cle });
    }
    this.feux = [...feux.values()];
  }

  _placerTerre() {
    this.terre = [...this.iles.values()].map(i => ({ x: i.x, y: i.y, l: i.l, h: i.h, rayon: 40 }));
    // Île centrale (ronde) et côtes irrégulières : des avancées arrondies le long des rivages,
    // sauf autour des têtes de pont.
    this.avancees = [{ x: 0, y: 0, r: R_HUB }];
    const alea = graine(3);
    for (const ile of this.iles.values()) {
      const ajouter = (x, y) => {
        if (ile.tete && Math.hypot(x - ile.tete[0], y - ile.tete[1]) < 70) return;
        if (alea() < 0.4) return;
        this.avancees.push({ x, y, r: 16 + alea() * 22 });
      };
      for (let x = ile.x + 50; x < ile.x + ile.l - 50; x += 55) { ajouter(x, ile.y + 4); ajouter(x, ile.y + ile.h - 4); }
      for (let y = ile.y + 50; y < ile.y + ile.h - 50; y += 55) { ajouter(ile.x + 4, y); ajouter(ile.x + ile.l - 4, y); }
    }
    const xs = [...this.iles.values()].flatMap(i => [i.x, i.x + i.l]).concat([-R_HUB, R_HUB]);
    const ys = [...this.iles.values()].flatMap(i => [i.y, i.y + i.h]).concat([-R_HUB, R_HUB]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    this.bornes = { x: x0 - 60, y: y0 - 60, l: x1 - x0 + 120, h: y1 - y0 + 120 };
  }

  _planterArbres() {
    // Bosquets entre l'anneau et la côte de l'île centrale, et sur les bords libres des îles.
    const alea = graine(7);
    for (let i = 0; i < 70; i++) {
      const angle = alea() * Math.PI * 2;
      const r = R_ANNEAU + 40 + alea() * (R_HUB - R_ANNEAU - 55);
      this.arbres.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, r: 7 + alea() * 6 });
    }
    for (let i = 0; i < 26; i++) {
      const angle = alea() * Math.PI * 2;
      const r = 50 + alea() * (R_PLACE - 70);
      if (Math.hypot(Math.cos(angle) * r, Math.sin(angle) * r) < this.tour.rayon + 30) continue;
      this.arbres.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, r: 6 + alea() * 5 });
    }
    for (const ile of this.iles.values()) {
      if (ile.id === '#centrale' || ile.id === '#aeroport') continue;
      const bandes = [{ x: ile.x + 8, y: ile.y + 6, l: ile.l - 16, h: BORD - 12 }];
      // Au port, le bas de l'île est le bassin : pas d'arbres dans l'eau.
      if (ile.id !== '#port') bandes.push({ x: ile.x + 8, y: ile.y + ile.h - BORD + 6, l: ile.l - 16, h: BORD - 12 });
      bandes.forEach((b, k) => this.arbres.push(...bosquet(b, ile.l + k * 13)));
    }
  }

  // Aucun arbre sur une route, un pont, l'anneau ni la place de la tour.
  _eloignerArbresDesRoutes() {
    const segments = [];
    for (const route of this.routes) {
      for (let i = 1; i < route.points.length; i++) segments.push([route.points[i - 1], route.points[i], route.largeur / 2]);
    }
    for (const lot of this.lots) segments.push([lot.allee[0], lot.allee[1], 5]);
    for (const pont of this.ponts) segments.push([pont.de, pont.a, 22]);
    const surRoute = a => segments.some(([p, q, demi]) => distanceSegment(a.x, a.y, p, q) < demi + a.r + 3)
      || Math.abs(Math.hypot(a.x, a.y) - R_ANNEAU) < 26 + a.r + 3
      || Math.hypot(a.x - this.tour.x, a.y - this.tour.y) < this.tour.rayon + a.r + 8
      || this.lots.some(l => a.x > l.x - 4 && a.x < l.x + l.l + 4 && a.y > l.y - 4 && a.y < l.y + l.h + 4);
    this.arbres = this.arbres.filter(a => !surRoute(a));
  }

  // ---------- Trajets des véhicules ----------

  // Accès d'un point de départ (ou d'arrivée) à la tête de pont de son île, dans le sens « sortant ».
  _acces(lieu) {
    if (lieu.type === 'app') {
      const lot = lieu.app.lot;
      const [xA, yA] = lot.allee[0];
      return { ile: lot.ile, points: [[xA, yA], [xA, lot.yRue], [lot.ile.xAvenue, lot.yRue], lot.ile.tete] };
    }
    if (lieu.type === 'entrepot') {
      const e = this.entrepots?.find(x => x.disque.id === lieu.entrepot.disque.id) ?? lieu.entrepot;
      const ile = this.iles.get('#port');
      const [tx] = e.allee[0];
      return { ile, points: [[tx, e.y], [tx, ile.service], [ile.xAvenue, ile.service], ile.tete] };
    }
    const a = this.aeroport;
    const ile = this.iles.get('#aeroport');
    return { ile, points: [a.entree, [a.entree[0], a.yRoute], [ile.xAvenue, a.yRoute], ile.tete] };
  }

  // Trajet d'une application vers sa cible (entrepôt ou aéroport), ou l'inverse (versApp) :
  // accès à la tête de pont, pont, tour de l'anneau (sens inverse des aiguilles d'une montre, comme
  // en France), pont, accès à l'arrivée. Renvoie { points, voies } : voies = parties à 2 voies par sens
  // (les deux ponts), en indices de points.
  trajet(app, cible, versApp = false) {
    if (!app.lot) return null;
    const source = { type: 'app', app };
    const [de, vers] = versApp ? [cible, source] : [source, cible];
    const aller = this._acces(de);
    const arrivee = this._acces(vers);
    const p1 = aller.ile.entree;
    const p2 = arrivee.ile.entree;
    // Anneau : l'angle décroît (y vers le bas) ; au moins un petit bout si entrée et sortie se confondent.
    const a1 = Math.atan2(p1[1], p1[0]);
    const a2 = Math.atan2(p2[1], p2[0]);
    let tour = a1 - a2;
    while (tour <= 0.05) tour += 2 * Math.PI;
    while (tour > 2 * Math.PI) tour -= 2 * Math.PI;
    const n = Math.max(2, Math.ceil(tour / 0.08));
    const anneau = [];
    for (let k = 0; k <= n; k++) {
      const angle = a1 - (tour * k) / n;
      anneau.push([Math.cos(angle) * R_ANNEAU, Math.sin(angle) * R_ANNEAU]);
    }
    const points = nettoyer([...aller.points, ...anneau, ...arrivee.points.slice().reverse()]);
    const i1 = trouver(points, aller.ile.tete);
    const i2 = trouver(points, arrivee.ile.tete, i1 + 1);
    // 2 voies par sens d'un bout à l'autre : pont, anneau (très large, comme la vraie Étoile), pont.
    // Au port et à l'aéroport, elles continuent jusqu'à l'entrepôt ou au terminal : tout le trafic
    // disque et réseau y converge.
    const large = lieu => lieu.type !== 'app';
    return { points, voies: [[large(de) ? 0 : i1, large(vers) ? points.length - 1 : i2]] };
  }

  // ---------- Recherche d'éléments ----------

  elementEn(x, y) {
    for (const lot of this.lots) {
      if (x >= lot.x && x <= lot.x + lot.l && y >= lot.y && y <= lot.y + lot.h) return { type: 'app', app: lot.app };
    }
    if (this.tour && Math.hypot(x - this.tour.x, y - this.tour.y) <= this.tour.rayon + 6) return { type: 'tour' };
    for (const e of this.entrepots ?? []) {
      if (x >= e.x && x <= e.x + e.l && y >= e.y && y <= e.y + e.h) return { type: 'entrepot', entrepot: e };
    }
    const a = this.aeroport;
    if (a && x >= a.x && x <= a.x + a.l && y >= a.y && y <= a.y + a.h) return { type: 'aeroport' };
    const c = this.centrale?.ile;
    if (c && x >= c.x && x <= c.x + c.l && y >= c.y && y <= c.y + c.h) return { type: 'centrale' };
    if (Math.hypot(x, y) <= R_HUB) return { type: 'hall' };
    return null;
  }

  // En mode discret, on cherche aussi par nom neutre (« Navigateurs 2 »).
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

function largeurEntrepot(disque) {
  // Taille selon la capacité, sur une échelle logarithmique pour qu'un petit disque reste visible.
  const go = disque.total / 2 ** 30;
  return Math.round(90 + 30 * Math.log2(Math.max(go, 16) / 16));
}

function distanceSegment(x, y, p, q) {
  const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / l2));
  return Math.hypot(x - p[0] - dx * t, y - p[1] - dy * t);
}

// Courbe de Bézier cubique de a à b (points de contrôle c1, c2), en n segments.
function bezier(a, c1, c2, b, n) {
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    points.push([
      u ** 3 * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * b[0],
      u ** 3 * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * b[1],
    ]);
  }
  return points;
}

// Retire les points répétés (un segment de longueur nulle fausserait le décalage des voies).
function nettoyer(points) {
  return points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.01);
}

// Indice du point d'une liste le plus proche de « cible », à partir de l'indice « depuis ».
function trouver(points, cible, depuis = 0) {
  let meilleur = depuis;
  let d = Infinity;
  for (let i = depuis; i < points.length; i++) {
    const e = Math.hypot(points[i][0] - cible[0], points[i][1] - cible[1]);
    if (e < d - 1e-6) { d = e; meilleur = i; }
  }
  return meilleur;
}

// Arbres répartis dans un rectangle, en évitant un éventuel étang.
function bosquet(rect, n, etang) {
  const alea = graine(n + 1);
  const nombre = Math.max(2, Math.min(14, Math.round((rect.l * rect.h) / 2600)));
  const arbres = [];
  for (let i = 0; i < nombre * 2 && arbres.length < nombre; i++) {
    const x = rect.x + 10 + alea() * Math.max(0, rect.l - 20);
    const y = rect.y + 10 + alea() * Math.max(0, rect.h - 20);
    if (etang && ((x - etang.x) / (etang.rx + 14)) ** 2 + ((y - etang.y) / (etang.ry + 14)) ** 2 < 1) continue;
    arbres.push({ x, y, r: 7 + alea() * 6 });
  }
  return arbres;
}

function graine(n) {
  // Générateur pseudo-aléatoire déterministe : le décor ne bouge pas d'un affichage à l'autre.
  let s = Math.abs(n * 9301 + 49297) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Nom affiché d'une application. En mode discret (F22), un nom neutre et stable : quartier + numéro de place.
export function nomVisible(app, discret) {
  return discret ? `${app.quartier.nom} ${app.emplacement + 1}` : app.donnees.nom;
}

export function normaliser(texte) {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
