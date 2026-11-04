// Trafic : transforme les débits disque et réseau de chaque application en véhicules qui circulent.
//   lecture disque  : de l'entrepôt vers l'application (bleu)
//   écriture disque : de l'application vers l'entrepôt (orange)
//   réseau          : entre l'application et l'aéroport (vert), débit estimé (§11 du CDC)
// Chaque trajet : île de départ → pont 2 × 2 voies → grand rond-point central (l'Étoile, priorité à
// ceux qui entrent) → pont → île d'arrivée. Les véhicules accélèrent et freinent progressivement,
// ne se superposent jamais, s'arrêtent aux feux rouges, roulent à droite sur les ponts et ne doublent
// que par la gauche.
// Embouteillages (F11) : quand un disque ou la carte réseau sature, ils ralentissent
// en approchant de l'entrepôt ou de l'aéroport et font la queue.

export const COULEURS_COURSE = ['#E8504F', '#F2C230', '#3FA9E0', '#FFFFFF'];

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
export const ECART_VOIES = 9; // px entre les deux voies d'un même sens sur un pont (2 × 2 voies)
const ZONE_BOUCHON = 320;    // longueur de route, avant l'entrepôt ou l'aéroport, où se forme la file
const ESPACE = 4;            // espace entre deux véhicules arrêtés
const FILE_MAX = 22;         // véhicules au plus dans la zone d'un bouchon, par sens
const ACCELERATION = 140;    // px/s² : de l'arrêt à la pleine vitesse en moins d'une seconde
const FREINAGE = 240;        // px/s²
export const FONDU = 24;     // px : un véhicule apparaît et s'efface en fondu sur cette longueur de trajet
const ANNEAU_MAX = 110;      // véhicules au plus sur l'Étoile, 2 voies (pleine, elle se bloquerait elle-même)
const BANDE_ANNEAU = 22;     // demi-largeur de l'anneau (on y est « sur l'anneau »)
const VITESSE_PONT = 1.3;    // on roule plus vite sur les ponts 2 × 2 voies
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

// Partie à 2 voies par sens (un pont) qui contient la distance d, ou null.
function pontEn(v, d) {
  return v.voies?.find(([a, b]) => d >= a && d <= b) ?? null;
}

