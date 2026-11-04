// Modèle de la ville : où se trouve chaque élément, indépendamment du dessin.
// Les positions sont stables : une application garde sa parcelle tant que la page est ouverte.

export const LOT_L = 100;        // largeur d'une parcelle
export const LOT_H = 78;         // hauteur d'une parcelle
export const RUE = 30;           // bande de la rue intérieure entre deux rangées de parcelles
export const COULOIR = 60;       // espace entre deux quartiers, avec la route au milieu
export const MARGE = 90;         // bande de terre entre la rocade et la mer
export const RAYON_ROND_POINT = 28;

const BANDE = 2 * LOT_H + RUE;
const TAILLE_CENTRE = 300;

// Disposition des quartiers en 3 × 3 autour de la tour centrale.
const GRILLE = [
  ['navigateurs', 'communication', 'bureautique'],
  ['developpement', '#centre', 'multimedia'],
  ['divers', 'systeme', '#port'],
];

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

  _taillePort() {
    const largeurs = this.disques.map(d => largeurEntrepot(d));
    const l = Math.max(240, largeurs.reduce((s, x) => s + x + 24, 24));
    return { l, h: 190 };
  }

  _taille(id) {
    if (id === '#centre') return { l: TAILLE_CENTRE, h: TAILLE_CENTRE };
    if (id === '#port') return this._taillePort();
    const q = this.quartiers.get(id);
    this._dimensionnerQuartier(q);
    return { l: q.colonnes * LOT_L, h: q.bandes * BANDE };
  }

  _placer() {
    const tailles = GRILLE.map(ligne => ligne.map(id => this._taille(id)));
    const largeurs = [0, 1, 2].map(j => Math.max(...tailles.map(l => l[j].l)));
    const hauteurs = tailles.map(l => Math.max(...l.map(t => t.h)));

    // Axes des routes : rocade extérieure + avenues entre les quartiers.
    const X = [0];
    largeurs.forEach(l => X.push(X[X.length - 1] + COULOIR + l));
    const Y = [0];
    hauteurs.forEach(h => Y.push(Y[Y.length - 1] + COULOIR + h));
    this.X = X;
    this.Y = Y;

    this.routes = [];      // { points: [[x,y]...], largeur, type }
    this.lots = [];
    this.arbres = [];
    this.zones = [];       // sols colorés des quartiers
    this.parcs = [];       // pelouses
    this.etangs = [];

    // Rocade et avenues
    this.rocade = { x: X[0], y: Y[0], l: X[3] - X[0], h: Y[3] - Y[0], rayon: 46 };
    for (const x of [X[1], X[2]]) this.routes.push({ points: [[x, Y[0]], [x, Y[3]]], largeur: 20, type: 'avenue' });
    for (const y of [Y[1], Y[2]]) this.routes.push({ points: [[X[0], y], [X[3], y]], largeur: 20, type: 'avenue' });

    GRILLE.forEach((ligne, i) => ligne.forEach((id, j) => {
      const cellule = {
        x: X[j] + COULOIR / 2, y: Y[i] + COULOIR / 2,
        l: largeurs[j], h: hauteurs[i],
        gauche: X[j], droite: X[j + 1],
      };
      if (id === '#centre') this._placerCentre(cellule);
      else if (id === '#port') this._placerPort(cellule);
      else this._placerQuartier(this.quartiers.get(id), cellule);
    }));

    this._placerAeroport();
    this._placerCarrefours();
    this._placerTerre();
    this._planterArbres();
    this._eloignerArbresDesRoutes();

    // Version du plan : change quand une route ou un bâtiment bouge (un quartier qui s'agrandit…).
    // Le trafic s'en sert pour retracer les trajets en cours, le rendu pour redessiner le décor.
    const signature = [X.join(), Y.join(), ...this.lots.map(l => `${l.app.id}:${l.x},${l.y}`),
      ...(this.entrepots ?? []).map(e => `${e.x},${e.l}`)].join('|');
    if (signature !== this._signature) {
      this._signature = signature;
      this.version = (this.version ?? 0) + 1;
    }
  }

  // Aucun arbre sur une route : les parcs placés de part et d'autre d'un quartier sont traversés par
  // sa rue, et la bande de terre longe la rocade.
  _eloignerArbresDesRoutes() {
    const segments = [];
    for (const route of this.routes) {
      for (let i = 1; i < route.points.length; i++) segments.push([route.points[i - 1], route.points[i], route.largeur / 2]);
    }
    for (const lot of this.lots) segments.push([lot.allee[0], lot.allee[1], 5]);
    const r = this.rocade;
    const coins = [[r.x, r.y], [r.x + r.l, r.y], [r.x + r.l, r.y + r.h], [r.x, r.y + r.h]];
    coins.forEach((c, i) => segments.push([c, coins[(i + 1) % 4], 11]));
    const surRoute = a => segments.some(([p, q, demi]) => distanceSegment(a.x, a.y, p, q) < demi + a.r + 3)
      || (this.rondsPoints ?? []).some(rp => Math.abs(Math.hypot(a.x - rp.x, a.y - rp.y) - rp.r) < 11 + a.r + 3)
      || (this.tour && Math.abs(Math.hypot(a.x - this.tour.x, a.y - this.tour.y) - this.tour.rondPoint) < 11 + a.r + 3);
    this.arbres = this.arbres.filter(a => !surRoute(a));
  }

  // Ronds-points aux croisements des avenues ; feux tricolores là où les rues des quartiers
  // débouchent sur les avenues intérieures, et aux carrefours de la rocade côté aéroport.
  _placerCarrefours() {
    const [X, Y] = [this.X, this.Y];
    this.rondsPoints = [];
    for (const x of [X[1], X[2]]) for (const y of [Y[1], Y[2]]) this.rondsPoints.push({ x, y, r: RAYON_ROND_POINT });
    const feux = new Map();
    const ajouter = (x, y) => {
      const cle = `${Math.round(x)},${Math.round(y)}`;
      if (!feux.has(cle)) feux.set(cle, { x, y, cle });
    };
    for (const route of this.routes) {
      if (route.type !== 'rue') continue;
      for (const [x, y] of route.points) if (x === X[1] || x === X[2]) ajouter(x, y);
    }
    for (const y of [Y[1], Y[2], this.aeroport.yRoute]) ajouter(X[3], y);
    this.feux = [...feux.values()];
  }

  _placerQuartier(q, cellule) {
    const l = q.colonnes * LOT_L;
    const h = q.bandes * BANDE;
    const ox = cellule.x + (cellule.l - l) / 2;
    const oy = cellule.y + (cellule.h - h) / 2;
    const zone = { quartier: q, x: ox - 10, y: oy - 10, l: l + 20, h: h + 20 };
    this.zones.push(zone);
    this._parcsAutour(cellule, zone, q.id.length * 17);

    for (let b = 0; b < q.bandes; b++) {
      const yRue = oy + b * BANDE + LOT_H + RUE / 2;
      this.routes.push({ points: [[cellule.gauche, yRue], [cellule.droite, yRue]], largeur: 14, type: 'rue' });
    }

    const capacite = 2 * q.colonnes * q.bandes;
    for (let i = 0; i < capacite; i++) {
      const bande = Math.floor(i / (2 * q.colonnes));
      const k = i % (2 * q.colonnes);
      const col = Math.floor(k / 2);
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
      const yRue = oy + bande * BANDE + LOT_H + RUE / 2;
      const lot = { x: x + 6, y: y + 6, l: LOT_L - 12, h: LOT_H - 12, enHaut, app, yRue, cellule };
      lot.allee = [[x + LOT_L / 2, enHaut ? lot.y + lot.h - 14 : lot.y + 14], [x + LOT_L / 2, yRue]];
      app.lot = lot;
      this.lots.push(lot);
    }
  }

  // Remplit de parcs l'espace laissé libre entre un quartier et les avenues qui l'entourent.
  _parcsAutour(cellule, zone, n) {
    const marge = 14;
    const candidats = [
      { x: cellule.x, y: cellule.y, l: zone.x - cellule.x - marge, h: cellule.h },
      { x: zone.x + zone.l + marge, y: cellule.y, l: cellule.x + cellule.l - zone.x - zone.l - marge, h: cellule.h },
      { x: zone.x, y: cellule.y, l: zone.l, h: zone.y - cellule.y - marge },
      { x: zone.x, y: zone.y + zone.h + marge, l: zone.l, h: cellule.y + cellule.h - zone.y - zone.h - marge },
    ];
    candidats.forEach((r, i) => {
      if (r.l < 46 || r.h < 46) return;
      this.parcs.push(r);
      if (r.l > 150 && r.h > 110) {
        this.etangs.push({ x: r.x + r.l / 2, y: r.y + r.h / 2, rx: Math.min(r.l, 220) / 4, ry: Math.min(r.h, 160) / 4 });
      }
      this.arbres.push(...bosquet(r, n + i * 7, this.etangs[this.etangs.length - 1]));
    });
  }

  _placerCentre(cellule) {
    const cx = cellule.x + cellule.l / 2;
    const cy = cellule.y + cellule.h / 2;
    const rayon = 100;
    this.tour = { x: cx, y: cy, rayon: 58, rondPoint: rayon };
    // Square autour de la tour : pelouse dans le rond-point et aux quatre coins.
    this.pelouseCentrale = { x: cx, y: cy, r: rayon - 11 };
    const demi = cellule.l / 2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const parc = { x: sx < 0 ? cellule.x : cx + 22, y: sy < 0 ? cellule.y : cy + 22, l: demi - 22, h: cellule.h / 2 - 22 };
      this.parcs.push(parc);
      const alea = graine(sx * 3 + sy + 11);
      for (let i = 0; i < 7; i++) {
        const x = parc.x + 12 + alea() * (parc.l - 24);
        const y = parc.y + 12 + alea() * (parc.h - 24);
        if (Math.hypot(x - cx, y - cy) > rayon + 26) this.arbres.push({ x, y, r: 7 + alea() * 5 });
      }
    }
    const [X, Y] = [this.X, this.Y];
    this.routes.push({ points: [[cx, cy - rayon], [cx, Y[1]]], largeur: 20, type: 'avenue' });
    this.routes.push({ points: [[cx, cy + rayon], [cx, Y[2]]], largeur: 20, type: 'avenue' });
    this.routes.push({ points: [[cx - rayon, cy], [X[1], cy]], largeur: 20, type: 'avenue' });
    this.routes.push({ points: [[cx + rayon, cy], [X[2], cy]], largeur: 20, type: 'avenue' });
  }

  _placerPort(cellule) {
    // Les entrepôts sont alignés le long du quai, au bord d'un bassin relié à la mer.
    const quai = cellule.y + cellule.h - 70;
    let x = cellule.x + (cellule.l - this._taillePort().l) / 2 + 24;
    this.entrepots = this.disques.map((d, i) => {
      const l = largeurEntrepot(d);
      const e = { disque: d, x, y: quai - 96, l, h: 84, toit: ['#3FA9E0', '#F2A541', '#E8504F', '#3DBE7A'][i % 4] };
      e.allee = [[x + l / 2, cellule.y - COULOIR / 2], [x + l / 2, e.y]];
      this.routes.push({ points: e.allee, largeur: 12, type: 'allee' });
      x += l + 24;
      return e;
    });
    this.bassin = {
      x: cellule.x + 20, y: quai,
      l: cellule.l - 40, h: this.Y[3] + MARGE + 40 - quai,
    };
    this.bateaux = [
      { x: this.bassin.x + this.bassin.l * 0.3, y: quai + 30, couleur: '#E8504F', phase: 0 },
      { x: this.bassin.x + this.bassin.l * 0.7, y: quai + 44, couleur: '#3FA9E0', phase: 2 },
    ];
    // Parc au-dessus des entrepôts
    const haut = { x: cellule.x, y: cellule.y, l: cellule.l, h: quai - 96 - 16 - cellule.y };
    if (haut.h >= 46) {
      this.parcs.push(haut);
      this.arbres.push(...bosquet(haut, 99));
    }
  }

  _placerAeroport() {
    const yMilieu = (this.Y[1] + this.Y[2]) / 2;
    const x0 = this.X[3] + MARGE + 30;
    this.aeroport = {
      x: x0, y: yMilieu - 150, l: 300, h: 300,
      piste: { x: x0 + 40, y: yMilieu + 40, l: 230, h: 34 },
      terminal: { x: x0 + 50, y: yMilieu - 90, l: 120, h: 70 },
      entree: [x0 + 110, yMilieu - 20],
      yRoute: yMilieu,
    };
    this.routes.push({ points: [[this.X[3], yMilieu], [x0 + 110, yMilieu], [x0 + 110, yMilieu - 20]], largeur: 20, type: 'avenue' });
    // Le pont qui relie la presqu'île à l'aéroport
    this.pont = { x1: this.X[3] + MARGE - 10, x2: x0 + 10, y: yMilieu };
  }

  _placerTerre() {
    const X = this.X, Y = this.Y;
    const terre = { x: X[0] - MARGE, y: Y[0] - MARGE, l: X[3] - X[0] + 2 * MARGE, h: Y[3] - Y[0] + 2 * MARGE, rayon: 70 };
    this.terre = [
      terre,
      { x: this.aeroport.x, y: this.aeroport.y, l: this.aeroport.l, h: this.aeroport.h, rayon: 60 },
    ];
    // Côte irrégulière : des avancées arrondies le long du rivage (sauf devant le port et le pont).
    this.avancees = [];
    const alea = graine(3);
    const ajouter = (x, y) => {
      if (this.bassin && x > this.bassin.x - 60 && x < this.bassin.x + this.bassin.l + 60 && y > Y[3]) return;
      if (x > X[3] && Math.abs(y - this.pont.y) < 70) return;
      if (alea() < 0.35) return;
      this.avancees.push({ x, y, r: 22 + alea() * 34 });
    };
    for (let x = terre.x + 80; x < terre.x + terre.l - 80; x += 55) {
      ajouter(x, terre.y + 6);
      ajouter(x, terre.y + terre.h - 6);
    }
    for (let y = terre.y + 80; y < terre.y + terre.h - 80; y += 55) {
      ajouter(terre.x + 6, y);
      ajouter(terre.x + terre.l - 6, y);
    }
    this.bornes = {
      x: X[0] - MARGE - 50, y: Y[0] - MARGE - 50,
      l: this.aeroport.x + this.aeroport.l - (X[0] - MARGE) + 50, h: Y[3] - Y[0] + 2 * MARGE + 100,
    };
  }

  _planterArbres() {
    // Bosquets dans la bande de terre entre la rocade et la mer.
    const X = this.X, Y = this.Y;
    const alea = graine(7);
    for (let i = 0; i < 90; i++) {
      const cote = Math.floor(alea() * 4);
      const t = alea();
      const p = 24 + alea() * (MARGE - 40);
      let x, y;
      if (cote === 0) { x = X[0] + t * (X[3] - X[0]); y = Y[0] - p; }
      else if (cote === 1) { x = X[0] + t * (X[3] - X[0]); y = Y[3] + p; }
      else if (cote === 2) { x = X[0] - p; y = Y[0] + t * (Y[3] - Y[0]); }
      else { x = X[3] + p; y = Y[0] + t * (Y[3] - Y[0]); }
      if (this.bassin && x > this.bassin.x - 20 && x < this.bassin.x + this.bassin.l + 20 && y > Y[3]) continue;
      if (this.pont && cote === 3 && Math.abs(y - this.pont.y) < 40) continue;
      this.arbres.push({ x, y, r: 7 + alea() * 6 });
    }
  }

  // ---------- Trajets des véhicules ----------

  // Trajet d'une application vers un entrepôt (disque) ou l'aéroport (Internet), en suivant les routes.
  trajet(app, cible) {
    const lot = app.lot;
    if (!lot) return null;
    const [X, Y] = [this.X, this.Y];
    const [xA, yA] = lot.allee[0];
    const yRue = lot.yRue;
    const points = [[xA, yA], [xA, yRue]];

    if (cible.type === 'entrepot') {
      const e = cible.entrepot;
      const tx = e.allee[0][0];
      const xs = tx > (lot.cellule.gauche + lot.cellule.droite) / 2 ? lot.cellule.droite : lot.cellule.gauche;
      points.push([xs, yRue], [xs, Y[2]], [tx, Y[2]], [tx, e.y]);
    } else {
      const a = this.aeroport;
      const xs = lot.cellule.droite;
      points.push([xs, yRue]);
      if (xs !== X[3]) {
        const ym = yRue < a.yRoute ? Y[1] : Y[2];
        points.push([xs, ym], [X[3], ym]);
      }
      // Rocade, puis pont jusqu'au pied du terminal, puis entrée du terminal (tracé de la route).
      points.push([X[3], a.yRoute], [a.entree[0], a.yRoute], a.entree.slice());
    }
    return this._passerRondsPoints(simplifier(points));
  }

  // Autoroute (gros flux soutenu), comme dans Mini Motorways : le véhicule sort par la rue du quartier,
  // prend l'avenue, puis une courte bretelle au sol jusqu'à un échangeur posé à côté de la route.
  // De là, l'autoroute file en courbe douce au-dessus de la ville jusqu'à l'échangeur d'arrivée,
  // relié par une autre bretelle à la route de la cible. Renvoie :
  //   points    : le trajet complet ;
  //   haut      : [indice de l'échangeur de départ, indice de l'échangeur d'arrivée] (partie en hauteur) ;
  //   bretelles : les deux bretelles au sol [route, échangeur] ;
  //   echangeurs: les deux échangeurs.
  //
  // Chaque bout est un vrai échangeur : on ne quitte une route et on ne s'y insère que par la droite,
  // dans sa propre voie, sans jamais couper l'autre sens. Quand l'échangeur est de l'autre côté de la
  // route, la bretelle fait une boucle de 270° (comme un trèfle) et passe au-dessus de la route.
  // Départ : sur l'avenue, au bout de la rue du quartier. Arrivée : directement sur la cible, avec les
  // 4 voies de l'autoroute (voir arriveeAutoroute).
  //
  // Renvoie :
  //   aller, retour : { points, haut: [premier, dernier indice de la partie en hauteur] } (sans inversion :
  //                   chaque sens a ses propres bretelles) ;
  //   ruban         : l'autoroute elle-même, d'un échangeur à l'autre ;
  //   rampes        : les quatre bretelles, { sol: partie au sol, pont: partie en hauteur ou null } ;
  //   echangeurs    : les deux péages.
  // Zone de péage d'arrivée, partagée par toutes les autoroutes vers une même cible : une place à
  // 4 voies (2 cabines par sens) juste au-dessus de l'entrepôt (à côté de son allée) ou du terminal de
  // l'aéroport, prolongée par une route à 4 voies, de la largeur de l'autoroute, qui s'arrête au bord
  // de la cible. Les autoroutes entrent dans la place par le haut.
  peageArrivee(cible) {
    const L = 48;
    const H = 40;
    let cx, bord;
    if (cible.type === 'entrepot') {
      const e = this.entrepots?.find(x => x.disque.id === cible.entrepot.disque.id) ?? cible.entrepot;
      const tx = e.allee[0][0];
      // À gauche de l'allée, qui arrive au milieu de l'entrepôt, sans la toucher.
      cx = Math.max(e.x + L / 2, tx - Math.max(32, e.l / 4));
      bord = e.y;
    } else {
      const t = this.aeroport.terminal;
      cx = t.x + t.l / 2;
      bord = t.y;
    }
    const cy = bord - 30 - H / 2;
    return { centre: [cx, cy], l: L, h: H, haut: [cx, cy - H / 2], bas: [cx, cy + H / 2], fin: [cx, bord] };
  }

  trajetAutoroute(app, cible) {
    const lot = app.lot;
    if (!lot) return null;
    const [X, Y] = [this.X, this.Y];
    const [xA, yA] = lot.allee[0];
    const yRue = lot.yRue;
    const peage = this.peageArrivee(cible);
    const n2 = peage.haut;
    const xs = n2[0] > (lot.cellule.gauche + lot.cellule.droite) / 2 ? lot.cellule.droite : lot.cellule.gauche;
    // Départ : sur l'avenue, 40 px après la rue, du côté où il y a le plus de place jusqu'au carrefour
    // suivant (la boucle ne doit pas toucher un rond-point) ; échangeur du côté de l'arrivée.
    const j1 = [xs, yRue];
    const vers = Y.filter(y => y !== undefined);
    const placeEnHaut = yRue - Math.max(...vers.filter(y => y < yRue), -Infinity);
    const placeEnBas = Math.min(...vers.filter(y => y > yRue), Infinity) - yRue;
    const h1 = [0, placeEnBas >= placeEnHaut ? 1 : -1];
    const p1 = plus(j1, h1, 40);
    const c1 = [Math.sign(n2[0] - xs) || 1, 0];
    const n1 = plus(p1, c1, ECARTEMENT);

    // L'autoroute quitte l'échangeur de départ dans l'axe de ses bretelles et descend se poser sur la cible.
    const distance = Math.hypot(n2[0] - n1[0], n2[1] - n1[1]);
    const ruban = bezier(n1, plus(n1, c1, distance * 0.4), plus(n2, [0, -1], distance * 0.4), n2, Math.max(8, Math.round(distance / 30)));

    const sortie1 = bretelleSortie(p1, h1, c1);          // aller : quitte l'avenue
    // Retour : vraie sortie. La bretelle se détache du ruban par la droite, passe en pont au-dessus des
    // toits et se pose sur sa propre voie, dans l'axe de la rue du quartier, de l'autre côté de l'avenue :
    // au feu du carrefour, on traverse l'avenue tout droit. Ni insertion dans l'avenue, ni tourne-à-gauche.
    // (Cas rare où l'application est du côté de l'échangeur : bretelle simple d'avant.)
    let entree1, rubanRetour, depart, departSortie = 0;
    if ((xA - xs) * c1[0] < 0) {
      const versCarrefour = oppose(c1);
      const cote = droiteDe(versCarrefour);
      const pose = plus(plus(j1, c1, LONGUEUR_DEDIEE), cote, VOIE_DEDIEE);   // la bretelle touche le sol
      const arret = plus(plus(j1, c1, 20), cote, VOIE_DEDIEE);              // ligne d'arrêt du feu
      // Point de départ sur le ruban : assez loin pour une bretelle en S douce jusqu'à la voie dédiée.
      const inverse = ruban.slice().reverse();
      let sens;
      for (departSortie = DEPART_SORTIE; ; departSortie += 20) {
        [rubanRetour, depart, sens] = couperFin(inverse, departSortie);
        const avance = produit([depart[0] - j1[0], depart[1] - j1[1]], c1);
        if (avance >= LONGUEUR_DEDIEE + 110 || departSortie > distance * 0.45) break;
      }
      const ecart = Math.hypot(pose[0] - depart[0], pose[1] - depart[1]);
      const rampe = bezier(depart, plus(depart, sens, ecart * 0.45), plus(pose, c1, ecart * 0.45), pose, 14);
      entree1 = { points: [...rampe, arret, j1], sol: [pose, arret, j1], pont: rampe };
    } else {
      entree1 = bretelleEntree(p1, oppose(h1), c1);
      rubanRetour = ruban.slice().reverse();
      entree1.points.push(j1);
    }
    // Péage puis route à 4 voies jusqu'au bord de la cible : on garde sa voie de l'autoroute tout du long.
    const entree2 = { points: [n2, peage.bas, peage.fin], pont: null };
    const sortie2 = { points: [peage.fin, peage.bas, n2], pont: null };

    const assembler = (avant, sortie, rubanSens, entree, apres) => {
      const points = nettoyer([...avant, ...sortie.points, ...rubanSens.slice(1), ...entree.points.slice(1), ...apres]);
      // Partie en hauteur : du début du pont de la bretelle de sortie (ou de l'échangeur) jusqu'à la fin
      // du pont de la bretelle d'entrée (ou de l'échangeur).
      const premier = trouver(points, sortie.pont ? sortie.pont[0] : sortie.points[sortie.points.length - 1]);
      const dernier = trouver(points, entree.pont ? entree.pont[entree.pont.length - 1] : entree.points[0], premier);
      return { points, haut: [premier, dernier] };
    };
    const aller = assembler([[xA, yA], [xA, yRue], j1], sortie1, ruban, entree2, []);
    const retour = assembler([], sortie2, rubanRetour, entree1, [[xA, yRue], [xA, yA]]);
    // Partie à 2 voies par sens : l'autoroute, prolongée par le péage et la route jusqu'à la cible.
    // Au retour, elle s'arrête où la bretelle de sortie se détache.
    aller.voies = [aller.haut[0], aller.points.length - 1];
    retour.voies = [0, depart ? trouver(retour.points, depart) : retour.haut[1]];
    return {
      aller,
      retour,
      ruban,
      departSortie,
      rampes: [sortie1, entree1],
      echangeurs: [n1],
      peage,
    };
  }

  // Au passage d'un rond-point, le trajet en fait le tour (sens inverse des aiguilles d'une montre,
  // comme en France) au lieu de traverser le carrefour.
  _passerRondsPoints(points) {
    const rps = this.rondsPoints ?? [];
    const coupe = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      const traverses = rps.filter(r => (a[1] === b[1] && r.y === a[1] && (r.x - a[0]) * (r.x - b[0]) < 0)
        || (a[0] === b[0] && r.x === a[0] && (r.y - a[1]) * (r.y - b[1]) < 0));
      traverses.sort((r1, r2) => Math.hypot(r1.x - a[0], r1.y - a[1]) - Math.hypot(r2.x - a[0], r2.y - a[1]));
      for (const r of traverses) coupe.push([r.x, r.y]);
      coupe.push(b);
    }
    const res = [coupe[0]];
    for (let i = 1; i < coupe.length - 1; i++) {
      const p = coupe[i];
      const r = rps.find(x => x.x === p[0] && x.y === p[1]);
      if (!r) { res.push(p); continue; }
      const [avant, apres] = [coupe[i - 1], coupe[i + 1]];
      const lin = Math.hypot(p[0] - avant[0], p[1] - avant[1]) || 1;
      const lout = Math.hypot(apres[0] - p[0], apres[1] - p[1]) || 1;
      // Entrée du côté d'où l'on vient, sortie du côté où l'on va ; l'angle décroît (y vers le bas).
      const aEntree = Math.atan2(-(p[1] - avant[1]) / lin, -(p[0] - avant[0]) / lin);
      const aSortie = Math.atan2((apres[1] - p[1]) / lout, (apres[0] - p[0]) / lout);
      let tour = aEntree - aSortie;
      while (tour <= 1e-6) tour += 2 * Math.PI;
      while (tour > 2 * Math.PI) tour -= 2 * Math.PI;
      const n = Math.max(3, Math.ceil(tour / (Math.PI / 10)));
      for (let k = 0; k <= n; k++) {
        const angle = aEntree - (tour * k) / n;
        res.push([r.x + r.r * Math.cos(angle), r.y + r.r * Math.sin(angle)]);
      }
    }
    res.push(coupe[coupe.length - 1]);
    return res;
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

