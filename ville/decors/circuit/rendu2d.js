// Rendu Canvas 2D du circuit imprimé : carte mère, zones sérigraphiées (quartiers), pistes de cuivre,
// puce du processeur, composants (applications), barrettes (disques), port RJ45 (Internet), impulsions (flux).

import { interpolerPalettes, momentDeLaJournee, rectArrondi } from '../ville/rendu2d.js';
import { nomVisible, CPU, CHANFREIN, chanfreiner } from './modele.js';
import { GABARITS } from './trafic.js';

export { momentDeLaJournee };

export const PALETTES = {
  // Journée : carte verte, sérigraphie blanche, cuivre doré
  jour: {
    table: '#1A2621', carte: '#1F7444', carteBord: '#175A35', serigraphie: '#EEF3EA', cuivre: '#D2A65C',
    cuivreFort: 0.5, pastille: '#D3D8DC', corps: '#202326', puce: '#AEB6BD', texte: '#F4F7F2',
    texteDoux: 'rgba(244,247,242,0.72)', ferme: '#8C9A92', ram: '#4FB3FF', eteinte: '#2C3430', obscurite: 0,
  },
  // Nuit : carte presque noire, le cuivre et les LED ressortent
  nuit: {
    table: '#04070A', carte: '#0B2A1B', carteBord: '#071C12', serigraphie: '#A9C2B3', cuivre: '#C98F45',
    cuivreFort: 0.42, pastille: '#8A9298', corps: '#111315', puce: '#6F777E', texte: '#E6EEE9',
    texteDoux: 'rgba(230,238,233,0.62)', ferme: '#4E5B54', ram: '#5CC8FF', eteinte: '#1C221F', obscurite: 1,
  },
};

export function paletteDuMoment(minutes) {
  let t = 1;
  if (minutes >= 420 && minutes < 480) t = 1 - (minutes - 420) / 60;
  else if (minutes >= 480 && minutes < 1140) t = 0;
  else if (minutes >= 1140 && minutes < 1200) t = (minutes - 1140) / 60;
  if (t <= 0) return PALETTES.jour;
  if (t >= 1) return PALETTES.nuit;
  return interpolerPalettes(PALETTES.jour, PALETTES.nuit, t);
}

