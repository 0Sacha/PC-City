// Rendu Canvas 2D de l'aquarium, vu de côté : eau dont le niveau suit la RAM, sable, récifs des
// quartiers, poissons des applications, coffres au trésor (disques), filtre (Internet), bulleur
// (processeur), perles et bulles pour les flux.

import { interpolerPalettes, momentDeLaJournee, rectArrondi } from '../ville/rendu2d.js';
import { nomVisible, SABLE, hacher } from './modele.js';
import { GABARITS } from './trafic.js';

export { momentDeLaJournee };

// « lueur » : les poissons brillent un peu la nuit (éclairage LED de l'aquarium).
export const PALETTES = {
  jour: {
    fond: '#EDE6DA', mur: '#E2D9CA', cadre: '#3A3F4B', air: 'rgba(225,242,250,0.55)',
    eauHaut: '#86DCEA', eauBas: '#2B8DB4', sable: '#EBD5A3', sableFonce: '#CDB37E', roche: '#8C8577',
    texte: '#22313D', texteDoux: 'rgba(34,49,61,0.65)', ferme: '#BDB5A8', rayons: 0.14, lueur: 0,
    obscurite: 0.1,
  },
  nuit: {
    fond: '#12141B', mur: '#181B24', cadre: '#07080C', air: 'rgba(40,60,90,0.35)',
    eauHaut: '#1E4F7C', eauBas: '#081A31', sable: '#5A533E', sableFonce: '#403B2C', roche: '#3C3A36',
    texte: '#E6F0FF', texteDoux: 'rgba(230,240,255,0.6)', ferme: '#6B675F', rayons: 0.05, lueur: 1,
    obscurite: 1,
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
    this.camera.zoom = Math.min((this.largeur - 40) / b.l, (this.hauteur - 130) / b.h, 1.6);
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
    this._avancerFondu();
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = p.fond;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    if (!v.bornes) return;
    v.animer(temps);
    if (this.trafic.suivi) {
      const q = this.trafic.position(this.trafic.suivi);
      this.camera.x += (q.x - this.camera.x) * 0.15;
      this.camera.y += (q.y - this.camera.y) * 0.15;
    }
    const c = this.camera;
    ctx.save();
    ctx.translate(this.largeur / 2, this.hauteur / 2);
    ctx.scale(c.zoom, c.zoom);
    ctx.translate(-c.x, -c.y);

    const L = v.largeur;
    const HAUTEUR = v.hauteur;
    const fond = HAUTEUR - SABLE;
    const surface = v.surface();
    // Meuble et intérieur de l'aquarium au-dessus de l'eau
    ctx.fillStyle = p.cadre;
    rectArrondi(ctx, -14, HAUTEUR - 4, L + 28, 34, 6); ctx.fill();
    ctx.fillStyle = p.air;
    ctx.fillRect(0, 0, L, surface);
    // Eau
    const eau = ctx.createLinearGradient(0, surface, 0, fond);
    eau.addColorStop(0, p.eauHaut);
    eau.addColorStop(1, p.eauBas);
    ctx.fillStyle = eau;
    ctx.beginPath();
    ctx.moveTo(0, HAUTEUR);
    for (let x = 0; x <= L; x += 20) ctx.lineTo(x, surface + Math.sin(x / 40 + temps / 600) * 2.5);
    ctx.lineTo(L, HAUTEUR);
    ctx.closePath();
    ctx.fill();
    this._dessinerRayons(surface, fond, temps);
    this._dessinerFiltre(surface, temps);
    // Sable
    ctx.fillStyle = p.sable;
    ctx.beginPath();
    ctx.moveTo(0, HAUTEUR);
    for (let x = 0; x <= L; x += 30) ctx.lineTo(x, fond + Math.sin(x / 90) * 6 + Math.sin(x / 37) * 3);
    ctx.lineTo(L, HAUTEUR);
    ctx.closePath();
    ctx.fill();
    this._dessinerGalets(L, fond);
    for (const r of v.recifs) this._dessinerRecif(r, fond, temps);
    for (const e of v.entrepots) this._dessinerCoffre(e, temps);
    this._dessinerBulleur(fond, surface, temps);
    this._dessinerFlux(temps);
    for (const lot of v.lots) this._dessinerPoisson(lot, temps);
    if (this.trafic.suivi) { const q = this.trafic.position(this.trafic.suivi); this._anneau(q.x, q.y, 9, 9); }
    // Vitre et cadre
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(L * 0.62, 0); ctx.lineTo(L * 0.7, 0); ctx.lineTo(L * 0.58, HAUTEUR); ctx.lineTo(L * 0.5, HAUTEUR); ctx.fill();
    ctx.strokeStyle = p.cadre;
    ctx.lineWidth = 8;
    ctx.strokeRect(-4, -4, L + 8, HAUTEUR + 8);
    this._dessinerJaugeRam(L, surface, fond);
    ctx.restore();
    this._dessinerEtiquettes();
  }

  // Rayons de lumière qui descendent de la surface et ondulent doucement.
  _dessinerRayons(surface, fond, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const L = this.ville.largeur;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < Math.ceil(L / 220); i++) {
      const x = i * 220 + 60 + Math.sin(temps / 2400 + i * 1.3) * 30;
      ctx.fillStyle = `rgba(255,255,240,${p.rayons})`;
      ctx.beginPath();
      ctx.moveTo(x, surface); ctx.lineTo(x + 40, surface); ctx.lineTo(x + 110, fond); ctx.lineTo(x + 30, fond);
      ctx.fill();
    }
    ctx.restore();
  }

  _dessinerGalets(L, fond) {
    const ctx = this.ctx;
    const p = this.palette;
    for (let i = 0; i < L / 18; i++) {
      const h = hacher(`g${i}`);
      const x = (h % 1000) / 1000 * L;
      const y = fond + 14 + ((h >>> 10) % 40);
      ctx.fillStyle = i % 3 ? p.sableFonce : p.roche;
      ctx.beginPath(); ctx.ellipse(x, y, 3 + (h >>> 20) % 4, 2 + (h >>> 24) % 2, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Récif d'un quartier : rochers, coraux et algues qui ondulent, panneau planté dans le sable.
  _dessinerRecif(r, fond, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const q = r.quartier;
    const k = this.ville.echelle ?? 1;
    const n = Math.max(3, Math.round(r.l / (70 * k)));
    for (let i = 0; i < n; i++) {
      const h = hacher(`${q.id}${i}`);
      const x = r.x + (i + 0.5) * (r.l / n) + ((h % 30) - 15);
      ctx.save();
      ctx.translate(x, fond);
      ctx.scale(k, k);
      ctx.translate(-x, -fond);
      // Rocher
      ctx.fillStyle = melanger(p.roche, q.couleur, 0.25);
      ctx.beginPath(); ctx.ellipse(x, fond + 4, 22 + (h % 14), 14 + (h >>> 4) % 10, 0, Math.PI, 0); ctx.fill();
      // Algues (deux ou trois brins) qui ondulent
      ctx.strokeStyle = melanger('#3FA35B', q.couleur, 0.35);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let k = 0; k < 2 + (h % 2); k++) {
        const bx = x - 12 + k * 10;
        const haut = 50 + ((h >>> (k * 3)) % 50);
        const ondule = Math.sin(temps / 900 + i + k) * 10;
        ctx.beginPath();
        ctx.moveTo(bx, fond);
        ctx.quadraticCurveTo(bx + ondule, fond - haut * 0.5, bx + ondule * 1.5, fond - haut);
        ctx.stroke();
      }
      // Corail branchu de la couleur du quartier
      ctx.strokeStyle = q.couleur;
      ctx.lineWidth = 4;
      const cx = x + 14;
      const branches = [[0, -26], [-10, -20], [10, -22]];
      for (const [dx, dy] of branches) {
        ctx.beginPath(); ctx.moveTo(cx, fond - 4); ctx.lineTo(cx + dx * 0.4, fond - 4 + dy * 0.5); ctx.lineTo(cx + dx, fond - 4 + dy); ctx.stroke();
      }
      ctx.restore();
    }
    // Panneau du quartier
    const px = r.x + 18;
    ctx.save();
    ctx.translate(px, fond);
    ctx.scale(Math.sqrt(k), Math.sqrt(k));   // moins agrandi que le récif : les panneaux voisins ne se touchent pas
    ctx.translate(-px, -fond);
    ctx.fillStyle = '#7A5A3A';
    ctx.fillRect(px - 1.5, fond - 6, 3, 30);
    ctx.font = `800 10px ${POLICE}`;
    const texte = q.nom.toUpperCase();
    const l = ctx.measureText(texte).width + 12;
    ctx.fillStyle = q.couleur;
    rectArrondi(ctx, px - 6, fond - 20, l, 16, 3); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(texte, px, fond - 12);
    ctx.restore();
  }

  // Coffre au trésor (un disque) : il s'entrouvre et luit quand le disque travaille ; halo rouge s'il sature.
  _dessinerCoffre(e, temps) {
    this._aEchelle(e.cx, e.fond, () => this._dessinerCoffreBase({ ...e, x: e.cx - 42, y: e.fond - 60, l: 84, h: 64 }, temps));
    const d = e.disque;
    if (this.selection?.entrepot?.disque.id === d.id || this.survol?.entrepot?.disque.id === d.id) this._anneau(e.cx, e.y + e.h / 2, e.l * 0.7, e.h * 0.8);
  }

  _dessinerCoffreBase(e, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = e.disque;
    const saturation = this.trafic.saturation.get(`disque:${d.id}`) ?? 0;
    const activite = Math.min(1, (d.occupation ?? 0) / 60);
    const [x, y, l, h] = [e.x, e.y + 22, e.l, e.h - 22];
    if (saturation > 0) {
      ctx.fillStyle = `rgba(232,80,79,${0.15 + 0.15 * saturation * (0.5 + 0.5 * Math.sin(temps / 250))})`;
      ctx.beginPath(); ctx.ellipse(e.cx, y + h / 2, l * 0.85, h * 1.1, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Lueur dorée
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,210,90,${0.12 + 0.3 * activite})`;
    ctx.beginPath(); ctx.ellipse(e.cx, y, l * 0.45, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#7B4F2A';
    rectArrondi(ctx, x, y, l, h, 4); ctx.fill();
    ctx.fillStyle = '#E8B04A';
    ctx.fillRect(x, y + h * 0.35, l, 4);
    ctx.fillRect(x + l / 2 - 5, y + h * 0.3, 10, 12);
    // Remplissage du disque : pile de pièces d'or qui dépasse du coffre
    const rempli = d.utilise / d.total;
    ctx.fillStyle = rempli > 0.9 ? ROUGE : '#F6CF5A';
    ctx.beginPath(); ctx.ellipse(e.cx, y + 2, (l / 2 - 6) * rempli + 6, 6 + 6 * rempli, 0, Math.PI, 0); ctx.fill();
    // Couvercle entrouvert selon l'activité
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.15 - 0.6 * activite);
    ctx.fillStyle = '#8E5E33';
    rectArrondi(ctx, 0, -16, l, 16, 6); ctx.fill();
    ctx.fillStyle = '#E8B04A';
    ctx.fillRect(0, -4, l, 3);
    ctx.restore();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 13px ${POLICE}`;
    ctx.fillText(d.nom, e.cx, y + h * 0.7);
    ctx.fillStyle = p.texte;
    ctx.font = `700 9px ${POLICE}`;
    ctx.fillText(`${Math.round(rempli * 100)} % plein`, e.cx, y + h + 14);
  }

  // Filtre (Internet), suspendu en haut à gauche : boîtier, tuyau dans l'eau, cascade de retour.
  // La cascade et les bulles s'emballent quand le réseau travaille ; rouge si le réseau sature.
  _dessinerFiltre(surface, temps) {
    const a = this.ville.aeroport;
    const k = this.ville.echelle ?? 1;
    this._aEchelle(a.x, a.y, () => this._dessinerFiltreBase({ ...a, cx: a.x + 50, cy: 120, l: 100, h: 230 }, a.y + (surface - a.y) / k, temps));
    if (this.selection?.type === 'aeroport' || this.survol?.type === 'aeroport') this._anneau(a.cx, a.y + 20 * k, a.l * 0.7, 60 * k);
  }

  _dessinerFiltreBase(a, surface, temps) {
    const ctx = this.ctx;
    const s = this.ville.systeme;
    const saturation = this.trafic.saturation.get('aeroport') ?? 0;
    const activite = Math.min(1, Math.log2(1 + ((s?.reseau_recu ?? 0) + (s?.reseau_envoye ?? 0)) / 1024) / 12);
    ctx.fillStyle = saturation > 0 ? '#C0504F' : '#4B5563';
    rectArrondi(ctx, a.x, a.y - 30, a.l, 60, 8); ctx.fill();
    ctx.fillStyle = saturation > 0 ? '#FFD0D0' : '#9BE7C4';
    ctx.font = `800 13px ${POLICE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('INTERNET', a.cx, a.y);
    // Tuyau d'aspiration jusque dans l'eau
    ctx.fillStyle = 'rgba(200,220,230,0.7)';
    ctx.fillRect(a.x + 18, a.y + 30, 10, a.h - 40);
    // Cascade de retour, de la sortie du filtre jusqu'à la surface
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.3 * activite})`;
    const xs = a.x + a.l - 18;
    ctx.fillRect(xs - 8, a.y + 30, 16 + 6 * activite, Math.max(0, surface - a.y - 30));
    // Remous à la surface
    for (let i = 0; i < 6; i++) {
      const t = ((temps / (700 - 400 * activite)) + i / 6) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - t)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(xs, surface + 4, 8 + t * 30, 3 + t * 6, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Bulleur (le processeur) : pierre au fond, colonne de bulles d'autant plus dense que le CPU travaille.
  _dessinerBulleur(fond, surface, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const s = this.ville.systeme;
    const b = this.ville.tour;
    if (!s) return;
    const cpu = s.cpu / 100;
    const n = Math.round(5 + cpu * 45);
    const hauteur = fond - surface;
    for (let i = 0; i < n; i++) {
      const h = hacher(`b${i}`);
      const vitesse = 60 + (h % 60);
      const t = ((temps / 1000) * vitesse / hauteur + (h % 1000) / 1000) % 1;
      const x = b.x + Math.sin(t * 9 + i) * (6 + t * 18) + ((h >>> 8) % 20 - 10);
      const y = fond - 14 - t * (hauteur - 14);
      const r = 1.5 + ((h >>> 12) % 4) * 0.8 + t * 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }
    // Pierre et panneau du CPU
    const k = this.ville.echelle ?? 1;
    ctx.save();
    ctx.translate(b.x, fond);
    ctx.scale(k, k);
    ctx.translate(-b.x, -fond);
    ctx.fillStyle = '#6E6A63';
    ctx.beginPath(); ctx.ellipse(b.x, fond - 4, 22, 12, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = cpu > 0.9 ? ROUGE : '#F2A541';
    rectArrondi(ctx, b.x - 30, fond + 12, 60, 24, 6); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 13px ${POLICE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`CPU ${Math.round(s.cpu)} %`, b.x, fond + 24);
    ctx.restore();
    ctx.fillStyle = p.texte;
    if (this.selection?.type === 'tour' || this.survol?.type === 'tour') this._anneau(b.x, fond + 6 * k, 40 * k, 36 * k);
  }

  // Graduation sur la vitre de droite : niveau de l'eau = RAM utilisée.
  _dessinerJaugeRam(L, surface, fond) {
    const ctx = this.ctx;
    const s = this.ville.systeme;
    if (!s) return;
    const ram = s.ram_utilisee / s.ram_totale;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= 10; k++) {
      const y = fond - (fond - 30) * (k / 10);
      ctx.beginPath(); ctx.moveTo(L - 4, y); ctx.lineTo(L - (k % 5 ? 10 : 18), y); ctx.stroke();
    }
    const k = this.ville.echelle ?? 1;
    ctx.save();
    ctx.translate(L - 12, surface);
    ctx.scale(k, k);
    ctx.translate(-(L - 12), -surface);
    ctx.fillStyle = ram > 0.9 ? ROUGE : '#3FA9E0';
    rectArrondi(ctx, L - 92, surface - 11, 80, 22, 6); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 12px ${POLICE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`RAM ${Math.round(ram * 100)} %`, L - 52, surface);
    ctx.restore();
  }

  // Poisson : corps de la couleur du quartier, queue qui bat (plus vite s'il calcule), œil ;
  // endormi en veille (plus pâle, petites bulles « z ») ; contour rouge qui pulse en cas d'alerte.
  // Fermé : ventre en l'air, gris, yeux en croix (retourne / terne viennent du modèle, animés).
  _dessinerPoisson(lot, temps) {
    const ctx = this.ctx;
    const p = this.palette;
    const d = lot.app.donnees;
    const veille = d.etat === 'veille';
    const terne = lot.terne ?? 0;
    const tr = lot.transition;
    if (tr?.type === 'reveil') this._dessinerReveil(lot, tr);
    // Un nouveau venu sort du sable tout petit et grandit.
    const croissance = tr?.type === 'reveil' && !tr.mort ? 0.25 + 0.75 * Math.min(1, Math.max(0, (tr.p - 0.15) / 0.6)) : 1;
    const L = lot.taille * croissance;
    const couleur = melanger(lot.quartier.couleur, p.ferme, 0.85 * terne);
    const cpu = terne > 0.5 ? 0 : Math.min(1, d.cpu / 20);
    ctx.save();
    ctx.translate(lot.cx, lot.cy);
    ctx.scale(lot.sens, Math.cos((lot.retourne ?? 0) * Math.PI));
    if (p.lueur > 0.05 && terne < 0.5) {
      ctx.fillStyle = teinte(couleur, 0.15 * p.lueur * (0.5 + cpu));
      ctx.beginPath(); ctx.ellipse(0, 0, L * 0.9, L * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = veille ? 0.6 : 1;
    const battement = Math.sin(temps / (veille || terne > 0.5 ? 600 : 140 - 70 * cpu)) * 0.35 * (1 - 0.85 * terne);
    // Queue
    ctx.fillStyle = eclaircir(couleur, -0.2);
    ctx.save();
    ctx.translate(-L * 0.42, 0);
    ctx.rotate(battement);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-L * 0.4, -L * 0.3); ctx.lineTo(-L * 0.32, 0); ctx.lineTo(-L * 0.4, L * 0.3); ctx.closePath(); ctx.fill();
    ctx.restore();
    // Nageoire dorsale
    ctx.beginPath(); ctx.moveTo(-L * 0.15, -L * 0.25); ctx.quadraticCurveTo(0, -L * 0.48, L * 0.15, -L * 0.24); ctx.fill();
    // Corps
    const g = ctx.createLinearGradient(0, -L * 0.3, 0, L * 0.3);
    g.addColorStop(0, eclaircir(couleur, 0.25));
    g.addColorStop(1, eclaircir(couleur, -0.15));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, L * 0.5, L * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    // Rayures
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1, L * 0.05);
    for (const x of [-0.15, 0.05]) { ctx.beginPath(); ctx.moveTo(L * x, -L * 0.26); ctx.lineTo(L * x, L * 0.26); ctx.stroke(); }
    // Œil : en croix une fois mort, fermé en veille
    if (terne > 0.5) {
      ctx.strokeStyle = '#1D2430';
      ctx.lineWidth = Math.max(1, L * 0.04);
      const [ox, oy, r] = [L * 0.28, -L * 0.07, L * 0.06];
      ctx.beginPath(); ctx.moveTo(ox - r, oy - r); ctx.lineTo(ox + r, oy + r); ctx.moveTo(ox + r, oy - r); ctx.lineTo(ox - r, oy + r); ctx.stroke();
    } else if (veille) {
      ctx.strokeStyle = '#1D2430';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(L * 0.22, -L * 0.07); ctx.lineTo(L * 0.34, -L * 0.07); ctx.stroke();
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(L * 0.28, -L * 0.07, L * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1D2430';
      ctx.beginPath(); ctx.arc(L * 0.3, -L * 0.07, L * 0.045, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (veille && terne < 0.5) {
      ctx.fillStyle = p.texteDoux;
      ctx.font = `700 ${Math.round(L * 0.35 + 6)}px ${POLICE}`;
      const t = (temps / 1500 + lot.phase) % 1;
      ctx.globalAlpha = 1 - t;
      ctx.fillText('z', lot.cx + L * 0.4 * lot.sens, lot.cy - L * 0.4 - t * 14);
      ctx.globalAlpha = 1;
    }
    if (d.alerte) {
      ctx.strokeStyle = teinte(ROUGE, 0.5 + 0.4 * Math.sin(temps / 180));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(lot.cx, lot.cy, L * 0.75, L * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.selection?.app === lot.app || this.survol?.app === lot.app) this._anneau(lot.cx, lot.cy, L * 0.8, L * 0.55);
  }

  // Réveil : éclat de lumière et gerbe de bulles là où le poisson revient à la vie (à la surface s'il
  // était mort, dans le sable pour un nouveau venu, avec un petit nuage de sable).
  _dessinerReveil(lot, tr) {
    const ctx = this.ctx;
    const k = this.ville.echelle ?? 1;
    const p = tr.p;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const eclat = Math.sin(Math.min(1, p / 0.45) * Math.PI);
    const g = ctx.createRadialGradient(tr.x, tr.y, 1, tr.x, tr.y, 34 * k);
    g.addColorStop(0, `rgba(255,250,200,${0.5 * eclat})`);
    g.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(tr.x, tr.y, 34 * k, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    if (!tr.mort && p < 0.5) {
      ctx.fillStyle = `rgba(205,179,126,${0.5 * (1 - p / 0.5)})`;
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(tr.x + s * (8 + 30 * p) * k, tr.y, (6 + 14 * p) * k, (3 + 5 * p) * k, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Étincelles en étoile autour du poisson qui se ranime
    ctx.strokeStyle = `rgba(255,240,170,${0.9 * eclat})`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + p * 2;
      const [r1, r2] = [(14 + 30 * p) * k, (20 + 36 * p) * k];
      ctx.beginPath(); ctx.moveTo(tr.x + Math.cos(a) * r1, tr.y + Math.sin(a) * r1); ctx.lineTo(tr.x + Math.cos(a) * r2, tr.y + Math.sin(a) * r2); ctx.stroke();
    }
    // Gerbe de bulles qui suit le poisson
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 12; i++) {
      const t = (p - (i % 6) * 0.05) / 0.75;
      if (t <= 0 || t >= 1) continue;
      const x = lot.cx + Math.sin(i * 2.3 + t * 6) * (8 + 14 * t) * k;
      const y = lot.cy - (6 + t * 70) * k;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath(); ctx.arc(x, y, (1.5 + (i % 3) + t * 2) * k, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // Perles (disque) et bulles (réseau), avec un petit sillage.
  _dessinerFlux(temps) {
    const ctx = this.ctx;
    const t = this.trafic;
    for (const v of t.vehicules) {
      if (!v.app.lot || v.s <= 0) continue;
      const q = t.position(v);
      const fondu = Math.max(0, Math.min(1, v.s / 0.06, (1 - v.s) / 0.06));
      const r = GABARITS[v.gabarit].rayon;
      const couleur = v.bouchon ? melanger(v.couleur, ROUGE, 0.5 + 0.5 * Math.sin(temps / 200)) : v.couleur;
      ctx.globalAlpha = fondu;
      if (v.cible.type === 'aeroport') {
        // Bulle : cercle clair, reflet
        ctx.strokeStyle = couleur;
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(q.x, q.y, r + 1, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(q.x - r * 0.35, q.y - r * 0.35, r * 0.35, 0, Math.PI * 2); ctx.fill();
      } else {
        // Perle lumineuse
        ctx.fillStyle = teinte(couleur, 0.3);
        ctx.beginPath(); ctx.arc(q.x, q.y, r * 2, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(q.x - r * 0.3, q.y - r * 0.3, 0.5, q.x, q.y, r);
        g.addColorStop(0, '#FFFFFF');
        g.addColorStop(1, couleur);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Dessine « dessin » agrandi de l'échelle du décor autour du point (x, y).
  _aEchelle(x, y, dessin) {
    const ctx = this.ctx;
    const k = this.ville.echelle ?? 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.translate(-x, -y);
    dessin();
    ctx.restore();
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

  // Noms des poissons à taille fixe à l'écran : de près, ou survolés / sélectionnés.
  _dessinerEtiquettes() {
    const ctx = this.ctx;
    const p = this.palette;
    const zoom = this.camera.zoom;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `600 11px ${POLICE}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.nuit ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)';
    for (const lot of this.ville.lots) {
      const mise = this.survol?.app === lot.app || this.selection?.app === lot.app;
      if (zoom < 1.2 && !mise) continue;
      const [sx, sy] = this.versEcran(lot.cx, lot.cy + lot.taille * 0.4 + 2);
      if (sx < -80 || sx > this.largeur + 80 || sy < -20 || sy > this.hauteur + 20) continue;
      const nom = tronquer(nomVisible(lot.app, this.discret), 20);
      ctx.strokeText(nom, sx, sy);
      ctx.fillStyle = mise ? p.texte : p.texteDoux;
      ctx.fillText(nom, sx, sy);
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