// ---------- Géométrie des échangeurs d'autoroute ----------

const ECARTEMENT = 34;   // distance entre l'axe de la route et l'échangeur (péage)
const BOUCLE = 18;       // rayon de la boucle d'une bretelle en trèfle
const RACCORD = 30;      // longueur d'une bretelle simple, le long de la route
export const DEPART_SORTIE = 90;  // la bretelle de sortie se détache du ruban à cette distance de l'échangeur
const VOIE_DEDIEE = 13;  // axe de la voie de sortie dédiée, décalé de l'axe de la rue
const LONGUEUR_DEDIEE = 85;  // longueur de la voie de sortie dédiée, jusqu'au carrefour

// Retire les « longueur » derniers px d'une ligne. Renvoie [ligne raccourcie, point de coupe, direction].
function couperFin(points, longueur) {
  let reste = longueur;
  for (let i = points.length - 1; i > 0; i--) {
    const [a, b] = [points[i - 1], points[i]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const sens = [(b[0] - a[0]) / (l || 1), (b[1] - a[1]) / (l || 1)];
    if (l >= reste) {
      const coupe = plus(b, sens, -reste);
      return [[...points.slice(0, i), coupe], coupe, sens];
    }
    reste -= l;
  }
  const l = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) || 1;
  return [[points[0], points[0]], points[0], [(points[1][0] - points[0][0]) / l, (points[1][1] - points[0][1]) / l]];
}

