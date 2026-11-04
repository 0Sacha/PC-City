// Rendu Canvas 2D de la ville, dans l'esprit de Mini Motorways : aplats, routes arrondies, ombres légères.

import { GABARITS, decaler, VOIE, FONDU, ECART_VOIES } from './trafic.js';
import { nomVisible } from './modele.js';

// Palettes de la ville. Les valeurs numériques s'interpolent comme les couleurs :
// phares (0 éteints → 1 allumés), obscurite (0 plein jour → 1 nuit), quartierTexte (assombrit/éclaircit les noms).
// « voile » : lumière colorée posée sur toute la scène (bâtiments et véhicules compris).
export const PALETTES = {
  jour: {
    mer: '#8FDFCF', merLigne: 'rgba(255,255,255,0.18)', terre: '#F6E7CB', route: '#FFFFFF',
    routeBord: 'rgba(160,140,110,0.18)', ombre: 'rgba(120,95,60,0.18)', pelouse: '#E5E6A6',
    etangBord: '#B9EBDF', arbre: '#8DBF6A', arbreClair: '#A9D17F', texte: '#4A4238',
    texteDoux: 'rgba(74,66,56,0.6)', ferme: '#C9C1B4', fermeFonce: '#A89F92', tour: '#3A3F4B',
    tourFlanc: '#2B303B', tourTexte: '#FFFFFF', piste: '#7C8290', zoneAlpha: 0.13,
    entrepot: '#EFE7DA', entrepotFonce: '#CFC5B5', phares: 0, obscurite: 0, quartierTexte: 0.1,
    voile: 'rgba(255,150,50,0)',
  },
  // Lever et coucher du soleil : heure dorée, ombres longues et chaudes
  dore: {
    mer: '#6FB4AE', merLigne: 'rgba(255,230,190,0.18)', terre: '#F0C38E', route: '#FCE2C2',
    routeBord: 'rgba(170,100,40,0.28)', ombre: 'rgba(150,70,20,0.32)', pelouse: '#D6BC6C',
    etangBord: '#A9CDB8', arbre: '#7FA14E', arbreClair: '#B5B95C', texte: '#4F3420',
    texteDoux: 'rgba(79,52,32,0.65)', ferme: '#C9A985', fermeFonce: '#A7896A', tour: '#3A3F4B',
    tourFlanc: '#2B303B', tourTexte: '#FFFFFF', piste: '#77687A', zoneAlpha: 0.13,
    entrepot: '#EDCFA8', entrepotFonce: '#C8A47A', phares: 0.2, obscurite: 0.2, quartierTexte: 0.15,
    voile: 'rgba(255,130,40,0.16)',
  },
  // Aube : lumière froide, bleutée et rosée
  aube: {
    mer: '#6E93AE', merLigne: 'rgba(255,255,255,0.10)', terre: '#C9B8BE', route: '#D9D3DE',
    routeBord: 'rgba(60,50,80,0.2)', ombre: 'rgba(60,40,70,0.25)', pelouse: '#A9B39A',
    etangBord: '#8FAFC4', arbre: '#6A9467', arbreClair: '#80A97A', texte: '#3A3446',
    texteDoux: 'rgba(58,52,70,0.6)', ferme: '#A9A3AE', fermeFonce: '#8E8794', tour: '#3A3F4B',
    tourFlanc: '#2B303B', tourTexte: '#FFFFFF', piste: '#5E6475', zoneAlpha: 0.13,
    entrepot: '#CFC8D2', entrepotFonce: '#ACA4B2', phares: 0.6, obscurite: 0.45, quartierTexte: 0.05,
    voile: 'rgba(220,120,180,0.12)',
  },
  // Crépuscule : violet bleuté
  crepuscule: {
    mer: '#4A5D86', merLigne: 'rgba(255,255,255,0.07)', terre: '#4A4560', route: '#77718C',
    routeBord: 'rgba(0,0,0,0.22)', ombre: 'rgba(20,10,40,0.32)', pelouse: '#465049',
    etangBord: '#5A6A92', arbre: '#4C6A54', arbreClair: '#5E7C61', texte: '#ECE6F2',
    texteDoux: 'rgba(236,230,242,0.6)', ferme: '#625C70', fermeFonce: '#4F4A5C', tour: '#E6E8EE',
    tourFlanc: '#C9CCD6', tourTexte: '#262B36', piste: '#2A2638', zoneAlpha: 0.14,
    entrepot: '#6E6886', entrepotFonce: '#58536C', phares: 0.85, obscurite: 0.75, quartierTexte: -0.2,
    voile: 'rgba(110,60,170,0.16)',
  },
  nuit: {
    mer: '#3D5873', merLigne: 'rgba(255,255,255,0.05)', terre: '#262B36', route: '#5B6170',
    routeBord: 'rgba(0,0,0,0.25)', ombre: 'rgba(0,0,0,0.35)', pelouse: '#2D3A33',
    etangBord: '#47647F', arbre: '#3F6B4A', arbreClair: '#4E7D57', texte: '#E6E8EE',
    texteDoux: 'rgba(230,232,238,0.6)', ferme: '#4A505C', fermeFonce: '#3C414B', tour: '#E6E8EE',
    tourFlanc: '#C9CCD6', tourTexte: '#262B36', piste: '#1E222B', zoneAlpha: 0.14,
    entrepot: '#59647A', entrepotFonce: '#454E60', phares: 1, obscurite: 1, quartierTexte: -0.25,
    voile: 'rgba(20,30,90,0.10)',
  },
};

