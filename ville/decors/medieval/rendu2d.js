// Rendu Canvas 2D du village médiéval, vu de dessus : prés et champs, rivière et port (Internet), enceinte
// crénelée, château (processeur et mémoire), maisons à colombages (applications) et leurs chaumières
// (processus), greniers à blé (disques), charrettes (flux). La nuit, fenêtres et torches s'allument.

import { interpolerPalettes, momentDeLaJournee, rectArrondi } from '../ville/rendu2d.js';
import { nomVisible, LOT_L, LOT_H, RUE, RUELLE, LARGEUR_RIVIERE } from './modele.js';
import { GABARITS } from './trafic.js';

export { momentDeLaJournee };

export const PALETTES = {
  jour: {
    fond: '#9CC06E', pre: '#A9C97A', preClair: '#B9D58C', champ: '#E2C66C', champ2: '#C7B45C', sillon: 'rgba(110,80,30,0.18)',
    eau: '#6DB1D8', eauClair: '#A3D3EC', rive: '#D7C79E', rue: '#D9C8A3', pave: 'rgba(110,90,60,0.22)', ruelle: '#E4D6B6',
    sol: '#E9DEC4', mur: '#BEB4A2', murClair: '#DAD2C3', murOmbre: '#8D8473', bois: '#76522F', torchis: '#F4E8CF',
    chaume: '#D8B45A', ferme: '#A39C90', arbre: '#5E9A4E', arbreClair: '#78B262', texte: '#3C2F22',
    texteDoux: 'rgba(60,47,34,0.7)', fenetre: '#FFD36B', ombre: 'rgba(40,30,10,0.18)', obscurite: 0,
  },
  // Lumière dorée du lever et du coucher du soleil
  dore: {
    fond: '#A8B060', pre: '#B4B86C', preClair: '#C4C47C', champ: '#EAB860', champ2: '#CFA450', sillon: 'rgba(110,70,30,0.2)',
    eau: '#7FA6C8', eauClair: '#C2C4D0', rive: '#DDBE92', rue: '#DDBE98', pave: 'rgba(110,80,50,0.22)', ruelle: '#E6CCA8',
    sol: '#EAD3B4', mur: '#C4AE98', murClair: '#DCC8B4', murOmbre: '#8E7866', bois: '#74492A', torchis: '#F2DDBE',
    chaume: '#D9A752', ferme: '#A0948A', arbre: '#6C8E44', arbreClair: '#86A656', texte: '#3C2A1E',
    texteDoux: 'rgba(60,42,30,0.7)', fenetre: '#FFC85A', ombre: 'rgba(60,30,10,0.2)', obscurite: 0.3,
  },
  nuit: {
    fond: '#1E2E2A', pre: '#24372F', preClair: '#2B4036', champ: '#3E3D2E', champ2: '#36372A', sillon: 'rgba(0,0,0,0.2)',
    eau: '#183150', eauClair: '#2C4C72', rive: '#3C3A36', rue: '#45434A', pave: 'rgba(0,0,0,0.25)', ruelle: '#3E3D44',
    sol: '#353640', mur: '#5B5D6A', murClair: '#6E7080', murOmbre: '#34353F', bois: '#3A2A1E', torchis: '#77705F',
    chaume: '#6B5A36', ferme: '#4C4C54', arbre: '#1F3A2A', arbreClair: '#2A4A36', texte: '#F2E8D4',
    texteDoux: 'rgba(242,232,212,0.65)', fenetre: '#FFC860', ombre: 'rgba(0,0,0,0.3)', obscurite: 1,
  },
};

// Cycle fictif d'une journée : nuit, aube dorée, plein jour de 9 h 30 à 17 h 30, crépuscule doré, nuit.
const CYCLE = [[0, 'nuit'], [420, 'nuit'], [500, 'dore'], [570, 'jour'], [1050, 'jour'], [1120, 'dore'], [1200, 'nuit'], [1440, 'nuit']];

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

const DUREE_FONDU = 1200;
const POLICE = 'system-ui, "Segoe UI", sans-serif';
const ROUGE = '#E0483E';
const OR = '#F2A541';
const BLEU_RAM = '#3F8FD8';

