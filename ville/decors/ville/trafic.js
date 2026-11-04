// Trafic : transforme les débits disque et réseau de chaque application en véhicules qui circulent.
//   lecture disque  : de l'entrepôt vers l'application (bleu)
//   écriture disque : de l'application vers l'entrepôt (orange)
//   réseau          : entre l'application et l'aéroport (vert), débit estimé (§11 du CDC)
// Les véhicules accélèrent et freinent progressivement, gardent leurs distances, s'arrêtent
// aux feux rouges et font le tour des ronds-points.
// Embouteillages (F11) : quand un disque ou la carte réseau sature, ils ralentissent
// en approchant de l'entrepôt ou de l'aéroport et font la queue.
// Autoroutes (§4) : un gros flux soutenu ouvre une autoroute numérotée, en ligne droite
// au-dessus de la ville, que ses véhicules empruntent ; elle disparaît quand le flux retombe.

export const COULEURS_FLUX = {
  lecture: '#3FA9E0',
  ecriture: '#F2A541',
  recu: '#3DBE7A',
  envoye: '#3DBE7A',
};

export const GABARITS = {
  voiture: { longueur: 11, largeur: 6, vitesse: 115, nom: 'Voiture' },
  camionnette: { longueur: 15, largeur: 7, vitesse: 100, nom: 'Camionnette' },
  camion: { longueur: 22, largeur: 8, vitesse: 85, nom: 'Camion' },
};

const MAX_VEHICULES = 300;
const DEPARTS_PAR_SECONDE = 8;  // au plus, tous flux confondus (les plus forts d'abord)
const SEUIL = 256;           // en dessous de 256 octets/s, pas de véhicule
export const VOIE = 5;       // décalage vers la droite de la chaussée
const ZONE_BOUCHON = 320;    // longueur de route, avant l'entrepôt ou l'aéroport, où se forme la file
const ESPACE = 4;            // espace entre deux véhicules arrêtés
const FILE_MAX = 22;         // véhicules au plus dans la zone d'un bouchon, par sens
const ACCELERATION = 140;    // px/s² : de l'arrêt à la pleine vitesse en moins d'une seconde
export const FONDU = 24;     // px : un véhicule apparaît et s'efface en fondu sur cette longueur de trajet
const ANNEAU_MAX = 9;      // véhicules au plus sur l'anneau d'un rond-point (plein, il se bloquerait)
const FREINAGE = 240;        // px/s²
const VITESSE_AUTOROUTE = 1.5;
export const ECART_VOIES = 9; // px entre les deux voies d'un même sens sur l'autoroute (2 × 2 voies)
export const FUSION = 220;    // px avant la bretelle de sortie où la voie de droite se termine en biseau
const CASE = 40;             // taille des cases de la grille de voisinage

// Cycle des feux, en secondes : vert puis orange pour les rues horizontales, puis pour les verticales.
const VERT = 4;
const ORANGE = 1;
const CYCLE_FEUX = 2 * (VERT + ORANGE);

const versApp = flux => flux === 'lecture' || flux === 'recu';
export const cleCible = cible => (cible.type === 'aeroport' ? 'aeroport' : `disque:${cible.entrepot.disque.id}`);

// 0 (fluide) → 1 (saturé), d'après l'occupation en % et les seuils de config.json.
function niveau(occupation, debut, plein) {
  if (occupation == null) return 0;
  return Math.max(0, Math.min(1, (occupation - debut) / (plein - debut)));
}

