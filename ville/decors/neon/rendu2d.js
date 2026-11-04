// Rendu Canvas 2D de la ville néon : fond sombre quadrillé, routes et bâtiments qui luisent,
// traînées de lumière pour les flux. Les lueurs sont faites de traits superposés en mode « lighter »
// (pas de flou, trop coûteux pour le PC).

import { interpolerPalettes, momentDeLaJournee, rectArrondi } from '../ville/rendu2d.js';
import { nomVisible, arc } from './modele.js';
import { GABARITS, TRAINEE } from './trafic.js';

export { momentDeLaJournee };

// « obscurite » > 0,5 : l'interface passe en sombre (toujours le cas ici, c'est une ville de nuit).
export const PALETTES = {
  // Journée : crépuscule violet façon synthwave
  jour: {
    fond: '#17112E', grille: 'rgba(170,110,255,0.10)', route: '#2B2252', lueur: '#B07CFF',
    texte: '#F4EEFF', texteDoux: 'rgba(244,238,255,0.6)', ferme: '#4D4766', coeur: '#FF9F43',
    ram: '#29E6FF', obscurite: 0.7,
  },
  // Nuit : noir profond, lueurs cyan
  nuit: {
    fond: '#04060E', grille: 'rgba(0,210,255,0.08)', route: '#121834', lueur: '#00D9FF',
    texte: '#E6FBFF', texteDoux: 'rgba(230,251,255,0.55)', ferme: '#2F3347', coeur: '#FF9F43',
    ram: '#29E6FF', obscurite: 1,
  },
};

