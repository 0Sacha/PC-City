// Circulation du circuit imprimé : chaque flux disque ou réseau devient une impulsion lumineuse qui
// glisse le long des pistes de cuivre, entre le composant de l'application et la barrette du disque
// (ou le port Internet). Dans un embouteillage, les impulsions ralentissent à l'approche de la cible
// saturée et s'accumulent les unes derrière les autres.

import { cleCible } from '../ville/trafic.js';
import { pointA } from './modele.js';

export { cleCible };

export const COULEURS_FLUX = {
  lecture: '#5CC8FF',
  ecriture: '#FFB347',
  recu: '#8CF29B',
  envoye: '#8CF29B',
};

export const GABARITS = {
  voiture: { vitesse: 125, longueur: 9, nom: 'Petite impulsion' },
  camionnette: { vitesse: 110, longueur: 15, nom: 'Impulsion' },
  camion: { vitesse: 95, longueur: 24, nom: 'Salve de données' },
};

const MAX_VEHICULES = 260;
const DEPARTS_PAR_SECONDE = 7;
const SEUIL = 256;
const VITESSE = 2.4;
const ZONE_BOUCHON = 0.3;   // dernière part du trajet où se forme le ralentissement
const ECART_BOUCHON = 4;    // px laissés entre deux impulsions arrêtées l'une derrière l'autre

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

  // Piste du moment (elle change si la carte se réorganise).
  _route(v) {
    return this.ville.route(v.app.lot, v.cible, v.flux);
  }

  avancer(dt, maintenant) {
    const restants = [];
    for (const depart of this.aVenir) {
      if (depart.quand > maintenant) { restants.push(depart); continue; }
      if (this.vehicules.length < MAX_VEHICULES && depart.app.lot) this.vehicules.push(this._creer(depart));
    }
    this.aVenir = restants;
    const files = new Map();  // impulsions prises dans un bouchon, par piste
    for (const v of this.vehicules) {
      if (!v.app.lot) { v.s = 1; continue; }
      const route = this._route(v);
      v.longueur = route.longueur;
      const saturation = this.saturation.get(cleCible(v.cible)) ?? 0;
      const pres = versApp(v.flux) ? v.s < ZONE_BOUCHON : v.s > 1 - ZONE_BOUCHON;
      v.bouchon = saturation > 0 && pres;
      let visee = v.vitesse;
      if (v.bouchon) visee *= 1 - 0.85 * saturation * (0.6 + 0.4 * Math.sin(maintenant / 400 + v.id));
      v.vitesseActuelle += (visee - v.vitesseActuelle) * Math.min(1, dt * 4);
      v.s += (v.vitesseActuelle * dt) / Math.max(40, route.longueur);
      if (v.bouchon) {
        const cle = `${v.app.id}|${cleCible(v.cible)}|${v.flux}`;
        if (!files.has(cle)) files.set(cle, []);
        files.get(cle).push(v);
      }
    }
    // Les impulsions d'une même piste ne se doublent pas : elles font la queue derrière la première.
    for (const file of files.values()) {
      file.sort((a, b) => b.s - a.s);
      for (let i = 1; i < file.length; i++) {
        const devant = file[i - 1];
        const ecart = (GABARITS[devant.gabarit].longueur + ECART_BOUCHON) / Math.max(40, file[i].longueur);
        if (file[i].s > devant.s - ecart) {
          file[i].s = devant.s - ecart;
          file[i].vitesseActuelle = Math.min(file[i].vitesseActuelle, devant.vitesseActuelle);
        }
      }
    }
    this.vehicules = this.vehicules.filter(v => v.s < 1 || (v === this.suivi && v.app.lot));
    if (this.suivi && this.suivi.s >= 1) this.suivi = null;
  }

  // Les flux vers l'application partent de la cible : ils parcourent la piste à rebours.
  position(v) {
    const route = this._route(v);
    const t = Math.min(1, Math.max(0, v.s));
    const p = pointA(route, (versApp(v.flux) ? 1 - t : t) * route.longueur);
    if (versApp(v.flux)) p.angle += Math.PI;
    return p;
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