const DUREE_FONDU = 1200;
const POLICE = 'system-ui, "Segoe UI", sans-serif';
const POLICE_SERIGRAPHIE = 'Consolas, "Cascadia Mono", monospace';
const ROUGE = '#FF4D5E';

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
    ctx.fillStyle = p.table;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    if (!v.bornes) return;

    const cible = this.trafic.suivi ? this.trafic.position(this.trafic.suivi) : null;
    if (cible) {
      this.camera.x += (cible.x - this.camera.x) * 0.15;
      this.camera.y += (cible.y - this.camera.y) * 0.15;
    }

    // Carte, zones et pistes en image mémoire, refaites seulement si la vue ou la carte change.
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
    this._dessinerPistesChaudes(temps);
    this._dessinerPort(temps);
    for (const e of v.entrepots ?? []) this._dessinerBarrette(e, temps);
    this._dessinerProcesseur(temps);
    for (const lot of v.lots) this._dessinerComposant(lot, temps);
    this._dessinerImpulsions(temps);
    const s = this.trafic.suivi;
    if (s?.app.lot) { const q = this.trafic.position(s); this._anneau(q.x, q.y, 9); }
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
    const b = v.bornes;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = p.table;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    ctx.translate(this.largeur / 2, this.hauteur / 2);
    ctx.scale(c.zoom, c.zoom);
    ctx.translate(-c.x, -c.y);

    // La carte : grand rectangle arrondi, bord plus sombre, trous de fixation aux quatre coins.
    ctx.fillStyle = p.carteBord;
    rectArrondi(ctx, b.x, b.y, b.l, b.h, 28); ctx.fill();
    ctx.fillStyle = p.carte;
    rectArrondi(ctx, b.x + 6, b.y + 6, b.l - 12, b.h - 12, 24); ctx.fill();
    for (const [x, y] of [[b.x + 30, b.y + 30], [b.x + b.l - 30, b.y + 30], [b.x + 30, b.y + b.h - 30], [b.x + b.l - 30, b.y + b.h - 30]]) {
      ctx.fillStyle = p.pastille;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.table;
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = teinte(p.serigraphie, 0.55);
    ctx.font = `700 13px ${POLICE_SERIGRAPHIE}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('PC-CITY MB  REV 2.6  ⏚  ROHS', b.x + b.l - 52, b.y + b.h - 24);

    // Zones des quartiers : teinte légère du quartier, cadre sérigraphié avec équerres aux coins.
    for (const q of v.zones) {
      ctx.fillStyle = teinte(q.couleur, 0.1);
      rectArrondi(ctx, q.x, q.y, q.l, q.h, 6); ctx.fill();
      ctx.strokeStyle = teinte(p.serigraphie, 0.5);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      rectArrondi(ctx, q.x, q.y, q.l, q.h, 6); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = p.serigraphie;
      ctx.lineWidth = 2.2;
      for (const [x, y, sx, sy] of [[q.x, q.y, 1, 1], [q.x + q.l, q.y, -1, 1], [q.x, q.y + q.h, 1, -1], [q.x + q.l, q.y + q.h, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(x + sx * 16, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * 16); ctx.stroke();
      }
      ctx.fillStyle = q.couleur;
      ctx.fillRect(q.x + 13, q.y + 14, 16, 16);
      ctx.fillStyle = p.serigraphie;
      ctx.font = `800 20px ${POLICE_SERIGRAPHIE}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(q.nom.toUpperCase(), q.x + 38, q.y + 23);
      ctx.font = `600 11px ${POLICE_SERIGRAPHIE}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = teinte(p.serigraphie, 0.6);
      ctx.fillText(`J${q.rang + 1}`, q.x + q.l - 10, q.y + 23);
    }

    // Bus du processeur : huit pistes fines qui partent de chaque côté de la puce vers chaque zone.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = teinte(p.cuivre, p.cuivreFort * 0.6);
    ctx.lineWidth = 1.3;
    for (const q of v.zones) {
      const yZone = Math.max(q.y + 24, Math.min(q.y + q.h - 24, 0));
      const n = 8;
      const yCpu = Math.max(-CPU + 14, Math.min(CPU - 14 - (n - 1) * 6, yZone - ((n - 1) * 6) / 2));
      for (let k = 0; k < n; k++) {
        const ya = yCpu + k * 6;
        const yb = Math.max(q.y + 8, Math.min(q.y + q.h - 8, yZone - ((n - 1) * 6) / 2 + k * 6));
        const xa = q.cote * (CPU + 10);
        const xb = q.bordInterieur;
        const dy = Math.abs(yb - ya);
        const pts = Math.abs(xb - xa) - 30 > dy
          ? [[xa, ya], [xb - q.cote * (dy + 30), ya], [xb - q.cote * 30, yb], [xb, yb]]
          : chanfreiner([[xa, ya], [(xa + xb) / 2, ya], [(xa + xb) / 2, yb], [xb, yb]], CHANFREIN);
        trace(ctx, pts);
      }
    }

    // Pistes des applications : vers le disque (lecture, écriture) et vers Internet. Les tronçons
    // communs se superposent et forment les bus.
    ctx.strokeStyle = teinte(p.cuivre, p.cuivreFort);
    ctx.lineWidth = 2.2;
    const vias = new Set();
    for (const lot of v.lots) {
      const disque = v.entrepots.find(e => e.disque.id === lot.app.donnees.disque) ?? v.entrepots[0];
      const routes = [v.route(lot, { type: 'aeroport' }, 'recu')];
      if (disque) routes.push(v.route(lot, { type: 'entrepot', entrepot: disque }, 'lecture'), v.route(lot, { type: 'entrepot', entrepot: disque }, 'ecriture'));
      for (const r of routes) {
        trace(ctx, r.points);
        // Une via au coin de la rangée, là où la piste quitte le composant
        const [x, y] = r.points[2] ?? r.points[0];
        vias.add(`${Math.round(x)},${Math.round(y)}`);
      }
    }
    for (const cle of vias) {
      const [x, y] = cle.split(',').map(Number);
      ctx.fillStyle = p.pastille;
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.carteBord;
      ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill();
    }

    // Empreinte du socket du processeur
    ctx.strokeStyle = p.serigraphie;
    ctx.lineWidth = 1.6;
    const s = CPU + 22;
    ctx.beginPath();
    ctx.moveTo(-s + 14, -s); ctx.lineTo(s, -s); ctx.lineTo(s, s); ctx.lineTo(-s, s); ctx.lineTo(-s, -s + 14); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = p.serigraphie;
    ctx.font = `700 11px ${POLICE_SERIGRAPHIE}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('U1  CPU', -s, -s - 4);
  }

  // Embouteillage : les pistes qui mènent à la cible saturée chauffent en rouge.
  _dessinerPistesChaudes(temps) {
    const ctx = this.ctx;
    const v = this.ville;
    const zones = v.zones;
    if (!zones.length) return;
    const xMin = Math.min(...zones.map(q => q.collecteur)) - 8;
    const xMax = Math.max(...zones.map(q => q.collecteur)) + 8;
    const chaud = (saturation, y, xCible, yCible) => {
      if (saturation <= 0) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = teinte(ROUGE, (0.32 + 0.18 * Math.sin(temps / 260)) * (0.5 + 0.5 * saturation));
      ctx.lineWidth = 22;
      trace(ctx, [[xMin, y], [xMax, y]]);
      trace(ctx, [[xCible, y], [xCible, yCible]]);
      ctx.strokeStyle = teinte('#FF7A5C', 0.9);
      ctx.lineWidth = 4;
      trace(ctx, [[xMin, y], [xMax, y]]);
      trace(ctx, [[xCible, y], [xCible, yCible]]);
      ctx.restore();
    };
    const a = v.aeroport;
    chaud(this.trafic.saturation.get('aeroport') ?? 0, v.busHaut, a.cx, a.y + a.h);
    for (const e of v.entrepots ?? []) chaud(this.trafic.saturation.get(`disque:${e.disque.id}`) ?? 0, v.busBas, e.cx, e.y);
  }

  // Le processeur : puce métallique avec ses broches, chiffre du CPU au centre ; autour, le cadre
  // de la mémoire (bleu, rouge au-delà de 90 %). Elle rougeoie quand le processeur chauffe.
  _dessinerProcesseur(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const s = this.ville.systeme;
    if (!s) return;
    const cpu = s.cpu / 100;
    const ram = s.ram_utilisee / s.ram_totale;
    const R = CPU;
    if (cpu > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * (1.6 + 0.6 * cpu));
      halo.addColorStop(0, teinte('#FF9A3C', 0.15 + 0.35 * cpu * (0.85 + 0.15 * Math.sin(temps / 300))));
      halo.addColorStop(1, teinte('#FF9A3C', 0));
      ctx.fillStyle = halo;
      ctx.fillRect(-R * 2.3, -R * 2.3, R * 4.6, R * 4.6);
      ctx.restore();
    }
    // Broches dorées sur les quatre côtés
    ctx.fillStyle = '#D9B45F';
    const n = 16;
    for (let i = 0; i < n; i++) {
      const t = -R + 12 + (i * (2 * R - 24)) / (n - 1);
      ctx.fillRect(t - 2, -R - 9, 4, 9);
      ctx.fillRect(t - 2, R, 4, 9);
      ctx.fillRect(-R - 9, t - 2, 9, 4);
      ctx.fillRect(R, t - 2, 9, 4);
    }
    // Boîtier et capot métallique
    ctx.fillStyle = '#1C3A2A';
    rectArrondi(ctx, -R, -R, 2 * R, 2 * R, 8); ctx.fill();
    const g = ctx.createLinearGradient(-R, -R, R, R);
    g.addColorStop(0, eclaircir(p.puce, 0.35));
    g.addColorStop(0.55, p.puce);
    g.addColorStop(1, eclaircir(p.puce, -0.3));
    ctx.fillStyle = g;
    rectArrondi(ctx, -R + 10, -R + 10, 2 * R - 20, 2 * R - 20, 6); ctx.fill();
    // Le capot rougit avec la charge
    if (cpu > 0.5) {
      ctx.fillStyle = teinte(ROUGE, (cpu - 0.5) * 0.5);
      rectArrondi(ctx, -R + 10, -R + 10, 2 * R - 20, 2 * R - 20, 6); ctx.fill();
    }
    ctx.fillStyle = '#E8ECEF';
    ctx.beginPath(); ctx.moveTo(-R + 4, -R + 4); ctx.lineTo(-R + 16, -R + 4); ctx.lineTo(-R + 4, -R + 16); ctx.fill();
    // Cadre de la mémoire
    const rr = R + 18;
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    rectArrondi(ctx, -rr, -rr, 2 * rr, 2 * rr, 10); ctx.stroke();
    ctx.strokeStyle = ram > 0.9 ? ROUGE : p.ram;
    cadreProgression(ctx, rr, Math.max(0.01, Math.min(1, ram)));
    ctx.fillStyle = '#20272C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(R * 0.46)}px ${POLICE}`;
    ctx.fillText(`${Math.round(s.cpu)} %`, 0, -6);
    ctx.font = `700 ${Math.round(R * 0.15)}px ${POLICE}`;
    ctx.fillText(`CPU · RAM ${Math.round(ram * 100)} %`, 0, R * 0.36);
    ctx.font = `600 ${Math.round(R * 0.12)}px ${POLICE_SERIGRAPHIE}`;
    ctx.fillStyle = 'rgba(32,39,44,0.6)';
    ctx.fillText(`${s.nb_coeurs ?? ''} CŒURS`, 0, -R * 0.5);
    if (this.selection?.type === 'tour' || this.survol?.type === 'tour') this._cadre(-rr - 8, -rr - 8, 2 * rr + 16, 2 * rr + 16);
  }

  // Un composant par application. Fermé : il ne reste que l'empreinte vide en pointillés.
  _dessinerComposant(lot, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = lot.app.donnees;
    const ferme = d.etat === 'ferme';
    const veille = d.etat === 'veille';
    const q = lot.quartier;
    const t = lot.taille;
    const [cx, cy] = [lot.cx, lot.cy];
    const [dl, dh] = lot.forme === 'etroite' ? [t * 1.2, t * 0.75] : [t, t];

    if (ferme) {
      ctx.strokeStyle = p.ferme;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      if (lot.forme === 'condensateur') { ctx.beginPath(); ctx.arc(cx, cy, t * 0.85, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.strokeRect(cx - dl, cy - dh, 2 * dl, 2 * dh); }
      ctx.setLineDash([]);
      ctx.fillStyle = teinte(p.pastille, 0.45);
      this._pastilles(lot, dl, dh, 0.45);
      ctx.fillStyle = p.ferme;
      ctx.font = `700 7px ${POLICE_SERIGRAPHIE}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NC', cx, cy);
    } else {
      ctx.globalAlpha = veille ? 0.5 : 1;
      ctx.fillStyle = p.pastille;
      this._pastilles(lot, dl, dh, 1);
      if (lot.forme === 'condensateur') {
        const r = t * 0.85;
        const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
        g.addColorStop(0, '#F2F4F6');
        g.addColorStop(1, '#8E979F');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        // Manchon de la couleur du quartier, côté polarité
        ctx.strokeStyle = q.couleur;
        ctx.lineWidth = Math.max(2, r * 0.28);
        ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth / 2, Math.PI * 0.65, Math.PI * 1.35); ctx.stroke();
        // Évent en croix sur le dessus
        ctx.strokeStyle = 'rgba(60,66,72,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - r * 0.45, cy); ctx.lineTo(cx + r * 0.45, cy); ctx.moveTo(cx, cy - r * 0.45); ctx.lineTo(cx, cy + r * 0.45); ctx.stroke();
      } else {
        const g = ctx.createLinearGradient(cx - dl, cy - dh, cx + dl, cy + dh);
        g.addColorStop(0, eclaircir(p.corps, 0.18));
        g.addColorStop(1, p.corps);
        ctx.fillStyle = g;
        rectArrondi(ctx, cx - dl, cy - dh, 2 * dl, 2 * dh, 2); ctx.fill();
        ctx.strokeStyle = teinte(q.couleur, 0.85);
        ctx.lineWidth = 1.4;
        rectArrondi(ctx, cx - dl + 2.5, cy - dh + 2.5, 2 * dl - 5, 2 * dh - 5, 1.5); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.arc(cx - dl + 5, cy - dh + 5, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      // Processus : petites résistances en rang sous le composant
      const nb = Math.min(6, Math.max(0, (d.nb_processus ?? 1) - 1));
      for (let i = 0; i < nb; i++) {
        const x = cx + (i - (nb - 1) / 2) * 7.5;
        const y = lot.y + lot.h - 2;
        ctx.fillStyle = '#D9C9A3';
        ctx.fillRect(x - 2.6, y - 1.4, 5.2, 2.8);
        ctx.fillStyle = '#8A5A2B';
        ctx.fillRect(x - 0.6, y - 1.4, 1.2, 2.8);
      }
      ctx.globalAlpha = 1;
      this._dessinerLed(lot, temps, veille);
    }
    if (d.alerte && !ferme) {
      ctx.strokeStyle = teinte(ROUGE, 0.5 + 0.4 * Math.sin(temps / 180));
      ctx.lineWidth = 1.6;
      rectArrondi(ctx, lot.x - 1, lot.y - 1, lot.l + 2, lot.h + 2, 5); ctx.stroke();
    }
    if (this.selection?.app === lot.app || this.survol?.app === lot.app) this._cadre(lot.x - 4, lot.y - 4, lot.l + 8, lot.h + 8);
  }

  // Pastilles de soudure de l'empreinte (broches de la puce, ou deux pattes du condensateur).
  _pastilles(lot, dl, dh) {
    const ctx = this.ctx;
    const [cx, cy] = [lot.cx, lot.cy];
    if (lot.forme === 'condensateur') {
      const r = lot.taille * 0.85;
      ctx.fillRect(cx - r - 3, cy - 2, 4, 4);
      ctx.fillRect(cx + r - 1, cy - 2, 4, 4);
      return;
    }
    const n = Math.max(3, Math.round(dl / 4));
    for (let i = 0; i < n; i++) {
      const x = cx - dl + 3 + (i * (2 * dl - 6)) / Math.max(1, n - 1);
      ctx.fillRect(x - 1, cy - dh - 3, 2, 3);
      ctx.fillRect(x - 1, cy + dh, 2, 3);
    }
    if (lot.forme === 'puce') {
      for (let i = 0; i < n; i++) {
        const y = cy - dh + 3 + (i * (2 * dh - 6)) / Math.max(1, n - 1);
        ctx.fillRect(cx - dl - 3, y - 1, 3, 2);
        ctx.fillRect(cx + dl, y - 1, 3, 2);
      }
    }
  }

  // LED du composant : allumée de la couleur du quartier selon le processeur, rouge clignotante en alerte.
  _dessinerLed(lot, temps, veille) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = lot.app.donnees;
    const [x, y] = [lot.x + lot.l - 3, lot.y + 3];
    const cpu = Math.min(1, d.cpu / 25);
    let couleur = null;
    let force = 0;
    if (d.alerte) {
      if (Math.sin(temps / 160) > -0.2) { couleur = ROUGE; force = 1; }
    } else if (!veille && cpu > 0.02) {
      couleur = eclaircir(lot.quartier.couleur, 0.3);
      force = 0.35 + 0.65 * cpu;
    }
    if (couleur) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = 5 + 7 * force * (this.nuit ? 1.4 : 1);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, teinte(couleur, 0.55 * force + 0.15));
      g.addColorStop(1, teinte(couleur, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.restore();
    }
    ctx.fillStyle = couleur ? eclaircir(couleur, 0.4 * force) : p.eteinte;
    ctx.fillRect(x - 2.2, y - 1.6, 4.4, 3.2);
  }

  // Barrette (un disque) : circuit vert, puces noires, contacts dorés, étiquette avec la jauge de
  // remplissage ; halo rouge s'il sature.
  _dessinerBarrette(e, temps) {
    const ctx = this.ctx;
    const d = e.disque;
    const saturation = this.trafic.saturation.get(`disque:${d.id}`) ?? 0;
    if (saturation > 0) {
      ctx.fillStyle = teinte(ROUGE, 0.12 + 0.15 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)));
      rectArrondi(ctx, e.x - 18, e.y - 18, e.l + 36, e.h + 36, 18); ctx.fill();
    }
    // Connecteur sur la carte
    ctx.fillStyle = '#2A2D30';
    rectArrondi(ctx, e.x - 6, e.y + e.h - 18, e.l + 12, 20, 3); ctx.fill();
    ctx.fillStyle = '#145A33';
    rectArrondi(ctx, e.x, e.y, e.l, e.h - 6, 4); ctx.fill();
    ctx.fillStyle = '#E2B652';
    for (let x = e.x + 6; x < e.x + e.l - 6; x += 5) ctx.fillRect(x, e.y + e.h - 18, 3, 11);
    ctx.fillStyle = '#16181A';
    const largeurPuce = (e.l - 16 - 3 * 8) / 4;
    for (let i = 0; i < 4; i++) ctx.fillRect(e.x + 8 + i * (largeurPuce + 8), e.y + 7, largeurPuce, 16);
    // Étiquette et jauge
    const rempli = d.utilise / d.total;
    ctx.fillStyle = '#F3F4EE';
    rectArrondi(ctx, e.x + 8, e.y + 29, e.l - 16, 30, 3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(e.x + 62, e.y + 47, e.l - 80, 6);
    ctx.fillStyle = rempli > 0.9 ? ROUGE : e.toit;
    ctx.fillRect(e.x + 62, e.y + 47, (e.l - 80) * Math.min(1, rempli), 6);
    ctx.fillStyle = '#20272C';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `800 16px ${POLICE}`;
    ctx.fillText(d.nom, e.x + 16, e.y + 44);
    ctx.font = `700 10px ${POLICE}`;
    ctx.fillText(`${Math.round(rempli * 100)} % utilisé`, e.x + 62, e.y + 38);
    if (this.selection?.entrepot?.disque.id === d.id || this.survol?.entrepot?.disque.id === d.id) this._cadre(e.x - 8, e.y - 8, e.l + 16, e.h + 16);
  }

  // Port RJ45 (Internet) : boîtier métallique, contacts dorés ; ses LED clignotent avec le réseau.
  _dessinerPort(temps) {
    const ctx = this.ctx;
    const a = this.ville.aeroport;
    const s = this.ville.systeme;
    const saturation = this.trafic.saturation.get('aeroport') ?? 0;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    if (saturation > 0) {
      ctx.fillStyle = teinte(ROUGE, 0.12 + 0.15 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)));
      rectArrondi(ctx, a.x - 18, a.y - 18, a.l + 36, a.h + 36, 18); ctx.fill();
    }
    const g = ctx.createLinearGradient(a.x, a.y, a.x + a.l, a.y + a.h);
    g.addColorStop(0, '#E6E9EC');
    g.addColorStop(1, '#8F979E');
    ctx.fillStyle = g;
    rectArrondi(ctx, a.x, a.y, a.l, a.h, 5); ctx.fill();
    // Ouverture de la prise (vue de face, rabattue sur la carte)
    const [ox, oy, ol, oh] = [a.cx - 38, a.y + 22, 76, 58];
    ctx.fillStyle = '#15181B';
    ctx.beginPath();
    ctx.moveTo(ox, oy); ctx.lineTo(ox + ol, oy); ctx.lineTo(ox + ol, oy + oh - 12); ctx.lineTo(a.cx + 12, oy + oh - 12);
    ctx.lineTo(a.cx + 12, oy + oh); ctx.lineTo(a.cx - 12, oy + oh); ctx.lineTo(a.cx - 12, oy + oh - 12); ctx.lineTo(ox, oy + oh - 12);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#E2B652';
    for (let i = 0; i < 8; i++) ctx.fillRect(ox + 8 + i * 8.4, oy + 4, 3.2, 15);
    // LED : verte qui clignote avec l'activité, orange fixe quand des données passent
    const clignote = activite > 0.05 && Math.sin(temps / (60 + 240 * (1 - activite))) > 0;
    for (const [x, couleur, allumee] of [[a.x + 9, saturation > 0 ? ROUGE : '#6CFF8E', clignote || saturation > 0], [a.x + a.l - 17, '#FFB347', activite > 0.2]]) {
      if (allumee) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = teinte(couleur, 0.35);
        ctx.beginPath(); ctx.arc(x + 4, a.y + 9, 10, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = allumee ? couleur : '#3A3F3C';
      ctx.fillRect(x, a.y + 5, 8, 7);
    }
    if (this.selection?.type === 'aeroport' || this.survol?.type === 'aeroport') this._cadre(a.x - 8, a.y - 8, a.l + 16, a.h + 16);
  }

  // Impulsions : trait lumineux orienté le long de la piste, halo doux autour.
  _dessinerImpulsions(temps) {
    const ctx = this.ctx;
    const t = this.trafic;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const v of t.vehicules) {
      if (!v.app.lot || v.s <= 0) continue;
      const q = t.position(v);
      const fondu = Math.min(1, v.s / 0.04, (1 - v.s) / 0.04);
      const l = GABARITS[v.gabarit].longueur;
      const couleur = v.bouchon ? melanger(v.couleur, ROUGE, 0.5 + 0.5 * Math.sin(temps / 200)) : v.couleur;
      const [dx, dy] = [Math.cos(q.angle) * l / 2, Math.sin(q.angle) * l / 2];
      ctx.globalAlpha = Math.max(0, fondu);
      ctx.strokeStyle = teinte(couleur, this.nuit ? 0.45 : 0.35);
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(q.x - dx, q.y - dy); ctx.lineTo(q.x + dx, q.y + dy); ctx.stroke();
      ctx.strokeStyle = eclaircir(couleur, 0.45);
      ctx.lineWidth = 3.6;
      ctx.beginPath(); ctx.moveTo(q.x - dx, q.y - dy); ctx.lineTo(q.x + dx, q.y + dy); ctx.stroke();
    }
    ctx.restore();
  }

  _anneau(x, y, r) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  _cadre(x, y, l, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    rectArrondi(ctx, x, y, l, h, 6); ctx.stroke();
    ctx.restore();
  }

  // Noms à taille fixe à l'écran : composants de près ou survolés, et le port Internet.
  _dessinerEtiquettes() {
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    const zoom = this.camera.zoom;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `600 11px ${POLICE}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.carte;
    for (const lot of v.lots) {
      const mise = this.survol?.app === lot.app || this.selection?.app === lot.app;
      if (zoom < 1.1 && !mise) continue;
      const [sx, sy] = this.versEcran(lot.cx, lot.y + lot.h + 1);
      if (sx < -80 || sx > this.largeur + 80 || sy < -20 || sy > this.hauteur + 20) continue;
      const nom = tronquer(nomVisible(lot.app, this.discret), 16);
      ctx.strokeText(nom, sx, sy);
      ctx.fillStyle = mise ? p.texte : p.texteDoux;
      ctx.fillText(nom, sx, sy);
    }
    ctx.font = `800 12px ${POLICE}`;
    const a = v.aeroport;
    const [ax, ay] = this.versEcran(a.cx, a.y - 6);
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = p.carte;
    ctx.strokeText('INTERNET', ax, ay);
    ctx.fillStyle = '#8CF29B';
    ctx.fillText('INTERNET', ax, ay);
  }
}

// ---------- Utilitaires ----------

function trace(ctx, points) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
}

// Partie du pourtour d'un carré (demi-côté r), en partant du milieu du haut, dans le sens des aiguilles.
function cadreProgression(ctx, r, part) {
  const tour = [[0, -r], [r, -r], [r, r], [-r, r], [-r, -r], [0, -r]];
  let reste = part * 8 * r;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  for (let i = 1; i < tour.length && reste > 0; i++) {
    const [a, b] = [tour[i - 1], tour[i]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = Math.min(1, reste / l);
    ctx.lineTo(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    reste -= l;
  }
  ctx.stroke();
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