// Jour de 8 h à 19 h, nuit de 20 h à 7 h, une heure de transition entre les deux.
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
const ROUGE = '#FF3B5C';

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
    // La barre du haut cache environ 110 px : la ville est centrée dans l'espace qui reste.
    this.camera.zoom = Math.min((this.largeur - 40) / b.l, (this.hauteur - 130) / b.h, 1.4);
    this.camera.x = b.x + b.l / 2;
    this.camera.y = b.y + b.h / 2 - 50 / this.camera.zoom;
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
    this._avancerFondu();
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = p.fond;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    if (!v.bornes) return;

    if (this.trafic.suivi) {
      const pos = this.trafic.position(this.trafic.suivi);
      this.camera.x += (pos.x - this.camera.x) * 0.15;
      this.camera.y += (pos.y - this.camera.y) * 0.15;
    }

    // Décor fixe (grille, secteurs, routes) en image mémoire, refaite seulement si la vue change.
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
    this._dessinerImpulsions();
    this._dessinerTrainees(temps);
    this._dessinerCoeur(temps);
    this._dessinerPortail(temps);
    for (const e of v.entrepots ?? []) this._dessinerCoffre(e, temps);
    for (const lot of v.lots) this._dessinerBloc(lot, temps);
    this._dessinerSuivi(temps);
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

    // Grille au sol, sur la partie visible
    const [x0, y0] = this.versMonde(0, 0);
    const [x1, y1] = this.versMonde(this.largeur, this.hauteur);
    const pas = 50;
    ctx.strokeStyle = p.grille;
    ctx.lineWidth = 1 / c.zoom;
    ctx.beginPath();
    for (let x = Math.floor(x0 / pas) * pas; x <= x1; x += pas) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.floor(y0 / pas) * pas; y <= y1; y += pas) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();

    // Secteurs des quartiers : sol légèrement teinté entre l'anneau intérieur et le périphérique
    for (const s of v.secteurs) {
      ctx.beginPath();
      ctx.arc(0, 0, v.rExterieur - 14, s.de + 0.02, s.a - 0.02);
      ctx.arc(0, 0, v.rInterieur + 14, s.a - 0.02, s.de + 0.02, true);
      ctx.closePath();
      ctx.fillStyle = teinte(s.quartier.couleur, 0.07);
      ctx.fill();
      ctx.strokeStyle = teinte(s.quartier.couleur, 0.22);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Routes : chaussée sombre, puis lueur et filet lumineux
    const routes = [];
    const cercle = r => { const pts = []; for (let i = 0; i <= 96; i++) { const a = (i / 96) * 2 * Math.PI; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } return pts; };
    routes.push({ points: cercle(v.rInterieur), largeur: 16 });
    routes.push({ points: cercle(v.rExterieur), largeur: 18 });
    for (const a of v.avenues) routes.push({ points: [a.de, a.a], largeur: 14 });
    for (const e of v.entrepots) routes.push({ points: [e.bretelle, [e.cx, e.cy]], largeur: 14 });
    routes.push({ points: [v.aeroport.bretelle, [v.aeroport.cx, v.aeroport.cy]], largeur: 14 });
    for (const rue of v.rues) routes.push({ points: arc(rue.r, rue.de, rue.a), largeur: 8 });
    for (const lot of v.lots) routes.push({ points: [[lot.cx, lot.cy], lot.acces], largeur: 4 });
    const tracer = (pts, largeur, couleur) => {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = largeur;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of routes) tracer(r.points, r.largeur, p.route);
    ctx.globalCompositeOperation = 'lighter';
    for (const r of routes) {
      tracer(r.points, r.largeur + 6, teinte(p.lueur, 0.05));
      for (const bord of [r.largeur / 2, -r.largeur / 2]) {
        if (r.largeur < 10) continue;
        tracer(decalerLigne(r.points, bord), 1.2, teinte(p.lueur, 0.55));
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Cœur du processeur : réacteur au centre, anneau du CPU (orange) et de la RAM (cyan).
  _dessinerCoeur(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const s = this.ville.systeme;
    if (!s) return;
    const cpu = s.cpu / 100;
    const ram = s.ram_utilisee / s.ram_totale;
    const R = this.ville.tour.rayon;
    const battement = 0.5 + 0.5 * Math.sin(temps / (500 - 300 * cpu));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 4; i >= 1; i--) {
      ctx.fillStyle = teinte(p.coeur, (0.03 + 0.05 * cpu) * (0.6 + 0.4 * battement));
      ctx.beginPath(); ctx.arc(0, 0, R * (0.4 + i * 0.18), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = p.fond;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.62, 0, Math.PI * 2); ctx.fill();
    const anneau = (r, part, couleur, largeur) => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = teinte(couleur, 0.18);
      ctx.lineWidth = largeur;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [l, a] of [[largeur + 6, 0.18], [largeur, 0.95]]) {
        ctx.strokeStyle = teinte(couleur, a);
        ctx.lineWidth = l;
        ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, part) * Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    };
    anneau(R * 0.95, cpu, p.coeur, 6);
    anneau(R * 0.75, ram, ram > 0.9 ? ROUGE : p.ram, 4);
    // Noyau qui tourne, plus vite quand le processeur travaille
    ctx.save();
    ctx.rotate(temps / (1400 - 1100 * cpu));
    ctx.strokeStyle = teinte(p.coeur, 0.7);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.4, 0, 1.2); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = p.texte;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 20px ${POLICE}`;
    ctx.fillText(`${Math.round(s.cpu)} %`, 0, -4);
    ctx.font = `600 8px ${POLICE}`;
    ctx.fillStyle = p.texteDoux;
    ctx.fillText(`CPU · RAM ${Math.round(ram * 100)} %`, 0, 13);
    if (this.selection?.type === 'tour' || this.survol?.type === 'tour') this._anneauSelection(0, 0, R + 10);
  }

  // Impulsions du processeur, de l'application vers le cœur, le long de l'avenue.
  _dessinerImpulsions() {
    const ctx = this.ctx;
    const v = this.ville;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const i of this.trafic.impulsions) {
      const { acces, angle } = i.lot;
      const fin = [Math.cos(angle) * v.tour.rayon, Math.sin(angle) * v.tour.rayon];
      const [x, y] = [acces[0] + (fin[0] - acces[0]) * i.t, acces[1] + (fin[1] - acces[1]) * i.t];
      const a = Math.sin(Math.PI * i.t);
      ctx.fillStyle = teinte(i.couleur, 0.25 * a);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = teinte(i.couleur, 0.9 * a);
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Traînées de lumière des flux disque et réseau.
  _dessinerTrainees(temps) {
    const ctx = this.ctx;
    const t = this.trafic;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const v of t.vehicules) {
      const longueur = TRAINEE[v.gabarit];
      const debut = Math.max(0, v.distance - longueur);
      if (v.distance <= 0) continue;
      const points = [];
      for (let d = debut; d < v.distance; d += 6) { const q = t.position(v, d); points.push([q.x, q.y]); }
      const tete = t.position(v);
      points.push([tete.x, tete.y]);
      // Apparition et disparition en fondu aux bouts du trajet
      const fondu = Math.min(1, v.distance / 30, (v.longueurTotale - v.distance) / 30);
      const couleur = v.bouchon ? melanger(v.couleur, ROUGE, 0.5 + 0.5 * Math.sin(temps / 200)) : v.couleur;
      const largeur = GABARITS[v.gabarit].largeur;
      ctx.strokeStyle = teinte(couleur, 0.16 * fondu);
      ctx.lineWidth = largeur * 3.5;
      trace(ctx, points);
      ctx.strokeStyle = teinte(couleur, 0.85 * fondu);
      ctx.lineWidth = largeur;
      trace(ctx, points);
      ctx.fillStyle = `rgba(255,255,255,${0.9 * fondu})`;
      ctx.beginPath(); ctx.arc(tete.x, tete.y, largeur * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Coffre de données (un disque) : jauge de remplissage, halo rouge s'il sature.
  _dessinerCoffre(e, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = e.disque;
    const saturation = this.trafic.saturation.get(`disque:${d.id}`) ?? 0;
    const couleur = '#29E6FF';
    ctx.save();
    ctx.translate(e.cx, e.cy);
    if (saturation > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = teinte(ROUGE, 0.12 + 0.12 * saturation * (0.5 + 0.5 * Math.sin(temps / 250)));
      ctx.beginPath(); ctx.arc(0, 0, e.l * 0.85, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.rotate(e.angle + Math.PI / 2);
    const h = e.l / 2;
    ctx.fillStyle = p.fond;
    rectArrondi(ctx, -h, -h, e.l, e.l, 8); ctx.fill();
    const rempli = d.utilise / d.total;
    ctx.fillStyle = teinte(rempli > 0.9 ? ROUGE : couleur, 0.22);
    rectArrondi(ctx, -h + 6, h - 6 - (e.l - 12) * rempli, e.l - 12, (e.l - 12) * rempli, 4); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    for (const [l, a] of [[7, 0.12], [1.8, 0.95]]) {
      ctx.strokeStyle = teinte(couleur, a);
      ctx.lineWidth = l;
      rectArrondi(ctx, -h, -h, e.l, e.l, 8); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(-(e.angle + Math.PI / 2));
    ctx.fillStyle = p.texte;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 13px ${POLICE}`;
    ctx.fillText(d.nom, 0, -4);
    ctx.font = `600 8px ${POLICE}`;
    ctx.fillStyle = p.texteDoux;
    ctx.fillText(`${Math.round(rempli * 100)} % plein`, 0, 10);
    ctx.restore();
    if (this.selection?.entrepot?.disque.id === d.id || this.survol?.entrepot?.disque.id === d.id) this._anneauSelection(e.cx, e.cy, e.l * 0.8);
  }

  // Portail Internet : anneaux qui tournent, plus vite quand le réseau travaille.
  _dessinerPortail(temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const a = this.ville.aeroport;
    const s = this.ville.systeme;
    const saturation = this.trafic.saturation.get('aeroport') ?? 0;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    const couleur = saturation > 0 ? ROUGE : '#7CFF6B';
    ctx.save();
    ctx.translate(a.cx, a.cy);
    ctx.fillStyle = p.fond;
    ctx.beginPath(); ctx.arc(0, 0, a.rayon, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const fond = ctx.createRadialGradient(0, 0, 2, 0, 0, a.rayon);
    fond.addColorStop(0, teinte(couleur, 0.35 + 0.3 * activite));
    fond.addColorStop(1, teinte(couleur, 0));
    ctx.fillStyle = fond;
    ctx.beginPath(); ctx.arc(0, 0, a.rayon, 0, Math.PI * 2); ctx.fill();
    for (const [r, sens, tirets] of [[a.rayon, 1, [10, 6]], [a.rayon * 0.72, -1, [4, 8]]]) {
      ctx.save();
      ctx.rotate(sens * temps / (3000 - 2400 * activite));
      ctx.setLineDash(tirets);
      for (const [l, al] of [[6, 0.15], [2, 0.9]]) {
        ctx.strokeStyle = teinte(couleur, al);
        ctx.lineWidth = l;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = p.texte;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 12px ${POLICE}`;
    ctx.fillText('INTERNET', a.cx, a.cy);
    if (this.selection?.type === 'aeroport' || this.survol?.type === 'aeroport') this._anneauSelection(a.cx, a.cy, a.rayon + 10);
  }

  // Bloc d'une application : contour néon de la couleur du quartier, fenêtres allumées selon les
  // processus et le processeur ; pâle et clignotant en veille ; gris éteint une fois fermé.
  _dessinerBloc(lot, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = lot.app.donnees;
    const ferme = d.etat === 'ferme';
    const veille = d.etat === 'veille';
    const couleur = ferme ? p.ferme : lot.app.quartier.couleur;
    const cpu = Math.min(1, d.cpu / 25);
    let eclat = ferme ? 0.35 : veille ? 0.35 + 0.15 * Math.sin(temps / 900 + lot.cx) : 0.75 + 0.25 * cpu;
    ctx.save();
    ctx.translate(lot.cx, lot.cy);
    ctx.rotate(lot.angle + Math.PI / 2);
    const h = lot.l / 2;
    ctx.fillStyle = teinte(couleur, ferme ? 0.08 : 0.14 + 0.2 * cpu);
    rectArrondi(ctx, -h, -h, lot.l, lot.l, 4); ctx.fill();
    // Fenêtres : une par processus (au plus 9), allumées au hasard selon l'activité
    if (!ferme) {
      const n = Math.min(9, d.nb_processus);
      const cote = Math.ceil(Math.sqrt(n));
      const case_ = (lot.l - 8) / cote;
      for (let i = 0; i < n; i++) {
        const allume = veille ? 0.15 : 0.3 + 0.7 * ((Math.sin(temps / 400 + i * 1.7 + lot.cx) + 1) / 2) * (0.3 + 0.7 * cpu);
        ctx.fillStyle = teinte(couleur, allume);
        ctx.fillRect(-h + 4 + (i % cote) * case_ + case_ * 0.2, -h + 4 + Math.floor(i / cote) * case_ + case_ * 0.2, case_ * 0.6, case_ * 0.6);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const [l, a] of [[6, 0.12 * eclat], [1.6, 0.95 * eclat]]) {
      ctx.strokeStyle = teinte(couleur, a);
      ctx.lineWidth = l;
      if (ferme) ctx.setLineDash([3, 3]);
      rectArrondi(ctx, -h, -h, lot.l, lot.l, 4); ctx.stroke();
    }
    ctx.restore();
    if (d.alerte) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = teinte(ROUGE, 0.5 + 0.4 * Math.sin(temps / 180));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(lot.cx, lot.cy, lot.l * 0.85, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (this.selection?.app === lot.app || this.survol?.app === lot.app) this._anneauSelection(lot.cx, lot.cy, lot.l * 0.9);
  }

  _anneauSelection(x, y, r) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  _dessinerSuivi(temps) {
    const v = this.trafic.suivi;
    if (!v) return;
    const q = this.trafic.position(v);
    this._anneauSelection(q.x, q.y, 10 + 2 * Math.sin(temps / 200));
  }

  // Noms à taille fixe à l'écran : applications (de près) et quartiers (au bout de leur avenue).
  _dessinerEtiquettes() {
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    const zoom = this.camera.zoom;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 11px ${POLICE}`;
    for (const lot of v.lots) {
      const mise = this.survol?.app === lot.app || this.selection?.app === lot.app;
      if (zoom < 0.8 && !mise) continue;
      const [ux, uy] = [lot.cx - lot.acces[0], lot.cy - lot.acces[1]];
      const n = Math.hypot(ux, uy) || 1;
      const [sx, sy] = this.versEcran(lot.cx + (ux / n) * (lot.l / 2 + 10), lot.cy + (uy / n) * (lot.l / 2 + 10));
      if (sx < -80 || sx > this.largeur + 80 || sy < -20 || sy > this.hauteur + 20) continue;
      ctx.fillStyle = mise ? p.texte : p.texteDoux;
      ctx.fillText(tronquer(nomVisible(lot.app, this.discret), 20), sx, sy);
    }
    ctx.font = `800 12px ${POLICE}`;
    for (const s of v.secteurs) {
      const r = v.rExterieur + 26;
      const [sx, sy] = this.versEcran(Math.cos(s.angle) * r, Math.sin(s.angle) * r);
      ctx.fillStyle = s.quartier.couleur;
      ctx.fillText(s.quartier.nom.toUpperCase(), sx, sy);
    }
  }
}

// ---------- Utilitaires ----------

function trace(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

// Ligne parallèle, décalée de « d » vers la droite (pour les bords lumineux des routes).
function decalerLigne(points, d) {
  return points.map(([x, y], i) => {
    const [a, b] = [points[Math.max(0, i - 1)], points[Math.min(points.length - 1, i + 1)]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const n = Math.hypot(dx, dy) || 1;
    return [x - (dy / n) * d, y + (dx / n) * d];
  });
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

function melanger(a, b, t) {
  const [r1, g1, b1] = versRgb(a);
  const [r2, g2, b2] = versRgb(b);
  const m = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${m(r1, r2)},${m(g1, g2)},${m(b1, b2)})`;
}

function tronquer(texte, n) {
  return texte.length > n ? texte.slice(0, n - 1) + '…' : texte;
}