const plus = (a, v, k = 1) => [a[0] + v[0] * k, a[1] + v[1] * k];
const oppose = v => [-v[0], -v[1]];
const droiteDe = h => [-h[1], h[0]];       // côté droit d'un sens de circulation (y vers le bas)
const produit = (a, b) => a[0] * b[0] + a[1] * b[1];

// Arc qui tourne à droite, partant de « depart » dans la direction v0, sur « angle » radians.
function arcADroite(depart, v0, rayon, angle, n) {
  const r0 = droiteDe(v0);
  const centre = plus(depart, r0, rayon);
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = (angle * i) / n;
    points.push([
      centre[0] - r0[0] * rayon * Math.cos(t) + v0[0] * rayon * Math.sin(t),
      centre[1] - r0[1] * rayon * Math.cos(t) + v0[1] * rayon * Math.sin(t),
    ]);
  }
  return points;
}

// Bretelle de sortie : quitte la voie de sens h (axe de la route au point p) par la droite et mène à
// l'échangeur, posé du côté c. Si l'échangeur est à gauche, boucle de 270° puis pont au-dessus de la route.
// Renvoie { points (de la route à l'échangeur), sol, pont }.
function bretelleSortie(p, h, c) {
  const n = plus(p, c, ECARTEMENT);
  if (produit(c, droiteDe(h)) > 0) {
    const points = courbeQuadratique(plus(p, h, -RACCORD), p, n, 6);
    return { points, sol: points, pont: null };
  }
  const boucle = arcADroite(plus(p, h, BOUCLE), h, BOUCLE, 1.5 * Math.PI, 14);
  const pont = [boucle[boucle.length - 1], n];
  return { points: [...boucle, n], sol: boucle, pont };
}