// Cycle fictif d'une journée (minutes depuis minuit → palette), interpolé entre deux repères.
// Plein jour de 9 h 30 à 17 h 30.
const CYCLE = [
  [0, 'nuit'], [420, 'nuit'], [465, 'aube'], [525, 'dore'], [570, 'jour'],
  [1050, 'jour'], [1095, 'dore'], [1140, 'crepuscule'], [1200, 'nuit'], [1440, 'nuit'],
];

const MOMENTS = [
  [0, 'Nuit', '🌙'], [420, 'Aube', '🌄'], [495, 'Lever du soleil', '🌅'], [570, 'Jour', '☀'],
  [1050, 'Coucher du soleil', '🌇'], [1110, 'Crépuscule', '🌆'], [1200, 'Nuit', '🌙'],
];

export function paletteDuMoment(minutes) {
  for (let i = 1; i < CYCLE.length; i++) {
    const [fin, vers] = CYCLE[i];
    if (minutes <= fin) {
      const [debut, de] = CYCLE[i - 1];
      return interpolerPalettes(PALETTES[de], PALETTES[vers], fin === debut ? 1 : (minutes - debut) / (fin - debut));
    }
  }
  return PALETTES.nuit;
}

export function momentDeLaJournee(minutes) {
  let moment = MOMENTS[0];
  for (const m of MOMENTS) if (minutes >= m[0]) moment = m;
  return { nom: moment[1], icone: moment[2] };
}

const DUREE_FONDU = 1200;

// Places des maisons autour du bâtiment : [colonne (négative à gauche), rangée],
// en remplissant d'abord les colonnes les plus proches du bâtiment.
const EMPLACEMENTS_MAISONS = [
  [-2, 1], [2, 1], [-2, 2], [2, 2], [-2, 0], [2, 0], [-2, 3], [2, 3],
  [-1, 1], [1, 1], [-1, 2], [1, 2], [-1, 0], [1, 0], [-1, 3], [1, 3],
];

const POLICE = 'system-ui, "Segoe UI", sans-serif';

