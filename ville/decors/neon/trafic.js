// Circulation de la ville néon : chaque flux disque ou réseau devient une traînée de lumière qui file
// de l'application au coffre de données (disque) ou au portail (Internet), ou l'inverse.
// Des faisceaux lumineux peuvent se croiser : pas de file d'attente, sauf dans un embouteillage,
// où ils ralentissent et rougeoient près de la cible saturée.
// Le processeur, lui, envoie des impulsions de chaque application vers le cœur.

import { decaler, cleCible } from '../ville/trafic.js';

export { cleCible };

// Taille du faisceau selon le débit (mêmes seuils que les véhicules de la ville).
export const GABARITS = {
  voiture: { vitesse: 115, largeur: 2.2, nom: 'Étincelle' },
  camionnette: { vitesse: 100, largeur: 3.2, nom: 'Faisceau' },
  camion: { vitesse: 85, largeur: 4.5, nom: 'Rayon lourd' },
};

export const COULEURS_FLUX = {
  lecture: '#29E6FF',
  ecriture: '#FF4FD8',
  recu: '#7CFF6B',
  envoye: '#7CFF6B',
};

const MAX_VEHICULES = 320;
const DEPARTS_PAR_SECONDE = 8;
const SEUIL = 256;
const VOIE = 4;               // chaque sens à droite de l'axe de la route
const ZONE_BOUCHON = 260;
const VITESSE = 1.6;          // la lumière file plus vite que les voitures de la ville
export const TRAINEE = { voiture: 26, camionnette: 40, camion: 60 };   // longueur de la traînée

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
    this.impulsions = [];         // processeur : de l'application vers le cœur
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

    // Impulsions du processeur : plus une application calcule, plus elle en envoie vers le cœur.
    this._cpu = ouvertes.filter(a => a.donnees.cpu >= 0.5).map(a => ({ app: a, cpu: a.donnees.cpu }));
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
        const onde = 0.5 + 0.5 * Math.sin(maintenant / 500 - dCible / 25);
        visee *= (1 - 0.8 * saturation) * (1 - 0.6 * saturation * onde);
      }
      v.vitesseActuelle += (visee - v.vitesseActuelle) * Math.min(1, dt * 4);
      v.distance += v.vitesseActuelle * dt;
    }
    this.vehicules = this.vehicules.filter(v => v.distance < v.longueurTotale || v === this.suivi);
    if (this.suivi && this.suivi.distance >= this.suivi.longueurTotale) this.suivi = null;

    // Impulsions CPU : de l'application vers le cœur, le long de son avenue.
    for (const c of this._cpu ?? []) {
      if (Math.random() < dt * Math.min(6, c.cpu / 8) && c.app.lot && this.impulsions.length < 200) {
        this.impulsions.push({ lot: c.app.lot, t: 0, couleur: c.app.quartier.couleur });
      }
    }
    for (const i of this.impulsions) i.t += dt * 1.4;
    this.impulsions = this.impulsions.filter(i => i.t < 1);
  }

  // Le plan a changé : chaque faisceau reprend son trajet recalculé, à la même proportion du parcours.
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

  position(v, distance = v.distance) {
    const d = Math.max(0, Math.min(distance, v.longueurTotale));
    let i = 1;
    while (i < v.longueurs.length - 1 && v.longueurs[i] < d) i++;
    const [x1, y1] = v.points[i - 1];
    const [x2, y2] = v.points[i];
    const t = (d - v.longueurs[i - 1]) / ((v.longueurs[i] - v.longueurs[i - 1]) || 1);
    return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, angle: Math.atan2(y2 - y1, x2 - x1) };
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