// Chaumières (processus) le long des bords de la parcelle : [x, y] depuis le coin haut gauche.
const CHAUMIERES = [[3, 6], [LOT_L - 13, 6], [3, 22], [LOT_L - 13, 22], [3, 38], [LOT_L - 13, 38]];

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
    this.nuit = false;
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

  definirPalette(palette) {
    this._fondu = { de: this.palette, vers: palette, debut: performance.now() };
    this.nuit = palette.obscurite > 0.5;
  }

  _avancerFondu() {
    const f = this._fondu;
    if (!f) return;
    const t = Math.min(1, (performance.now() - f.debut) / DUREE_FONDU);
    this.palette = t >= 1 ? f.vers : interpolerPalettes(f.de, f.vers, t * t * (3 - 2 * t));
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
    this.camera.zoom = Math.min((this.largeur - 40) / b.l, (this.hauteur - 130) / b.h, 1.4);
    this.camera.x = b.x + b.l / 2;
    this.camera.y = b.y + b.h / 2 - 50 / this.camera.zoom;
  }

  zoomer(facteur, sx, sy) {
    const [wx, wy] = this.versMonde(sx, sy);
    const c = this.camera;
    c.zoom = Math.min(3, Math.max(0.12, c.zoom * facteur));
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
    this._avancerFondu();
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = p.fond;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    if (!v.bornes) return;

    const cible = this.trafic.suivi ? this.trafic.position(this.trafic.suivi) : null;
    if (cible) {
      this.camera.x += (cible.x - this.camera.x) * 0.15;
      this.camera.y += (cible.y - this.camera.y) * 0.15;
    }

    // Prés, rivière, rues, enceinte et arbres en image mémoire, refaits seulement si la vue change.
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
    this._dessinerPort(temps);
    this._dessinerBouchons(temps);
    for (const e of v.entrepots ?? []) this._dessinerGrenier(e, temps);
    for (const lot of v.lots) this._dessinerMaison(lot, temps);
    this._dessinerChateau(temps);
    this._dessinerCharrettes(temps);
    this._dessinerTorches(temps);
    for (const lot of v.lots) this._dessinerSignes(lot, temps);
    const s = this.trafic.suivi;
    if (s?.app.lot) { const q = this.trafic.position(s); this._anneau(q.x, q.y, 12); }
    ctx.restore();
    this._dessinerEtiquettes();
  }

  _dessinerDecor() {
    if (!this._decor) this._decor = document.createElement('canvas');
    const toile = this._decor;
    toile.width = this.canvas.width;
    toile.height = this.canvas.height;
    const ctx = toile.getContext('2d');
    const p = this.palette;
    const v = this.ville;
    const c = this.camera;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = p.fond;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    ctx.translate(this.largeur / 2, this.hauteur / 2);
    ctx.scale(c.zoom, c.zoom);
    ctx.translate(-c.x, -c.y);
    const b = v.bornes;
    const e = v.enceinte;

    // Pré et champs cultivés hors les murs
    ctx.fillStyle = p.pre;
    ctx.fillRect(b.x - 2000, v.riviere, b.l + 4000, b.y + b.h - v.riviere + 2000);
    this._dessinerChamps(ctx);
    // Rivière (au nord), avec ses reflets
    this._dessinerRiviere(ctx);
    // Chemins hors les murs : vers le port, vers les greniers
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const chemin = pts => {
      for (const [couleur, l] of [[p.rive, 26], [p.rue, 20]]) {
        ctx.strokeStyle = couleur;
        ctx.lineWidth = l;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    };
    chemin([[0, e.y], [0, v.aeroport.cy]]);
    for (const g of v.entrepots) chemin([[0, e.y + e.h], [0, v.routeGreniers], [g.cx, v.routeGreniers], [g.cx, g.y + 10]]);
    // Intérieur de l'enceinte : terre battue, rues pavées
    ctx.fillStyle = p.sol;
    ctx.fillRect(e.x, e.y, e.l, e.h);
    ctx.fillStyle = p.rue;
    const [g, d] = [v.XS[0] - RUE / 2, v.XS.at(-1) + RUE / 2];
    const [h, bas] = [v.YS[0] - RUE / 2, v.YS.at(-1) + RUE / 2];
    for (const x of v.XS) ctx.fillRect(x - RUE / 2, h, RUE, bas - h);
    for (const y of v.YS) ctx.fillRect(g, y - RUE / 2, d - g, RUE);
    ctx.fillRect(-RUE / 2, e.y, RUE, h - e.y);
    ctx.fillRect(-RUE / 2, bas, RUE, e.y + e.h - bas);
    // Pavés : rangées de petits traits, seulement de près (léger)
    if (c.zoom > 0.6) {
      ctx.strokeStyle = p.pave;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const x of v.XS) for (let y = h; y < bas; y += 9) { ctx.moveTo(x - RUE / 2 + 4, y); ctx.lineTo(x + RUE / 2 - 4, y); }
      for (const y of v.YS) for (let x = g; x < d; x += 9) { ctx.moveTo(x, y - RUE / 2 + 4); ctx.lineTo(x, y + RUE / 2 - 4); }
      ctx.stroke();
    }
    // Quartiers : sol teinté de la couleur du quartier, ruelles, parcelles ; place du marché dans les cases libres
    for (const z of v.cases) {
      if (!z.quartier) { this._dessinerMarche(ctx, z); continue; }
      const q = z.quartier;
      ctx.fillStyle = melanger(p.preClair, q.couleur, 0.14);
      rectArrondi(ctx, z.x, z.y, z.l, z.h, 10); ctx.fill();
      ctx.fillStyle = p.ruelle;
      for (let r = 0; r < q.rangees; r++) {
        const y = z.y + 14 + r * (LOT_H + RUELLE) + LOT_H;
        ctx.fillRect(z.x, y + 2, z.l, RUELLE - 4);
      }
      // Arbres dans la place restée libre du quartier
      const libre = z.y + 14 + q.rangees * (LOT_H + RUELLE);
      if (z.y + z.h - libre > 40) this._bosquet(ctx, z.x + 10, libre + 6, z.l - 20, z.y + z.h - libre - 12, q.rang + 3);
    }
    for (const lot of v.lots) {
      ctx.fillStyle = melanger(p.preClair, lot.quartier.couleur, 0.08);
      rectArrondi(ctx, lot.x + 2, lot.y + 2, lot.l - 4, lot.h - 2, 5); ctx.fill();
      ctx.fillStyle = p.ruelle;
      ctx.fillRect(lot.cx - 3, lot.cy + 8, 6, lot.ruelle - lot.cy - 8);
    }
    // Parc du château : pelouse, bosquets dans les coins, douves et pont-levis au sud, cour pavée
    const parc = v.cases.length ? { x: v.XS[1] + RUE / 2, y: v.YS[1] + RUE / 2, l: v.XS[2] - v.XS[1] - RUE, h: v.YS[2] - v.YS[1] - RUE } : null;
    if (parc) {
      ctx.fillStyle = p.preClair;
      rectArrondi(ctx, parc.x, parc.y, parc.l, parc.h, 10); ctx.fill();
      const coin = 70;
      if (parc.l > 340) {
        this._bosquet(ctx, parc.x + 6, parc.y + 6, (parc.l - 330) / 2, parc.h - 12, 41);
        this._bosquet(ctx, parc.x + parc.l - 6 - (parc.l - 330) / 2, parc.y + 6, (parc.l - 330) / 2, parc.h - 12, 43);
      } else {
        for (const [x, y] of [[parc.x + 14, parc.y + 14], [parc.x + parc.l - 14, parc.y + 14], [parc.x + 14, parc.y + parc.h - 14], [parc.x + parc.l - 14, parc.y + parc.h - 14]]) this._arbre(ctx, x, y, coin / 7);
      }
    }
    ctx.fillStyle = p.rive;
    rectArrondi(ctx, -150, -136, 300, 272, 34); ctx.fill();
    ctx.fillStyle = p.eau;
    rectArrondi(ctx, -146, -132, 292, 264, 30); ctx.fill();
    ctx.fillStyle = p.ruelle;
    rectArrondi(ctx, -124, -112, 248, 224, 16); ctx.fill();
    ctx.fillStyle = p.bois;
    ctx.fillRect(-14, 108, 28, 30);
    ctx.fillStyle = p.rue;
    ctx.fillRect(-RUE / 2, 136, RUE, v.YS[2] - 136);
    this._dessinerEnceinte(ctx);
    // Arbres hors les murs (toujours les mêmes : tirage pseudo-aléatoire stable)
    this._dessinerArbres(ctx);
  }

  _dessinerChamps(ctx) {
    const p = this.palette;
    const v = this.ville;
    const e = v.enceinte;
    const b = v.bornes;
    const alea = graine(11);
    // Bandes de champs à l'est, à l'ouest et au sud de l'enceinte
    const zones = [
      [b.x - 400, e.y - 20, e.x - 40 - (b.x - 400), e.h + 260],
      [e.x + e.l + 40, e.y - 20, b.x + b.l + 400 - (e.x + e.l + 40), e.h + 260],
      [e.x - 40, e.y + e.h + 220, e.l + 80, 300],
    ];
    for (const [zx, zy, zl, zh] of zones) {
      if (zl <= 0 || zh <= 0) continue;
      const pas = 110;
      for (let x = zx; x < zx + zl - 30; x += pas) {
        for (let y = zy; y < zy + zh - 30; y += pas * 0.8) {
          const a = alea();
          if (a < 0.45) continue;
          const [l, h] = [pas - 14 - alea() * 20, pas * 0.8 - 14 - alea() * 16];
          ctx.fillStyle = a < 0.72 ? p.champ : a < 0.9 ? p.champ2 : p.preClair;
          rectArrondi(ctx, x, y, l, h, 6); ctx.fill();
          ctx.strokeStyle = p.sillon;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const vertical = alea() < 0.5;
          for (let k = 8; k < (vertical ? l : h); k += 8) {
            if (vertical) { ctx.moveTo(x + k, y + 4); ctx.lineTo(x + k, y + h - 4); } else { ctx.moveTo(x + 4, y + k); ctx.lineTo(x + l - 4, y + k); }
          }
          ctx.stroke();
        }
      }
    }
  }

  _dessinerRiviere(ctx) {
    const p = this.palette;
    const v = this.ville;
    const b = v.bornes;
    const y0 = v.riviere;
    const demi = LARGEUR_RIVIERE / 2;
    const [x1, x2] = [b.x - 2000, b.x + b.l + 2000];
    const berge = (decalage, sens) => {
      for (let x = x1; x <= x2; x += 40) {
        const y = y0 + sens * demi + Math.sin(x / 140) * 8 + Math.sin(x / 53) * 3 + decalage;
        if (x === x1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    };
    // Berges sablonneuses, puis l'eau
    ctx.fillStyle = p.rive;
    ctx.beginPath(); berge(-8, -1); ctx.lineTo(x2, y0 + demi + 30); ctx.lineTo(x1, y0 + demi + 30); ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.pre;
    ctx.fillRect(x1, y0 - demi - 2000, x2 - x1, 2000 - 6);
    ctx.fillStyle = p.eau;
    ctx.beginPath(); berge(0, -1);
    for (let x = x2; x >= x1; x -= 40) ctx.lineTo(x, y0 + demi + Math.sin(x / 140) * 8 + Math.sin(x / 61) * 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.rive;
    ctx.beginPath();
    for (let x = x1; x <= x2; x += 40) ctx.lineTo(x, y0 + demi + Math.sin(x / 140) * 8 + Math.sin(x / 61) * 3);
    ctx.lineTo(x2, y0 + demi + 14); ctx.lineTo(x1, y0 + demi + 14); ctx.closePath(); ctx.fill();
    // Reflets
    ctx.strokeStyle = p.eauClair;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const alea = graine(5);
    ctx.beginPath();
    for (let x = b.x - 200; x < b.x + b.l + 200; x += 70) {
      const y = y0 + (alea() - 0.5) * LARGEUR_RIVIERE * 0.6;
      const l = 14 + alea() * 22;
      ctx.moveTo(x, y); ctx.lineTo(x + l, y);
    }
    ctx.stroke();
  }

  // Muraille crénelée, tours rondes aux coins et le long des côtés, deux portes (nord et sud).
  _dessinerEnceinte(ctx) {
    const p = this.palette;
    const e = this.ville.enceinte;
    const EP = 14;
    ctx.save();
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = p.murOmbre;
    ctx.lineWidth = EP + 4;
    ctx.strokeRect(e.x, e.y + 3, e.l, e.h);
    ctx.strokeStyle = p.mur;
    ctx.lineWidth = EP;
    ctx.strokeRect(e.x, e.y, e.l, e.h);
    // Créneaux : petits merlons sur le bord extérieur
    ctx.fillStyle = p.murClair;
    const merlons = (x1, y1, x2, y2) => {
      const n = Math.floor(Math.hypot(x2 - x1, y2 - y1) / 12);
      for (let i = 0; i <= n; i++) {
        const [x, y] = [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n];
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
    };
    merlons(e.x - EP / 2 + 3, e.y - EP / 2 + 3, e.x + e.l + EP / 2 - 3, e.y - EP / 2 + 3);
    merlons(e.x - EP / 2 + 3, e.y + e.h + EP / 2 - 3, e.x + e.l + EP / 2 - 3, e.y + e.h + EP / 2 - 3);
    merlons(e.x - EP / 2 + 3, e.y - EP / 2 + 3, e.x - EP / 2 + 3, e.y + e.h + EP / 2 - 3);
    merlons(e.x + e.l + EP / 2 - 3, e.y - EP / 2 + 3, e.x + e.l + EP / 2 - 3, e.y + e.h + EP / 2 - 3);
    // Portes : ouverture dans le mur, deux tours de chaque côté
    for (const y of [e.y, e.y + e.h]) {
      ctx.fillStyle = p.rue;
      ctx.fillRect(-RUE / 2, y - EP, RUE, 2 * EP);
      ctx.fillStyle = p.bois;
      ctx.fillRect(-RUE / 2, y - 2, RUE, 4);
      for (const s of [-1, 1]) this._tourRonde(ctx, s * (RUE / 2 + 12), y, 15);
    }
    // Tours d'angle, puis environ toutes les 260 px
    for (const [x, y] of this._tours()) this._tourRonde(ctx, x, y, 17);
    ctx.restore();
  }

  _tours() {
    const e = this.ville.enceinte;
    const tours = [[e.x, e.y], [e.x + e.l, e.y], [e.x, e.y + e.h], [e.x + e.l, e.y + e.h]];
    const nx = Math.max(1, Math.round(e.l / 260));
    const ny = Math.max(1, Math.round(e.h / 260));
    for (let i = 1; i < nx; i++) {
      const x = e.x + (e.l * i) / nx;
      if (Math.abs(x) < 60) continue;  // laisse la place des portes
      tours.push([x, e.y], [x, e.y + e.h]);
    }
    for (let i = 1; i < ny; i++) tours.push([e.x, e.y + (e.h * i) / ny], [e.x + e.l, e.y + (e.h * i) / ny]);
    return tours;
  }

  _tourRonde(ctx, x, y, r) {
    const p = this.palette;
    ctx.fillStyle = p.murOmbre;
    ctx.beginPath(); ctx.arc(x, y + 3, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.mur;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.murClair;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * (r - 3), y + Math.sin(a) * (r - 3), 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = p.murOmbre;
    ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
  }

  _dessinerMarche(ctx, z) {
    const p = this.palette;
    ctx.fillStyle = p.ruelle;
    rectArrondi(ctx, z.x, z.y, z.l, z.h, 10); ctx.fill();
    const [cx, cy] = [z.x + z.l / 2, z.y + z.h / 2];
    // Puits au milieu de la place
    ctx.fillStyle = p.mur;
    ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.eau;
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
    // Étals aux toiles rayées
    const couleurs = ['#D9534F', '#4A90C2', '#E8B23A', '#5BAA5B'];
    const n = Math.max(2, Math.min(6, Math.floor(z.l / 70)));
    for (let i = 0; i < n; i++) {
      for (const [y, k] of [[z.y + 16, i], [z.y + z.h - 40, i + 1]]) {
        if (y < z.y + 4 || y + 24 > z.y + z.h) continue;
        const x = z.x + (z.l - n * 50) / 2 + i * 50 + 6;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(x, y, 34, 22);
        ctx.fillStyle = couleurs[k % couleurs.length];
        for (let s = 0; s < 34; s += 10) ctx.fillRect(x + s, y, 5, 22);
      }
    }
  }

  // Petit bosquet d'arbres ronds dans un rectangle (graine stable).
  _bosquet(ctx, x, y, l, h, g) {
    const alea = graine(g);
    const n = Math.min(14, Math.floor((l * h) / 2600));
    for (let i = 0; i < n; i++) this._arbre(ctx, x + 10 + alea() * (l - 20), y + 10 + alea() * (h - 20), 7 + alea() * 6);
  }

  _arbre(ctx, x, y, r) {
    const p = this.palette;
    ctx.fillStyle = p.ombre;
    ctx.beginPath(); ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.arbre;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.arbreClair;
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, Math.PI * 2); ctx.fill();
  }

  _dessinerArbres(ctx) {
    const v = this.ville;
    const b = v.bornes;
    const e = v.enceinte;
    if (!this._arbres || this._arbresPour !== v.version) {
      const alea = graine(23);
      this._arbres = [];
      for (let i = 0; i < 260; i++) {
        const [x, y] = [b.x - 200 + alea() * (b.l + 400), v.riviere + LARGEUR_RIVIERE / 2 + 30 + alea() * (b.y + b.h + 200 - v.riviere)];
        const dedans = x > e.x - 40 && x < e.x + e.l + 40 && y > e.y - 40 && y < e.y + e.h + 40;
        const chemin = Math.abs(x) < 40 || (y > v.routeGreniers - 30 && y < v.routeGreniers + 30 && Math.abs(x) < b.l / 2);
        const grenier = v.entrepots.some(g => Math.abs(x - g.cx) < 80 && Math.abs(y - g.cy) < 70);
        const port = Math.abs(x) < 90 && y < e.y;
        if (!dedans && !chemin && !grenier && !port) this._arbres.push([x, y, 8 + alea() * 9]);
      }
      // Rangée d'arbres au nord de la rivière
      for (let x = b.x - 200; x < b.x + b.l + 200; x += 46) this._arbres.push([x + alea() * 20, v.riviere - LARGEUR_RIVIERE / 2 - 40 - alea() * 40, 10 + alea() * 8]);
      this._arbresPour = v.version;
    }
    for (const [x, y, r] of this._arbres) this._arbre(ctx, x, y, r);
  }

  // Le port (Internet) : ponton de bois sur la rivière, voiliers qui vont et viennent, plus nombreux et plus
  // rapides quand le réseau travaille. Halo rouge si la connexion sature.
  _dessinerPort(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    const a = v.aeroport;
    const s = v.systeme;
    const saturation = this.trafic.saturation.get('aeroport') ?? 0;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    if (saturation > 0) {
      ctx.fillStyle = teinte(ROUGE, 0.15 + 0.15 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)));
      ctx.beginPath(); ctx.ellipse(a.cx, a.cy - 10, 110, 60, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Ponton
    ctx.fillStyle = p.bois;
    ctx.fillRect(a.cx - 50, a.cy - 6, 100, 16);
    ctx.fillRect(a.cx - 10, a.cy - 40, 20, 40);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = a.cx - 50; x < a.cx + 50; x += 6) { ctx.moveTo(x, a.cy - 6); ctx.lineTo(x, a.cy + 10); }
    ctx.stroke();
    // Voiliers sur la rivière
    const n = 2 + Math.round(activite * 4);
    const b = v.bornes;
    for (let i = 0; i < n; i++) {
      const sens = i % 2 ? 1 : -1;
      const vitesse = 0.012 + 0.03 * activite;
      const course = b.l + 400;
      const x = b.x - 200 + ((((temps * vitesse * sens) / 1 + i * 397) % course) + course) % course;
      const y = v.riviere + (sens > 0 ? 14 : -14);
      this._voilier(x, y, sens, i);
    }
    // Voilier amarré au ponton
    this._voilier(a.cx + 30, a.cy - 26, 1, 9, true);
    if (this.selection?.type === 'aeroport' || this.survol?.type === 'aeroport') this._anneau(a.cx, a.cy - 10, 64);
  }

  _voilier(x, y, sens, i, amarre = false) {
    const ctx = this.ctx;
    const p = this.palette;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sens, 1);
    ctx.fillStyle = p.bois;
    ctx.beginPath(); ctx.moveTo(-14, -5); ctx.lineTo(10, -5); ctx.lineTo(16, 0); ctx.lineTo(10, 5); ctx.lineTo(-14, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = amarre ? '#EDE6D6' : ['#F4EEDC', '#E8DCC0', '#F6E3B0'][i % 3];
    ctx.beginPath(); ctx.moveTo(-6, -2); ctx.quadraticCurveTo(2, -16, 8, -2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4FB860';
    ctx.fillRect(-1, -3, 2, 6);
    ctx.restore();
  }

  // Chemin qui rougit vers un grenier ou le port saturé.
  _dessinerBouchons(temps) {
    const ctx = this.ctx;
    const v = this.ville;
    const e = v.enceinte;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 20;
    const pulse = 0.5 + 0.5 * Math.sin(temps / 250);
    const sp = this.trafic.saturation.get('aeroport') ?? 0;
    if (sp > 0) {
      ctx.strokeStyle = teinte(ROUGE, 0.2 + 0.2 * sp * pulse);
      ctx.beginPath(); ctx.moveTo(0, e.y); ctx.lineTo(0, v.aeroport.cy); ctx.stroke();
    }
    for (const g of v.entrepots) {
      const sd = this.trafic.saturation.get(`disque:${g.disque.id}`) ?? 0;
      if (sd <= 0) continue;
      ctx.strokeStyle = teinte(ROUGE, 0.2 + 0.2 * sd * pulse);
      ctx.beginPath(); ctx.moveTo(0, e.y + e.h); ctx.lineTo(0, v.routeGreniers); ctx.lineTo(g.cx, v.routeGreniers); ctx.lineTo(g.cx, g.y + 10); ctx.stroke();
    }
    ctx.restore();
  }

  // Grenier à blé (un disque) : grange au toit de planches entrouvert, le tas de grain monte avec l'espace utilisé.
  _dessinerGrenier(e, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = e.disque;
    const saturation = this.trafic.saturation.get(`disque:${d.id}`) ?? 0;
    const rempli = d.total ? d.utilise / d.total : 0;
    if (saturation > 0) {
      ctx.fillStyle = teinte(ROUGE, 0.15 + 0.15 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)));
      ctx.beginPath(); ctx.ellipse(e.cx, e.cy, 80, 62, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = p.ombre;
    rectArrondi(ctx, e.x + 4, e.y + 5, e.l, e.h, 6); ctx.fill();
    // Murs de bois, intérieur ouvert vu d'en haut
    ctx.fillStyle = p.bois;
    rectArrondi(ctx, e.x, e.y, e.l, e.h, 6); ctx.fill();
    const [ix, iy, il, ih] = [e.x + 7, e.y + 7, e.l - 14, e.h - 22];
    ctx.fillStyle = eclaircir(p.bois, 0.25);
    ctx.fillRect(ix, iy, il, ih);
    // Grain : monte depuis le bas, doré (rouge au-delà de 90 %)
    const hg = ih * Math.max(0.04, rempli);
    ctx.fillStyle = rempli > 0.9 ? ROUGE : '#E8BE4E';
    ctx.beginPath();
    ctx.moveTo(ix, iy + ih);
    ctx.lineTo(ix, iy + ih - hg + 4);
    ctx.quadraticCurveTo(ix + il / 2, iy + ih - hg - 6, ix + il, iy + ih - hg + 4);
    ctx.lineTo(ix + il, iy + ih);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let k = 0; k < 6; k++) ctx.fillRect(ix + 6 + k * 13, iy + ih - hg * 0.5 + (k % 2) * 4, 3, 2);
    // Poutres du toit (charpente apparente)
    ctx.strokeStyle = eclaircir(p.bois, -0.3);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = ix + il / 4; x < ix + il; x += il / 4) { ctx.moveTo(x, iy); ctx.lineTo(x, iy + ih); }
    ctx.stroke();
    // Enseigne : nom du disque et remplissage
    ctx.fillStyle = '#F4E8CF';
    rectArrondi(ctx, e.cx - 26, e.y + e.h - 16, 52, 14, 3); ctx.fill();
    ctx.fillStyle = '#3C2F22';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 9px ${POLICE}`;
    ctx.fillText(`${d.nom} ${Math.round(rempli * 100)} %`, e.cx, e.y + e.h - 9);
    if (this.selection?.entrepot?.disque.id === d.id || this.survol?.entrepot?.disque.id === d.id) this._anneau(e.cx, e.cy, 62);
  }

  // Le château (processeur et mémoire) : courtine carrée et tours d'angle, donjon rond au centre avec le
  // pourcentage du processeur. La courtine se colore en bleu à mesure que la mémoire se remplit (rouge
  // au-delà de 90 %). La bannière flotte d'autant plus vite que le processeur travaille.
  _dessinerChateau(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const s = this.ville.systeme;
    if (!s) return;
    const cpu = s.cpu / 100;
    const ram = s.ram_utilisee / s.ram_totale;
    const [L, H] = [200, 180];
    ctx.save();
    // Lueur du processeur
    if (cpu > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 30, 0, 0, 120 + 60 * cpu);
      g.addColorStop(0, teinte(OR, 0.15 + 0.35 * cpu));
      g.addColorStop(1, teinte(OR, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 120 + 60 * cpu, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    // Courtine : gris, puis remplie de bleu selon la RAM (départ en haut au milieu, sens des aiguilles d'une montre)
    const contour = [[0, -H / 2], [L / 2, -H / 2], [L / 2, H / 2], [-L / 2, H / 2], [-L / 2, -H / 2], [0, -H / 2]];
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = p.murOmbre;
    ctx.lineWidth = 18;
    ctx.strokeRect(-L / 2, -H / 2 + 3, L, H);
    ctx.strokeStyle = p.mur;
    ctx.lineWidth = 14;
    ctx.strokeRect(-L / 2, -H / 2, L, H);
    ctx.strokeStyle = ram > 0.9 ? ROUGE : BLEU_RAM;
    ctx.lineWidth = 6;
    ctx.lineCap = 'butt';
    tracerPortion(ctx, contour, Math.max(0.01, Math.min(1, ram)));
    ctx.stroke();
    for (const [x, y] of [[-L / 2, -H / 2], [L / 2, -H / 2], [-L / 2, H / 2], [L / 2, H / 2]]) this._tourRonde(ctx, x, y, 20);
    // Porte du château, au sud
    ctx.fillStyle = p.bois;
    ctx.fillRect(-14, H / 2 - 5, 28, 10);
    // Donjon
    const R = 46;
    ctx.fillStyle = p.murOmbre;
    ctx.beginPath(); ctx.arc(0, 4, R, 0, Math.PI * 2); ctx.fill();
    const toit = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
    toit.addColorStop(0, p.murClair);
    toit.addColorStop(1, p.mur);
    ctx.fillStyle = toit;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.murClair;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      ctx.fillRect(Math.cos(a) * (R - 4) - 3, Math.sin(a) * (R - 4) - 3, 6, 6);
    }
    // Anneau orange du processeur autour du chiffre
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, R - 13, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = cpu > 0.9 ? ROUGE : OR;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, R - 13, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, cpu) * Math.PI * 2); ctx.stroke();
    ctx.fillStyle = p.texte;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 20px ${POLICE}`;
    ctx.fillText(`${Math.round(s.cpu)} %`, 0, -2);
    ctx.font = `700 7px ${POLICE}`;
    ctx.fillText('PROCESSEUR', 0, 13);
    // Bannière sur son mât (côté nord-est du donjon) : ondule plus vite avec le processeur
    const [mx, my] = [R * 0.55, -R * 0.75];
    ctx.strokeStyle = '#4A3A2A';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx, my - 26); ctx.stroke();
    const phase = temps * (0.003 + 0.02 * cpu);
    ctx.fillStyle = cpu > 0.9 ? ROUGE : OR;
    ctx.beginPath();
    ctx.moveTo(mx, my - 26);
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      ctx.lineTo(mx + t * 30, my - 26 + Math.sin(phase + t * 4) * 3 * t);
    }
    for (let i = 10; i >= 0; i--) {
      const t = i / 10;
      ctx.lineTo(mx + t * 30, my - 14 - t * 4 + Math.sin(phase + t * 4) * 3 * t);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // Mémoire écrite sous le château
    ctx.fillStyle = p.texte;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `800 11px ${POLICE}`;
    ctx.fillText(`MÉMOIRE ${Math.round(ram * 100)} %`, 0, H / 2 + 14);
    if (this.selection?.type === 'tour' || this.survol?.type === 'tour') this._anneau(0, 0, 145);
  }

  // Maison à colombages (une application) : taille selon la RAM, toit de la couleur du quartier, façade avec
  // poutres, fenêtres éclairées la nuit. Autour, des chaumières pour ses processus.
  _dessinerMaison(lot, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = lot.app.donnees;
    const ferme = d.etat === 'ferme';
    const veille = d.etat === 'veille';
    const part = Math.sqrt(Math.min(1, d.ram / (this.ville.ramMax || 1)));
    const l = Math.round(20 + 24 * part);
    const h = Math.round(14 + 12 * part);
    const [x, y] = [lot.cx - l / 2, lot.y + 26 - h / 2];
    const toit = ferme ? p.ferme : melanger(lot.quartier.couleur, p.fond, p.obscurite * 0.35);
    ctx.globalAlpha = veille ? 0.75 : 1;
    // Chaumières des processus
    const n = ferme ? Math.min(2, d.nb_processus) : Math.min(CHAUMIERES.length, Math.max(0, (d.nb_processus ?? 1) - 1));
    for (let i = 0; i < n; i++) {
      const [hx, hy] = CHAUMIERES[i];
      ctx.fillStyle = p.ombre;
      ctx.fillRect(lot.x + hx + 1, lot.y + hy + 2, 10, 9);
      ctx.fillStyle = ferme ? p.ferme : p.chaume;
      ctx.fillRect(lot.x + hx, lot.y + hy, 10, 9);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(lot.x + hx, lot.y + hy + 4, 10, 1);
    }
    // Ombre, façade (côté sud) et toit
    ctx.fillStyle = p.ombre;
    ctx.fillRect(x + 3, y + 4, l, h + 8);
    ctx.fillStyle = p.torchis;
    ctx.fillRect(x, y + h - 2, l, 10);
    ctx.fillStyle = p.bois;
    ctx.fillRect(x, y + h - 2, l, 1.5);
    ctx.fillRect(x, y + h + 6.5, l, 1.5);
    for (let k = 0; k <= 4; k++) ctx.fillRect(x + (k * (l - 2)) / 4, y + h - 2, 2, 10);
    // Fenêtres : éclairées la nuit, volets à moitié en veille, clos si fermé
    const lumiere = !ferme && !veille ? p.obscurite : 0;
    for (const fx of [x + l * 0.25 - 2.5, x + l * 0.75 - 2.5]) {
      ctx.fillStyle = lumiere > 0.2 ? melanger('#5A4A38', p.fenetre, Math.min(1, lumiere)) : '#5A4A38';
      ctx.fillRect(fx, y + h + 1, 5, 4);
      if (ferme || veille) {
        ctx.fillStyle = eclaircir(p.bois, 0.1);
        ctx.fillRect(fx - 1, y + h + 0.5, 7, ferme ? 5 : 2.5);
      }
    }
    // Porte, barrée d'une planche si le programme est fermé
    ctx.fillStyle = eclaircir(p.bois, -0.2);
    ctx.fillRect(lot.cx - 2.5, y + h + 2, 5, 6);
    if (ferme) {
      ctx.save();
      ctx.translate(lot.cx, y + h + 5);
      ctx.rotate(-0.4);
      ctx.fillStyle = '#B08A5A';
      ctx.fillRect(-6, -1, 12, 2.4);
      ctx.restore();
    }
    // Toit à deux pans : arête au milieu, pan nord plus clair
    ctx.fillStyle = toit;
    ctx.fillRect(x - 2, y - 2, l + 4, h);
    ctx.fillStyle = eclaircir(toit, 0.2);
    ctx.fillRect(x - 2, y - 2, l + 4, h / 2);
    ctx.fillStyle = eclaircir(toit, -0.25);
    ctx.fillRect(x - 2, y - 2 + h / 2 - 1, l + 4, 2);
    // Cheminée
    ctx.fillStyle = ferme ? p.ferme : '#9A6B4E';
    ctx.fillRect(x + l - 9, y + 1, 5, 5);
    ctx.globalAlpha = 1;
    // Lueur des fenêtres la nuit
    if (lumiere > 0.2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = teinte(p.fenetre, 0.12 * lumiere);
      ctx.beginPath(); ctx.ellipse(lot.cx, y + h + 10, l * 0.7, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    lot.cheminee = [x + l - 6.5, y + 3];
    lot.toitY = y - 2;
    if (this.selection?.app === lot.app || this.survol?.app === lot.app) {
      ctx.save();
      ctx.strokeStyle = this.nuit ? 'rgba(255,255,255,0.85)' : 'rgba(60,47,34,0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      rectArrondi(ctx, lot.x + 1, lot.y + 1, lot.l - 2, lot.h, 6); ctx.stroke();
      ctx.restore();
    }
  }

  // Par-dessus les maisons : fumée de cheminée (processeur), « z » de la veille, flamme d'alerte.
  _dessinerSignes(lot, temps) {
    const ctx = this.ctx;
    const d = lot.app.donnees;
    if (!lot.cheminee || d.etat === 'ferme') return;
    const [cx, cy] = lot.cheminee;
    const decal = (((lot.cx * 7 + lot.cy * 13) % 1000) + 1000) % 1000;  // toujours positif
    if (d.etat === 'veille') {
      ctx.fillStyle = this.palette.texteDoux;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const t = ((temps + decal * 3) / 2400) % 1;
      ctx.globalAlpha = 1 - t;
      ctx.font = `700 ${8 + t * 4}px ${POLICE}`;
      ctx.fillText('z', cx + 4 + t * 6, cy - 6 - t * 14);
      ctx.globalAlpha = 1;
    } else if (d.cpu > 0.3) {
      // Fumée : des bouffées qui montent et s'élargissent, plus nombreuses quand le processeur travaille
      const n = 1 + Math.min(4, Math.floor(d.cpu / 6));
      const nuit = this.palette.obscurite;
      for (let i = 0; i < n; i++) {
        const t = ((temps / (1800 - Math.min(1000, d.cpu * 25)) + i / n + decal / 1000) % 1);
        ctx.fillStyle = `rgba(${nuit > 0.5 ? '170,170,180' : '235,235,235'},${0.55 * (1 - t)})`;
        ctx.beginPath(); ctx.arc(cx + Math.sin(t * 5 + i) * 3 + t * 6, cy - t * 22, 2 + t * 5, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (d.alerte) {
      // Torche d'alerte rouge plantée devant la maison, qui vacille
      const [tx, ty] = [lot.x + lot.l - 8, lot.toitY - 2];
      const f = 0.7 + 0.3 * Math.sin(temps / 90 + decal);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = teinte(ROUGE, 0.25 * f);
      ctx.beginPath(); ctx.arc(tx, ty, 14 * f, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#5A3A22';
      ctx.fillRect(tx - 1, ty, 2, 9);
      ctx.fillStyle = ROUGE;
      ctx.beginPath(); ctx.moveTo(tx - 4, ty + 1); ctx.quadraticCurveTo(tx, ty - 10 * f, tx + 4, ty + 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#FFD36B';
      ctx.beginPath(); ctx.moveTo(tx - 2, ty + 1); ctx.quadraticCurveTo(tx, ty - 5 * f, tx + 2, ty + 1); ctx.closePath(); ctx.fill();
    }
  }

  // Torches sur les tours de l'enceinte et aux portes : elles s'allument au crépuscule.
  _dessinerTorches(temps) {
    const ctx = this.ctx;
    const o = this.palette.obscurite;
    if (o < 0.25) return;
    const e = this.ville.enceinte;
    const points = [...this._tours(), [-RUE / 2 - 12, e.y], [RUE / 2 + 12, e.y], [-RUE / 2 - 12, e.y + e.h], [RUE / 2 + 12, e.y + e.h]];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    points.forEach(([x, y], i) => {
      const f = 0.75 + 0.25 * Math.sin(temps / 110 + i * 1.7);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 34 * f);
      g.addColorStop(0, teinte('#FFB347', 0.45 * o * f));
      g.addColorStop(1, teinte('#FFB347', 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 34 * f, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = teinte('#FFE08A', o);
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  // Charrettes vues de dessus : brouette poussée par un paysan, charrette tirée par un cheval, chariot tiré
  // par deux bœufs. La bâche porte la couleur du flux ; dans un embouteillage, elle clignote en rouge.
  _dessinerCharrettes(temps) {
    const ctx = this.ctx;
    const t = this.trafic;
    const o = this.palette.obscurite;
    for (const v of t.vehicules) {
      if (!v.app.lot || v.s <= 0) continue;
      const q = t.position(v);
      const fondu = Math.min(1, v.s / 0.04, (1 - v.s) / 0.04);
      const l = GABARITS[v.gabarit].longueur;
      const couleur = v.bouchon ? melanger(v.couleur, ROUGE, 0.5 + 0.5 * Math.sin(temps / 200)) : v.couleur;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fondu);
      ctx.translate(q.x, q.y);
      ctx.rotate(q.angle);
      const pas = Math.sin(temps / 90 + v.id) * 0.8;
      if (v.gabarit === 'voiture') {
        // Brouette : une roue devant, le paysan derrière
        ctx.fillStyle = '#3A2A1E';
        ctx.fillRect(l / 2 - 1, -1, 3, 2);
        ctx.fillStyle = '#8A6038';
        ctx.fillRect(-l / 2, -3, l, 6);
        ctx.fillStyle = couleur;
        ctx.fillRect(-l / 2 + 1, -2.2, l - 2, 4.4);
        ctx.fillStyle = '#B5653A';
        ctx.beginPath(); ctx.arc(-l / 2 - 3.5 + pas, 0, 2.6, 0, Math.PI * 2); ctx.fill();
      } else {
        const boeufs = v.gabarit === 'camion';
        const largeur = boeufs ? 9 : 7;
        // Roues
        ctx.fillStyle = '#3A2A1E';
        ctx.fillRect(-l * 0.15 - 2, -largeur / 2 - 1.5, 5, 1.6);
        ctx.fillRect(-l * 0.15 - 2, largeur / 2 - 0.1, 5, 1.6);
        // Caisse de bois et bâche colorée
        ctx.fillStyle = '#7A5230';
        ctx.fillRect(-l / 2, -largeur / 2, l * 0.72, largeur);
        ctx.fillStyle = couleur;
        rectArrondi(ctx, -l / 2 + 1, -largeur / 2 + 1, l * 0.72 - 2, largeur - 2, 2.5); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(-l / 2 + 2, -0.5, l * 0.72 - 4, 1);
        // Brancards et bête de trait
        ctx.strokeStyle = '#5A3A22';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(l * 0.22, -2); ctx.lineTo(l * 0.36, -2); ctx.moveTo(l * 0.22, 2); ctx.lineTo(l * 0.36, 2); ctx.stroke();
        ctx.fillStyle = boeufs ? '#C9B79A' : '#8B5A33';
        for (const dy of boeufs ? [-2.6, 2.6] : [0]) {
          ctx.beginPath(); ctx.ellipse(l * 0.38 + pas * 0.5, dy, boeufs ? 3.6 : 3.4, boeufs ? 2 : 1.7, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(l * 0.38 + (boeufs ? 4 : 3.8) + pas * 0.5, dy, boeufs ? 1.4 : 1.1, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Lanterne la nuit
      if (o > 0.4) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = teinte('#FFC860', 0.25 * o);
        ctx.beginPath(); ctx.arc(l / 2 + 4, 0, 6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  _anneau(x, y, r) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.nuit ? 'rgba(255,255,255,0.85)' : 'rgba(60,47,34,0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // Noms à taille fixe à l'écran : bannières des quartiers toujours, maisons de près ou survolées.
  _dessinerEtiquettes() {
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    const zoom = this.camera.zoom;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `600 11px ${POLICE}`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.sol;
    for (const lot of v.lots) {
      const mise = this.survol?.app === lot.app || this.selection?.app === lot.app;
      if (zoom < 1.1 && !mise) continue;
      const [sx, sy] = this.versEcran(lot.cx, lot.y + lot.h - 4);
      if (sx < -80 || sx > this.largeur + 80 || sy < -20 || sy > this.hauteur + 20) continue;
      const nom = tronquer(nomVisible(lot.app, this.discret), mise ? 24 : 13);
      ctx.strokeText(nom, sx, sy);
      ctx.fillStyle = mise ? p.texte : p.texteDoux;
      ctx.fillText(nom, sx, sy);
    }
    // Bannières des quartiers, accrochées en haut de chaque quartier
    ctx.font = `800 11px ${POLICE}`;
    ctx.textBaseline = 'middle';
    for (const q of v.quartiers.values()) {
      if (!q.zone) continue;
      const [sx, sy] = this.versEcran(q.zone.x + q.zone.l / 2, q.zone.y);
      const texte = q.nom.toUpperCase();
      const l = ctx.measureText(texte).width + 22;
      ctx.fillStyle = q.couleur;
      ctx.beginPath();
      ctx.moveTo(sx - l / 2 - 6, sy - 9); ctx.lineTo(sx + l / 2 + 6, sy - 9);
      ctx.lineTo(sx + l / 2, sy); ctx.lineTo(sx + l / 2 + 6, sy + 9);
      ctx.lineTo(sx - l / 2 - 6, sy + 9); ctx.lineTo(sx - l / 2, sy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(texte, sx, sy + 0.5);
    }
    // Port
    const a = v.aeroport;
    const [ax, ay] = this.versEcran(a.cx - 64, a.cy + 2);
    ctx.textAlign = 'right';
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.rive;
    ctx.strokeText('PORT · INTERNET', ax, ay);
    ctx.fillStyle = this.nuit ? '#8CE29B' : '#2E7D3E';
    ctx.fillText('PORT · INTERNET', ax, ay);
  }
}

// ---------- Utilitaires ----------

// Trace le début d'une ligne brisée, jusqu'à une fraction (0 → 1) de sa longueur.
function tracerPortion(ctx, points, fraction) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  let reste = total * fraction;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (let i = 1; i < points.length && reste > 0; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = Math.min(1, reste / l);
    ctx.lineTo(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    reste -= l;
  }
}

function graine(g) {
  let s = g * 7919 + 13;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function versRgb(couleur) {
  if (couleur.startsWith('#')) {
    const n = parseInt(couleur.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return couleur.match(/[\d.]+/g).slice(0, 3).map(Number);
}

function teinte(couleur, alpha) {
  const [r, g, b] = versRgb(couleur);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0, Math.min(1, alpha))})`;
}

// Éclaircit (facteur > 0) ou assombrit (facteur < 0) une couleur.
function eclaircir(couleur, facteur) {
  const [r, g, b] = versRgb(couleur);
  const f = c => Math.round(facteur >= 0 ? c + (255 - c) * facteur : c * (1 + facteur));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function melanger(a, b, t) {
  const [r1, g1, b1] = versRgb(a);
  const [r2, g2, b2] = versRgb(b);
  const m = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${m(r1, r2)},${m(g1, g2)},${m(b1, b2)})`;
}

function tronquer(texte, n) {
  return texte.length > n ? texte.slice(0, n - 1) + '…' : texte;
}