export class Rendu {
  constructor(canvas, ville, trafic) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ville = ville;
    this.trafic = trafic;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.survol = null;
    this.selection = null;
    this.discret = false;
    this.palette = PALETTES.jour;
    this._precedent = null;
    this._redimensionner();
    window.addEventListener('resize', () => this._redimensionner());
  }

  _redimensionner() {
    const ratio = window.devicePixelRatio || 1;
    this.largeur = this.canvas.clientWidth;
    this.hauteur = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.largeur * ratio);
    this.canvas.height = Math.round(this.hauteur * ratio);
    this.ratio = ratio;
  }

  // Change de palette en fondu (aucune coupure nette entre deux ambiances).
  definirPalette(palette) {
    this._fondu = { de: this.palette, vers: palette, debut: performance.now() };
    this.nuit = palette.obscurite > 0.5;
  }

  _avancerFondu() {
    const f = this._fondu;
    if (!f) return;
    const t = Math.min(1, (performance.now() - f.debut) / DUREE_FONDU);
    const doux = t * t * (3 - 2 * t);
    this.palette = t >= 1 ? f.vers : interpolerPalettes(f.de, f.vers, doux);
    if (t >= 1) this._fondu = null;
  }

  // ---------- Caméra ----------

  versMonde(sx, sy) {
    const c = this.camera;
    return [(sx - this.largeur / 2) / c.zoom + c.x, (sy - this.hauteur / 2) / c.zoom + c.y];
  }

  versEcran(wx, wy) {
    const c = this.camera;
    return [(wx - c.x) * c.zoom + this.largeur / 2, (wy - c.y) * c.zoom + this.hauteur / 2];
  }

  recentrer() {
    const b = this.ville.bornes;
    if (!b) return;
    this.camera.x = b.x + b.l / 2;
    this.camera.y = b.y + b.h / 2;
    this.camera.zoom = Math.min((this.largeur - 40) / b.l, (this.hauteur - 120) / b.h, 1.4);
  }

  zoomer(facteur, sx, sy) {
    const [wx, wy] = this.versMonde(sx, sy);
    const c = this.camera;
    c.zoom = Math.min(3, Math.max(0.15, c.zoom * facteur));
    const [nx, ny] = this.versMonde(sx, sy);
    c.x += wx - nx;
    c.y += wy - ny;
  }

  centrerSur(x, y, zoom) {
    this.camera.x = x;
    this.camera.y = y;
    if (zoom) this.camera.zoom = zoom;
  }

  // ---------- Dessin ----------

  dessiner(temps) {
    const dt = this._precedent === null ? 0 : Math.min(0.1, (temps - this._precedent) / 1000);
    this._precedent = temps;
    this._avancerFondu();
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = p.mer;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    if (!v.bornes) return;

    // La caméra suit le véhicule sélectionné.
    if (this.trafic.suivi) {
      const pos = this.trafic.position(this.trafic.suivi);
      this.camera.x += (pos.x - this.camera.x) * Math.min(1, dt * 5);
      this.camera.y += (pos.y - this.camera.y) * Math.min(1, dt * 5);
    }

    // Décor fixe (mer, terre, parcs, routes, arbres) : dessiné dans une image en mémoire, refaite
    // seulement si la caméra, le plan, les couleurs ou la taille de la fenêtre changent. Le reste du
    // temps, une seule copie d'image remplace des centaines d'ordres de dessin (PC moins sollicité).
    const c = this.camera;
    const cle = `${c.x},${c.y},${c.zoom},${this.largeur},${this.hauteur},${this.ratio},${v.version}`;
    if (cle !== this._cleDecor || p !== this._paletteDecor) {
      this._dessinerDecor();
      this._cleDecor = cle;
      this._paletteDecor = p;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this._decor, 0, 0);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);

    ctx.save();
    ctx.translate(this.largeur / 2, this.hauteur / 2);
    ctx.scale(c.zoom, c.zoom);
    ctx.translate(-c.x, -c.y);

    this._dessinerBateaux(temps);
    this._dessinerCentrale(temps);
    this._dessinerVehicules();
    for (const feu of v.feux ?? []) this._dessinerFeu(feu);
    this._dessinerAeroport(temps);
    for (const e of v.entrepots ?? []) this._dessinerEntrepot(e, temps);
    for (const lot of v.lots) this._dessinerBatiment(lot, temps, dt);
    this._dessinerTour(temps);
    this._dessinerPisteElectrique(temps);
    for (const lot of v.lots) if (lot.app.donnees.alerte) this._dessinerEpingle(lot, temps);
    this._dessinerSuivi();
    ctx.restore();

    // Lumière du moment sur toute la scène ; les noms restent nets par-dessus.
    if (versRgba(p.voile)[3] > 0.005) {
      ctx.fillStyle = p.voile;
      ctx.fillRect(0, 0, this.largeur, this.hauteur);
    }
    this._dessinerEtiquettes();
  }

  // Décor fixe, dans l'image en mémoire (mêmes dimensions que la carte).
  _dessinerDecor() {
    if (!this._decor) this._decor = document.createElement('canvas');
    const toile = this._decor;
    if (toile.width !== this.canvas.width || toile.height !== this.canvas.height) {
      toile.width = this.canvas.width;
      toile.height = this.canvas.height;
    }
    const ecran = this.ctx;
    const ctx = (this.ctx = toile.getContext('2d'));
    try {
      const p = this.palette;
      const v = this.ville;
      const c = this.camera;
      ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
      ctx.fillStyle = p.mer;
      ctx.fillRect(0, 0, this.largeur, this.hauteur);
      ctx.translate(this.largeur / 2, this.hauteur / 2);
      ctx.scale(c.zoom, c.zoom);
      ctx.translate(-c.x, -c.y);
      this._dessinerMer();
      this._dessinerTerre();
      this._dessinerBassin();
      for (const parc of v.parcs) { ctx.fillStyle = p.pelouse; rectArrondi(ctx, parc.x, parc.y, parc.l, parc.h, 16); ctx.fill(); }
      for (const e of v.etangs) this._dessinerEtang(e);
      for (const z of v.zones) {
        ctx.fillStyle = teinte(z.quartier.couleur, p.zoneAlpha);
        rectArrondi(ctx, z.x, z.y, z.l, z.h, 26);
        ctx.fill();
      }
      if (v.pelouseCentrale) {
        ctx.fillStyle = p.pelouse;
        ctx.beginPath(); ctx.arc(v.pelouseCentrale.x, v.pelouseCentrale.y, v.pelouseCentrale.r, 0, Math.PI * 2); ctx.fill();
      }
      this._dessinerRoutes();
      // Ponts 2 × 2 voies entre chaque île et l'Étoile
      for (const pont of v.ponts ?? []) this._dessinerRuban([pont.de, pont.a], 0, 1);
      for (const a of v.arbres) this._dessinerArbre(a);
    } finally {
      this.ctx = ecran;
    }
  }

  _dessinerMer() {
    // Quadrillage discret sur l'eau, comme une carte marine.
    const ctx = this.ctx;
    const b = this.ville.bornes;
    ctx.strokeStyle = this.palette.merLigne;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor((b.x - 2000) / 120) * 120; x < b.x + b.l + 2000; x += 120) {
      ctx.moveTo(x, b.y - 2000); ctx.lineTo(x, b.y + b.h + 2000);
    }
    for (let y = Math.floor((b.y - 2000) / 120) * 120; y < b.y + b.h + 2000; y += 120) {
      ctx.moveTo(b.x - 2000, y); ctx.lineTo(b.x + b.l + 2000, y);
    }
    ctx.stroke();
  }

  _dessinerTerre() {
    const ctx = this.ctx;
    const v = this.ville;
    ctx.fillStyle = this.palette.terre;
    for (const t of v.terre) { rectArrondi(ctx, t.x, t.y, t.l, t.h, t.rayon); ctx.fill(); }
    for (const a of v.avancees) { ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill(); }
  }

  _dessinerBassin() {
    const b = this.ville.bassin;
    if (!b) return;
    this.ctx.fillStyle = this.palette.mer;
    rectArrondi(this.ctx, b.x, b.y, b.l, b.h, 26);
    this.ctx.fill();
  }

  _dessinerBateaux(temps) {
    const v = this.ville;
    const ctx = this.ctx;
    for (const bateau of v.bateaux ?? []) {
      const roulis = Math.sin(temps / 900 + bateau.phase) * 2;
      const x = bateau.x + Math.sin(temps / 2500 + bateau.phase) * 8;
      const y = bateau.y + roulis;
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath(); ctx.ellipse(x + 2, y + 3, 17, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.ellipse(x, y, 17, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bateau.couleur;
      rectArrondi(ctx, x - 7, y - 3.5, 10, 7, 2); ctx.fill();
    }
  }

  _dessinerEtang(e) {
    const ctx = this.ctx;
    ctx.fillStyle = this.palette.etangBord;
    ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx + 4, e.ry + 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.palette.mer;
    ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2); ctx.fill();
  }

  _dessinerRoutes() {
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const tracer = (largeur, couleur) => {
      ctx.strokeStyle = couleur;
      for (const route of v.routes) {
        ctx.lineWidth = route.largeur + largeur;
        ctx.beginPath();
        route.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      for (const lot of v.lots) {
        ctx.lineWidth = 9 + largeur;
        ctx.beginPath();
        ctx.moveTo(...lot.allee[0]);
        ctx.lineTo(...lot.allee[1]);
        ctx.stroke();
      }
      // L'Étoile : très large anneau autour de la place centrale
      for (const r of v.rondsPoints ?? []) {
        ctx.lineWidth = 46 + largeur;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    tracer(5, p.routeBord);
    tracer(0, p.route);
    // Routes à 2 × 2 voies (port, aéroport) : ligne continue au centre, pointillés entre les voies
    ctx.strokeStyle = p.routeBord;
    for (const route of v.routes) {
      if (route.largeur < 40) continue;
      const ligne = (pts, largeur) => {
        ctx.lineWidth = largeur;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      };
      ligne(route.points, 1.5);
      ctx.setLineDash([8, 9]);
      for (const cote of [VOIE + ECART_VOIES / 2, -(VOIE + ECART_VOIES / 2)]) ligne(decaler(route.points, cote), 1.2);
      ctx.setLineDash([]);
    }
    // Marquage de l'anneau : une ligne pointillée au milieu
    ctx.setLineDash([12, 12]);
    ctx.strokeStyle = p.routeBord;
    ctx.lineWidth = 1.5;
    for (const r of v.rondsPoints ?? []) {
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r - 10, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Feu tricolore : une tête pour la rue verticale (coin haut-droit), une pour l'horizontale (coin bas-gauche).
  // Éteint (lampes sombres) tant qu'il n'y a pas de véhicules des deux côtés du carrefour.
  _dessinerFeu(feu) {
    const ctx = this.ctx;
    const couleurs = { rouge: '#FF3B30', orange: '#FFB020', vert: '#34C759' };
    const tete = (x, y, horizontale, etat) => {
      const [l, h] = horizontale ? [16, 7] : [7, 16];
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      rectArrondi(ctx, x - l / 2 + 1, y - h / 2 + 1.5, l, h, 3); ctx.fill();
      ctx.fillStyle = '#2B303B';
      rectArrondi(ctx, x - l / 2, y - h / 2, l, h, 3); ctx.fill();
      ['rouge', 'orange', 'vert'].forEach((nom, i) => {
        const d = (i - 1) * 4.6;
        ctx.fillStyle = nom === etat ? couleurs[nom] : 'rgba(255,255,255,0.14)';
        ctx.beginPath();
        ctx.arc(x + (horizontale ? d : 0), y + (horizontale ? 0 : d), 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
    };
    tete(feu.x + 17, feu.y - 17, false, this.trafic.etatFeu(feu, 'v'));
    tete(feu.x - 17, feu.y + 17, true, this.trafic.etatFeu(feu, 'h'));
  }

  // Île électrique : la centrale (bâtiment et tours de refroidissement qui fument), source de la piste.
  _dessinerCentrale(temps) {
    const ctx = this.ctx;
    const c = this.ville.centrale;
    if (!c) return;
    const p = this.palette;
    const u = c.usine;
    ctx.fillStyle = p.ombre;
    rectArrondi(ctx, u.x + 5, u.y + 8, u.l, u.h, 10); ctx.fill();
    ctx.fillStyle = '#B88A1E';
    rectArrondi(ctx, u.x, u.y + 5, u.l, u.h, 10); ctx.fill();
    ctx.fillStyle = '#F2C230';
    rectArrondi(ctx, u.x, u.y, u.l, u.h, 10); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 26px ${POLICE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡', u.x + u.l / 2, u.y + u.h / 2 - 6);
    ctx.font = `800 10px ${POLICE}`;
    ctx.fillText(`≈ ${Math.round(this.trafic.watts ?? 0)} W`, u.x + u.l / 2, u.y + u.h - 14);
    for (const t of c.tours) {
      ctx.fillStyle = p.ombre;
      ctx.beginPath(); ctx.arc(t.x + 4, t.y + 6, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#C9CCD6';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8E95A6';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 0.62, 0, Math.PI * 2); ctx.fill();
      // Vapeur : trois bouffées qui montent et s'estompent, plus vite quand la consommation monte
      const rythme = 2600 - Math.min(1800, (this.trafic.watts ?? 0) * 25);
      for (let i = 0; i < 3; i++) {
        const k = ((temps / rythme + i / 3 + t.x * 0.01) % 1);
        ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(t.x + k * 10, t.y - k * 34, t.r * (0.45 + k * 0.5), 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Piste électrique (au-dessus de tout) de la centrale à la tour centrale, et ses voitures de course.
  _dessinerPisteElectrique(temps) {
    const ctx = this.ctx;
    const c = this.ville.centrale;
    if (!c) return;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    const trace = (dx, dy, largeur, couleur) => {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = largeur;
      ctx.beginPath();
      c.piste.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
      ctx.stroke();
    };
    trace(6, 11, 12, this.palette.ombre);
    trace(0, 0, 14, 'rgba(242,194,48,0.35)');
    trace(0, 0, 9, 'rgba(58,63,75,0.92)');
    // Bordures en damier rouge et blanc, comme un circuit
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -temps / 40;
    for (const cote of [-5.5, 5.5]) {
      ctx.strokeStyle = '#E8504F';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      decaler(c.piste, cote).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    for (const voiture of this.trafic.courses) {
      const { x, y, angle } = this.trafic.positionCourse(voiture);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(242,194,48,0.45)';
      ctx.fillRect(-16, -1.2, 9, 2.4);   // traînée lumineuse
      ctx.fillStyle = voiture.couleur;
      rectArrondi(ctx, -7, -2, 14, 4, 2); ctx.fill();           // coque
      ctx.fillRect(4.5, -3.5, 2.5, 7);                          // aileron avant
      ctx.fillRect(-7.5, -3, 2.5, 6);                           // aileron arrière
      ctx.fillStyle = '#2B303B';
      ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();   // cockpit
      ctx.restore();
    }
  }

  // Ruban d'autoroute 2 × 2 voies (partie de « de » à « a », entre 0 et 1), avec son ombre : nulle aux
  // deux bouts (il y touche le sol), elle s'écarte avec la hauteur. Bouts coupés nets.
  _dessinerRuban(points, de, a) {
    const ctx = this.ctx;
    const trait = (pts, largeur, couleur) => {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = largeur;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    };
    const n = points.length - 1;
    const ombre = points.map(([x, y], i) => {
      const t = i / n;
      const h = Math.min(1, t / 0.18, (1 - t) / 0.18);
      const doux = h * h * (3 - 2 * h);
      return [x + 9 * doux, y + 15 * doux];
    });
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    trait(sousLigne(ombre, de, a), 36, this.palette.ombre);
    // 2 × 2 voies : ligne continue au centre, pointillés entre les deux voies de chaque sens.
    const partie = sousLigne(points, de, a);
    trait(partie, 40, 'rgba(244,179,154,0.95)');
    trait(partie, 1.5, 'rgba(255,255,255,0.85)');
    if (partie.length >= 2) {
      ctx.setLineDash([8, 9]);
      for (const cote of [VOIE + ECART_VOIES / 2, -(VOIE + ECART_VOIES / 2)]) trait(decaler(partie, cote), 1.2, 'rgba(255,255,255,0.7)');
      ctx.setLineDash([]);
    }
  }

  _dessinerVehicules() {
    const ctx = this.ctx;
    const phares = this.palette.phares;
    for (const v of this.trafic.vehicules) {
      const { x, y, angle } = this.trafic.position(v);
      const g = GABARITS[v.gabarit];
      // Apparition et disparition en fondu aux deux bouts du trajet
      const bout = Math.min(v.distance, v.longueurTotale - v.distance);
      ctx.globalAlpha = Math.max(0, Math.min(1, bout / FONDU));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      if (phares > 0.02) {
        ctx.fillStyle = `rgba(255,230,150,${0.28 * phares})`;
        ctx.beginPath();
        ctx.moveTo(g.longueur / 2, -g.largeur / 2);
        ctx.lineTo(g.longueur / 2 + 18, -g.largeur);
        ctx.lineTo(g.longueur / 2 + 18, g.largeur);
        ctx.lineTo(g.longueur / 2, g.largeur / 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      rectArrondi(ctx, -g.longueur / 2 + 1, -g.largeur / 2 + 2, g.longueur, g.largeur, 2.5); ctx.fill();
      ctx.fillStyle = v.couleur;
      rectArrondi(ctx, -g.longueur / 2, -g.largeur / 2, g.longueur, g.largeur, 2.5); ctx.fill();
      // Cabine : partie avant plus claire (pare-brise)
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      const cabine = v.gabarit === 'camion' ? 6 : 3.5;
      rectArrondi(ctx, g.longueur / 2 - cabine - 1.5, -g.largeur / 2 + 1.2, cabine, g.largeur - 2.4, 1.2); ctx.fill();
      if (v.freine) {
        // Feux stop dans les embouteillages
        ctx.fillStyle = '#FF3B30';
        ctx.fillRect(-g.longueur / 2 - 0.5, -g.largeur / 2 + 0.6, 1.8, 1.8);
        ctx.fillRect(-g.longueur / 2 - 0.5, g.largeur / 2 - 2.4, 1.8, 1.8);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  _dessinerSuivi() {
    const v = this.trafic.suivi;
    if (!v) return;
    const { x, y } = this.trafic.position(v);
    const ctx = this.ctx;
    ctx.strokeStyle = v.couleur;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
  }

  _dessinerBatiment(lot, temps, dt) {
    const ctx = this.ctx;
    const p = this.palette;
    const app = lot.app;
    const d = app.donnees;
    const ferme = d.etat === 'ferme';
    const veille = d.etat === 'veille';
    let couleur = ferme ? p.ferme : app.quartier.couleur;
    if (veille) couleur = melanger(couleur, p.ferme, 0.45);
    const fonce = ferme ? p.fermeFonce : assombrir(couleur, 0.22);

    // Surface proportionnelle à la RAM ; la taille suit en douceur, et un nouveau bâtiment « pousse ».
    const ramMax = this.ville.ramMax || 1;
    const cible = ferme ? 32 : 26 + 16 * Math.sqrt(Math.min(1, d.ram / ramMax));
    if (app.cote === undefined) app.cote = app.nouveau ? 0 : cible;
    app.cote += (cible - app.cote) * (1 - Math.exp(-dt * 5));
    const cote = app.cote;
    if (cote < 1) return;
    const cx = lot.x + lot.l / 2;
    const cy = lot.y + lot.h / 2 - 2;
    const x = cx - cote / 2;
    const y = cy - cote / 2;
    lot.toit = y;

    if (this.selection?.type === 'app' && this.selection.app === app) {
      ctx.strokeStyle = app.quartier.couleur;
      ctx.lineWidth = 3;
      rectArrondi(ctx, lot.x, lot.y, lot.l, lot.h, 12);
      ctx.stroke();
    }

    // Maisons : les processus de l'application, en petits blocs de la même couleur
    // de part et d'autre du bâtiment (au-delà de 16, le panneau de détail donne le nombre exact).
    const nbMaisons = Math.min(ferme ? 0 : d.nb_processus, EMPLACEMENTS_MAISONS.length);
    const echelle = Math.min(1, cote / cible);
    for (let i = 0; i < nbMaisons; i++) {
      const [colonne, rangee] = EMPLACEMENTS_MAISONS[i];
      const decalage = (hacher(app.id, i) - 0.5) * 3;
      const mx = colonne < 0 ? lot.x + 2 + (-colonne - 1) * 10 : lot.x + lot.l - 10 - (colonne - 1) * 10;
      this._maison(mx + decalage, lot.y + 6 + rangee * 13 + decalage, couleur, fonce, echelle);
    }

    // Ombre portée, flanc foncé puis toit : un léger relief façon maquette.
    ctx.fillStyle = p.ombre;
    rectArrondi(ctx, x + 4, y + 6, cote, cote, 7); ctx.fill();
    ctx.fillStyle = fonce;
    rectArrondi(ctx, x, y + 4, cote, cote, 7); ctx.fill();
    ctx.fillStyle = couleur;
    rectArrondi(ctx, x, y, cote, cote, 7); ctx.fill();

    if (ferme) {
      // Rideau baissé et panneau « FERMÉ »
      ctx.fillStyle = p.fermeFonce;
      for (let i = 1; i < 4; i++) ctx.fillRect(x + 5, y + i * cote / 4 - 1, cote - 10, 2);
      ctx.fillStyle = '#E8504F';
      rectArrondi(ctx, cx - 22, cy - 7, 44, 14, 4); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `700 9px ${POLICE}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FERMÉ', cx, cy + 0.5);
      return;
    }

    if (veille) {
      // « z » qui s'envolent doucement
      ctx.fillStyle = p.texteDoux;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 2; i++) {
        const t = ((temps / 2200 + i / 2 + hacher(app.id, 0)) % 1);
        ctx.globalAlpha = 1 - t;
        ctx.font = `800 ${9 + i * 3}px ${POLICE}`;
        ctx.fillText('z', cx + 8 + t * 8, y - 4 - t * 14);
      }
      ctx.globalAlpha = 1;
    }

    // Pastilles sur le toit : s'allument selon l'activité CPU.
    const paliers = [0.5, 3, 10, 25];
    const allumees = veille ? 0 : paliers.filter(s => d.cpu >= s).length;
    const pulsation = allumees ? 0.75 + 0.25 * Math.sin(temps / 300 + lot.x) : 1;
    const ecart = cote / 4.5;
    for (let i = 0; i < 4; i++) {
      const px = cx + (i % 2 ? ecart : -ecart);
      const py = cy + (i < 2 ? -ecart : ecart);
      ctx.fillStyle = i < allumees ? `rgba(255,255,255,${0.95 * pulsation})` : 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2.2, cote / 13), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _maison(x, y, couleur, fonce, echelle) {
    const ctx = this.ctx;
    const t = 8 * echelle;
    const dx = (8 - t) / 2;
    ctx.fillStyle = fonce;
    rectArrondi(ctx, x + dx, y + dx + 2, t, t, 2); ctx.fill();
    ctx.fillStyle = couleur;
    rectArrondi(ctx, x + dx, y + dx, t, t, 2); ctx.fill();
  }

  _dessinerTour(temps) {
    const ctx = this.ctx;
    const t = this.ville.tour;
    const s = this.ville.systeme;
    if (!t || !s) return;
    const cpu = s.cpu / 100;
    const ram = s.ram_utilisee / s.ram_totale;

    // Halo qui pulse plus vite et plus fort quand le CPU travaille.
    const pulse = (Math.sin(temps / (600 - 400 * cpu)) + 1) / 2;
    ctx.fillStyle = `rgba(242,165,65,${0.12 + 0.35 * cpu * pulse})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.rayon + 10 + 14 * cpu * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.palette.ombre;
    ctx.beginPath(); ctx.arc(t.x + 5, t.y + 8, t.rayon, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.palette.tourFlanc;
    ctx.beginPath(); ctx.arc(t.x, t.y + 5, t.rayon, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.palette.tour;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.rayon, 0, Math.PI * 2); ctx.fill();

    // Deux anneaux, chacun avec son chiffre : CPU à l'extérieur (orange, suit le grand chiffre),
    // RAM à l'intérieur (bleu). Rouge quand ça sature.
    ctx.lineCap = 'round';
    const anneau = (rayon, largeur, part, couleur) => {
      ctx.lineWidth = largeur;
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath(); ctx.arc(t.x, t.y, rayon, 0, Math.PI * 2); ctx.stroke();
      if (part <= 0.005) return;
      ctx.strokeStyle = couleur;
      ctx.beginPath(); ctx.arc(t.x, t.y, rayon, -Math.PI / 2, -Math.PI / 2 + Math.min(1, part) * Math.PI * 2); ctx.stroke();
    };
    anneau(t.rayon - 9, 7, cpu, cpu > 0.85 ? '#E8504F' : '#F2A541');
    anneau(t.rayon - 19, 4, ram, ram > 0.9 ? '#E8504F' : '#3FA9E0');

    ctx.fillStyle = this.palette.tourTexte;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 16px ${POLICE}`;
    ctx.fillText(`${Math.round(s.cpu)} %`, t.x, t.y - 7);
    ctx.font = `700 8px ${POLICE}`;
    ctx.fillText('CPU', t.x, t.y + 6);
    ctx.globalAlpha = 0.75;
    ctx.font = `600 8px ${POLICE}`;
    ctx.fillText(`RAM ${Math.round(ram * 100)} %`, t.x, t.y + 17);
    ctx.globalAlpha = 1;

    // Enseigne du hall central, au-dessus de la tour (la piste électrique arrive par le bas)
    ctx.fillStyle = '#4C5DA8';
    rectArrondi(ctx, t.x - 52, t.y - t.rayon - 36, 104, 20, 6); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 11px ${POLICE}`;
    ctx.fillText('HALL CENTRAL', t.x, t.y - t.rayon - 26);
  }

  // Halo rouge qui pulse autour d'un disque ou de l'aéroport saturé (embouteillage).
  _halo(x, y, l, h, saturation, temps) {
    if (!(saturation > 0)) return;
    const ctx = this.ctx;
    const pulse = (Math.sin(temps / 400) + 1) / 2;
    ctx.strokeStyle = `rgba(232,80,79,${0.25 + 0.5 * saturation * pulse})`;
    ctx.lineWidth = 4 + 4 * saturation;
    const marge = 6 + 4 * pulse;
    rectArrondi(ctx, x - marge, y - marge, l + 2 * marge, h + 2 * marge, 14);
    ctx.stroke();
  }

  _dessinerEntrepot(e, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = e.disque;
    const occupe = d.utilise / d.total;
    this._halo(e.x, e.y, e.l, e.h + 5, this.trafic.saturation.get(`disque:${d.id}`), temps);
    ctx.fillStyle = p.ombre;
    rectArrondi(ctx, e.x + 5, e.y + 8, e.l, e.h, 10); ctx.fill();
    ctx.fillStyle = p.entrepotFonce;
    rectArrondi(ctx, e.x, e.y + 5, e.l, e.h, 10); ctx.fill();
    ctx.fillStyle = p.entrepot;
    rectArrondi(ctx, e.x, e.y, e.l, e.h, 10); ctx.fill();
    // Bandeau de toit coloré avec le nom du disque
    ctx.fillStyle = e.toit;
    rectArrondi(ctx, e.x, e.y, e.l, 26, 10); ctx.fill();
    ctx.fillRect(e.x, e.y + 14, e.l, 12);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 15px ${POLICE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Disque ${d.nom}`, e.x + e.l / 2, e.y + 14);
    // Remplissage : piles de caisses, hauteur selon l'espace utilisé
    const zoneH = e.h - 38;
    const hRemplie = zoneH * occupe;
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    rectArrondi(ctx, e.x + 8, e.y + 32, e.l - 16, zoneH, 4); ctx.fill();
    ctx.fillStyle = occupe > 0.9 ? '#E8504F' : assombrir(e.toit, -0.25);
    rectArrondi(ctx, e.x + 8, e.y + 32 + zoneH - hRemplie, e.l - 16, hRemplie, 4); ctx.fill();
  }

  _dessinerAeroport(temps) {
    const ctx = this.ctx;
    const a = this.ville.aeroport;
    if (!a) return;
    const p = this.palette;
    // Piste
    const r = a.piste;
    ctx.fillStyle = p.piste;
    rectArrondi(ctx, r.x, r.y, r.l, r.h, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([14, 10]);
    ctx.beginPath(); ctx.moveTo(r.x + 16, r.y + r.h / 2); ctx.lineTo(r.x + r.l - 16, r.y + r.h / 2); ctx.stroke();
    ctx.setLineDash([]);
    // Terminal
    const t = a.terminal;
    this._halo(t.x, t.y, t.l, t.h + 5, this.trafic.saturation.get('aeroport'), temps);
    ctx.fillStyle = p.ombre;
    rectArrondi(ctx, t.x + 5, t.y + 8, t.l, t.h, 10); ctx.fill();
    ctx.fillStyle = assombrir('#5BC8E8', 0.22);
    rectArrondi(ctx, t.x, t.y + 5, t.l, t.h, 10); ctx.fill();
    ctx.fillStyle = '#5BC8E8';
    rectArrondi(ctx, t.x, t.y, t.l, t.h, 10); ctx.fill();
    // Avion stylisé : il roule, décolle, puis revient
    const progres = (temps / 9000) % 1;
    this._avion(r.x + 30 + progres * (r.l - 60), r.y + r.h / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 17px ${POLICE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('INTERNET', t.x + t.l / 2, t.y + t.h / 2);
  }

  _avion(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(x, y, 13, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 2, y); ctx.lineTo(x - 4, y - 12); ctx.lineTo(x - 7, y - 12); ctx.lineTo(x - 4, y);
    ctx.lineTo(x - 7, y + 12); ctx.lineTo(x - 4, y + 12); ctx.closePath();
    ctx.fill();
  }

  _dessinerArbre(a) {
    const ctx = this.ctx;
    ctx.fillStyle = this.palette.ombre;
    ctx.beginPath(); ctx.arc(a.x + 2, a.y + 3, a.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.palette.arbre;
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.palette.arbreClair;
    ctx.beginPath(); ctx.arc(a.x - a.r * 0.3, a.y - a.r * 0.3, a.r * 0.45, 0, Math.PI * 2); ctx.fill();
  }

  _dessinerEpingle(lot, temps) {
    // Épingle rouge façon Mini Motorways, qui rebondit doucement.
    const ctx = this.ctx;
    const cx = lot.x + lot.l / 2;
    const base = lot.toit ?? lot.y;
    const saut = Math.abs(Math.sin(temps / 350)) * 5;
    const y = base - 12 - saut;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(cx, base + 2, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#E8504F';
    ctx.beginPath();
    ctx.arc(cx, y - 8, 11, Math.PI * 0.8, Math.PI * 2.2);
    ctx.lineTo(cx, y + 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(cx, y - 8, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#E8504F';
    ctx.beginPath(); ctx.arc(cx, y - 8, 2.2, 0, Math.PI * 2); ctx.fill();
  }

  _dessinerEtiquettes() {
    // Noms affichés à taille fixe à l'écran : lisibles quel que soit le zoom.
    const ctx = this.ctx;
    const p = this.palette;
    const zoom = this.camera.zoom;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `600 11px ${POLICE}`;
    for (const lot of this.ville.lots) {
      const mise = this.survol?.app === lot.app || this.selection?.app === lot.app;
      if (zoom < 0.75 && !mise) continue;
      const [sx, sy] = this.versEcran(lot.x + lot.l / 2, lot.enHaut ? lot.y - 2 : lot.y + lot.h + 2);
      if (sx < -80 || sx > this.largeur + 80 || sy < -20 || sy > this.hauteur + 20) continue;
      const nom = tronquer(nomVisible(lot.app, this.discret), 22);
      const y = lot.enHaut ? sy - 14 : sy;
      ctx.fillStyle = mise ? p.texte : p.texteDoux;
      ctx.fillText(nom, sx, y);
    }
    // Noms des quartiers
    ctx.font = `800 12px ${POLICE}`;
    ctx.textBaseline = 'bottom';
    for (const z of this.ville.zones) {
      const [sx, sy] = this.versEcran(z.x + z.l / 2, z.y - 4);
      ctx.fillStyle = assombrir(z.quartier.couleur, p.quartierTexte);
      ctx.fillText(z.quartier.nom.toUpperCase(), sx, sy);
    }
  }
}

// ---------- Utilitaires ----------

export function rectArrondi(ctx, x, y, l, h, r) {
  r = Math.max(0, Math.min(r, l / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + l, y, x + l, y + h, r);
  ctx.arcTo(x + l, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + l, y, r);
  ctx.closePath();
}

function versRgb(couleur) {
  if (couleur.startsWith('#')) {
    const n = parseInt(couleur.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return couleur.match(/\d+/g).slice(0, 3).map(Number);
}

function teinte(couleur, alpha) {
  const [r, g, b] = versRgb(couleur);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Assombrit (facteur > 0) ou éclaircit (facteur < 0) une couleur.
export function assombrir(couleur, facteur) {
  const [r, g, b] = versRgb(couleur);
  const f = c => Math.round(facteur >= 0 ? c * (1 - facteur) : c + (255 - c) * -facteur);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function melanger(a, b, t) {
  const [r1, g1, b1] = versRgb(a);
  const [r2, g2, b2] = versRgb(b);
  const m = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${m(r1, r2)},${m(g1, g2)},${m(b1, b2)})`;
}

function versRgba(couleur) {
  if (couleur.startsWith('#')) return [...versRgb(couleur), 1];
  const [r, g, b, a = 1] = couleur.match(/[\d.]+/g).map(Number);
  return [r, g, b, a];
}

// Mélange deux palettes, couleur par couleur (transparence comprise) et valeur par valeur.
export function interpolerPalettes(a, b, t) {
  const res = {};
  for (const cle of Object.keys(b)) {
    const x = a[cle];
    const y = b[cle];
    if (typeof y === 'number') {
      res[cle] = x + (y - x) * t;
    } else {
      const c1 = versRgba(x);
      const c2 = versRgba(y);
      const m = c1.map((v, i) => v + (c2[i] - v) * t);
      res[cle] = `rgba(${Math.round(m[0])},${Math.round(m[1])},${Math.round(m[2])},${m[3].toFixed(3)})`;
    }
  }
  return res;
}

// Petite valeur pseudo-aléatoire stable pour une application (dispersion des maisons).
function hacher(texte, i) {
  let h = 2166136261 ^ i;
  for (let k = 0; k < texte.length; k++) h = Math.imul(h ^ texte.charCodeAt(k), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

// Portion d'une ligne brisée, entre deux fractions (0 → 1) de sa longueur totale.
function sousLigne(points, de, a) {
  const longueurs = [0];
  for (let i = 1; i < points.length; i++) {
    longueurs.push(longueurs[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const total = longueurs[longueurs.length - 1] || 1;
  const point = d => {
    let i = 1;
    while (i < points.length - 1 && longueurs[i] < d) i++;
    const t = (d - longueurs[i - 1]) / ((longueurs[i] - longueurs[i - 1]) || 1);
    return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
  };
  const [d1, d2] = [de * total, a * total];
  return [point(d1), ...points.filter((_, i) => longueurs[i] > d1 && longueurs[i] < d2), point(d2)];
}

function tronquer(texte, n) {
  return texte.length > n ? texte.slice(0, n - 1) + '…' : texte;
}
