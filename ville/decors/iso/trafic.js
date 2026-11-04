// Circulation de la ville isométrique : chaque flux disque ou réseau devient une petite voiture en
// volume qui roule de l'immeuble au data center (disque) ou à l'antenne (Internet), ou l'inverse.
// Les trajets sont calculés en cases (i, j), chaque sens à droite de la rue, puis projetés.
// Dans un embouteillage, les voitures ralentissent près de la cible saturée.

import { decaler, cleCible, COULEURS_FLUX, GABARITS } from '../ville/trafic.js';
import { projeter } from './modele.js';

export { cleCible, COULEURS_FLUX, GABARITS };

const MAX_VEHICULES = 320;
const DEPARTS_PAR_SECONDE = 8;
const SEUIL = 256;
const VOIE = 0.17;            // chaque sens à droite de l'axe de la rue (en cases)
const ZONE_BOUCHON = 6;       // cases avant la cible où se forme la file
const VITESSE = 1 / 42;       // px/s des gabarits de la ville → cases/s

const versApp = flux => flux === 'lecture' || flux === 'recu';

function niveau(occupation, debut, plein) {
  if (occupation == null) return 0;
  return Math.max(0, Math.min(1, (occupation - debut) / (plein - debut)));
}

function nombreDeVehicules(debit) {
  if (debit < SEUIL) return 0;
  return Math.min(6, 1 + Math.floor(Math.log2(debit / SEUIL) / 3));
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
      const entrepot = v.entrepots?.find(e => e.disque.id === d.disque) ?? v.entrepots?.[0];
      const flux = [];
      if (entrepot) flux.push([{ type: 'entrepot', entrepot }, { lecture: d.lecture, ecriture: d.ecriture }]);
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
      const modele = this._creer(depart);
      if (!modele) continue;
      const enRoute = Math.max(1, Math.round(modele.longueurTotale / modele.vitesse / (periodeMs / 1000)));
      for (let k = 0; k < enRoute && this.vehicules.length < MAX_VEHICULES; k++) {
        const vehicule = k === 0 ? modele : this._creer(depart);
        vehicule.distance = Math.random() * vehicule.longueurTotale;
        this.vehicules.push(vehicule);
      }
    }
  }

  _creer(depart) {
    const trajet = this.ville.trajet(depart.app, depart.cible);
    if (!trajet || trajet.length < 2) return null;
    const points = decaler(versApp(depart.flux) ? trajet.slice().reverse() : trajet, VOIE);
    const longueurs = [0];
    for (let i = 1; i < points.length; i++) {
      longueurs.push(longueurs[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    const vitesse = GABARITS[depart.gabarit].vitesse * VITESSE * (0.9 + Math.random() * 0.2);
    return {
      ...depart, id: ++this._compteur, points, longueurs, longueurTotale: longueurs[longueurs.length - 1],
      distance: 0, vitesse, vitesseActuelle: vitesse, couleur: COULEURS_FLUX[depart.flux],
    };
  }

  avancer(dt, maintenant) {
    if (this.versionPlan !== this.ville.version) this._retracer();
    const restants = [];
    for (const depart of this.aVenir) {
      if (depart.quand > maintenant) { restants.push(depart); continue; }
      if (this.vehicules.length >= MAX_VEHICULES) continue;
      const vehicule = this._creer(depart);
      if (vehicule) this.vehicules.push(vehicule);
    }
    this.aVenir = restants;

    for (const v of this.vehicules) {
      const saturation = this.saturation.get(cleCible(v.cible)) ?? 0;
      const dCible = versApp(v.flux) ? v.distance : v.longueurTotale - v.distance;
      v.bouchon = saturation > 0 && dCible < ZONE_BOUCHON;
      let visee = v.vitesse;
      if (v.bouchon) {
        const onde = 0.5 + 0.5 * Math.sin(maintenant / 500 - dCible / 0.6);
        visee *= (1 - 0.8 * saturation) * (1 - 0.6 * saturation * onde);
      }
      v.vitesseActuelle += (visee - v.vitesseActuelle) * Math.min(1, dt * 4);
      v.distance += v.vitesseActuelle * dt;
    }
    this.vehicules = this.vehicules.filter(v => v.distance < v.longueurTotale || v === this.suivi);
    if (this.suivi && this.suivi.distance >= this.suivi.longueurTotale) this.suivi = null;
  }

  // Le plan a changé : chaque voiture reprend son trajet recalculé, à la même proportion du parcours.
  _retracer() {
    this.versionPlan = this.ville.version;
    this.vehicules = this.vehicules.filter(v => {
      if (v.cible.type === 'entrepot') {
        const e = this.ville.entrepots.find(x => x.disque.id === v.cible.entrepot.disque.id);
        if (!e) return false;
        v.cible = { type: 'entrepot', entrepot: e };
      }
      const neuf = this._creer(v);
      if (!neuf) return false;
      const part = v.distance / v.longueurTotale;
      Object.assign(v, { points: neuf.points, longueurs: neuf.longueurs, longueurTotale: neuf.longueurTotale });
      v.distance = part * v.longueurTotale;
      return true;
    });
  }

  // Position projetée à l'écran (x, y), case (i, j) et direction de la rue (di, dj : axe du véhicule).
  position(v, distance = v.distance) {
    const d = Math.max(0, Math.min(distance, v.longueurTotale));
    let k = 1;
    while (k < v.longueurs.length - 1 && v.longueurs[k] < d) k++;
    const [i1, j1] = v.points[k - 1];
    const [i2, j2] = v.points[k];
    const l = (v.longueurs[k] - v.longueurs[k - 1]) || 1;
    const t = (d - v.longueurs[k - 1]) / l;
    const [i, j] = [i1 + (i2 - i1) * t, j1 + (j2 - j1) * t];
    const [x, y] = projeter(i, j);
    const [x2, y2] = projeter(i2, j2);
    const [xa, ya] = projeter(i1, j1);
    return { x, y, i, j, di: (i2 - i1) / l, dj: (j2 - j1) / l, angle: Math.atan2(y2 - ya, x2 - xa) };
  }

  vehiculeEn(x, y) {
    let meilleur = null;
    let distance = 12;
    for (const v of this.vehicules) {
      const p = this.position(v);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < distance) { distance = d; meilleur = v; }
    }
    return meilleur;
  }
}
