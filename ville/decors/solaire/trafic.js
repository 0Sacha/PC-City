// Circulation du système solaire : chaque flux disque ou réseau devient un vaisseau qui vole en courbe
// entre la lune de l'application et la station du disque (ou le trou de ver d'Internet). Les lunes
// tournent : le trajet est recalculé à chaque image, le vaisseau suit sa cible en mouvement.
// Dans un embouteillage, les vaisseaux ralentissent à l'approche de la cible saturée.

import { cleCible } from '../ville/trafic.js';
import { R_SOLEIL } from './modele.js';

export { cleCible };

export const COULEURS_FLUX = {
  lecture: '#5CC8FF',
  ecriture: '#FFB347',
  recu: '#8CF29B',
  envoye: '#8CF29B',
};

export const GABARITS = {
  voiture: { vitesse: 115, longueur: 7, nom: 'Navette' },
  camionnette: { vitesse: 100, longueur: 10, nom: 'Cargo' },
  camion: { vitesse: 85, longueur: 14, nom: 'Vaisseau-cargo' },
};

const MAX_VEHICULES = 260;
const DEPARTS_PAR_SECONDE = 7;
const SEUIL = 256;
const VITESSE = 2.2;
const ZONE_BOUCHON = 0.3;   // dernière part du trajet où se forme le ralentissement

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
    // Écart propre à chaque vaisseau : ils ne volent pas tous sur la même courbe.
    return { ...depart, id: ++this._compteur, s: 0, vitesse, vitesseActuelle: vitesse,
      couleur: COULEURS_FLUX[depart.flux], ecart: (Math.random() - 0.5) * 0.5 };
  }

  // Extrémités du vol du moment : la lune (qui tourne) et la station ou le trou de ver.
  _extremites(v) {
    const lot = v.app.lot;
    let cible;
    if (v.cible.type === 'aeroport') {
      const a = this.ville.aeroport;
      cible = [a.cx, a.cy];
    } else {
      const e = this.ville.entrepots.find(x => x.disque.id === v.cible.entrepot.disque.id) ?? v.cible.entrepot;
      cible = [e.cx, e.cy];
    }
    const lune = [lot.cx, lot.cy];
    return versApp(v.flux) ? [cible, lune] : [lune, cible];
  }

  // Courbe du vol : arc qui contourne le Soleil (point de contrôle repoussé loin du centre).
  _courbe(v) {
    const [a, b] = this._extremites(v);
    const milieu = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let n = Math.hypot(...milieu);
    let dir = n > 1 ? [milieu[0] / n, milieu[1] / n] : [-(b[1] - a[1]) / (dist || 1), (b[0] - a[0]) / (dist || 1)];
    const pousse = Math.max(dist * (0.25 + v.ecart), R_SOLEIL * 2.5 - n);
    const c = [milieu[0] + dir[0] * pousse, milieu[1] + dir[1] * pousse];
    const longueur = Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1]);
    return { a, b, c, longueur };
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
      const courbe = this._courbe(v);
      const saturation = this.saturation.get(cleCible(v.cible)) ?? 0;
      const pres = versApp(v.flux) ? v.s < ZONE_BOUCHON : v.s > 1 - ZONE_BOUCHON;
      v.bouchon = saturation > 0 && pres;
      let visee = v.vitesse;
      if (v.bouchon) visee *= 1 - 0.85 * saturation * (0.6 + 0.4 * Math.sin(maintenant / 400 + v.id));
      v.vitesseActuelle += (visee - v.vitesseActuelle) * Math.min(1, dt * 4);
      v.s += (v.vitesseActuelle * dt) / Math.max(40, courbe.longueur);
    }
    this.vehicules = this.vehicules.filter(v => v.s < 1 || (v === this.suivi && v.app.lot));
    if (this.suivi && this.suivi.s >= 1) this.suivi = null;
  }

  position(v) {
    const { a, b, c } = this._courbe(v);
    const t = Math.min(1, Math.max(0, v.s));
    const u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0];
    const y = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
    const dx = 2 * u * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
    const dy = 2 * u * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
    return { x, y, angle: Math.atan2(dy, dx) };
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