// Nombre de véhicules par relevé : 1 dès 256 o/s, puis +1 chaque fois que le débit est multiplié par 8
// (6 véhicules à partir de 8 Mo/s environ).
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
  // seuils : config.json « embouteillages » ; reglesAutoroutes : config.json « autoroutes ».
  // forcer : embouteillages imposés pour un aperçu ('disque', 'reseau' ou 'tout').
  constructor(ville, seuils, reglesAutoroutes, forcer = '') {
    this.ville = ville;
    this.seuils = seuils;
    this.reglesAutoroutes = reglesAutoroutes;
    this.forcer = forcer;
    this.forcerAutoroutes = false;
    this.vehicules = [];
    this.aVenir = [];
    this.saturation = new Map();  // cleCible -> 0 (fluide) à 1 (saturé)
    this.autoroutes = new Map();  // application|cible -> autoroute (active ou en train de disparaître)
    this.horloge = 0;             // secondes de ville écoulées (s'arrête pendant la pause) : feux, autoroutes
    this.etatsFeux = new Map();   // clé du feu -> { actif, debut, premier, vu } (les feux sont recréés à chaque relevé)
    this._enFile = new Map();
  }

  mesurerSaturation(etat) {
    const s = this.seuils;
    const tout = this.forcer === 'tout';
    this.saturation = new Map();
    for (const d of etat.disques) {
      const n = niveau(d.occupation, s.disque_debut_pct, s.disque_plein_pct);
      this.saturation.set(`disque:${d.id}`, tout || this.forcer === 'disque' ? 1 : n);
    }
    const n = niveau(etat.systeme.reseau_occupation, s.reseau_debut_pct, s.reseau_plein_pct);
    this.saturation.set('aeroport', tout || this.forcer === 'reseau' ? 1 : n);
  }

  // ---------- Feux tricolores ----------

  // État d'un feu pour une rue horizontale ('h') ou verticale ('v') : 'eteint' (on passe), 'vert',
  // 'orange' ou 'rouge'. Un feu ne s'allume que s'il y a du monde des deux côtés du carrefour.
  etatFeu(feu, axe) {
    const s = this.etatsFeux.get(feu.cle);
    if (!s?.actif) return 'eteint';
    // La rue où le premier véhicule est arrivé passe au vert en premier.
    let t = (this.horloge - s.debut) % CYCLE_FEUX;
    if (axe !== s.premier) t = (t + VERT + ORANGE) % CYCLE_FEUX;
    if (t < VERT) return 'vert';
    if (t < VERT + ORANGE) return 'orange';
    return 'rouge';
  }

  // Allume un feu quand des véhicules approchent par les deux rues, l'éteint 3 s après.
  // Allumé, il reste réactif : si personne n'arrive par l'autre rue depuis 1 s, la rue qui attend
  // passe tout de suite au vert (pas besoin d'orange : il n'y a personne à arrêter).
  _majFeux(demandes) {
    for (const feu of this.ville.feux ?? []) {
      const d = demandes.get(feu.cle);
      const s = this.etatsFeux.get(feu.cle) ?? { actif: false, vuH: -1e9, vuV: -1e9 };
      if (d?.h) s.vuH = this.horloge;
      if (d?.v) s.vuV = this.horloge;
      if (d?.h && d?.v) {
        s.vu = this.horloge;
        if (!s.actif) Object.assign(s, { actif: true, debut: this.horloge, premier: d.hMin <= d.vMin ? 'h' : 'v' });
      } else if (s.actif && this.horloge - s.vu > 3) {
        s.actif = false;
      }
      if (s.actif) {
        for (const [axe, autre] of [['h', 'vuV'], ['v', 'vuH']]) {
          if (d?.[axe] && this.horloge - s[autre] > 1 && this.etatFeu(feu, axe) === 'rouge') {
            Object.assign(s, { debut: this.horloge, premier: axe });
          }
        }
      }
      this.etatsFeux.set(feu.cle, s);
    }
  }

  // ---------- Autoroutes ----------

  // Une autoroute s'ouvre quand le débit d'une application vers une cible dépasse le seuil pendant
  // la durée voulue, et se ferme quand il reste sous la moitié du seuil pendant la même durée.
  _majAutoroutes(flux, periodeMs) {
    const r = this.reglesAutoroutes;
    const seuil = r.seuil_ko_s * 1024;
    const releves = Math.max(1, Math.round((r.duree_s * 1000) / periodeMs));
    const cle = f => `${f.app.id}|${cleCible(f.cible)}`;
    // Aperçu (touche A) : les trois flux les plus forts ont leur autoroute tout de suite.
    const forces = new Set(this.forcerAutoroutes
      ? flux.filter(f => f.debit > 0).sort((a, b) => b.debit - a.debit).slice(0, 3).map(cle)
      : []);
    const vus = new Set();
    for (const f of flux) {
      const k = cle(f);
      vus.add(k);
      const a = this.autoroutes.get(k) ?? { cle: k, fort: 0, faible: 0, active: false };
      Object.assign(a, { app: f.app, cible: f.cible, debit: f.debit });
      if (f.debit >= seuil) { a.fort++; a.faible = 0; } else if (f.debit < seuil / 2) { a.faible++; a.fort = 0; }
      if (!a.active && (forces.has(k) || a.fort >= releves)) this._ouvrir(a, forces.has(k));
      // Une autoroute d'aperçu se ferme à la fin de l'aperçu, sauf si le flux réel la justifie.
      else if (a.active && !forces.has(k) && (a.force ? a.debit < seuil : a.faible >= releves)) this._fermer(a);
      this.autoroutes.set(k, a);
    }
    for (const a of this.autoroutes.values()) if (a.active && !vus.has(a.cle)) this._fermer(a);
  }

  _ouvrir(a, force) {
    if (a.numero === undefined) {
      // Plus petit numéro libre (une autoroute qui finit de disparaître garde encore le sien).
      const pris = new Set([...this.autoroutes.values()].map(x => x.numero));
      a.numero = 1;
      while (pris.has(a.numero)) a.numero++;
      a.apparition = this.horloge;
    }
    Object.assign(a, { active: true, force, finUsage: null });
  }

  _fermer(a) {
    a.active = false;
    a.fort = 0;
  }

  // Tracé d'une autoroute et part déjà dessinée (0 → 1) : elle s'étire en apparaissant
  // et se rétracte vers sa cible en disparaissant.
  geometrieAutoroute(a) {
    // Géométrie gardée tant que le plan de la ville ne change pas (appelée plusieurs fois par image).
    if (a._geometrie?.version !== this.ville.version || a._geometrie.app !== a.app) {
      a._geometrie = { version: this.ville.version, app: a.app, trajet: this.ville.trajetAutoroute(a.app, a.cible) };
    }
    const trajet = a._geometrie.trajet;
    if (!trajet) return null;
    const debut = Math.min(1, (this.horloge - a.apparition) / 1);
    const fin = a.finUsage === null ? 0 : Math.min(1, (this.horloge - a.finUsage) / 1);
    return { points: trajet.ruban, de: fin, a: debut, rampes: trajet.rampes, echangeurs: trajet.echangeurs, peage: trajet.peage,
      departSortie: trajet.departSortie };
  }

  // ---------- Départs ----------

  // Appelé à chaque relevé : prévoit les départs des véhicules sur la période qui vient.
  // Avec « immediat » (ouverture, sortie de pause), la circulation est recréée d'un coup,
  // véhicules déjà répartis le long des routes, comme si la ville tournait depuis longtemps.
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

    // Débits de chaque application vers chaque cible
    const flux = [];
    for (const app of ouvertes) {
      const d = app.donnees;
      const entrepot = v.entrepots?.find(e => e.disque.id === d.disque) ?? v.entrepots?.[0];
      if (entrepot) {
        flux.push({ app, cible: { type: 'entrepot', entrepot }, debits: { lecture: d.lecture, ecriture: d.ecriture } });
      }
      if (connexions && d.connexions) {
        const part = d.connexions / connexions;
        flux.push({ app, cible: { type: 'aeroport' }, debits: { recu: s.reseau_recu * part, envoye: s.reseau_envoye * part } });
      }
    }
    for (const f of flux) f.debit = Object.values(f.debits).reduce((a, b) => a + b, 0);
    this._majAutoroutes(flux, periodeMs);

    let departs = [];
    for (const f of flux) {
      const autoroute = this.autoroutes.get(`${f.app.id}|${cleCible(f.cible)}`);
      for (const [type, debit] of Object.entries(f.debits)) {
        const n = nombreDeVehicules(debit);
        for (let i = 0; i < n; i++) {
          departs.push({
            quand: maintenant + Math.random() * periodeMs, app: f.app, flux: type, debit, cible: f.cible,
            gabarit: gabarit(debit), autoroute: autoroute?.active ? autoroute : null,
          });
        }
      }
    }
    // Budget de départs : au-delà, la ville serait en surcharge permanente (mesuré : 31 départs/s
    // avec ~90 applications, soit ~530 véhicules en route pour 300 places, et des files partout).
    // Les flux les plus forts passent d'abord ; les tout petits ne sont plus dessinés.
    const budget = Math.round(DEPARTS_PAR_SECONDE * periodeMs / 1000);
    if (departs.length > budget) departs = departs.sort((a, b) => b.debit - a.debit).slice(0, budget);

    for (const depart of departs) {
      if (!immediat) {
        this.aVenir.push(depart);
        continue;
      }
      // Régime établi : un départ par période depuis toute la durée du trajet.
      const modele = this._creer(depart);
      if (!modele) continue;
      const enRoute = Math.max(1, Math.round(modele.longueurTotale / modele.vitesse / (periodeMs / 1000)));
      for (let k = 0; k < enRoute && this.vehicules.length < MAX_VEHICULES; k++) {
        const vehicule = k === 0 ? modele : this._creer(depart);
        // Quelques essais pour trouver une place libre le long du trajet ; sinon, pas de véhicule.
        for (let essai = 0; essai < 6; essai++) {
          vehicule.distance = Math.random() * vehicule.longueurTotale;
          vehicule.enHauteur = !!vehicule.hauteur && vehicule.distance > vehicule.hauteur[0] && vehicule.distance < vehicule.hauteur[1];
          if (this._placeLibre(vehicule)) {
            vehicule.prevu = vehicule.distance;
            vehicule.forme = this._carrosserie(vehicule);
            this.vehicules.push(vehicule);
            break;
          }
        }
      }
    }
  }

  // Vers une cible saturée, la file a une longueur limitée et la sortie de l'entrepôt doit être libre :
  // sinon le départ est abandonné. Des véhicules en attente invisibles occuperaient tout le quota
  // et la circulation s'arrêterait dans le reste de la ville.
  _peutPartir(depart) {
    if (!((this.saturation.get(cleCible(depart.cible)) ?? 0) > 0)) return true;
    const cle = cleCible(depart.cible) + (versApp(depart.flux) ? '<' : '>');
    if ((this._enFile.get(cle) ?? 0) >= FILE_MAX) return false;
    return !versApp(depart.flux) || !this.vehicules.some(v => v.cible.type === depart.cible.type
      && cleCible(v.cible) === cleCible(depart.cible) && versApp(v.flux) && v.distance < 30);
  }

  // ---------- Déplacements ----------

  avancer(dt, maintenant) {
    this.horloge += dt;
    if (this.versionPlan !== this.ville.version) this._retracer();

    // Départs prévus. Un véhicule ne part que si sa place de départ est libre ; sinon il réessaie
    // un peu plus tard, et renonce au bout de 4 s.
    const restants = [];
    for (const depart of this.aVenir) {
      if (depart.quand > maintenant) { restants.push(depart); continue; }
      if (this.vehicules.length >= MAX_VEHICULES || !this._peutPartir(depart)) continue;
      if (depart.autoroute && !depart.autoroute.active) depart.autoroute = null;
      const vehicule = this._creer(depart);
      if (!vehicule) continue;
      if (this._placeLibre(vehicule)) {
        this.vehicules.push(vehicule);
      } else if (maintenant - (depart.prevuA ??= depart.quand) < 4000) {
        depart.quand = maintenant + 250;
        restants.push(depart);
      }
    }
    this.aVenir = restants;

    // 1. Vitesse visée : normale, réduite en accordéon dans un bouchon, nulle avant un feu rouge.
    //    La vitesse réelle la rejoint progressivement (accélération et freinage), sans à-coup.
    const enFile = new Map();
    const demandes = new Map();   // feu -> rues d'où arrivent des véhicules
    const rondsPoints = this.ville.rondsPoints ?? [];
    for (const v of this.vehicules) {
      const saturation = this.saturation.get(cleCible(v.cible)) ?? 0;
      const dCible = versApp(v.flux) ? v.distance : v.longueurTotale - v.distance;
      v.ici = this.position(v);
      v.enHauteur = !!v.hauteur && v.distance > v.hauteur[0] && v.distance < v.hauteur[1];
      v.bouchon = saturation > 0 && dCible < ZONE_BOUCHON;
      // Boost : un véhicule retardé (feux, ronds-points) roule plus vite pour retrouver la place que
      // lui donnent les données en direct. Pas dans un bouchon : ce retard-là est réel.
      const retard = v.prevu - v.distance;
      let visee = v.vitesse * (retard > 4 && !v.bouchon ? Math.min(2, 1 + retard / 200) : 1);
      v.boost = visee > v.vitesse * 1.05;
      // Rond-point : on ralentit à l'approche et sur l'anneau, où l'on a la priorité (voir plus bas).
      v.surAnneau = false;
      if (!v.enHauteur) {
        for (const r of rondsPoints) {
          const d = Math.hypot(v.ici.x - r.x, v.ici.y - r.y);
          if (d < r.r + 50) visee = Math.min(visee, v.vitesse * 0.7);
          if (d < r.r + 12) v.surAnneau = true;
        }
      }
      if (v.bouchon) {
        // Une onde d'arrêts et de redémarrages remonte la file.
        const onde = 0.5 + 0.5 * Math.sin(maintenant / 650 - dCible / 30);
        visee *= (1 - 0.75 * saturation) * (1 - 0.7 * saturation * onde);
        const cle = cleCible(v.cible) + (versApp(v.flux) ? '<' : '>');
        enFile.set(cle, (enFile.get(cle) ?? 0) + 1);
      }
      v.stop = null;
      const feu = this._prochainFeu(v);
      if (feu) {
        const reste = feu.dStop - v.distance;
        if (reste < 140) {
          const d = demandes.get(feu.feu.cle) ?? { hMin: Infinity, vMin: Infinity };
          d[feu.axe] = true;
          d[`${feu.axe}Min`] = Math.min(d[`${feu.axe}Min`], reste);
          demandes.set(feu.feu.cle, d);
        }
        const etat = this.etatFeu(feu.feu, feu.axe);
        // Au rouge comme à l'orange, on passe si l'on est trop près pour s'arrêter sans piler.
        if ((etat === 'rouge' || etat === 'orange') && reste > (v.vitesseActuelle ** 2) / (2 * FREINAGE)) {
          visee = Math.min(visee, Math.sqrt(FREINAGE * Math.max(0, reste)));
          v.stop = feu.dStop;
        }
      }
      const avant = v.vitesseActuelle;
      v.vitesseActuelle = visee < avant
        ? Math.max(visee, avant - FREINAGE * dt)
        : Math.min(visee, avant + ACCELERATION * dt);
      v.freine = v.vitesseActuelle < avant - 1e-6 || v.vitesseActuelle < v.vitesse * 0.4;
      v.prochaine = v.distance + v.vitesseActuelle * dt;
      if (v.stop !== null) v.prochaine = Math.min(v.prochaine, Math.max(v.distance, v.stop));
      v.raison = v.stop !== null ? 'feu' : (v.bouchon ? 'bouchon' : null);
      v.devant = null;
    }
    this._enFile = enFile;
    this._majFeux(demandes);

    // 2. Aucune superposition : un véhicule n'avance jamais là où il toucherait un autre véhicule,
    //    quel que soit son sens (voir _resoudreCollisions).
    this._resoudreCollisions(rondsPoints);

    // 3. Déplacement ; un véhicule bloqué voit sa vitesse retomber à ce qu'il a pu parcourir.
    //    La place « prévue » avance à vitesse normale, sauf dans un bouchon (retard réel, pas rattrapé).
    for (const v of this.vehicules) {
      v.attente = v.prochaine - v.distance < 0.05 ? (v.attente ?? 0) + dt : 0;
      // Changement de voie sur l'autoroute, en un peu plus d'une demi-seconde.
      if (v.voies) v.couloirActuel += (v.couloir - v.couloirActuel) * Math.min(1, dt * 4);
      if (dt > 0) v.vitesseActuelle = Math.min(v.vitesseActuelle, (v.prochaine - v.distance) / dt);
      v.prevu = v.bouchon ? v.prevu + (v.prochaine - v.distance) : Math.min(v.longueurTotale, v.prevu + v.vitesse * dt);
      v.distance = v.prochaine;
    }
    this.vehicules = this.vehicules.filter(v => v.distance < v.longueurTotale || v === this.suivi);
    if (this.suivi && this.suivi.distance >= this.suivi.longueurTotale) this.suivi = null;

    // Une autoroute fermée disparaît quand son dernier véhicule est arrivé.
    const utilisees = new Set(this.vehicules.filter(v => v.autoroute).map(v => v.autoroute));
    for (const a of this.autoroutes.values()) {
      if (a.active || a.numero === undefined || utilisees.has(a)) continue;
      if (a.finUsage === null) a.finUsage = this.horloge;
      if (this.horloge - a.finUsage > 1) {
        delete a.numero;
        a.finUsage = null;
      }
    }
  }

  // ---------- Aucune superposition ----------

  // Carrosserie d'un véhicule, couverte par 2 ou 3 disques alignés (à la distance « d » de son trajet).
  _carrosserie(v, d = v.distance) {
    const p = this.position(v, d);
    const g = GABARITS[v.gabarit];
    const r = g.largeur / 2 + 0.5;
    const k = Math.max(0, g.longueur / 2 - r);
    const n = g.longueur > 16 ? 3 : 2;
    const [cos, sin] = [Math.cos(p.angle), Math.sin(p.angle)];
    const centres = [];
    for (let i = 0; i < n; i++) {
      const t = -k + (2 * k * i) / (n - 1);
      centres.push(p.x + cos * t, p.y + sin * t);
    }
    return { x: p.x, y: p.y, angle: p.angle, cos, sin, r, centres };
  }

  // Priorité quand deux véhicules se disputent la même place : l'anneau d'un rond-point d'abord (sinon
  // il se bloquerait), puis celui qui s'insère (il est en courbe : bretelle, virage), puis les avenues
  // et la rocade, puis les rues et allées. Donner la main à celui qui s'insère évite qu'il attende
  // indéfiniment une place qui ne se libère jamais.
  //   Un véhicule qui attend depuis plus d'1 s passe devant tout le monde : chacun son tour (comme une
  //   fermeture éclair), sinon un flot continu d'insertions bloquerait l'avenue indéfiniment.
  _priorite(v, c) {
    if ((v.attente ?? 0) > 1) return 5;
    if (v.surAnneau) return 4;
    if (Math.min(Math.abs(c.cos), Math.abs(c.sin)) > 0.2) return 3;
    const [X, Y] = [this.ville.X ?? [], this.ville.Y ?? []];
    const vertical = Math.abs(c.sin) > Math.abs(c.cos);
    return (vertical ? X.some(x => Math.abs(c.x - x) < 9) : Y.some(y => Math.abs(c.y - y) < 9)) ? 2 : 1;
  }

  // Deux carrosseries se touchent-elles ? « marge » : espace minimal voulu entre elles.
  _touche(a, b, marge) {
    const seuil = a.r + b.r + marge;
    for (let i = 0; i < a.centres.length; i += 2) {
      for (let j = 0; j < b.centres.length; j += 2) {
        if (Math.hypot(a.centres[i] - b.centres[j], a.centres[i + 1] - b.centres[j + 1]) < seuil) return true;
      }
    }
    return false;
  }

  // Le véhicule v (à sa position candidate « c ») doit-il céder devant o ?
  //   même sens : on suit celui qui est devant ; sens opposé : voies séparées, on s'ignore ;
  //   croisement : celui qui a l'autre devant lui s'arrête ; si chacun a l'autre devant lui,
  //   la priorité (anneau > avenue > rue) départage, puis l'ancienneté.
  //   Deux véhicules qui se rejoignent en biais (insertion) ont souvent chacun l'autre devant eux :
  //   la priorité tranche, sinon chacun attendrait l'autre indéfiniment.
  //   Aux croisements (sens perpendiculaires), on ne bloque pas : les feux s'en chargent, et un
  //   blocage mutuel à plusieurs y deviendrait inextricable (essayé : la ville se fige en 30 s).
  //   Seule exception : pour entrer dans un rond-point, on attend un trou dans l'anneau.
  _cede(v, c, o, oc) {
    const cosRelatif = c.cos * oc.cos + c.sin * oc.sin;
    if (cosRelatif < 0.6) {
      if (v.surAnneau || !o.surAnneau || cosRelatif < -0.6 || (v.attente ?? 0) > 3) return false;
      if (!this._touche(c, oc, 1.5)) return false;
      // Un entrant déjà passé devant le véhicule de l'anneau continue (celui-ci le suit).
      const vPasse = (c.x - oc.x) * oc.cos + (c.y - oc.y) * oc.sin > 0;
      const oDevantV = (oc.x - c.x) * c.cos + (oc.y - c.y) * c.sin > 0;
      return !(vPasse && !oDevantV);
    }
    const avance = (oc.x - c.x) * c.cos + (oc.y - c.y) * c.sin;
    // Deux véhicules exactement au même endroit : le plus récent cède, et la pile se défait.
    const vDevant = avance > 0.5 || (Math.abs(avance) <= 0.5 && v.id > o.id);   // o est devant v
    if (!vDevant || !this._touche(c, oc, ESPACE)) return false;
    // Insertion : on ne tient compte que de celui qui est déjà dans sa voie ; celui qui s'insère
    // (encore décalé) attend un trou, et s'il attend depuis plus d'1 s, on lui laisse la place.
    // Voie d'à côté : ignorée seulement si les deux carrosseries ne se touchent pas de flanc (voies de
    // l'autoroute écartées de 9 px) ; un véhicule à mi-chemin d'un changement de voie compte pour les
    // deux voies, donc personne ne lui rentre dedans.
    const decalage = Math.abs((oc.y - c.y) * c.cos - (oc.x - c.x) * c.sin);
    const flanc = (GABARITS[v.gabarit].largeur + GABARITS[o.gabarit].largeur) / 2 + 0.5;
    if (decalage > flanc && !((o.attente ?? 0) > 1 && decalage < 12)) return false;
    const oDevant = (c.x - oc.x) * oc.cos + (c.y - oc.y) * oc.sin > 0;   // v est devant o
    if (!oDevant) return true;
    const [pv, po] = [this._priorite(v, c), this._priorite(o, oc)];
    return pv < po || (pv === po && v.id > o.id);
  }

  _resoudreCollisions(rondsPoints) {
    // Grille de voisinage ; les véhicules sur une autoroute ne gênent pas ceux qui roulent dessous.
    // Près d'une jonction sol / pont, un véhicule est sur les deux niveaux : sinon celui qui arrive
    // au sol ne verrait pas celui qui vient de monter juste devant lui, et ils s'empileraient.
    const niveaux = v => {
      if (!v.hauteur) return ['S'];
      const pres = Math.abs(v.distance - v.hauteur[0]) < 20 || Math.abs(v.distance - v.hauteur[1]) < 20;
      return pres ? ['A', 'S'] : [v.enHauteur ? 'A' : 'S'];
    };
    const grille = new Map();
    for (const v of this.vehicules) {
      v.forme = this._carrosserie(v);
      v.niveaux = niveaux(v);
      for (const n of v.niveaux) {
        const k = `${n}${Math.floor(v.forme.x / CASE)},${Math.floor(v.forme.y / CASE)}`;
        if (!grille.has(k)) grille.set(k, []);
        grille.get(k).push(v);
      }
    }
    // On n'entre dans un rond-point que s'il n'est pas presque plein : un anneau plein se bloquerait.
    const surAnneau = new Map(rondsPoints.map(r => [r, 0]));
    for (const v of this.vehicules) {
      if (!v.surAnneau) continue;
      for (const r of rondsPoints) if (Math.hypot(v.forme.x - r.x, v.forme.y - r.y) < r.r + 12) surAnneau.set(r, surAnneau.get(r) + 1);
    }

    // Les plus prioritaires bougent d'abord ; les autres tiennent compte de leur nouvelle place.
    const ordre = this.vehicules.slice().sort((a, b) => this._priorite(b, b.forme) - this._priorite(a, a.forme));
    for (const v of ordre) {
      if (v.prochaine <= v.distance) continue;
      if (!v.surAnneau && !v.enHauteur) {
        // Seulement si le trajet entre vraiment dans l'anneau dans les 30 px qui viennent (une boucle
        // d'échangeur qui passe à côté d'un rond-point n'est pas concernée).
        const plus30 = this.position(v, Math.min(v.longueurTotale, v.distance + 30));
        const plein = rondsPoints.find(r => Math.hypot(plus30.x - r.x, plus30.y - r.y) < r.r + 12
          && Math.hypot(v.forme.x - r.x, v.forme.y - r.y) >= r.r + 12 && surAnneau.get(r) >= ANNEAU_MAX);
        if (plein) { this._bloquer(v, v.distance, 'rond-point', null); continue; }
      }
      const voisins = new Set();
      const [cx, cy] = [Math.floor(v.forme.x / CASE), Math.floor(v.forme.y / CASE)];
      for (const n of v.niveaux) for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const o of grille.get(`${n}${cx + i},${cy + j}`) ?? []) {
            // Un véhicule qui arrive (il s'efface au bout de son trajet) ne gêne plus personne.
            if (o === v || o.longueurTotale - o.distance < FONDU) continue;
            voisins.add(o);
          }
        }
      }
      const bloque = d => {
        const c = this._carrosserie(v, d);
        for (const o of voisins) if (this._cede(v, c, o, o.forme)) return o;
        return null;
      };
      // Avance vérifiée par pas de 5 px : quand l'image ralentit (PC chargé), un véhicule rapide
      // parcourt 20 à 30 px d'un coup et sauterait par-dessus celui de devant.
      let gene = null;
      let [libre, butee] = [v.distance, v.prochaine];
      const pas = Math.max(1, Math.ceil((v.prochaine - v.distance) / 5));
      for (let k = 1; k <= pas; k++) {
        const d = v.distance + (v.prochaine - v.distance) * k / pas;
        gene = bloque(d);
        if (gene) { butee = d; break; }
        libre = d;
      }
      // Autoroute : on roule à droite (couloir 1, extérieur) et on ne double que par la gauche
      // (couloir 0, près du centre). Gêné à droite : on passe à gauche si elle est libre à sa hauteur
      // et devant. À gauche : on se rabat dès que la droite est libre, sauf si l'on est bloqué derrière
      // un véhicule plus lent (on ne double jamais par la droite).
      //   Sortie (fin des 2 voies avant la bretelle) : la voie de droite disparaît sur FUSION px ; on s'y
      //   rabat à gauche dès qu'il y a un trou, et au bout on s'insère un sur deux (fermeture éclair).
      const finVoies = v.voies && v.voies[1] < v.longueurTotale - 1 ? v.voies[1] - v.distance : Infinity;
      if (v.voies && v.distance >= v.voies[0] && Math.abs(v.couloirActuel - v.couloir) < 0.05) {
        const essai = couloir => {
          const actuel = v.couloirActuel;
          v.couloirActuel = couloir;
          const place = !bloque(v.distance) && !bloque(v.prochaine) && !bloque(v.prochaine + 25);
          v.couloirActuel = actuel;
          return place;
        };
        if (v.couloir === 1 && finVoies < FUSION) {
          if (essai(0)) v.couloir = 0;
        } else if (v.enHauteur) {
          if (v.couloir === 1 && gene && essai(0)) v.couloir = 0;
          else if (v.couloir === 0 && !gene && finVoies > FUSION + 80 && essai(1)) v.couloir = 1;
        }
      }
      if (gene) {
        // Plus grande avance possible sans toucher personne (recherche par dichotomie).
        let [ok, ko] = [libre, butee];
        if (ok === v.distance && bloque(ok)) ko = ok;
        for (let i = 0; i < 6 && ko - ok > 0.2; i++) {
          const milieu = (ok + ko) / 2;
          if (bloque(milieu)) ko = milieu; else ok = milieu;
        }
        this._bloquer(v, ok, 'file', gene);
      }
      v.forme = this._carrosserie(v, v.prochaine);
    }
  }

  _bloquer(v, distance, raison, gene) {
    v.prochaine = Math.max(v.distance, Math.min(v.prochaine, distance));
    v.freine = true;
    v.raison ??= raison;
    v.devant = gene;
  }

  // Le plan de la ville a changé (un quartier s'est agrandi…) : chaque véhicule reprend son trajet
  // recalculé sur le nouveau plan, à la même proportion du parcours.
  _retracer() {
    this.versionPlan = this.ville.version;
    const entrepots = this.ville.entrepots ?? [];
    this.vehicules = this.vehicules.filter(v => {
      if (v.cible.type === 'entrepot') {
        const e = entrepots.find(x => x.disque.id === v.cible.entrepot.disque.id);
        if (!e) return false;
        v.cible = { type: 'entrepot', entrepot: e };
      }
      if (v.autoroute && !v.autoroute.active) v.autoroute = null;
      const neuf = this._creer(v);
      if (!neuf) return false;
      const part = v.distance / v.longueurTotale;
      const partPrevue = v.prevu / v.longueurTotale;
      for (const cle of ['points', 'longueurs', 'longueurTotale', 'hauteur', 'voies', 'feux']) v[cle] = neuf[cle];
      v.distance = part * v.longueurTotale;
      v.prevu = partPrevue * v.longueurTotale;
      v.iFeu = 0;
      return true;
    });
  }

  // La place de départ est-elle libre ? (on ne fait jamais apparaître un véhicule sur un autre)
  _placeLibre(v) {
    const c = this._carrosserie(v);
    return !this.vehicules.some(o => {
      if (!!o.enHauteur !== !!v.enHauteur) return false;
      const oc = o.forme ?? this._carrosserie(o);
      if (Math.hypot(oc.x - c.x, oc.y - c.y) > 30) return false;
      return (c.cos * oc.cos + c.sin * oc.sin) >= -0.5 && this._touche(c, oc, ESPACE);
    });
  }

  _prochainFeu(v) {
    while (v.iFeu < v.feux.length && v.feux[v.iFeu].dStop < v.distance - 0.5) v.iFeu++;
    return v.feux[v.iFeu] ?? null;
  }

  _creer(depart) {
    const surAutoroute = !!depart.autoroute;
    const inverse = versApp(depart.flux);
    // Sur autoroute, chaque sens a ses propres bretelles : on prend le trajet du sens voulu tel quel.
    const id = depart.id ?? (this._compteur = (this._compteur ?? 0) + 1);
    const autoroute = surAutoroute ? this.ville.trajetAutoroute(depart.app, depart.cible) : null;
    const branche = autoroute ? (inverse ? autoroute.retour : autoroute.aller) : null;
    const trajet = branche ? branche.points : this.ville.trajet(depart.app, depart.cible);
    if (!trajet || trajet.length < 2) return null;
    const points = decaler(branche || !inverse ? trajet : trajet.slice().reverse(), VOIE);
    const longueurs = [0];
    for (let i = 1; i < points.length; i++) {
      longueurs.push(longueurs[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    // Partie en hauteur (ponts des bretelles et autoroute) et partie à 2 voies par sens (autoroute,
    // péage et route jusqu'à la cible), en distance le long du trajet.
    const hauteur = branche ? [longueurs[branche.haut[0]], longueurs[branche.haut[1]]] : null;
    const voies = branche ? [longueurs[branche.voies[0]], longueurs[branche.voies[1]]] : null;
    const g = GABARITS[depart.gabarit];
    const vitesse = g.vitesse * (0.9 + Math.random() * 0.2) * (surAutoroute ? VITESSE_AUTOROUTE : 1);
    // Les feux comptent seulement dans les rues, pas sur l'autoroute.
    const feux = feuxDuTrajet(this.ville.feux ?? [], points, longueurs, g.longueur)
      .filter(f => !hauteur || f.dStop < hauteur[0] - 5 || f.dStop > hauteur[1] + 5);
    // Autoroute : on roule dans la voie de droite (couloir 1) ; la gauche sert à doubler. En partant
    // directement du disque (retour), on démarre sur l'une ou l'autre voie, puis on se rabat.
    const couloir = voies ? (voies[0] <= 1 ? id % 2 : 1) : 0;
    return {
      ...depart,
      id,
      couloir,
      couloirActuel: couloir,
      points,
      longueurs,
      longueurTotale: longueurs[longueurs.length - 1],
      distance: 0,
      prevu: 0,
      vitesse,
      vitesseActuelle: vitesse,
      couleur: COULEURS_FLUX[depart.flux],
      hauteur,
      voies,
      feux,
      iFeu: 0,
    };
  }

  // Position et orientation d'un véhicule le long de son trajet (à sa distance actuelle, ou à « distance »).
  // Sur l'autoroute (2 × 2 voies), le véhicule est décalé vers sa voie : la voie près du centre prolonge
  // la bretelle, l'autre est 9 px plus à l'extérieur ; on y glisse en douceur sur 40 px.
  position(v, distance = v.distance) {
    const d = Math.min(distance, v.longueurTotale);
    let i = 1;
    while (i < v.longueurs.length - 1 && v.longueurs[i] < d) i++;
    const [x1, y1] = v.points[i - 1];
    const [x2, y2] = v.points[i];
    const segment = v.longueurs[i] - v.longueurs[i - 1] || 1;
    const t = (d - v.longueurs[i - 1]) / segment;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    let x = x1 + (x2 - x1) * t;
    let y = y1 + (y2 - y1) * t;
    if (v.voies && v.couloirActuel) {
      // Pas de resserrement au bout qui touche la cible : péage et route y arrivent avec leurs 4 voies.
      const entree = v.voies[0] > 1 ? (d - v.voies[0]) / 40 : 1;
      // À la sortie, celui qui n'a pas pu se rabattre suit le biseau dessiné (70 px).
      const sortie = v.voies[1] < v.longueurTotale - 1 ? (v.voies[1] - d) / 70 : 1;
      const k = Math.max(0, Math.min(1, entree, sortie));
      // Vers la droite du sens de circulation (l'extérieur du ruban).
      const e = ECART_VOIES * v.couloirActuel * k;
      x += -Math.sin(angle) * e;
      y += Math.cos(angle) * e;
    }
    return { x, y, angle };
  }

  // Véhicule sous le curseur ; ceux des autoroutes, dessinés au-dessus, passent en premier.
  vehiculeEn(x, y) {
    let meilleur = null;
    let distance = 12;
    for (const v of this.vehicules) {
      const p = this.position(v);
      const d = Math.hypot(p.x - x, p.y - y) - (v.enHauteur ? 4 : 0);
      if (d < distance) { distance = d; meilleur = v; }
    }
    return meilleur;
  }
}

// Feux rencontrés le long d'un trajet : distance de la ligne d'arrêt et axe de la rue d'approche.
function feuxDuTrajet(feux, points, longueurs, longueurVehicule) {
  const trouves = [];
  for (const feu of feux) {
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      const l = longueurs[i] - longueurs[i - 1];
      if (l < 1) continue;
      const t = ((feu.x - x1) * (x2 - x1) + (feu.y - y1) * (y2 - y1)) / (l * l);
      if (t < 0 || t > 1) continue;
      if (Math.hypot(x1 + (x2 - x1) * t - feu.x, y1 + (y2 - y1) * t - feu.y) > 9) continue;
      // Ligne d'arrêt à 17 px du centre du carrefour : le véhicule arrêté n'empiète pas sur l'avenue.
      const dStop = longueurs[i - 1] + t * l - 17 - longueurVehicule / 2;
      // Un véhicule qui part juste à côté d'un feu ne s'y arrête pas.
      if (dStop > 2) trouves.push({ feu, dStop, axe: Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? 'h' : 'v' });
      break;
    }
  }
  return trouves.sort((a, b) => a.dStop - b.dStop);
}

// Décale un trajet vers sa droite (circulation à droite), en gardant des angles nets aux virages.
export function decaler(points, decalage) {
  const normales = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const l = Math.hypot(dx, dy) || 1;
    normales.push([-dy / l, dx / l]);
  }
  return points.map((p, i) => {
    const n1 = normales[i - 1] ?? normales[i];
    const n2 = normales[i] ?? normales[i - 1];
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const lm = Math.hypot(mx, my);
    if (lm < 1e-6) return [p[0] + n1[0] * decalage, p[1] + n1[1] * decalage];
    mx /= lm;
    my /= lm;
    const k = decalage / Math.max(0.5, mx * n1[0] + my * n1[1]);
    return [p[0] + mx * k, p[1] + my * k];
  });
}
