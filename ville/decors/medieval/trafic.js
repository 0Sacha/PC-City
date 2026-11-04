// Circulation du village médiéval : chaque flux disque ou réseau devient une charrette qui suit la ruelle,
// les rues pavées et la porte de la ville, entre la maison de l'application et un grenier (disque) ou le port
// (Internet). Les charrettes roulent à droite. Dans un embouteillage, elles ralentissent hors les murs,
// à l'approche du grenier ou du port saturé.

import { cleCible } from '../ville/trafic.js';

export { cleCible };

export const COULEURS_FLUX = {
  lecture: '#4A9FE0',
  ecriture: '#F08A2C',
  recu: '#4FB860',
  envoye: '#4FB860',
};

export const GABARITS = {
  voiture: { vitesse: 100, longueur: 8, nom: 'Brouette' },
  camionnette: { vitesse: 90, longueur: 13, nom: 'Charrette' },
  camion: { vitesse: 75, longueur: 19, nom: 'Chariot à bœufs' },
};

const MAX_VEHICULES = 240;
const DEPARTS_PAR_SECONDE = 7;
const SEUIL = 256;
const VITESSE = 2.4;
export const VOIE = 4;           // décalage vers la droite du chemin
export const ZONE_BOUCHON = 260; // px avant le grenier ou le port où se forme la file

const versApp = flux => flux === 'lecture' || flux === 'recu';

function niveau(occupation, debut, plein) {
  if (occupation == null) return 0;
  return Math.max(0, Math.min(1, (occupation - debut) / (plein - debut)));
}

function nombreDeVehicules(debit) {
  if (debit < SEUIL) return 0;
  return Math.min(5, 1 + Math.floor(Math.log2(debit / SEUIL) / 3));
}

function gabarit(debit) {
  if (debit < 256 * 1024) return 'voiture';
  if (debit < 4 * 1024 * 1024) return 'camionnette';
  return 'camion';
}

export class Trafic {
  constructor(ville, seuils, forcer = '') {
    this.ville = ville;
    this.seuils = seuils;
    this.forcer = forcer;
    this.vehicules = [];
    this.aVenir = [];
    this.saturation = new Map();
    this.suivi = null;
    this._compteur = 0;
  }

  mesurerSaturation(etat) {
    const s = this.seuils;
    const tout = this.forcer === 'tout';
    this.saturation = new Map();
    for (const d of etat.disques) {
      this.saturation.set(`disque:${d.id}`, tout || this.forcer === 'disque' ? 1 : niveau(d.occupation, s.disque_debut_pct, s.disque_plein_pct));
    }
    this.saturation.set('aeroport', tout || this.forcer === 'reseau' ? 1
      : niveau(etat.systeme.reseau_occupation, s.reseau_debut_pct, s.reseau_plein_pct));
  }

  planifier(etat, periodeMs, maintenant, immediat = false) {
    this.aVenir = this.aVenir.filter(d => d.quand > maintenant);
    this.mesurerSaturation(etat);
    if (immediat) {
      this.vehicules = [];
      this.suivi = null;
    }
    const v = this.ville;
    const s = etat.systeme;
    const ouvertes = [...v.apps.values()].filter(a => a.lot && a.donnees.etat !== 'ferme');
    const connexions = ouvertes.reduce((n, a) => n + a.donnees.connexions, 0);
    let departs = [];
    for (const app of ouvertes) {
      const d = app.donnees;
      const flux = [];
      const disque = v.entrepots?.find(e => e.disque.id === d.disque) ?? v.entrepots?.[0];
      if (disque) flux.push([{ type: 'entrepot', entrepot: disque }, { lecture: d.lecture, ecriture: d.ecriture }]);
      if (connexions && d.connexions) {
        const part = d.connexions / connexions;
        flux.push([{ type: 'aeroport' }, { recu: s.reseau_recu * part, envoye: s.reseau_envoye * part }]);
      }
      for (const [cible, debits] of flux) {
        for (const [type, debit] of Object.entries(debits)) {
          for (let i = 0; i < nombreDeVehicules(debit); i++) {
            departs.push({ quand: maintenant + Math.random() * periodeMs, app, flux: type, debit, cible, gabarit: gabarit(debit) });
          }
        }
      }
    }
    const budget = Math.round(DEPARTS_PAR_SECONDE * periodeMs / 1000);
    if (departs.length > budget) departs = departs.sort((a, b) => b.debit - a.debit).slice(0, budget);
    for (const depart of departs) {
      if (!immediat) { this.aVenir.push(depart); continue; }
      if (this.vehicules.length >= MAX_VEHICULES) break;
      const vehicule = this._creer(depart);
      vehicule.d = Math.random() * this._trajet(vehicule).longueur;
      this.vehicules.push(vehicule);
    }
  }

