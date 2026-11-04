// Aquarium, vu de côté : l'aquarium est le PC. Le niveau de l'eau suit la RAM, le bulleur au fond
// fait des bulles avec le processeur. Chaque quartier est un récif posé sur le sable, chaque
// application un poisson qui nage au-dessus de son récif (taille selon la RAM, vivacité selon le
// processeur) ; en veille il dort près du fond ; fermé, il flotte mort à la surface, ventre en l'air.
// Les disques sont des coffres au trésor (à droite), Internet le filtre suspendu (en haut à gauche).
// animer(temps) calcule les positions du moment (temps de la ville, figé en pause).

export { nomVisible, normaliser } from '../ville/modele.js';
import { normaliser, nomVisible } from '../ville/modele.js';

const HAUTEUR_MIN = 620;         // hauteur intérieure minimale ; sinon elle suit la largeur (≈ forme de l'écran)
const PROPORTION = 2.1;          // largeur / hauteur de l'aquarium
export const SABLE = 70;         // épaisseur du sable
const MARGE_GAUCHE = 150;        // place du filtre
const PAR_POISSON = 24;          // largeur de récif par application (les poissons se partagent aussi la hauteur)
const LARGEUR_MIN = 210;         // largeur minimale d'un récif
const COFFRES = 130;             // largeur par coffre, à droite
const DUREE_REVEIL = 2800;       // ms : le poisson revient à la vie et replonge vers son couloir
const DUREE_MORT = 3200;         // ms : le poisson se retourne et remonte flotter à la surface

export class Ville {
  constructor(quartiers) {
    this.quartiers = new Map(quartiers.map((q, i) => [q.id, { ...q, apps: [], rang: i }]));
    this.ordre = quartiers.map(q => q.id);
    this.apps = new Map();
    this.disques = [];
    this.systeme = null;
    this.lots = [];
  }

  mettreAJour(etat) {
    this.systeme = etat.systeme;
    this.disques = etat.disques;
    const presents = new Set(etat.applications.map(a => a.id));
    for (const id of [...this.apps.keys()]) if (!presents.has(id)) this.apps.delete(id);
    for (const q of this.quartiers.values()) q.apps = [];
    for (const donnees of etat.applications) {
      let app = this.apps.get(donnees.id);
      if (!app) {
        app = { id: donnees.id, nouveau: this.dejaAffiche === true };
        this.apps.set(donnees.id, app);
      }
      const quartier = this.quartiers.get(donnees.quartier) ?? this.quartiers.get('divers') ?? [...this.quartiers.values()][0];
      let emplacement = donnees.emplacement ?? 0;
      while (quartier.apps[emplacement]) emplacement++;
      quartier.apps[emplacement] = app;
      Object.assign(app, { quartier, emplacement, donnees });
    }
    this.ramMax = Math.max(1, ...etat.applications.map(a => a.ram));
    this.dejaAffiche = true;
    this._placer();
    this.animer(this._temps ?? 0);
  }

