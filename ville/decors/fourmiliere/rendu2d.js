// Rendu Canvas 2D de la fourmilière, vue en coupe : ciel et herbe en haut, couches de terre, galeries,
// chambre de la reine (processeur), chambres des applications, réserves (disques), entrée (Internet)
// et fourmis porteuses (flux).

import { interpolerPalettes, momentDeLaJournee } from '../ville/rendu2d.js';
import { nomVisible, hacher, segmentPuits, REINE } from './modele.js';
import { GABARITS, ZONE_BOUCHON } from './trafic.js';

export { momentDeLaJournee };

export const PALETTES = {
  // Journée : ciel clair, terre ocre, galeries sableuses
  jour: {
    ciel: '#9FD6F2', cielBas: '#DDF1F8', astre: '#FFE07A', etoiles: 0,
    herbe: '#6DBE4B', herbeFoncee: '#4C9A35',
    terre1: '#B8895C', terre2: '#A47650', terre3: '#8F6345', terre4: '#7A5339',
    caillou: 'rgba(80,52,30,0.28)', racine: 'rgba(90,60,35,0.45)',
    galerie: '#E6CDA6', bord: '#6B472D', cavite: '#F2E0C2', trou: '#2A1A10',
    fourmi: '#2A1810', ferme: '#A39B90', texte: '#3B2717', texteDoux: 'rgba(59,39,23,0.72)',
    etiquette: 'rgba(255,248,236,0.93)', internet: '#2E8B4E', ram: '#3FA9F5', oeuf: '#FFF8EA',
    lueur: 0, obscurite: 0,
  },
  // Nuit : ciel étoilé, terre sombre, chambres actives qui luisent doucement
  nuit: {
    ciel: '#0D1530', cielBas: '#28325A', astre: '#E8ECF8', etoiles: 1,
    herbe: '#2D4C2B', herbeFoncee: '#1E3720',
    terre1: '#4C3625', terre2: '#412E1F', terre3: '#36261A', terre4: '#2C1F15',
    caillou: 'rgba(0,0,0,0.3)', racine: 'rgba(20,12,6,0.55)',
    galerie: '#6E5339', bord: '#1E140C', cavite: '#7E6145', trou: '#0B0705',
    fourmi: '#120A05', ferme: '#5E5A55', texte: '#F3E6D2', texteDoux: 'rgba(243,230,210,0.66)',
    etiquette: 'rgba(32,23,15,0.88)', internet: '#7EE29A', ram: '#5CC8FF', oeuf: '#F2E6D0',
    lueur: 1, obscurite: 1,
  },
};

// Jour de 9 h 30 à 17 h 30, nuit de 20 h à 7 h, transitions progressives entre les deux.
export function paletteDuMoment(minutes) {
  let t = 1;
  if (minutes >= 420 && minutes < 570) t = 1 - (minutes - 420) / 150;
  else if (minutes >= 570 && minutes < 1050) t = 0;
  else if (minutes >= 1050 && minutes < 1200) t = (minutes - 1050) / 150;
  if (t <= 0) return PALETTES.jour;
  if (t >= 1) return PALETTES.nuit;
  return interpolerPalettes(PALETTES.jour, PALETTES.nuit, t);
}

