// Rendu Canvas 2D du système solaire : ciel étoilé, Soleil (processeur), planètes (quartiers),
// lunes (applications), stations spatiales (disques), trou de ver (Internet), vaisseaux (flux).

import { interpolerPalettes, momentDeLaJournee } from '../ville/rendu2d.js';
import { nomVisible, R_SOLEIL, INCLINAISON, ENTRE_ANNEAUX } from './modele.js';
import { GABARITS } from './trafic.js';

export { momentDeLaJournee };

export const PALETTES = {
  // Journée : bleu nuit profond, nébuleuse claire
  jour: {
    fond: '#0B1534', nebuleuse: 'rgba(120,90,220,0.10)', etoile: '#FFFFFF', orbite: 'rgba(150,180,255,0.16)',
    texte: '#F1F4FF', texteDoux: 'rgba(241,244,255,0.6)', ferme: '#6B6F80', soleil: '#FFC34D',
    ram: '#5CC8FF', obscurite: 0.75,
  },
  // Nuit : espace noir
  nuit: {
    fond: '#02030A', nebuleuse: 'rgba(80,60,180,0.08)', etoile: '#DDE6FF', orbite: 'rgba(150,180,255,0.11)',
    texte: '#E9EEFF', texteDoux: 'rgba(233,238,255,0.55)', ferme: '#4E5262', soleil: '#FFB13B',
    ram: '#5CC8FF', obscurite: 1,
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
    this.palette = PALETTES.nuit;
    this.nuit = true;
    this._etoiles = null;
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
    v.animer(temps);

    // Suivi : d'un vaisseau, ou de la lune sélectionnée (elle tourne).
    const cible = this.trafic.suivi ? this.trafic.position(this.trafic.suivi) : null;
    if (cible) {
      this.camera.x += (cible.x - this.camera.x) * 0.15;
      this.camera.y += (cible.y - this.camera.y) * 0.15;
    }

    // Ciel et orbites en image mémoire, refaits seulement si la vue change.
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
    this._dessinerTrouDeVer(temps);
    for (const e of v.entrepots ?? []) this._dessinerStation(e, temps);
    this._dessinerSoleil(temps);
    // Lunes de la moitié arrière, cachées par leur planète, puis planètes, puis lunes de devant.
    for (const lot of v.lots) if (!lot.devant) this._dessinerLune(lot, temps);
    for (const q of v.planetes) this._dessinerPlanete(q);
    for (const lot of v.lots) if (lot.devant) this._dessinerLune(lot, temps);
    this._dessinerVaisseaux(temps);
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
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = p.fond;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    ctx.translate(this.largeur / 2, this.hauteur / 2);
    ctx.scale(c.zoom, c.zoom);
    ctx.translate(-c.x, -c.y);

    // Nébuleuses : quelques grandes taches colorées très douces
    const b = v.bornes;
    for (const [fx, fy, fr, teinteN] of [[-0.3, -0.25, 0.5, p.nebuleuse], [0.35, 0.3, 0.45, 'rgba(60,140,200,0.07)']]) {
      const [x, y, r] = [fx * b.l, fy * b.h, fr * b.l];
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, teinteN);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    // Étoiles fixes (toujours les mêmes : tirage pseudo-aléatoire stable)
    if (!this._etoiles || this._etoilesPour !== b.l) {
      let graine = 7;
      const alea = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
      this._etoiles = Array.from({ length: 700 }, () => [(alea() - 0.5) * b.l * 1.6, (alea() - 0.5) * b.h * 1.6, alea()]);
      this._etoilesPour = b.l;
    }
    for (const [x, y, e] of this._etoiles) {
      ctx.globalAlpha = 0.25 + 0.6 * e;
      ctx.fillStyle = p.etoile;
      const r = (0.6 + e * 1.1) / Math.max(0.6, c.zoom);
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
    ctx.globalAlpha = 1;
    // Orbites des planètes
    ctx.strokeStyle = p.orbite;
    ctx.lineWidth = 1.2 / c.zoom;
    ctx.setLineDash([6 / c.zoom, 6 / c.zoom]);
    for (const q of v.planetes) { ctx.beginPath(); ctx.ellipse(0, 0, q.orbite, q.orbite * INCLINAISON, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  // Le Soleil : plus le processeur travaille, plus il grossit, brille et lance des éruptions.
  // Autour, l'anneau de la RAM (bleu, rouge au-delà de 90 %).
  _dessinerSoleil(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const s = this.ville.systeme;
    if (!s) return;
    const cpu = s.cpu / 100;
    const ram = s.ram_utilisee / s.ram_totale;
    const R = R_SOLEIL * (0.85 + 0.25 * cpu);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R * (2.2 + 1.2 * cpu));
    halo.addColorStop(0, teinte(p.soleil, 0.45 + 0.3 * cpu));
    halo.addColorStop(1, teinte(p.soleil, 0));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, R * (2.2 + 1.2 * cpu), 0, Math.PI * 2); ctx.fill();
    // Éruptions : langues de feu qui tournent lentement, plus longues avec le processeur
    ctx.rotate(temps / 9000);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const l = R * (0.15 + cpu * (0.3 + 0.3 * Math.sin(temps / 300 + i * 2.1)));
      ctx.fillStyle = teinte(p.soleil, 0.35);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.12) * R * 0.95, Math.sin(a - 0.12) * R * 0.95);
      ctx.lineTo(Math.cos(a) * (R + l), Math.sin(a) * (R + l));
      ctx.lineTo(Math.cos(a + 0.12) * R * 0.95, Math.sin(a + 0.12) * R * 0.95);
      ctx.fill();
    }
    ctx.restore();
    const corps = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
    corps.addColorStop(0, '#FFF6C8');
    corps.addColorStop(0.6, p.soleil);
    corps.addColorStop(1, '#F07A1A');
    ctx.fillStyle = corps;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    // Anneau de la RAM
    const rr = R_SOLEIL * 1.25 + 14;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = ram > 0.9 ? ROUGE : p.ram;
    ctx.beginPath(); ctx.arc(0, 0, rr, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, ram) * Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#5A2A00';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(R * 0.42)}px ${POLICE}`;
    ctx.fillText(`${Math.round(s.cpu)} %`, 0, -3);
    ctx.font = `700 ${Math.round(R * 0.16)}px ${POLICE}`;
    ctx.fillText(`CPU · RAM ${Math.round(ram * 100)} %`, 0, R * 0.32);
    if (this.selection?.type === 'tour' || this.survol?.type === 'tour') this._anneau(0, 0, rr + 10);
  }

  _dessinerPlanete(q) {
    const ctx = this.ctx;
    const p = this.palette;
    // Anneaux où tournent les lunes
    ctx.strokeStyle = teinte(q.couleur, 0.13);
    ctx.lineWidth = 1;
    for (let j = 0; j < q.anneaux; j++) {
      const r = q.premierAnneau + j * ENTRE_ANNEAUX;
      ctx.beginPath(); ctx.ellipse(q.x, q.y, r, r * INCLINAISON, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const r = q.rayonPlanete;
    // Face éclairée tournée vers le Soleil
    const n = Math.hypot(q.x, q.y) || 1;
    const [lx, ly] = [q.x - (q.x / n) * r * 0.5, q.y - (q.y / n) * r * 0.5];
    const g = ctx.createRadialGradient(lx, ly, r * 0.1, q.x, q.y, r);
    g.addColorStop(0, eclaircir(q.couleur, 0.45));
    g.addColorStop(0.7, q.couleur);
    g.addColorStop(1, eclaircir(q.couleur, -0.55));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
    // Les gros quartiers ont un anneau, comme Saturne
    if (q.apps.length >= 8) {
      ctx.strokeStyle = teinte(eclaircir(q.couleur, 0.3), 0.55);
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(q.x, q.y, r * 1.7, r * 0.5, -0.4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = p.texte;
  }

  // Une lune par application : taille selon la RAM, lueur selon le processeur ; pâle en veille,
  // petit caillou gris une fois fermée ; anneau rouge qui pulse si elle sature le CPU ou la RAM.
  _dessinerLune(lot, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = lot.app.donnees;
    const ferme = d.etat === 'ferme';
    const veille = d.etat === 'veille';
    const r = ferme ? Math.max(2.5, lot.taille * 0.55) : lot.taille;
    const couleur = ferme ? p.ferme : eclaircir(lot.quartier.couleur, 0.25);
    const cpu = Math.min(1, d.cpu / 25);
    if (!ferme && cpu > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = teinte(couleur, 0.12 + 0.25 * cpu);
      ctx.beginPath(); ctx.arc(lot.cx, lot.cy, r * (1.8 + cpu), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = veille ? 0.45 : 1;
    const n = Math.hypot(lot.cx, lot.cy) || 1;
    const g = ctx.createRadialGradient(lot.cx - (lot.cx / n) * r * 0.5, lot.cy - (lot.cy / n) * r * 0.5, r * 0.1, lot.cx, lot.cy, r);
    g.addColorStop(0, eclaircir(couleur, 0.5));
    g.addColorStop(1, eclaircir(couleur, -0.45));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(lot.cx, lot.cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    if (d.alerte) {
      ctx.strokeStyle = teinte(ROUGE, 0.5 + 0.4 * Math.sin(temps / 180));
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(lot.cx, lot.cy, r + 5, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.selection?.app === lot.app || this.survol?.app === lot.app) this._anneau(lot.cx, lot.cy, r + 7);
  }

  // Station spatiale (un disque) : module central qui tourne lentement, panneaux solaires,
  // jauge de remplissage ; halo rouge s'il sature.
  _dessinerStation(e, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = e.disque;
    const saturation = this.trafic.saturation.get(`disque:${d.id}`) ?? 0;
    ctx.save();
    ctx.translate(e.cx, e.cy);
    if (saturation > 0) {
      ctx.fillStyle = teinte(ROUGE, 0.12 + 0.15 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)));
      ctx.beginPath(); ctx.arc(0, 0, 70, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.rotate(temps / 12000);
    ctx.fillStyle = '#2C3550';
    for (const s of [-1, 1]) {
      ctx.fillRect(s * 22, -3, s * 24, 6);
      ctx.fillStyle = '#3F6FB5';
      ctx.fillRect(s > 0 ? 46 : -70, -14, 24, 28);
      ctx.strokeStyle = 'rgba(160,200,255,0.5)';
      ctx.lineWidth = 0.8;
      for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo((s > 0 ? 46 : -70) + k * 6, -14); ctx.lineTo((s > 0 ? 46 : -70) + k * 6, 14); ctx.stroke(); }
      ctx.fillStyle = '#2C3550';
    }
    ctx.restore();
    ctx.fillStyle = '#D6DEEE';
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill();
    const rempli = d.utilise / d.total;
    ctx.strokeStyle = rempli > 0.9 ? ROUGE : e.toit;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 29, -Math.PI / 2, -Math.PI / 2 + rempli * Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#26304A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 13px ${POLICE}`;
    ctx.fillText(d.nom, 0, -3);
    ctx.font = `700 7px ${POLICE}`;
    ctx.fillText(`${Math.round(rempli * 100)} %`, 0, 9);
    ctx.restore();
    if (this.selection?.entrepot?.disque.id === d.id || this.survol?.entrepot?.disque.id === d.id) this._anneau(e.cx, e.cy, 40);
    ctx.fillStyle = p.texteDoux;
  }

  // Trou de ver (Internet) : spirale qui tourne, plus vite quand le réseau travaille.
  _dessinerTrouDeVer(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const a = this.ville.aeroport;
    const s = this.ville.systeme;
    const saturation = this.trafic.saturation.get('aeroport') ?? 0;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    const couleur = saturation > 0 ? ROUGE : '#8CF29B';
    ctx.save();
    ctx.translate(a.cx, a.cy);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, a.rayon * 1.3);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.35, teinte(couleur, 0.35 + 0.3 * activite));
    g.addColorStop(1, teinte(couleur, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, a.rayon * 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(-temps / (2600 - 2000 * activite));
    ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.strokeStyle = teinte(couleur, 0.55);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const r = a.rayon * (0.15 + 0.85 * t);
        const ang = t * 2.4;
        if (i) ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r); else ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
      }
      ctx.stroke();
    }
    ctx.restore();
    if (this.selection?.type === 'aeroport' || this.survol?.type === 'aeroport') this._anneau(a.cx, a.cy, a.rayon + 8);
  }

  // Vaisseaux : triangle orienté dans le sens du vol, flamme du réacteur qui vacille, courte traînée.
  _dessinerVaisseaux(temps) {
    const ctx = this.ctx;
    const t = this.trafic;
    for (const v of t.vehicules) {
      if (!v.app.lot || v.s <= 0) continue;
      const q = t.position(v);
      const fondu = Math.min(1, v.s / 0.06, (1 - v.s) / 0.06);
      const l = GABARITS[v.gabarit].longueur;
      const couleur = v.bouchon ? melanger(v.couleur, ROUGE, 0.5 + 0.5 * Math.sin(temps / 200)) : v.couleur;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fondu);
      ctx.translate(q.x, q.y);
      ctx.rotate(q.angle);
      ctx.fillStyle = teinte(couleur, 0.25);
      ctx.fillRect(-l * 2.6, -0.8, l * 2, 1.6);
      const flamme = l * (0.5 + 0.3 * Math.sin(temps / 40 + v.id));
      ctx.fillStyle = '#FFE08A';
      ctx.beginPath(); ctx.moveTo(-l / 2, -l * 0.18); ctx.lineTo(-l / 2 - flamme, 0); ctx.lineTo(-l / 2, l * 0.18); ctx.fill();
      ctx.fillStyle = couleur;
      ctx.beginPath(); ctx.moveTo(l / 2, 0); ctx.lineTo(-l / 2, -l * 0.38); ctx.lineTo(-l * 0.3, 0); ctx.lineTo(-l / 2, l * 0.38); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
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

  // Noms à taille fixe à l'écran : planètes toujours, lunes de près ou survolées.
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
    ctx.strokeStyle = p.fond;
    for (const lot of v.lots) {
      const mise = this.survol?.app === lot.app || this.selection?.app === lot.app;
      if (zoom < 1.1 && !mise) continue;
      const [sx, sy] = this.versEcran(lot.cx, lot.cy + lot.taille + 2);
      if (sx < -80 || sx > this.largeur + 80 || sy < -20 || sy > this.hauteur + 20) continue;
      const nom = tronquer(nomVisible(lot.app, this.discret), 20);
      ctx.strokeText(nom, sx, sy);
      ctx.fillStyle = mise ? p.texte : p.texteDoux;
      ctx.fillText(nom, sx, sy);
    }
    ctx.font = `800 12px ${POLICE}`;
    const a = v.aeroport;
    const [ax, ay] = this.versEcran(a.cx, a.cy - a.rayon * 1.3);
    ctx.textBaseline = 'bottom';
    ctx.strokeText('INTERNET', ax, ay);
    ctx.fillStyle = '#8CF29B';
    ctx.fillText('INTERNET', ax, ay);
    ctx.textBaseline = 'top';
    for (const q of v.planetes) {
      const [sx, sy] = this.versEcran(q.x, q.y + q.rayonPlanete + 4);
      ctx.strokeText(q.nom.toUpperCase(), sx, sy + 2);
      ctx.fillStyle = eclaircir(q.couleur, 0.35);
      ctx.fillText(q.nom.toUpperCase(), sx, sy + 2);
    }
  }
}

// ---------- Utilitaires ----------

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