  // Récifs côte à côte sur le sable ; un récif ne rétrécit jamais (les poissons gardent leur coin).
  _placer() {
    for (const id of this.ordre) {
      const q = this.quartiers.get(id);
      q.largeur = Math.max(q.largeur ?? 0, LARGEUR_MIN, q.apps.length * PAR_POISSON);
    }
    const largeur = MARGE_GAUCHE + this.ordre.reduce((s, id) => s + this.quartiers.get(id).largeur, 0)
      + 80 + COFFRES * Math.max(1, this.disques.length);
    this.hauteur = Math.max(this.hauteur ?? 0, HAUTEUR_MIN, Math.round(largeur / PROPORTION));
    const fond = this.hauteur - SABLE;
    // Échelle du décor (récifs, coffres, filtre, poissons) : il grandit avec l'aquarium.
    const k = this.echelle = this.hauteur / HAUTEUR_MIN;
    let x = MARGE_GAUCHE;
    this.recifs = [];
    this.lots = [];
    for (const id of this.ordre) {
      const q = this.quartiers.get(id);
      const recif = { quartier: q, x, l: q.largeur, graine: q.rang * 7 + 3 };
      this.recifs.push(recif);
      q.recif = recif;
      const vivants = q.apps.filter(a => a && a.donnees.etat !== 'ferme').length || 1;
      let iVivant = 0;
      q.apps.forEach(app => {
        if (!app) return;
        const d = app.donnees;
        const taille = (14 + 28 * Math.sqrt(Math.min(1, d.ram / this.ramMax))) * Math.sqrt(k);
        const graine = hacher(app.id);
        const lot = app.lot ?? {};
        const ferme = d.etat === 'ferme';
        // Réveil : un programme qui rouvre revient à la vie ; un nouveau venu sort du sable.
        if (!ferme && (lot.ferme === true || (!app.lot && app.nouveau))) {
          lot.reveil = { debut: this._temps ?? 0, x: lot.cx ?? x + q.largeur / 2, y: lot.cy ?? fond + 10, mort: lot.ferme === true };
          delete lot.mort;
        }
        // Mort : un programme qui se ferme se retourne, pâlit et remonte flotter à la surface.
        if (ferme && lot.ferme === false && lot.cx !== undefined) {
          lot.mort = { debut: this._temps ?? 0, x: lot.cx, y: lot.cy };
          delete lot.reveil;
        }
        // Chaque poisson vivant a son couloir de nage, réparti en hauteur dans l'eau au-dessus du récif ;
        // fermé, il flotte à la surface au-dessus de son récif.
        const part = ferme ? 0 : (iVivant++ + 0.5) / vivants;
        Object.assign(lot, { app, quartier: q, ferme, taille,
          baseX: x + q.largeur * (0.2 + 0.6 * ((graine % 100) / 100)),
          amplitude: q.largeur * 0.32, hauteurRelative: part,
          phase: (graine % 628) / 100, vitesse: 0.12 + ((graine >>> 3) % 50) / 600 });
        lot.l = lot.h = Math.max(18, taille + 8);
        app.lot = lot;
        this.lots.push(lot);
      });
      x += q.largeur;
    }
    this.largeurRecifs = x;
    const nd = Math.max(1, this.disques.length);
    this.entrepots = this.disques.map((disque, i) => {
      const cx = x + 40 + COFFRES * (i + 0.5);
      return { disque, cx, cy: fond - 30 * k, x: cx - 42 * k, y: fond - 60 * k, l: 84 * k, h: 64 * k, toit: '#E8B04A', fond };
    });
    this.largeur = x + 80 + COFFRES * nd;
    // Bulleur (le processeur) au milieu du fond, filtre (Internet) en haut à gauche
    this.tour = { x: this.largeur / 2, y: fond, rayon: 26 * k };
    this.aeroport = { cx: 20 + 50 * k, cy: 120 * k, x: 20, y: 0, l: 100 * k, h: 230 * k, rayon: 50 * k };
    this.bornes = { x: -30, y: -50, l: this.largeur + 60, h: this.hauteur + 90 };
    const signature = [this.largeur, ...this.recifs.map(r => r.l), ...this.lots.map(l => `${l.app.id}:${l.ferme}`)].join('|');
    if (signature !== this._signature) {
      this._signature = signature;
      this.version = (this.version ?? 0) + 1;
    }
  }

  // Niveau de l'eau (y de la surface) : plus la RAM est remplie, plus l'aquarium est plein.
  surface() {
    const s = this.systeme;
    const ram = s ? s.ram_utilisee / s.ram_totale : 0.6;
    const fond = this.hauteur - SABLE;
    return fond - (fond - 30) * Math.max(0.25, Math.min(1, ram));
  }