const DUREE_FONDU = 1200;
const POLICE = 'system-ui, "Segoe UI", sans-serif';
const ROUGE = '#E8504F';
const COUCHE = 170;   // épaisseur d'une couche de terre

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
    ctx.fillStyle = p.terre1;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    if (!v.bornes) return;

    const cible = this.trafic.suivi ? this.trafic.position(this.trafic.suivi) : null;
    if (cible) {
      this.camera.x += (cible.x - this.camera.x) * 0.15;
      this.camera.y += (cible.y - this.camera.y) * 0.15;
    }

    // Ciel, terre et galeries en image mémoire, refaits seulement si la vue change.
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
    this._dessinerBouchons(temps);
    this._dessinerEntree(temps);
    for (const e of v.entrepots ?? []) this._dessinerReserve(e, temps);
    this._dessinerReine(temps);
    for (const lot of v.lots) this._dessinerChambre(lot, temps);
    this._dessinerPorteuses(temps);
    const s = this.trafic.suivi;
    if (s?.app.lot) { const q = this.trafic.position(s); this._anneau(q.x, q.y, 11, 11); }
    ctx.restore();
    this._dessinerEtiquettes();
  }

  // Décor fixe : ciel, astre, herbe, couches de terre ondulées, cailloux, racines, monticule, galeries.
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
    ctx.translate(this.largeur / 2, this.hauteur / 2);
    ctx.scale(c.zoom, c.zoom);
    ctx.translate(-c.x, -c.y);
    const [x0, y0] = this.versMonde(0, 0);
    const [x1, y1] = this.versMonde(this.largeur, this.hauteur);

    // Ciel
    if (y0 < 0) {
      const g = ctx.createLinearGradient(0, b.y, 0, 0);
      g.addColorStop(0, p.ciel);
      g.addColorStop(1, p.cielBas);
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, x1 - x0, -y0 + 2);
      // Étoiles (la nuit) et astre : soleil le jour, lune la nuit
      if (p.etoiles > 0.02) {
        const alea = generateur(11);
        for (let i = 0; i < 260; i++) {
          const [sx, sy, e] = [b.x + alea() * b.l * 1.4 - b.l * 0.2, b.y - 400 + alea() * (400 - b.y - 40), alea()];
          if (sy > -50) continue;
          ctx.globalAlpha = p.etoiles * (0.3 + 0.6 * e);
          ctx.fillStyle = '#FFFFFF';
          const r = (0.7 + e) / Math.max(0.6, c.zoom);
          ctx.fillRect(sx, sy, r, r);
        }
        ctx.globalAlpha = 1;
      }
      const [ax, ay] = [b.x + b.l * 0.82, b.y + 40];
      const halo = ctx.createRadialGradient(ax, ay, 8, ax, ay, 90);
      halo.addColorStop(0, teinte(p.astre, 0.45));
      halo.addColorStop(1, teinte(p.astre, 0));
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(ax, ay, 90, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.astre;
      ctx.beginPath(); ctx.arc(ax, ay, 24, 0, Math.PI * 2); ctx.fill();
    }

    // Couches de terre, de plus en plus sombres en profondeur, bords ondulés
    const terres = [p.terre1, p.terre2, p.terre3, p.terre4];
    ctx.fillStyle = p.terre1;
    ctx.fillRect(x0, Math.max(0, y0), x1 - x0, y1 - Math.max(0, y0) + 2);
    const pas = Math.max(8, 20 / c.zoom);
    for (let k = 1; k * COUCHE - 20 < y1; k++) {
      const haut = k * COUCHE;
      if (haut + 30 < y0) continue;
      ctx.fillStyle = terres[Math.min(3, k)];
      ctx.beginPath();
      ctx.moveTo(x0 - pas, y1 + 10);
      for (let x = x0 - pas; x <= x1 + pas; x += pas) ctx.lineTo(x, haut + 10 * Math.sin(x / 110 + k * 1.7) + 6 * Math.sin(x / 37 + k));
      ctx.lineTo(x1 + pas, y1 + 10);
      ctx.closePath();
      ctx.fill();
      if (k >= 3) break;  // la dernière couche descend jusqu'en bas
    }

    // Cailloux et racines (tirage pseudo-aléatoire stable)
    const alea = generateur(23);
    ctx.fillStyle = p.caillou;
    for (let i = 0; i < 420; i++) {
      const [x, y, r] = [b.x - 300 + alea() * (b.l + 600), 24 + alea() * (b.y + b.h + 200), 2 + alea() * 6];
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, alea() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = p.racine;
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      let [x, y] = [b.x - 200 + alea() * (b.l + 400), 4];
      if (Math.abs(x) < 120) continue;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x, y);
      const n = 4 + Math.floor(alea() * 5);
      for (let j = 0; j < n; j++) { x += (alea() - 0.5) * 30; y += 10 + alea() * 14; ctx.lineTo(x, y); ctx.lineWidth = 2.5 - j * 0.3; }
      ctx.stroke();
    }

    // Herbe : bande verte et brins au-dessus de la surface
    ctx.fillStyle = p.herbeFoncee;
    ctx.fillRect(x0, -2, x1 - x0, 9);
    ctx.fillStyle = p.herbe;
    ctx.fillRect(x0, -2, x1 - x0, 4);
    if (c.zoom > 0.25) {
      ctx.strokeStyle = p.herbe;
      ctx.lineWidth = 1.6;
      for (let x = Math.floor(x0 / 7) * 7; x < x1; x += 7) {
        if (Math.abs(x) < 90) continue;  // le monticule
        const h = 6 + 9 * hacher('h', Math.round(x));
        const penche = (hacher('p', Math.round(x)) - 0.5) * 6;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x + penche * 0.3, -h * 0.6, x + penche, -h); ctx.stroke();
      }
    }

    // Monticule de l'entrée (Internet)
    ctx.fillStyle = p.terre1;
    ctx.beginPath(); ctx.ellipse(0, 2, 92, 40, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = p.bord;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 2, 92, 40, 0, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = p.caillou;
    for (let i = 0; i < 40; i++) {
      const a = Math.PI + (i / 40) * Math.PI;
      const r = 0.45 + 0.5 * hacher('m', i);
      ctx.beginPath(); ctx.arc(Math.cos(a) * 92 * r, 2 + Math.sin(a) * 40 * r, 1.5 + 2 * hacher('n', i), 0, Math.PI * 2); ctx.fill();
    }

    // Galeries : bord sombre partout, puis intérieur clair, pour des raccords nets
    const chemins = [
      segmentPuits(-30, v.yReserves),
      ...v.lots.map(lot => lot.chemin),
      ...(v.entrepots ?? []).map(e => e.chemin),
    ];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [couleur, epaisseur] of [[p.bord, 21], [p.galerie, 14]]) {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = epaisseur;
      for (const points of chemins) trace(ctx, points);
    }
    // Trou de l'entrée, au sommet du monticule
    ctx.fillStyle = p.trou;
    ctx.beginPath(); ctx.ellipse(0, -33, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Galeries vers une cible saturée : la fin du trajet rougit, en pulsant.
  _dessinerBouchons(temps) {
    const ctx = this.ctx;
    const v = this.ville;
    const sat = this.trafic.saturation;
    const pulse = 0.5 + 0.5 * Math.sin(temps / 250);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    const a = sat.get('aeroport') ?? 0;
    if (a > 0) {
      ctx.strokeStyle = teinte(ROUGE, (0.25 + 0.25 * pulse) * a);
      trace(ctx, [...segmentPuits(ZONE_BOUCHON, 0), [0, -28]]);
    }
    for (const e of v.entrepots ?? []) {
      const s = sat.get(`disque:${e.disque.id}`) ?? 0;
      if (s <= 0) continue;
      ctx.strokeStyle = teinte(ROUGE, (0.25 + 0.25 * pulse) * s);
      trace(ctx, [...segmentPuits(v.yReserves - ZONE_BOUCHON / 2, v.yReserves), ...e.chemin]);
    }
  }

  // Entrée (Internet) : halo vert qui grandit avec le réseau, rouge s'il sature.
  _dessinerEntree(temps) {
    const ctx = this.ctx;
    const s = this.ville.systeme;
    const saturation = this.trafic.saturation.get('aeroport') ?? 0;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    const couleur = saturation > 0 ? ROUGE : '#7EE29A';
    const r = 30 + 30 * activite + (saturation > 0 ? 8 * Math.sin(temps / 250) : 0);
    const g = ctx.createRadialGradient(0, -33, 4, 0, -33, Math.max(5, r));
    g.addColorStop(0, teinte(couleur, 0.25 + 0.35 * activite));
    g.addColorStop(1, teinte(couleur, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, -33, Math.max(5, r), 0, Math.PI * 2); ctx.fill();
    if (this.selection?.type === 'aeroport' || this.survol?.type === 'aeroport') this._anneau(0, -20, 96, 50);
  }

  // Réserve (un disque) : chambre remplie de graines jusqu'au niveau d'espace utilisé.
  _dessinerReserve(e, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = e.disque;
    const saturation = this.trafic.saturation.get(`disque:${d.id}`) ?? 0;
    const rempli = Math.min(1, d.utilise / d.total);
    if (saturation > 0) {
      ctx.fillStyle = teinte(ROUGE, 0.15 + 0.15 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)));
      ctx.beginPath(); ctx.ellipse(e.cx, e.cy, e.rx + 22, e.ry + 22, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = p.bord;
    ctx.beginPath(); ctx.ellipse(e.cx, e.cy, e.rx + 4, e.ry + 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.cavite;
    ctx.beginPath(); ctx.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2); ctx.fill();
    // Graines : tas qui monte avec le remplissage (rouge au-delà de 90 %)
    ctx.save();
    ctx.beginPath(); ctx.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2); ctx.clip();
    const niveau = e.cy + e.ry - rempli * 2 * e.ry;
    ctx.fillStyle = rempli > 0.9 ? '#D9785A' : e.toit;
    ctx.fillRect(e.cx - e.rx, niveau, 2 * e.rx, e.cy + e.ry - niveau);
    ctx.fillStyle = 'rgba(120,70,20,0.35)';
    for (let i = 0; i < 70; i++) {
      const [gx, gy] = [e.cx - e.rx + hacher(d.id, i) * 2 * e.rx, niveau + 3 + hacher(d.id, i + 300) * (e.cy + e.ry - niveau)];
      ctx.beginPath(); ctx.ellipse(gx, gy, 3, 2, hacher(d.id, i + 600) * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // Nom et remplissage sur une plaque
    ctx.fillStyle = p.etiquette;
    rectArrondi(ctx, e.cx - 42, e.cy + e.ry + 10, 84, 40, 10); ctx.fill();
    ctx.fillStyle = p.texte;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 18px ${POLICE}`;
    ctx.fillText(d.nom, e.cx, e.cy + e.ry + 24);
    ctx.font = `700 11px ${POLICE}`;
    ctx.fillText(`${Math.round(rempli * 100)} % plein`, e.cx, e.cy + e.ry + 41);
    if (this.selection?.entrepot?.disque.id === d.id || this.survol?.entrepot?.disque.id === d.id) {
      this._anneau(e.cx, e.cy, e.rx + 10, e.ry + 10);
    }
  }

  // Chambre de la reine (le processeur) : la reine pond d'autant plus que le CPU travaille ;
  // anneau de la RAM autour (bleu, rouge au-delà de 90 %).
  _dessinerReine(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const s = this.ville.systeme;
    if (!s) return;
    const { y } = this.ville.tour;
    const cpu = s.cpu / 100;
    const ram = s.ram_utilisee / s.ram_totale;
    const { rx, ry } = REINE;
    if (p.lueur > 0.05) {
      const g = ctx.createRadialGradient(0, y, 10, 0, y, rx * 1.6);
      g.addColorStop(0, `rgba(255,200,110,${0.3 * p.lueur * (0.4 + cpu)})`);
      g.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, y, rx * 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = p.bord;
    ctx.beginPath(); ctx.ellipse(0, y, rx + 5, ry + 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.cavite;
    ctx.beginPath(); ctx.ellipse(0, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    // Anneau de la RAM
    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(0, y, rx + 16, ry + 16, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = ram > 0.9 ? ROUGE : p.ram;
    ctx.beginPath(); ctx.ellipse(0, y, rx + 16, ry + 16, 0, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, ram) * Math.PI * 2); ctx.stroke();
    // Œufs : plus nombreux et plus agités quand le processeur travaille
    const oeufs = 6 + Math.round(cpu * 16);
    for (let i = 0; i < oeufs; i++) {
      const a = (i / oeufs) * Math.PI * 2 + 0.3;
      const tremble = Math.sin(temps / (300 - 200 * cpu) + i) * 1.5 * cpu;
      const [ox, oy] = [Math.cos(a) * rx * 0.78 + tremble, y + Math.sin(a) * ry * 0.7];
      ctx.fillStyle = p.oeuf;
      ctx.beginPath(); ctx.ellipse(ox, oy, 5, 3.4, a, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(120,90,50,0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    // La reine, au centre : abdomen énorme qui pulse au rythme du processeur
    const pulse = 1 + (0.03 + 0.08 * cpu) * Math.sin(temps / (500 - 380 * cpu));
    ctx.save();
    ctx.translate(-6, y + 4);
    dessinerFourmi(ctx, 88, p.fourmi, temps / (260 - 180 * cpu), 1.8 * pulse);
    ctx.restore();
    // Plaque : processeur et mémoire
    ctx.fillStyle = p.etiquette;
    rectArrondi(ctx, -80, y + ry + 28, 160, 58, 12); ctx.fill();
    ctx.fillStyle = p.texte;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 30px ${POLICE}`;
    ctx.fillText(`${Math.round(s.cpu)} %`, 0, y + ry + 49);
    ctx.font = `700 12px ${POLICE}`;
    ctx.fillText(`CPU · RAM ${Math.round(ram * 100)} %`, 0, y + ry + 74);
    if (this.selection?.type === 'tour' || this.survol?.type === 'tour') this._anneau(0, y, rx + 26, ry + 26);
  }

  // Une chambre par application : taille selon la RAM, alvéoles autour (ses processus), fourmis
  // qui s'activent selon le CPU ; pâle avec des « z » en veille, grise et éboulée une fois fermée,
  // contour rouge qui pulse si elle sature le CPU ou la RAM.
  _dessinerChambre(lot, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = lot.app.donnees;
    const q = lot.quartier;
    const ferme = d.etat === 'ferme';
    const veille = d.etat === 'veille';
    const { cx, cy, rx, ry } = lot;
    const cpu = Math.min(1, d.cpu / 25);
    if (!ferme && !veille && p.lueur > 0.05 && cpu > 0.02) {
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, rx * 2);
      g.addColorStop(0, teinte(q.couleur, 0.35 * p.lueur * (0.3 + cpu)));
      g.addColorStop(1, teinte(q.couleur, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, rx * 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = veille ? 0.55 : 1;
    // Alvéoles des processus (au-delà du premier), réparties autour de la chambre
    const alveoles = ferme ? 0 : Math.min(12, Math.max(0, (d.nb_processus ?? 1) - 1));
    for (let k = 0; k < alveoles; k++) {
      const a = -Math.PI * 0.85 + (k / 12) * Math.PI * 2 + hacher(lot.app.id, 1) * 0.5;
      const [ax, ay] = [cx + Math.cos(a) * (rx + 9), cy + Math.sin(a) * (ry + 8)];
      ctx.fillStyle = p.bord;
      ctx.beginPath(); ctx.arc(ax, ay, 5.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = eclaircir(q.couleur, 0.35);
      ctx.beginPath(); ctx.arc(ax, ay, 3.6, 0, Math.PI * 2); ctx.fill();
    }
    // Cavité creusée, bordée de la couleur du quartier
    ctx.fillStyle = p.bord;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx + 4, ry + 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ferme ? p.ferme : melanger(p.cavite, q.couleur, 0.22);
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ferme ? eclaircir(p.ferme, -0.2) : q.couleur;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (ferme) {
      // Éboulis : pierres grises tombées au fond de la chambre
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
      for (let i = 0; i < 9; i++) {
        const [px, py] = [cx - rx + hacher(lot.app.id, i) * 2 * rx, cy + ry * (0.1 + 0.8 * hacher(lot.app.id, i + 50))];
        const r = 4 + 5 * hacher(lot.app.id, i + 90);
        ctx.fillStyle = i % 2 ? '#8A837A' : '#77706A';
        ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.75, i, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    } else if (veille) {
      // Une fourmi endormie et ses « z »
      ctx.save();
      ctx.translate(cx, cy + ry * 0.3);
      dessinerFourmi(ctx, 11, p.fourmi, 0, 1);
      ctx.restore();
      ctx.fillStyle = p.texte;
      ctx.font = `700 9px ${POLICE}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 2; i++) {
        const t = ((temps / 1600) + i / 2) % 1;
        ctx.globalAlpha = 0.55 * (1 - t);
        ctx.fillText('z', cx + 6 + t * 10, cy - t * 18);
      }
    } else {
      // Fourmis au travail : plus nombreuses et plus rapides avec le processeur
      const n = 1 + Math.min(3, Math.floor(d.cpu / 4));
      for (let i = 0; i < n; i++) {
        const a = hacher(lot.app.id, i + 7) * 6.28 + (temps / 1000) * (0.4 + 2.2 * cpu) * (i % 2 ? -1 : 1);
        const [fx, fy] = [cx + Math.cos(a) * rx * 0.55, cy + Math.sin(a) * ry * 0.5];
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(a + (i % 2 ? -Math.PI / 2 : Math.PI / 2));
        dessinerFourmi(ctx, 10, p.fourmi, temps / (120 - 70 * cpu) + i, 1);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (d.alerte) {
      ctx.strokeStyle = teinte(ROUGE, 0.55 + 0.4 * Math.sin(temps / 180));
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx + 7, ry + 7, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.selection?.app === lot.app || this.survol?.app === lot.app) this._anneau(cx, cy, rx + 12, ry + 12);
  }

  // Fourmis porteuses : ouvrière (petite charge), soldat (grosse tête, charge plus lourde),
  // porteuse de feuille (grande feuille colorée). Rouge clignotant dans un embouteillage.
  _dessinerPorteuses(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const t = this.trafic;
    for (const v of t.vehicules) {
      if (!v.app.lot || v.s <= 0) continue;
      const q = t.position(v);
      const L = t.route(v).longueur;
      const fondu = Math.min(1, (v.s * L) / 20, ((1 - v.s) * L) / 20);
      const l = GABARITS[v.gabarit].longueur;
      const couleur = v.bouchon ? melanger(v.couleur, ROUGE, 0.5 + 0.5 * Math.sin(temps / 200)) : v.couleur;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fondu);
      ctx.translate(q.x, q.y);
      ctx.rotate(q.angle);
      const pas = v.bouchon ? temps / 160 : temps / 45 + v.id;
      dessinerFourmi(ctx, l, p.fourmi, pas, 1, v.gabarit === 'camionnette' ? 1.5 : 1);
      if (v.gabarit === 'camion') {
        // Feuille tenue au-dessus du corps
        ctx.fillStyle = couleur;
        ctx.beginPath(); ctx.ellipse(l * 0.15, 0, l * 0.55, l * 0.32, -0.25, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-l * 0.35, l * 0.12); ctx.lineTo(l * 0.65, -l * 0.12); ctx.stroke();
      } else {
        const r = v.gabarit === 'camionnette' ? l * 0.26 : l * 0.22;
        ctx.fillStyle = couleur;
        ctx.beginPath(); ctx.arc(l * 0.62 + r * 0.6, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _anneau(x, y, rx, ry) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.nuit ? 'rgba(255,255,255,0.85)' : 'rgba(40,25,12,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // Noms à taille fixe à l'écran : quartiers toujours, chambres de près ou survolées, entrée.
  _dessinerEtiquettes() {
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    const zoom = this.camera.zoom;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `600 11px ${POLICE}`;
    for (const lot of v.lots) {
      const mise = this.survol?.app === lot.app || this.selection?.app === lot.app;
      if (zoom < 1.1 && !mise) continue;
      const [sx, sy] = this.versEcran(lot.cx, lot.cy + lot.ry + 8);
      if (sx < -80 || sx > this.largeur + 80 || sy < -20 || sy > this.hauteur + 20) continue;
      const nom = tronquer(nomVisible(lot.app, this.discret), 18);
      const l = ctx.measureText(nom).width + 10;
      ctx.fillStyle = p.etiquette;
      rectArrondi(ctx, sx - l / 2, sy - 1, l, 15, 6); ctx.fill();
      ctx.fillStyle = mise ? p.texte : p.texteDoux;
      ctx.fillText(nom, sx, sy + 1);
    }
    // Nom de chaque aile, en haut de l'aile, avec la pastille de sa couleur
    ctx.font = `800 11px ${POLICE}`;
    ctx.textBaseline = 'middle';
    for (const q of v.ailes ?? []) {
      if (!q.apps.some(Boolean)) continue;
      const [sx, sy] = this.versEcran(q.bloc.x + q.bloc.l / 2, q.bloc.y + 12);
      const texte = q.nom.toUpperCase();
      const l = ctx.measureText(texte).width + 30;
      ctx.fillStyle = p.etiquette;
      rectArrondi(ctx, sx - l / 2, sy - 10, l, 20, 10); ctx.fill();
      ctx.fillStyle = q.couleur;
      ctx.beginPath(); ctx.arc(sx - l / 2 + 11, sy, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.texte;
      ctx.fillText(texte, sx + 7, sy + 0.5);
    }
    const [ax, ay] = this.versEcran(0, -44);
    ctx.font = `800 12px ${POLICE}`;
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.etiquette;
    ctx.strokeText('INTERNET', ax, ay);
    ctx.fillStyle = p.internet;
    ctx.fillText('INTERNET', ax, ay);
  }
}

// ---------- Fourmi ----------

// Fourmi vue de dessus, tête vers +x, centrée sur le thorax : abdomen, thorax, tête, six pattes qui
// battent en trépied (pas : phase de la marche), antennes. « abdomen » grossit l'abdomen (la reine),
// « tete » la tête (le soldat).
function dessinerFourmi(ctx, l, couleur, pas, abdomen = 1, tete = 1) {
  ctx.strokeStyle = couleur;
  ctx.fillStyle = couleur;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.7, l * 0.06);
  for (let k = -1; k <= 1; k++) {
    for (const s of [-1, 1]) {
      const bat = Math.sin(pas + (k + (s > 0 ? 1 : 0)) * Math.PI) * l * 0.09;
      ctx.beginPath();
      ctx.moveTo(k * l * 0.06, 0);
      ctx.lineTo(k * l * 0.14 + bat * 0.5, s * l * 0.2);
      ctx.lineTo(k * l * 0.26 + bat, s * l * 0.34);
      ctx.stroke();
    }
  }
  const t = l * 0.12 * tete;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(l * 0.24 + t * 0.6, s * t * 0.3);
    ctx.quadraticCurveTo(l * 0.42 + t, s * l * 0.12, l * 0.5 + t, s * l * 0.2);
    ctx.stroke();
  }
  ctx.beginPath(); ctx.ellipse(-l * 0.13 - l * 0.24 * abdomen * 0.6, 0, l * 0.24 * abdomen, l * 0.15 * Math.sqrt(abdomen), 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, 0, l * 0.13, l * 0.075, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(l * 0.17 + t * 0.5, 0, t, t * 0.85, 0, 0, Math.PI * 2); ctx.fill();
  if (abdomen > 1.2) {
    // Rayures de l'abdomen de la reine
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = l * 0.02;
    const cx = -l * 0.13 - l * 0.24 * abdomen * 0.6;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.ellipse(cx + i * l * 0.07 * abdomen, 0, l * 0.02, l * 0.13 * Math.sqrt(abdomen), 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

// ---------- Utilitaires ----------

function trace(ctx, points) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
}

function generateur(graine) {
  return () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
}

function rectArrondi(ctx, x, y, l, h, r) {
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