export class Trafic {
  // seuils : config.json « embouteillages ». forcer : embouteillages imposés pour un aperçu
  // ('disque', 'reseau' ou 'tout').
  constructor(ville, seuils, forcer = '') {
    this.ville = ville;
    this.seuils = seuils;
    this.forcer = forcer;
    this.vehicules = [];
    this.aVenir = [];
    this.saturation = new Map();  // cleCible -> 0 (fluide) à 1 (saturé)
    this.horloge = 0;             // secondes de ville écoulées (s'arrête pendant la pause) : feux, courses
    this.etatsFeux = new Map();   // clé du feu -> { actif, debut, premier, vu } (les feux sont recréés à chaque relevé)
    this.courses = [];            // voitures de course de la piste électrique
    this._compteurCourses = 0;
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

  // ---------- Électricité : voitures de course sur la piste de la centrale à la tour ----------

  // Plus la consommation (estimée) est forte, plus il part de voitures, et plus elles vont vite.
  _avancerCourses(dt) {
    const piste = this.ville.centrale?.piste;
    if (!piste) return;
    if (this._piste?.version !== this.ville.version) {
      const longueurs = [0];
      for (let i = 1; i < piste.length; i++) {
        longueurs.push(longueurs[i - 1] + Math.hypot(piste[i][0] - piste[i - 1][0], piste[i][1] - piste[i - 1][1]));
      }
      this._piste = { version: this.ville.version, points: piste, longueurs, longueurTotale: longueurs[longueurs.length - 1] };
    }
    const watts = this.watts ?? 0;
    const vitesse = 260 + watts * 5;
    this._reserveCourses = (this._reserveCourses ?? 0) + dt * watts / 8;   // ~1 voiture par seconde à 8 W
    while (this._reserveCourses >= 1) {
      this._reserveCourses -= 1;
      if (this.courses.length < 40) this.courses.push({ distance: 0, couleur: COULEURS_COURSE[this._compteurCourses++ % COULEURS_COURSE.length] });
    }
    for (const c of this.courses) c.distance += vitesse * dt;
    this.courses = this.courses.filter(c => c.distance < this._piste.longueurTotale);
  }

  positionCourse(c) {
    return this.position({ ...this._piste, distance: c.distance });
  }

  // ---------- Départs ----------

  // Appelé à chaque relevé : prévoit les départs des véhicules sur la période qui vient.
  // Avec « immediat » (ouverture, sortie de pause), la circulation est recréée d'un coup,
  // véhicules déjà répartis le long des routes, comme si la ville tournait depuis longtemps.
  planifier(etat, periodeMs, maintenant, immediat = false) {
    this.aVenir = this.aVenir.filter(d => d.quand > maintenant);
    this.mesurerSaturation(etat);
    this.watts = etat.systeme.watts_estimes ?? 0;
    if (immediat) {
      this.vehicules = [];
      this.suivi = null;
    }
    const v = this.ville;
    const s = etat.systeme;
    const ouvertes = [...v.apps.values()].filter(a => a.lot && a.donnees.etat !== 'ferme');
    const connexions = ouvertes.reduce((n, a) => n + a.donnees.connexions, 0);

    let departs = [];
    const prevoir = (app, flux, debit, cible) => {
      for (let i = 0; i < nombreDeVehicules(debit); i++) {
        departs.push({ quand: maintenant + Math.random() * periodeMs, app, flux, debit, cible, gabarit: gabarit(debit) });
      }
    };
    for (const app of ouvertes) {
      const d = app.donnees;
      const entrepot = v.entrepots?.find(e => e.disque.id === d.disque) ?? v.entrepots?.[0];
      if (entrepot) {
        prevoir(app, 'lecture', d.lecture, { type: 'entrepot', entrepot });
        prevoir(app, 'ecriture', d.ecriture, { type: 'entrepot', entrepot });
      }
      if (connexions && d.connexions) {
        const part = d.connexions / connexions;
        prevoir(app, 'recu', s.reseau_recu * part, { type: 'aeroport' });
        prevoir(app, 'envoye', s.reseau_envoye * part, { type: 'aeroport' });
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
    return !versApp(depart.flux) || !this.vehicules.some(v => cleCible(v.cible) === cleCible(depart.cible)
      && versApp(v.flux) && v.distance < 30);
  }

  // ---------- Déplacements ----------

  avancer(dt, maintenant) {
    this.horloge += dt;
    this._avancerCourses(dt);
    if (this.versionPlan !== this.ville.version) this._retracer();

    // Départs prévus. Un véhicule ne part que si sa place de départ est libre ; sinon il réessaie
    // un peu plus tard, et renonce au bout de 4 s.
    const restants = [];
    for (const depart of this.aVenir) {
      if (depart.quand > maintenant) { restants.push(depart); continue; }
      if (this.vehicules.length >= MAX_VEHICULES || !this._peutPartir(depart)) continue;
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

    // 1. Vitesse visée : normale, plus rapide sur les ponts, réduite en accordéon dans un bouchon,
    //    nulle avant un feu rouge. La vitesse réelle la rejoint progressivement, sans à-coup.
    const enFile = new Map();
    const demandes = new Map();   // feu -> rues d'où arrivent des véhicules
    const rondsPoints = this.ville.rondsPoints ?? [];
    for (const v of this.vehicules) {
      const saturation = this.saturation.get(cleCible(v.cible)) ?? 0;
      const dCible = versApp(v.flux) ? v.distance : v.longueurTotale - v.distance;
      v.ici = this.position(v);
      v.bouchon = saturation > 0 && dCible < ZONE_BOUCHON;
      // Boost : un véhicule retardé (feux, rond-point) roule plus vite pour retrouver la place que
      // lui donnent les données en direct. Pas dans un bouchon : ce retard-là est réel.
      const retard = v.prevu - v.distance;
      let visee = v.vitesse * (retard > 4 && !v.bouchon ? Math.min(2, 1 + retard / 200) : 1);
      v.boost = visee > v.vitesse * 1.05;
      if (pontEn(v, v.distance)) visee *= VITESSE_PONT;
      // Étoile : sur l'anneau (bande autour de l'axe), ou en train d'y entrer (on s'en approche).
      v.surAnneau = false;
      v.entreAnneau = false;
      for (const r of rondsPoints) {
        const d = Math.hypot(v.ici.x - r.x, v.ici.y - r.y);
        if (Math.abs(d - r.r) < BANDE_ANNEAU) v.surAnneau = true;
        else if (d > r.r && d < r.r + 70 && (r.x - v.ici.x) * Math.cos(v.ici.angle) + (r.y - v.ici.y) * Math.sin(v.ici.angle) > 0) {
          v.entreAnneau = true;
        }
      }
      if (v.surAnneau) visee = Math.min(visee, v.vitesse * 1.1);
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

    // 2. Aucune superposition : un véhicule n'avance jamais là où il toucherait le véhicule qui le
    //    précède (voir _resoudreCollisions).
    this._resoudreCollisions(rondsPoints);

    // 3. Déplacement ; un véhicule bloqué voit sa vitesse retomber à ce qu'il a pu parcourir.
    //    La place « prévue » avance à vitesse normale, sauf dans un bouchon (retard réel, pas rattrapé).
    for (const v of this.vehicules) {
      v.attente = v.prochaine - v.distance < 0.05 ? (v.attente ?? 0) + dt : 0;
      // Changement de voie sur un pont, en un peu plus d'une demi-seconde.
      if (v.voies) v.couloirActuel += (v.couloir - v.couloirActuel) * Math.min(1, dt * 4);
      if (dt > 0) v.vitesseActuelle = Math.min(v.vitesseActuelle, (v.prochaine - v.distance) / dt);
      v.prevu = v.bouchon ? v.prevu + (v.prochaine - v.distance) : Math.min(v.longueurTotale, v.prevu + v.vitesse * dt);
      v.distance = v.prochaine;
    }
    this.vehicules = this.vehicules.filter(v => v.distance < v.longueurTotale || v === this.suivi);
    if (this.suivi && this.suivi.distance >= this.suivi.longueurTotale) this.suivi = null;
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

  // Priorité quand deux véhicules se disputent la même place :
  //   1. celui qui attend depuis plus d'1 s (chacun son tour, comme une fermeture éclair) ;
  //   2. celui qui entre dans l'Étoile (comme place de l'Étoile : priorité à ceux qui entrent) ;
  //   3. celui qui s'insère en courbe (bretelle, virage) ;
  //   4. l'anneau de l'Étoile, puis tous les autres.
  _priorite(v, c) {
    if ((v.attente ?? 0) > 1) return 5;
    if (v.entreAnneau) return 4;
    if (v.surAnneau) return 2;
    if (Math.min(Math.abs(c.cos), Math.abs(c.sin)) > 0.2) return 3;
    return 1;
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
  //   même sens : on suit celui qui est devant, s'il est déjà dans sa voie ; celui qui s'insère attend
  //   un trou (et passe s'il attend depuis plus d'1 s) ; si chacun a l'autre devant lui (insertion en
  //   biais), la priorité tranche, puis l'ancienneté. Deux véhicules au même endroit : le plus récent cède.
  //   Sens opposé : voies séparées. Croisements perpendiculaires : pas de blocage (les feux s'en chargent).
  _cede(v, c, o, oc) {
    const cosRelatif = c.cos * oc.cos + c.sin * oc.sin;
    if (cosRelatif < 0.6) return false;
    const avance = (oc.x - c.x) * c.cos + (oc.y - c.y) * c.sin;
    const vDevant = avance > 0.5 || (Math.abs(avance) <= 0.5 && v.id > o.id);   // o est devant v
    if (!vDevant || !this._touche(c, oc, ESPACE)) return false;
    // Seuil de 6 px : un véhicule à mi-chemin d'un changement de voie (4,5 px des deux voies d'un pont,
    // écartées de 9 px) compte pour les deux voies, donc personne ne lui rentre dedans.
    const decalage = Math.abs((oc.y - c.y) * c.cos - (oc.x - c.x) * c.sin);
    if (decalage > 6 && !((o.attente ?? 0) > 1 && decalage < 12)) return false;
    const oDevant = (c.x - oc.x) * oc.cos + (c.y - oc.y) * oc.sin > 0;   // v est devant o
    if (!oDevant) return true;
    const [pv, po] = [this._priorite(v, c), this._priorite(o, oc)];
    return pv < po || (pv === po && v.id > o.id);
  }

  _resoudreCollisions(rondsPoints) {
    const grille = new Map();
    for (const v of this.vehicules) {
      v.forme = this._carrosserie(v);
      const k = `${Math.floor(v.forme.x / CASE)},${Math.floor(v.forme.y / CASE)}`;
      if (!grille.has(k)) grille.set(k, []);
      grille.get(k).push(v);
    }
    // On n'entre dans l'Étoile que si elle n'est pas presque pleine : pleine, elle se bloquerait.
    const surAnneau = this.vehicules.filter(v => v.surAnneau).length;

    // Les plus prioritaires bougent d'abord ; les autres tiennent compte de leur nouvelle place.
    const ordre = this.vehicules.slice().sort((a, b) => this._priorite(b, b.forme) - this._priorite(a, a.forme));
    for (const v of ordre) {
      if (v.prochaine <= v.distance) continue;
      if (v.entreAnneau && surAnneau >= ANNEAU_MAX && rondsPoints.length) {
        const r = rondsPoints[0];
        const plus30 = this.position(v, Math.min(v.longueurTotale, v.distance + 30));
        if (Math.abs(Math.hypot(plus30.x - r.x, plus30.y - r.y) - r.r) < BANDE_ANNEAU) {
          this._bloquer(v, v.distance, 'rond-point', null);
          continue;
        }
      }
      const voisins = [];
      const [cx, cy] = [Math.floor(v.forme.x / CASE), Math.floor(v.forme.y / CASE)];
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const o of grille.get(`${cx + i},${cy + j}`) ?? []) {
            // Un véhicule qui arrive (il s'efface au bout de son trajet) ne gêne plus personne.
            if (o !== v && o.longueurTotale - o.distance >= FONDU) voisins.push(o);
          }
        }
      }
      const bloque = d => {
        const c = this._carrosserie(v, d);
        for (const o of voisins) if (this._cede(v, c, o, o.forme)) return o;
        return null;
      };
      const gene = bloque(v.prochaine);
      // Pont 2 × 2 voies : on roule à droite (couloir 1, extérieur) et on ne double que par la gauche
      // (couloir 0, près du centre). Gêné à droite : on passe à gauche si elle est libre à sa hauteur
      // et devant. À gauche : on se rabat dès que la droite est libre, sauf si l'on est bloqué derrière
      // un véhicule plus lent (on ne double jamais par la droite).
      const pont = pontEn(v, v.distance);
      if (pont && v.distance > pont[0] + 40 && v.distance < pont[1] - 60 && Math.abs(v.couloirActuel - v.couloir) < 0.05) {
        const essai = couloir => {
          const actuel = v.couloirActuel;
          v.couloirActuel = couloir;
          const libre = !bloque(v.distance) && !bloque(v.prochaine) && !bloque(v.prochaine + 25);
          v.couloirActuel = actuel;
          return libre;
        };
        if (v.couloir === 1 && gene && essai(0)) v.couloir = 0;
        else if (v.couloir === 0 && !gene && essai(1)) v.couloir = 1;
      }
      if (gene) {
        // Plus grande avance possible sans toucher personne (recherche par dichotomie).
        let [ok, ko] = [v.distance, v.prochaine];
        if (bloque(ok)) ko = ok;
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

  // Le plan de la ville a changé (une île s'est agrandie…) : chaque véhicule reprend son trajet
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
      const neuf = this._creer(v);
      if (!neuf) return false;
      const part = v.distance / v.longueurTotale;
      const partPrevue = v.prevu / v.longueurTotale;
      for (const cle of ['points', 'longueurs', 'longueurTotale', 'voies', 'feux']) v[cle] = neuf[cle];
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
    const id = depart.id ?? (this._compteur = (this._compteur ?? 0) + 1);
    // Le modèle donne le trajet dans le sens de la marche (le tour de l'anneau ne se fait que dans un sens).
    const trajet = this.ville.trajet(depart.app, depart.cible, versApp(depart.flux));
    if (!trajet || trajet.points.length < 2) return null;
    const points = decaler(trajet.points, VOIE);
    const longueurs = [0];
    for (let i = 1; i < points.length; i++) {
      longueurs.push(longueurs[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    // Ponts à 2 voies par sens, en distance le long du trajet.
    const voies = trajet.voies.map(([a, b]) => [longueurs[a], longueurs[b]]);
    const g = GABARITS[depart.gabarit];
    const vitesse = g.vitesse * (0.9 + Math.random() * 0.2);
    return {
      ...depart,
      id,
      // On roule dans la voie de droite des ponts ; la gauche sert à doubler. En partant de l'entrepôt
      // ou du terminal (déjà sur 2 voies), on démarre sur l'une ou l'autre, puis on se rabat.
      couloir: voies[0]?.[0] <= 1 ? id % 2 : 1,
      couloirActuel: voies[0]?.[0] <= 1 ? id % 2 : 1,
      points,
      longueurs,
      longueurTotale: longueurs[longueurs.length - 1],
      distance: 0,
      prevu: 0,
      vitesse,
      vitesseActuelle: vitesse,
      couleur: COULEURS_FLUX[depart.flux],
      voies,
      feux: feuxDuTrajet(this.ville.feux ?? [], points, longueurs, g.longueur),
      iFeu: 0,
    };
  }

  // Position et orientation d'un véhicule le long de son trajet (à sa distance actuelle, ou à « distance »).
  // Sur un pont (2 × 2 voies), le véhicule est décalé vers sa voie : la voie près du centre prolonge la
  // route, l'autre est 9 px plus à l'extérieur ; on y glisse en douceur sur 40 px à chaque bout du pont.
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
    const pont = v.couloirActuel ? pontEn(v, d) : null;
    if (pont) {
      // On glisse vers sa voie en entrant sur la partie à 2 voies et on en revient en la quittant,
      // sauf aux bouts du trajet (entrepôt, terminal) : on y arrive et on en part déjà dans sa voie.
      const entree = pont[0] > 1 ? (d - pont[0]) / 40 : 1;
      const sortie = pont[1] < v.longueurTotale - 1 ? (pont[1] - d) / 40 : 1;
      const k = Math.max(0, Math.min(1, entree, sortie));
      const e = ECART_VOIES * v.couloirActuel * k;   // vers la droite du sens de marche (l'extérieur)
      x += -Math.sin(angle) * e;
      y += Math.cos(angle) * e;
    }
    return { x, y, angle };
  }

  // Véhicule sous le curseur.
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