  _creer(depart) {
    const vitesse = GABARITS[depart.gabarit].vitesse * VITESSE * (0.85 + Math.random() * 0.3);
    return { ...depart, id: ++this._compteur, d: 0, s: 0, vitesse, vitesseActuelle: vitesse, couleur: COULEURS_FLUX[depart.flux] };
  }

  // Ligne brisée du trajet (et longueurs cumulées), recalculée seulement si la ville a été replacée.
  _trajet(v) {
    if (v._trajet && v._version === this.ville.version) return v._trajet;
    let points = this.ville.route(v.app.lot, v.cible);
    if (versApp(v.flux)) points = points.slice().reverse();
    const cumul = [0];
    for (let i = 1; i < points.length; i++) {
      cumul.push(cumul[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    v._trajet = { points, cumul, longueur: cumul.at(-1) };
    v._version = this.ville.version;
    return v._trajet;
  }

  avancer(dt, maintenant) {
    const restants = [];
    for (const depart of this.aVenir) {
      if (depart.quand > maintenant) { restants.push(depart); continue; }
      if (this.vehicules.length < MAX_VEHICULES && depart.app.lot) this.vehicules.push(this._creer(depart));
    }
    this.aVenir = restants;
    for (const v of this.vehicules) {
      if (!v.app.lot) { v.s = 1; continue; }
      const { longueur } = this._trajet(v);
      // File d'attente : la portion du chemin la plus proche du grenier ou du port
      const saturation = this.saturation.get(cleCible(v.cible)) ?? 0;
      const pres = versApp(v.flux) ? v.d < ZONE_BOUCHON : v.d > longueur - ZONE_BOUCHON;
      v.bouchon = saturation > 0 && pres;
      let visee = v.vitesse;
      if (v.bouchon) visee *= 1 - 0.85 * saturation * (0.6 + 0.4 * Math.sin(maintenant / 400 + v.id));
      v.vitesseActuelle += (visee - v.vitesseActuelle) * Math.min(1, dt * 4);
      v.d += v.vitesseActuelle * dt;
      v.s = longueur > 0 ? v.d / longueur : 1;
    }
    this.vehicules = this.vehicules.filter(v => v.s < 1 || (v === this.suivi && v.app.lot));
    if (this.suivi && this.suivi.s >= 1) this.suivi = null;
  }

  // Position sur le trajet, décalée vers la droite du chemin.
  position(v) {
    const { points, cumul, longueur } = this._trajet(v);
    const d = Math.max(0, Math.min(longueur, v.d));
    let i = 1;
    while (i < points.length - 1 && cumul[i] < d) i++;
    const [a, b] = [points[i - 1], points[i]];
    const seg = cumul[i] - cumul[i - 1];
    const t = seg > 0 ? (d - cumul[i - 1]) / seg : 0;
    const [ux, uy] = seg > 0 ? [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg] : [0, 1];
    return { x: a[0] + (b[0] - a[0]) * t - uy * VOIE, y: a[1] + (b[1] - a[1]) * t + ux * VOIE, angle: Math.atan2(uy, ux) };
  }

  vehiculeEn(x, y) {
    let meilleur = null;
    let distance = 12;
    for (const v of this.vehicules) {
      if (!v.app.lot) continue;
      const p = this.position(v);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < distance) { distance = d; meilleur = v; }
    }
    return meilleur;
  }
}