  // Positions du moment (temps en ms, celui de la ville : il s'arrête pendant la pause).
  //   retourne : 0 à l'endroit → 1 ventre en l'air ; terne : 0 en couleurs → 1 gris (mort).
  animer(temps) {
    this._temps = temps;
    const t = temps / 1000;
    const fond = this.hauteur - SABLE;
    const surface = this.surface();
    const haut = surface + 30;
    const adoucir = x => 1 - (1 - x) ** 3;
    for (const lot of this.lots) {
      const d = lot.app.donnees;
      // Place de flottaison (mort) : à la surface, il dérive lentement au-dessus de son récif.
      const xMort = lot.baseX + Math.sin(t * 0.06 + lot.phase) * lot.amplitude * 0.3;
      const yMort = surface + lot.taille * 0.12 + Math.sin(t * 1.3 + lot.phase) * 1.5;
      if (lot.ferme) {
        lot.cx = xMort;
        lot.cy = yMort;
        lot.sens = Math.cos(t * 0.06 + lot.phase) >= 0 ? 1 : -1;
        lot.retourne = 1;
        lot.terne = 1;
        lot.transition = null;
        const m = lot.mort;
        if (m) {
          const p = (temps - m.debut) / DUREE_MORT;
          if (p >= 1 || p < 0) {
            delete lot.mort;
          } else {
            // Il s'arrête, se retourne et pâlit, puis remonte doucement.
            lot.retourne = Math.min(1, p / 0.3);
            lot.terne = Math.min(1, p / 0.4);
            const k = p < 0.3 ? 0 : adoucir((p - 0.3) / 0.7);
            lot.cx = m.x + (xMort - m.x) * k;
            lot.cy = m.y + (yMort - m.y) * k;
            lot.transition = { type: 'mort', p };
          }
        }
      } else {
        const veille = d.etat === 'veille';
        // Vivacité : un poisson qui calcule nage plus vite ; endormi, il bouge à peine, près du fond.
        const vif = veille ? 0.15 : 0.6 + Math.min(1, d.cpu / 20) * 1.6;
        lot.temps = (lot.temps ?? t) + (t - (lot._t ?? t)) * vif;
        lot._t = t;
        const u = lot.temps * lot.vitesse + lot.phase;
        const x = lot.baseX + Math.sin(u) * lot.amplitude * (veille ? 0.15 : 1);
        const yBase = veille ? fond - lot.taille * 0.6 - 6
          : haut + (fond - 40 - haut) * lot.hauteurRelative;
        const y = yBase + Math.sin(u * 2.3 + lot.phase) * (veille ? 2 : 14);
        lot.sens = Math.cos(u) >= 0 ? 1 : -1;
        lot.cx = x;
        lot.cy = Math.min(fond - lot.taille * 0.5, Math.max(haut - 10, y));
        lot.retourne = 0;
        lot.terne = 0;
        lot.transition = null;
        const r = lot.reveil;
        if (r) {
          const p = (temps - r.debut) / DUREE_REVEIL;
          if (p >= 1 || p < 0) {
            delete lot.reveil;
          } else {
            // Il se remet à l'endroit et reprend ses couleurs, puis replonge vers son couloir.
            if (r.mort) {
              lot.retourne = 1 - Math.min(1, p / 0.3);
              lot.terne = 1 - Math.min(1, p / 0.35);
            }
            const k = p < 0.3 ? 0 : adoucir((p - 0.3) / 0.7);
            lot.cx = r.x + (lot.cx - r.x) * k;
            lot.cy = r.y + (lot.cy - r.y) * k;
            lot.transition = { type: 'reveil', p, x: r.x, y: r.y, mort: r.mort };
          }
        }
      }
      lot.x = lot.cx - lot.l / 2;
      lot.y = lot.cy - lot.h / 2;
    }
  }

  // ---------- Recherche d'éléments ----------

  elementEn(x, y) {
    let meilleur = null;
    let distance = Infinity;
    for (const lot of this.lots) {
      const d = Math.hypot(x - lot.cx, (y - lot.cy) * 1.6);
      if (d <= lot.l * 0.7 && d < distance) { distance = d; meilleur = lot; }
    }
    if (meilleur) return { type: 'app', app: meilleur.app };
    const b = this.tour;
    if (Math.hypot(x - b.x, y - b.y) <= b.rayon + 10) return { type: 'tour' };
    for (const e of this.entrepots ?? []) {
      if (x >= e.x && x <= e.x + e.l && y >= e.y && y <= e.y + e.h) return { type: 'entrepot', entrepot: e };
    }
    const a = this.aeroport;
    if (a && x >= a.x && x <= a.x + a.l && y >= a.y && y <= a.y + a.h) return { type: 'aeroport' };
    return null;
  }

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

// Nombre stable tiré du nom d'une application (position et rythme de nage propres à chaque poisson).
export function hacher(texte) {
  let h = 2166136261;
  for (let k = 0; k < texte.length; k++) h = Math.imul(h ^ texte.charCodeAt(k), 16777619);
  return h >>> 0;
}