// Bretelle d'entrée : part de l'échangeur (côté c) et rejoint par la droite la voie de sens h, au point p.
// Si l'échangeur est à gauche, pont au-dessus de la route puis boucle de 270°.
// Renvoie { points (de l'échangeur à la route), sol, pont }.
function bretelleEntree(p, h, c) {
  const n = plus(p, c, ECARTEMENT);
  const droite = droiteDe(h);
  if (produit(c, droite) > 0) {
    const points = courbeQuadratique(n, p, plus(p, h, RACCORD), 6);
    return { points, sol: points, pont: null };
  }
  const debutBoucle = plus(p, droite, BOUCLE);
  const boucle = arcADroite(debutBoucle, droite, BOUCLE, 1.5 * Math.PI, 14);
  return { points: [n, ...boucle], sol: boucle, pont: [n, debutBoucle] };
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

// Courbe de Bézier quadratique de a à b (point de contrôle c), en n segments.
function courbeQuadratique(a, c, b, n) {
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    points.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return points;
}

// Supprime les points répétés et les points intermédiaires alignés.
function simplifier(points) {
  const res = [];
  for (const p of points) {
    const d = res[res.length - 1];
    if (d && d[0] === p[0] && d[1] === p[1]) continue;
    if (res.length >= 2) {
      const a = res[res.length - 2];
      if ((a[0] === d[0] && d[0] === p[0]) || (a[1] === d[1] && d[1] === p[1])) res.pop();
    }
    res.push(p);
  }
  return res;
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
