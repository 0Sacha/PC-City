// Rendu Canvas 2D de la ville isométrique : sol, rues et boulevard en image mémoire, puis immeubles,
// tour du processeur, data centers, antenne et voitures, en volume, dessinés du fond vers l'avant
// (les plus proches cachent ceux de derrière).

import { interpolerPalettes, momentDeLaJournee } from '../ville/rendu2d.js';
import { nomVisible, projeter, TH } from './modele.js';

export { momentDeLaJournee };

export const PALETTES = {
  jour: {
    ciel: '#CFE8F3', sol: '#DCE6C4', bord: '#B9C79E', route: '#7A808C', marquage: 'rgba(255,255,255,0.8)',
    texte: '#26303B', texteDoux: 'rgba(38,48,59,0.65)', ferme: '#B9B2A7', vitre: 'rgba(40,60,90,0.35)',
    lumiere: '#FFF0B8', lueur: 0, obscurite: 0.1,
  },
  nuit: {
    ciel: '#0D1322', sol: '#1D2620', bord: '#2A352C', route: '#2C313C', marquage: 'rgba(255,255,255,0.35)',
    texte: '#E8EEF8', texteDoux: 'rgba(232,238,248,0.6)', ferme: '#474B55', vitre: 'rgba(10,14,26,0.75)',
    lumiere: '#FFD36B', lueur: 1, obscurite: 1,
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
const ROUGE = '#E8504F';

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
    c.zoom = Math.min(4, Math.max(0.15, c.zoom * facteur));
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
    const dt = this._precedent === null ? 0 : Math.min(0.1, Math.max(0, (temps - this._precedent) / 1000));
    this._precedent = temps;
    this._avancerFondu();
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = p.ciel;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    if (!v.bornes) return;
    if (this.trafic.suivi) {
      const q = this.trafic.position(this.trafic.suivi);
      this.camera.x += (q.x - this.camera.x) * 0.15;
      this.camera.y += (q.y - this.camera.y) * 0.15;
    }
    // Sol, quartiers et rues en image mémoire, refaits seulement si la vue change.
    const c = this.camera;
    const cle = `${c.x},${c.y},${c.zoom},${this.largeur},${this.hauteur},${this.ratio},${v.version}`;
    if (cle !== this._cleDecor || p !== this._paletteDecor) {
      this._dessinerSol();
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
    // Immeubles : hauteur et couleur rejoignent leur cible en douceur (un programme qui rouvre se
    // reconstruit, un programme qui se ferme s'affaisse en gris).
    for (const lot of v.lots) {
      const ferme = lot.app.donnees.etat === 'ferme';
      lot.hauteurAffichee = lot.hauteurAffichee ?? lot.hauteurCible;
      lot.hauteurAffichee += (lot.hauteurCible - lot.hauteurAffichee) * Math.min(1, dt * 1.8);
      lot.terneAffiche = lot.terneAffiche ?? (ferme ? 1 : 0);
      lot.terneAffiche += ((ferme ? 1 : 0) - lot.terneAffiche) * Math.min(1, dt * 1.5);
      v._cadre(lot, lot.hauteurAffichee);
    }
    // Tout ce qui a du volume, trié du fond vers l'avant (i + j croissant).
    const objets = [];
    for (const lot of v.lots) objets.push([lot.ci + lot.cj + lot.s, () => this._dessinerImmeuble(lot, temps)]);
    objets.push([v.tour.ci + v.tour.cj + v.tour.s, () => this._dessinerTour(temps)]);
    for (const e of v.entrepots) objets.push([e.ci + e.cj + e.s, () => this._dessinerDataCenter(e, temps)]);
    objets.push([v.aeroport.ci + v.aeroport.cj, () => this._dessinerAntenne(temps)]);
    for (const vh of this.trafic.vehicules) {
      const q = this.trafic.position(vh);
      objets.push([q.i + q.j, () => this._dessinerVoiture(vh, q, temps)]);
    }
    objets.sort((a, b) => a[0] - b[0]);
    for (const [, dessin] of objets) dessin();
    if (this.trafic.suivi) { const q = this.trafic.position(this.trafic.suivi); this._anneau(q.x, q.y, 14, 8); }
    ctx.restore();
    this._dessinerEtiquettes();
  }

  // ---------- Sol ----------

  _dessinerSol() {
    if (!this._decor) this._decor = document.createElement('canvas');
    const toile = this._decor;
    toile.width = this.canvas.width;
    toile.height = this.canvas.height;
    const ctx = toile.getContext('2d');
    const p = this.palette;
    const v = this.ville;
    const c = this.camera;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = p.ciel;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    ctx.translate(this.largeur / 2, this.hauteur / 2);
    ctx.scale(c.zoom, c.zoom);
    ctx.translate(-c.x, -c.y);
    const losange = (i0, i1, j0, j1, couleur) => {
      ctx.fillStyle = couleur;
      ctx.beginPath();
      ctx.moveTo(...projeter(i0, j0)); ctx.lineTo(...projeter(i1, j0)); ctx.lineTo(...projeter(i1, j1)); ctx.lineTo(...projeter(i0, j1));
      ctx.closePath();
      ctx.fill();
    };
    // Terrain, avec une tranche de terre visible devant (épaisseur du plateau)
    const [I0, I1, J0, J1] = [-12, v.longueur + 6, -9.5, 9.5];
    ctx.fillStyle = p.bord;
    ctx.beginPath();
    ctx.moveTo(...projeter(I1, J0)); ctx.lineTo(...projeter(I1, J1)); ctx.lineTo(...projeter(I0, J1));
    ctx.lineTo(...projeter(I0, J1, -18)); ctx.lineTo(...projeter(I1, J1, -18)); ctx.lineTo(...projeter(I1, J0, -18));
    ctx.closePath();
    ctx.fill();
    losange(I0, I1, J0, J1, p.sol);
    // Sols des quartiers
    for (const b of v.blocs) losange(b.i0, b.i1, b.j0, b.j1, melanger(p.sol, b.quartier.couleur, 0.22));
    // Boulevard (2 voies), rues des quartiers, accès aux data centers et à l'antenne
    const route = (i0, i1, j0, j1) => losange(Math.min(i0, i1), Math.max(i0, i1), Math.min(j0, j1), Math.max(j0, j1), p.route);
    route(-9, v.longueur + 1, -0.5, 0.5);
    route(-8.4, -7.6, -2, 0);
    for (const r of v.rues) route(r.i - 0.35, r.i + 0.35, r.j0, r.j1);
    for (const e of v.entrepots) { route(v.longueur, v.longueur + 1, Math.min(0, e.cj), Math.max(0, e.cj)); route(v.longueur, e.ci - 1, e.cj - 0.4, e.cj + 0.4); }
    for (const lot of v.lots) route(Math.min(lot.ci, lot.iRue), Math.max(lot.ci, lot.iRue), lot.cj - 0.12, lot.cj + 0.12);
    // Ligne pointillée au milieu du boulevard
    ctx.strokeStyle = p.marquage;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.moveTo(...projeter(-9, 0)); ctx.lineTo(...projeter(v.longueur + 1, 0)); ctx.stroke();
    ctx.setLineDash([]);
    // Arbres décoratifs le long du terrain (petites boules sur tronc)
    for (let k = 0; k < (v.longueur + 18) / 1.6; k++) {
      for (const j of [-8.7, 8.7]) {
        const [x, y] = projeter(-11 + k * 1.6, j);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.beginPath(); ctx.ellipse(x, y, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = this.nuit ? '#2F5A3A' : '#7DB560';
        ctx.beginPath(); ctx.arc(x, y - 10, 8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // ---------- Volumes ----------

  // Boîte posée en (ci, cj), de côté si × sj cases, haute de h px : toit et deux façades visibles.
  _boite(ci, cj, si, sj, h, couleur, z0 = 0) {
    const ctx = this.ctx;
    const [i0, i1, j0, j1] = [ci - si / 2, ci + si / 2, cj - sj / 2, cj + sj / 2];
    const P = (i, j, z) => projeter(i, j, z0 + z);
    // La nuit, les volumes s'assombrissent : seules les fenêtres allumées brillent.
    couleur = eclaircir(couleur, -0.45 * this.palette.lueur);
    // Façade droite (i = i1), plus sombre
    ctx.fillStyle = eclaircir(couleur, -0.25);
    ctx.beginPath(); ctx.moveTo(...P(i1, j0, 0)); ctx.lineTo(...P(i1, j1, 0)); ctx.lineTo(...P(i1, j1, h)); ctx.lineTo(...P(i1, j0, h)); ctx.closePath(); ctx.fill();
    // Façade gauche (j = j1)
    ctx.fillStyle = eclaircir(couleur, -0.1);
    ctx.beginPath(); ctx.moveTo(...P(i0, j1, 0)); ctx.lineTo(...P(i1, j1, 0)); ctx.lineTo(...P(i1, j1, h)); ctx.lineTo(...P(i0, j1, h)); ctx.closePath(); ctx.fill();
    // Toit
    ctx.fillStyle = eclaircir(couleur, 0.15);
    ctx.beginPath(); ctx.moveTo(...P(i0, j0, h)); ctx.lineTo(...P(i1, j0, h)); ctx.lineTo(...P(i1, j1, h)); ctx.lineTo(...P(i0, j1, h)); ctx.closePath(); ctx.fill();
    return { i0, i1, j0, j1 };
  }

  // Fenêtres sur les deux façades visibles : allumées selon l'activité (part de 0 à 1).
  _fenetres(b, h, part, graine, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const etages = Math.floor((h - 6) / 11);
    for (const facade of [0, 1]) {
      for (let e = 0; e < etages; e++) {
        for (let k = 0; k < 2; k++) {
          const n = hacher(`${graine}${facade}${e}${k}`);
          const clignote = (Math.floor(temps / 4000 + (n % 97) / 97) + n) % 7 === 0;
          const allume = ((n % 100) / 100 < part) !== clignote;
          const z = 6 + e * 11;
          const t0 = 0.18 + k * 0.42;
          const t1 = t0 + 0.26;
          ctx.fillStyle = allume ? p.lumiere : p.vitre;
          ctx.beginPath();
          if (facade === 0) {
            const jA = b.j0 + (b.j1 - b.j0) * t0;
            const jB = b.j0 + (b.j1 - b.j0) * t1;
            ctx.moveTo(...projeter(b.i1, jA, z)); ctx.lineTo(...projeter(b.i1, jB, z)); ctx.lineTo(...projeter(b.i1, jB, z + 6)); ctx.lineTo(...projeter(b.i1, jA, z + 6));
          } else {
            const iA = b.i0 + (b.i1 - b.i0) * t0;
            const iB = b.i0 + (b.i1 - b.i0) * t1;
            ctx.moveTo(...projeter(iA, b.j1, z)); ctx.lineTo(...projeter(iB, b.j1, z)); ctx.lineTo(...projeter(iB, b.j1, z + 6)); ctx.lineTo(...projeter(iA, b.j1, z + 6));
          }
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  // Immeuble d'une application : hauteur selon la RAM, fenêtres allumées selon le processeur ;
  // en veille presque toutes éteintes ; fermé : bloc bas et gris ; gyrophare rouge en cas d'alerte.
  _dessinerImmeuble(lot, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = lot.app.donnees;
    const h = lot.hauteurAffichee;
    const couleur = melanger(lot.quartier.couleur, p.ferme, lot.terneAffiche);
    // Ombre au sol
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath(); ctx.moveTo(...projeter(lot.ci - lot.s / 2, lot.cj + lot.s / 2)); ctx.lineTo(...projeter(lot.ci + lot.s / 2, lot.cj + lot.s / 2));
    ctx.lineTo(...projeter(lot.ci + lot.s / 2 + 0.4, lot.cj + lot.s / 2 + 0.4)); ctx.lineTo(...projeter(lot.ci - lot.s / 2 + 0.4, lot.cj + lot.s / 2 + 0.4)); ctx.fill();
    const b = this._boite(lot.ci, lot.cj, lot.s, lot.s, h, couleur);
    if (lot.terneAffiche < 0.5) {
      const part = d.etat === 'veille' ? 0.08 : 0.25 + 0.75 * Math.min(1, d.cpu / 20);
      this._fenetres(b, h, part, lot.app.id, temps);
    }
    if (d.alerte) {
      const [x, y] = projeter(lot.ci, lot.cj, h + 6);
      ctx.fillStyle = Math.sin(temps / 200) > 0 ? ROUGE : '#7A2A2A';
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (this.selection?.app === lot.app || this.survol?.app === lot.app) {
      ctx.strokeStyle = this.nuit ? '#FFFFFF' : '#1E2A36';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(...projeter(b.i0, b.j0, h)); ctx.lineTo(...projeter(b.i1, b.j0, h)); ctx.lineTo(...projeter(b.i1, b.j1, h)); ctx.lineTo(...projeter(b.i0, b.j1, h)); ctx.closePath();
      ctx.moveTo(...projeter(b.i1, b.j1, 0)); ctx.lineTo(...projeter(b.i1, b.j1, h));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Tour du processeur : gratte-ciel dont les étages s'éclairent jusqu'au niveau de la RAM utilisée,
  // couronne de diodes orange (le CPU) et antenne qui clignote.
  _dessinerTour(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const t = this.ville.tour;
    const s = this.ville.systeme;
    if (!s) return;
    const cpu = s.cpu / 100;
    const ram = s.ram_utilisee / s.ram_totale;
    const b = this._boite(t.ci, t.cj, t.s, t.s, t.hauteur, '#3A4152');
    // Étages : bande éclairée par étage jusqu'au niveau de la RAM (rouge au-delà de 90 %)
    const etages = 18;
    for (let e = 0; e < etages; e++) {
      const z = 8 + e * ((t.hauteur - 30) / etages);
      const allume = e / etages < ram;
      ctx.fillStyle = allume ? (ram > 0.9 ? ROUGE : '#5CC8FF') : 'rgba(255,255,255,0.08)';
      for (const [a, c2] of [[[b.i1, b.j0], [b.i1, b.j1]], [[b.i0, b.j1], [b.i1, b.j1]]]) {
        ctx.beginPath();
        ctx.moveTo(...projeter(...a, z)); ctx.lineTo(...projeter(...c2, z)); ctx.lineTo(...projeter(...c2, z + 4)); ctx.lineTo(...projeter(...a, z + 4));
        ctx.closePath(); ctx.fill();
      }
    }
    // Couronne : 16 diodes sur le pourtour du toit, allumées selon le CPU
    const n = 16;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const [x, y] = projeter(t.ci + Math.cos(a) * t.s * 0.45, t.cj + Math.sin(a) * t.s * 0.45, t.hauteur + 4);
      ctx.fillStyle = k / n < cpu ? '#FF9F43' : 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Antenne
    const [ax, ay] = projeter(t.ci, t.cj, t.hauteur);
    ctx.strokeStyle = '#2A2F3A';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - 40); ctx.stroke();
    ctx.fillStyle = Math.sin(temps / (500 - 350 * cpu)) > 0 ? ROUGE : '#5A1F1F';
    ctx.beginPath(); ctx.arc(ax, ay - 42, 3.5, 0, Math.PI * 2); ctx.fill();
    // Enseigne
    ctx.fillStyle = cpu > 0.9 ? ROUGE : '#F2A541';
    const [ex, ey] = [ax, ay - 66];
    ctx.beginPath(); ctx.roundRect?.(ex - 46, ey - 13, 92, 26, 6) ?? ctx.rect(ex - 46, ey - 13, 92, 26); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 14px ${POLICE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`CPU ${Math.round(s.cpu)} %`, ex, ey);
    ctx.fillStyle = p.texte;
    if (this.selection?.type === 'tour' || this.survol?.type === 'tour') this._anneau(ax, ay + t.hauteur / 2, 70, 140);
  }

  // Data center (un disque) : bâtiment large et bas, rangées de diodes qui clignotent avec
  // l'activité du disque, jauge de remplissage sur le toit ; halo rouge s'il sature.
  _dessinerDataCenter(e, temps) {
    const ctx = this.ctx;
    const d = e.disque;
    const saturation = this.trafic.saturation.get(`disque:${d.id}`) ?? 0;
    if (saturation > 0) {
      const [x, y] = projeter(e.ci, e.cj);
      ctx.fillStyle = `rgba(232,80,79,${0.18 + 0.18 * saturation * (0.5 + 0.5 * Math.sin(temps / 250))})`;
      ctx.beginPath(); ctx.ellipse(x, y, 110, 55, 0, 0, Math.PI * 2); ctx.fill();
    }
    const b = this._boite(e.ci, e.cj, e.s, e.s, e.hauteur, '#D9DEE6');
    const activite = Math.min(1, (d.occupation ?? 0) / 50);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 9; k++) {
        const n = hacher(`${d.id}${r}${k}`);
        const on = Math.sin(temps / (120 + (n % 200) * (1.5 - activite)) + n) > 1 - 1.6 * (0.2 + activite);
        ctx.fillStyle = on ? (k % 3 ? '#3DBE7A' : '#3FA9E0') : 'rgba(40,50,60,0.45)';
        const [x, y] = projeter(b.i1, b.j0 + ((k + 0.5) / 9) * (b.j1 - b.j0), 10 + r * 11);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    // Jauge sur le toit
    const rempli = d.utilise / d.total;
    const [x0, y0] = projeter(e.ci, e.cj, e.hauteur);
    ctx.fillStyle = '#26303B';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 16px ${POLICE}`;
    ctx.fillText(d.nom, x0, y0 - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x0 - 30, y0 + 4, 60, 6);
    ctx.fillStyle = rempli > 0.9 ? ROUGE : e.toit;
    ctx.fillRect(x0 - 30, y0 + 4, 60 * rempli, 6);
    if (this.selection?.entrepot?.disque.id === d.id || this.survol?.entrepot?.disque.id === d.id) this._anneau(e.cx, e.cy, 90, 60);
  }

  // Antenne Internet : pylône en treillis, ondes qui partent du sommet (plus vite quand le réseau
  // travaille) ; rouge si le réseau sature.
  _dessinerAntenne(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const a = this.ville.aeroport;
    const s = this.ville.systeme;
    const saturation = this.trafic.saturation.get('aeroport') ?? 0;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    const couleur = saturation > 0 ? ROUGE : '#3DBE7A';
    const [x, y] = projeter(a.ci, a.cj);
    const haut = 190;
    ctx.strokeStyle = this.nuit ? '#9AA3B5' : '#5B6272';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 22, y); ctx.lineTo(x, y - haut); ctx.lineTo(x + 22, y);
    for (let k = 1; k < 8; k++) {
      const z = (k / 8) * haut;
      const l = 22 * (1 - k / 8);
      ctx.moveTo(x - l, y - z); ctx.lineTo(x + l, y - z);
    }
    ctx.stroke();
    for (let k = 0; k < 4; k++) {
      const t = ((temps / (1800 - 1300 * activite)) + k / 4) % 1;
      ctx.strokeStyle = teinte(couleur, 0.8 * (1 - t));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y - haut, 10 + t * 70, 5 + t * 35, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = couleur;
    ctx.beginPath(); ctx.arc(x, y - haut, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.texte;
    ctx.font = `800 14px ${POLICE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('INTERNET', x, y - haut - 44);
    if (this.selection?.type === 'aeroport' || this.survol?.type === 'aeroport') this._anneau(x, y - haut / 2, 50, 110);
  }

  // Petite voiture en volume, orientée dans l'axe de sa rue ; rouge qui clignote dans un bouchon.
  _dessinerVoiture(v, q, temps) {
    const longueur = v.gabarit === 'camion' ? 0.5 : v.gabarit === 'camionnette' ? 0.4 : 0.32;
    const h = v.gabarit === 'camion' ? 9 : 6;
    const [si, sj] = Math.abs(q.di) >= Math.abs(q.dj) ? [longueur, 0.18] : [0.18, longueur];
    const fondu = Math.min(1, v.distance / 0.4, (v.longueurTotale - v.distance) / 0.4);
    if (fondu <= 0) return;
    this.ctx.globalAlpha = fondu;
    const couleur = v.bouchon && Math.sin(temps / 200) > 0 ? ROUGE : v.couleur;
    this._boite(q.i, q.j, si, sj, h, couleur);
    if (this.palette.lueur > 0.3) {
      // Phares la nuit
      const [x, y] = projeter(q.i + q.di * longueur / 2, q.j + q.dj * longueur / 2, 3);
      this.ctx.fillStyle = 'rgba(255,240,180,0.85)';
      this.ctx.beginPath(); this.ctx.arc(x, y, 1.8, 0, Math.PI * 2); this.ctx.fill();
    }
    this.ctx.globalAlpha = 1;
  }

  _anneau(x, y, rx, ry) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.nuit ? 'rgba(255,255,255,0.85)' : 'rgba(20,30,40,0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // Noms à taille fixe à l'écran : applications (de près ou survolées) au-dessus du toit, quartiers
  // au bord du boulevard.
  _dessinerEtiquettes() {
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    const zoom = this.camera.zoom;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.nuit ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';
    ctx.font = `600 11px ${POLICE}`;
    for (const lot of v.lots) {
      const mise = this.survol?.app === lot.app || this.selection?.app === lot.app;
      if (zoom < 1 && !mise) continue;
      const [x, y] = projeter(lot.ci, lot.cj, lot.hauteurAffichee + 4);
      const [sx, sy] = this.versEcran(x, y - (lot.s / 2) * TH);
      if (sx < -80 || sx > this.largeur + 80 || sy < -20 || sy > this.hauteur + 20) continue;
      const nom = tronquer(nomVisible(lot.app, this.discret), 20);
      ctx.strokeText(nom, sx, sy);
      ctx.fillStyle = mise ? p.texte : p.texteDoux;
      ctx.fillText(nom, sx, sy);
    }
    ctx.font = `800 12px ${POLICE}`;
    ctx.textBaseline = 'middle';
    for (const b of v.blocs) {
      const j = b.j0 > 0 ? b.j1 + 0.6 : b.j0 - 0.6;
      const [sx, sy] = this.versEcran(...projeter((b.i0 + b.i1) / 2, j));
      const nom = b.quartier.nom.toUpperCase();
      ctx.strokeText(nom, sx, sy);
      ctx.fillStyle = eclaircir(b.quartier.couleur, this.nuit ? 0.25 : -0.25);
      ctx.fillText(nom, sx, sy);
    }
  }
}

// ---------- Utilitaires ----------

function hacher(texte) {
  let h = 2166136261;
  for (let k = 0; k < texte.length; k++) h = Math.imul(h ^ texte.charCodeAt(k), 16777619);
  return h >>> 0;
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
