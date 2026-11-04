// Circulation de la fourmilière : chaque flux disque ou réseau devient une fourmi qui porte sa charge
// le long des galeries, de la chambre de l'application au puits, puis jusqu'à une réserve (disque)
// ou jusqu'à l'entrée (Internet). Quand la cible est saturée, les fourmis qui y vont font la queue
// dans la dernière partie de la galerie, sans se chevaucher.

import { cleCible } from '../ville/trafic.js';
import { segmentPuits } from './modele.js';

export { cleCible };

export const COULEURS_FLUX = {
  lecture: '#3FA9F5',
  ecriture: '#FF9F1C',
  recu: '#4FCB68',
  envoye: '#4FCB68',
};

export const GABARITS = {
  voiture: { vitesse: 72, longueur: 11, nom: 'Fourmi ouvrière' },
  camionnette: { vitesse: 64, longueur: 13, nom: 'Fourmi soldat' },
  camion: { vitesse: 55, longueur: 13, nom: 'Fourmi porteuse de feuille' },
};

const MAX_VEHICULES = 260;
const DEPARTS_PAR_SECONDE = 7;
const SEUIL = 256;
const VITESSE = 2.2;
export const ZONE_BOUCHON = 220;  // px : dernière part du trajet où se forme la file d'attente
const ESPACE = 13;                // px entre deux fourmis dans la file

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
      vehicule.s = Math.random();
      this.vehicules.push(vehicule);
    }
  }

  _creer(depart) {
    const vitesse = GABARITS[depart.gabarit].vitesse * VITESSE * (0.85 + Math.random() * 0.3);
    return { ...depart, id: ++this._compteur, s: 0, vitesse, vitesseActuelle: vitesse, couleur: COULEURS_FLUX[depart.flux] };
  }

  // Trajet complet de la fourmi (points et longueurs cumulées), refait si la fourmilière a changé de forme.
  route(v) {
    const ville = this.ville;
    const lot = v.app.lot;
    if (v._route && v._routeVersion === ville.version && v._routeLot === lot) return v._route;
    const points = [...lot.chemin];
    if (v.cible.type === 'aeroport') {
      points.push(...segmentPuits(lot.jonction, 0), ...ville.aeroport.entree);
    } else {
      const e = ville.entrepots.find(x => x.disque.id === v.cible.entrepot.disque.id) ?? ville.entrepots[0];
      points.push(...segmentPuits(lot.jonction, ville.yReserves), ...e.chemin);
    }
    if (versApp(v.flux)) points.reverse();
    const cumul = [0];
    for (let i = 1; i < points.length; i++) {
      cumul.push(cumul[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    v._route = { points, cumul, longueur: Math.max(1, cumul[cumul.length - 1]) };
    v._routeVersion = ville.version;
    v._routeLot = lot;
    return v._route;
  }

  avancer(dt, maintenant) {
    const restants = [];
    for (const depart of this.aVenir) {
      if (depart.quand > maintenant) { restants.push(depart); continue; }
      if (this.vehicules.length < MAX_VEHICULES && depart.app.lot) this.vehicules.push(this._creer(depart));
    }
    this.aVenir = restants;
    const files = new Map();  // cible saturée -> fourmis qui y vont, dans la zone d'attente
    for (const v of this.vehicules) {
      if (!v.app.lot) { v.s = 1; continue; }
      const L = this.route(v).longueur;
      const saturation = this.saturation.get(cleCible(v.cible)) ?? 0;
      const allerVersCible = !versApp(v.flux);
      const prochesCible = allerVersCible ? (1 - v.s) * L : v.s * L;
      v.bouchon = saturation > 0 && prochesCible < ZONE_BOUCHON;
      let visee = v.vitesse;
      if (v.bouchon) visee *= 1 - 0.8 * saturation * (0.6 + 0.4 * Math.sin(maintenant / 400 + v.id));
      v.vitesseActuelle += (visee - v.vitesseActuelle) * Math.min(1, dt * 4);
      v.avance = v.vitesseActuelle * dt;
      if (v.bouchon && allerVersCible) {
        const cle = cleCible(v.cible);
        if (!files.has(cle)) files.set(cle, []);
        files.get(cle).push(v);
      } else {
        v.s += v.avance / L;
      }
    }
    // File d'attente : la plus proche de la cible avance, les suivantes gardent leurs distances.
    for (const file of files.values()) {
      const reste = v => (1 - v.s) * this.route(v).longueur;
      file.sort((a, b) => reste(a) - reste(b));
      let devant = -Infinity;
      for (const v of file) {
        const L = this.route(v).longueur;
        const avant = reste(v);
        const minimum = devant + ESPACE;
        const apres = Math.max(avant - v.avance, Math.min(avant, minimum));
        v.s = 1 - apres / L;
        devant = apres;
      }
    }
    this.vehicules = this.vehicules.filter(v => v.s < 1 || (v === this.suivi && v.app.lot));
    if (this.suivi && this.suivi.s >= 1) this.suivi = null;
  }

  position(v) {
    const { points, cumul, longueur } = this.route(v);
    const d = Math.min(1, Math.max(0, v.s)) * longueur;
    let i = 1;
    while (i < points.length - 1 && cumul[i] < d) i++;
    const [a, b] = [points[i - 1], points[i] ?? points[i - 1]];
    const t = (d - cumul[i - 1]) / ((cumul[i] - cumul[i - 1]) || 1);
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
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
