// Vue 3D (relief), commune à tous les décors. Le décor fixe dessiné par le rendu 2D du décor (sol,
// routes, eau, parcs…) sert de sol ; les éléments de la ville s'y dressent en volume : applications,
// tour (processeur et mémoire), disques, Internet et véhicules. Chaque décor peut préciser leurs
// formes dans decors/<id>/formes3d.js ; sinon, des volumes simples aux couleurs du décor sont utilisés.
//
// Même contrat que les rendus 2D (camera, selection, survol, discret, nuit, versMonde, zoomer,
// recentrer, centrerSur, definirPalette, dessiner), plus glisser() : la carte se déplace dans le sens
// de la caméra, qui peut tourner autour de la ville (clic droit et glisser).

import * as THREE from './lib/three.module.min.js';

const FOV = 38;
const INCLINAISON_DEFAUT = 0.95;        // angle de vue au-dessus de l'horizon (radians)
const INCLINAISON_MIN = 0.22;
const INCLINAISON_MAX = 1.52;
const TEXELS_MAX = 4096;                // côté maximal de l'image du sol
const MARGE_SOL = 0.2;                  // sol dessiné au-delà des bornes de la ville (part de leur taille)
const MAX_VEHICULES = 400;
const REFAIRE_SOL_MS = 400;             // pendant un fondu de couleurs, le sol est redessiné au plus à ce rythme
const POLICE = 'system-ui, "Segoe UI", sans-serif';
const ROUGE = '#E8504F';

// ---------- Formes par défaut (tout décor sans formes3d.js) ----------

export const FORMES_DEFAUT = {
  // Couleur du ciel, de la brume et du sol au-delà du décor.
  ciel: p => p.ciel ?? p.mer ?? p.fond ?? '#20242C',

  // Clé qui change quand l'application doit être reconstruite (le reste s'anime dans maj).
  cleApplication: (lot, c) => {
    const d = lot.app.donnees;
    return [d.etat, d.alerte ? 1 : 0, Math.round(20 * Math.sqrt(Math.min(1, d.ram / c.ramMax))), lot.app.quartier.couleur, c.nuitArrondie].join('|');
  },

  application(lot, c) {
    const d = lot.app.donnees;
    const ferme = d.etat === 'ferme';
    const cote = Math.max(8, Math.min(lot.l, lot.h) * 0.62);
    const haut = ferme ? 6 : 10 + 70 * Math.sqrt(Math.min(1, d.ram / c.ramMax));
    let couleur = ferme ? c.gris : lot.app.quartier.couleur;
    if (d.etat === 'veille') couleur = c.melanger(couleur, c.gris, 0.45);
    const groupe = new c.THREE.Group();
    groupe.add(c.boite(cote, haut, cote, couleur));
    if (!ferme) {
      // Toit qui s'éclaire avec le processeur
      const toit = c.boite(cote * 0.7, 1.5, cote * 0.7, '#FFFFFF', { lumineux: true });
      toit.position.y = haut;
      groupe.add(toit);
      groupe.userData.maj = () => { toit.material.emissiveIntensity = d.etat === 'veille' ? 0 : Math.min(1, lot.app.donnees.cpu / 25); };
    }
    if (d.alerte) groupe.add(c.epingle(haut + 14));
    groupe.userData.hauteur = haut;
    return groupe;
  },

  tour(tour, c) {
    const groupe = new c.THREE.Group();
    const r = (tour.rayon ?? 50) * 0.8;
    groupe.add(c.cylindre(r, 70, '#3A3F4B'));
    groupe.add(c.anneaux(r, 70));
    groupe.userData.hauteur = 70;
    return groupe;
  },

  entrepot(e, c) {
    const groupe = new c.THREE.Group();
    const [l, h] = [e.l ?? 80, e.h ?? 80];
    groupe.add(c.boite(l, 22, h, '#CFC5B5'));
    groupe.add(c.jaugeDisque(e, l * 0.8, h * 0.8, 22));
    groupe.userData.hauteur = 40;
    return groupe;
  },

  internet(a, c) {
    const groupe = new c.THREE.Group();
    const r = a.rayon ?? Math.min(a.l ?? 120, a.h ?? 120) / 3;
    const balise = c.cylindre(r * 0.5, 50, '#5BC8E8');
    groupe.add(balise);
    groupe.userData.hauteur = 50;
    return groupe;
  },

  // Volumes fixes en plus (arbres…), refaits quand le plan de la ville change.
  extras: () => null,

  // Hauteur d'un véhicule au-dessus du sol (autoroutes, vaisseaux…).
  altitudeVehicule: () => 0,

  // Volumes qui changent en continu (autoroutes…), à tenir à jour dans le groupe donné.
  dynamique: null,
};

// ---------- Rendu ----------

export class Rendu3D {
  // canvas : la carte 2D, qui reçoit les clics et sert de calque pour les noms ;
  // D : le module du décor ; formes : son formes3d.js (peut être vide).
  constructor(canvas, ville, trafic, D, formes = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ville = ville;
    this.trafic = trafic;
    this.D = D;
    this.formes = { ...FORMES_DEFAUT, ...formes };
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.azimut = 0;
    this.inclinaison = INCLINAISON_DEFAUT;
    this.survol = null;
    this.selection = null;
    this.discret = false;
    this.nuit = false;

    // Le rendu 2D du décor, sur une toile hors écran : il fournit le sol et les fondus de couleurs.
    this.toileSol = document.createElement('canvas');
    this.r2 = new D.Rendu(this.toileSol, ville, trafic);
    this.r2._redimensionner = () => {};
    this.palette = this.r2.palette;

    // Toile WebGL sous la carte 2D (qui reste au-dessus pour les clics et les noms).
    this.toile3d = document.createElement('canvas');
    this.toile3d.id = 'carte3d';
    canvas.before(this.toile3d);
    canvas.classList.add('calque3d');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.toile3d, antialias: true, powerPreference: 'low-power' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x000000, 1000, 5000);
    this.cam = new THREE.PerspectiveCamera(FOV, 1, 2, 40000);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
    this.soleil = new THREE.DirectionalLight(0xffffff, 2);
    this.soleil.castShadow = true;
    this.soleil.shadow.mapSize.set(2048, 2048);
    this.soleil.shadow.bias = -0.0008;
    this.soleil.shadow.normalBias = 0.6;
    this.scene.add(this.hemi, this.soleil, this.soleil.target);

    this.sol = null;
    this.fondSol = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.fondSol.rotation.x = -Math.PI / 2;
    this.fondSol.position.y = -0.5;
    this.scene.add(this.fondSol);

    this.racine = new THREE.Group();        // éléments de la ville
    this.dynamique = new THREE.Group();     // volumes tenus à jour par le décor (formes.dynamique)
    this.scene.add(this.racine, this.dynamique);
    this.objetsApps = new Map();            // lot -> objet
    this.objetsEntrepots = new Map();       // id du disque -> objet
    this.objetTour = null;
    this.objetInternet = null;
    this.objetExtras = null;
    this.pickables = [];

    // Véhicules : une seule maille instanciée (un seul ordre de dessin pour tous).
    this.vehicules3d = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAX_VEHICULES);
    this.vehicules3d.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.vehicules3d.castShadow = true;
    this.vehicules3d.frustumCulled = false;
    this.scene.add(this.vehicules3d);

    // Repère de sélection : un anneau posé au sol.
    this.repere = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.repere.rotation.x = -Math.PI / 2;
    this.repere.position.y = 1.2;
    this.repere.visible = false;
    this.scene.add(this.repere);

    this._raycaster = new THREE.Raycaster();
    this._materiaux = new Map();
    this._temps = 0;
    this._redimensionner();
    window.addEventListener('resize', () => this._redimensionner());
    this._brancherRotation();
  }

  // Création asynchrone : charge les formes propres au décor s'il en a.
  static async creer(canvas, ville, trafic, D, idDecor) {
    let formes = {};
    try {
      formes = await import(`./decors/${idDecor}/formes3d.js`);
    } catch {
      // Pas de formes propres à ce décor : volumes simples
    }
    return new Rendu3D(canvas, ville, trafic, D, formes);
  }

  _redimensionner() {
    const ratio = window.devicePixelRatio || 1;
    this.largeur = this.canvas.clientWidth;
    this.hauteur = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.largeur * ratio);
    this.canvas.height = Math.round(this.hauteur * ratio);
    this.ratio = ratio;
    this.renderer.setPixelRatio(Math.min(ratio, 1.5));
    this.renderer.setSize(this.largeur, this.hauteur, false);
    this.cam.aspect = this.largeur / Math.max(1, this.hauteur);
    this.cam.updateProjectionMatrix();
  }

  // Clic droit et glisser : tourner autour de la ville et changer l'inclinaison.
  _brancherRotation() {
    let rotation = null;
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 2) return;
      rotation = { x: e.clientX, y: e.clientY, azimut: this.azimut, inclinaison: this.inclinaison };
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.classList.add('glisse');
    });
    this.canvas.addEventListener('pointermove', e => {
      if (!rotation) return;
      this.azimut = rotation.azimut - (e.clientX - rotation.x) * 0.006;
      this.inclinaison = Math.min(INCLINAISON_MAX, Math.max(INCLINAISON_MIN, rotation.inclinaison + (e.clientY - rotation.y) * 0.005));
    });
    this.canvas.addEventListener('pointerup', e => {
      if (e.button !== 2 || !rotation) return;
      rotation = null;
      this.canvas.classList.remove('glisse');
    });
  }

  definirPalette(palette) {
    this.r2.definirPalette(palette);
    this.nuit = this.r2.nuit;
  }

  // ---------- Caméra ----------

  get _distanceBase() {
    const b = this.ville.bornes;
    if (!b) return 2000;
    // Distance à laquelle toute la ville tient dans l'écran, vue sous l'inclinaison par défaut.
    const etendue = Math.max(b.l / Math.max(0.5, this.cam.aspect), b.h * 1.15);
    return (etendue / 2) / Math.tan((FOV * Math.PI) / 360) * 1.05;
  }

  get _distance() {
    return this._distanceBase / this.camera.zoom;
  }

  _placerCamera() {
    const c = this.camera;
    const d = this._distance;
    const h = Math.cos(this.inclinaison);
    this.cam.position.set(
      c.x + d * h * Math.sin(this.azimut),
      d * Math.sin(this.inclinaison),
      c.y + d * h * Math.cos(this.azimut),
    );
    this.cam.lookAt(c.x, 0, c.y);
    this.cam.updateMatrixWorld();
  }

  // Point du sol sous un point de l'écran (null si le regard passe au-dessus de l'horizon).
  _solSous(sx, sy) {
    this._placerCamera();
    this._raycaster.setFromCamera(new THREE.Vector2((sx / this.largeur) * 2 - 1, -(sy / this.hauteur) * 2 + 1), this.cam);
    const r = this._raycaster.ray;
    if (r.direction.y >= -1e-4) return null;
    const t = -r.origin.y / r.direction.y;
    return [r.origin.x + r.direction.x * t, r.origin.z + r.direction.z * t];
  }

  // Coordonnées de la ville sous la souris. Un clic sur un volume (immeuble, tour…) vise son
  // centre au sol, pour que la ville le reconnaisse comme en 2D.
  versMonde(sx, sy) {
    this._placerCamera();
    this._raycaster.setFromCamera(new THREE.Vector2((sx / this.largeur) * 2 - 1, -(sy / this.hauteur) * 2 + 1), this.cam);
    const touche = this._raycaster.intersectObjects(this.pickables, true)[0];
    if (touche) {
      let o = touche.object;
      while (o && !o.userData.centre) o = o.parent;
      if (o) return [...o.userData.centre];
    }
    return this._solSous(sx, sy) ?? [Infinity, Infinity];
  }

  versEcran(wx, wy, hauteur = 0) {
    const v = new THREE.Vector3(wx, hauteur, wy).project(this.cam);
    return [(v.x + 1) / 2 * this.largeur, (1 - v.y) / 2 * this.hauteur, v.z];
  }

  recentrer() {
    const b = this.ville.bornes;
    if (!b) return;
    this.camera.x = b.x + b.l / 2;
    this.camera.y = b.y + b.h / 2;
    this.camera.zoom = 1;
    this.azimut = 0;
    this.inclinaison = INCLINAISON_DEFAUT;
  }

  // Prise de vue précise, pour un essai (?camera3d=zoom,azimut°,inclinaison°[,x,y] dans l'adresse ;
  // x et y de 0 à 1 dans les bornes de la ville).
  regler(texte) {
    const b = this.ville.bornes;
    const valeurs = texte.split(',').map(Number);
    if (!b || valeurs.length < 3 || !valeurs.every(Number.isFinite)) return;
    const [zoom, azimut, inclinaison, fx = 0.5, fy = 0.5] = valeurs;
    Object.assign(this.camera, { zoom, x: b.x + fx * b.l, y: b.y + fy * b.h });
    this.azimut = (azimut * Math.PI) / 180;
    this.inclinaison = Math.min(INCLINAISON_MAX, Math.max(INCLINAISON_MIN, (inclinaison * Math.PI) / 180));
  }

  // Molette : rapproche la caméra du point visé.
  zoomer(facteur, sx, sy) {
    const c = this.camera;
    const avant = this._solSous(sx, sy);
    c.zoom = Math.min(14, Math.max(0.35, c.zoom * facteur));
    const apres = this._solSous(sx, sy);
    if (avant && apres) {
      c.x += avant[0] - apres[0];
      c.y += avant[1] - apres[1];
    }
  }

  // Glisser (clic gauche) : la ville suit la souris, quelle que soit l'orientation de la caméra.
  glisser(depart, dx, dy) {
    const parPixel = (2 * this._distance * Math.tan((FOV * Math.PI) / 360)) / Math.max(1, this.hauteur);
    const [sin, cos] = [Math.sin(this.azimut), Math.cos(this.azimut)];
    // Droite de l'écran au sol : (cos, -sin) ; haut de l'écran au sol : (-sin, -cos).
    // La carte suit la souris : la caméra part à l'opposé du geste.
    const ky = parPixel / Math.max(0.35, Math.sin(this.inclinaison));
    this.camera.x = depart.cx - cos * dx * parPixel - sin * dy * ky;
    this.camera.y = depart.cy + sin * dx * parPixel - cos * dy * ky;
  }

  centrerSur(x, y, zoom) {
    this.camera.x = x;
    this.camera.y = y;
    if (zoom) this.camera.zoom = Math.max(this.camera.zoom, zoom * 1.6);
  }

  // ---------- Outils de construction (passés aux formes) ----------

  _contexte() {
    const p = this.palette;
    const v = this.ville;
    const ramMax = v.ramMax || Math.max(1, ...[...v.apps.values()].map(a => a.donnees?.ram ?? 0));
    return {
      THREE,
      palette: p,
      ville: v,
      trafic: this.trafic,
      ramMax,
      nuit: p.obscurite ?? (this.nuit ? 1 : 0),
      nuitArrondie: Math.round((p.obscurite ?? 0) * 4),
      gris: p.ferme ?? '#9A9488',
      melanger,
      eclaircir,
      materiau: (couleur, options) => this._materiau(couleur, options),
      boite: (l, h, p2, couleur, options) => this._boite(l, h, p2, couleur, options),
      cylindre: (r, h, couleur, options) => this._cylindre(r, h, couleur, options),
      anneaux: (r, h) => this._anneaux(r, h),
      jaugeDisque: (e, l, p2, y) => this._jaugeDisque(e, l, p2, y),
      epingle: h => this._epingle(h),
      texteSur: (texte, l, h, options) => this._panneauTexte(texte, l, h, options),
    };
  }

  // Matériaux partagés par couleur (les volumes animés ont le leur : options.propre).
  _materiau(couleur, { lumineux = false, propre = false, transparent = false, opacite = 1 } = {}) {
    const cle = `${couleur}|${lumineux}|${transparent}|${opacite}`;
    if (!propre && this._materiaux.has(cle)) return this._materiaux.get(cle);
    const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(versCss(couleur)), transparent, opacity: opacite });
    if (lumineux) { m.emissive = new THREE.Color(versCss(couleur)); m.emissiveIntensity = 0; }
    m.userData.partage = !propre && !lumineux;
    if (!propre && !lumineux) this._materiaux.set(cle, m);
    return m;
  }

  // Boîte posée au sol (sa base à y = 0), centrée sur l'origine.
  _boite(l, h, p, couleur, options = {}) {
    const geo = new THREE.BoxGeometry(l, h, p);
    geo.translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, this._materiau(couleur, { ...options, propre: options.propre ?? !!options.lumineux }));
    m.castShadow = options.ombre ?? true;
    m.receiveShadow = true;
    return m;
  }

  _cylindre(r, h, couleur, options = {}) {
    const geo = new THREE.CylinderGeometry(options.rHaut ?? r, r, h, options.faces ?? 32);
    geo.translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, this._materiau(couleur, { ...options, propre: options.propre ?? !!options.lumineux }));
    m.castShadow = options.ombre ?? true;
    m.receiveShadow = true;
    return m;
  }

  // Couronne de la tour : anneau du processeur (orange) et de la mémoire (bleu), qui se remplissent.
  _anneaux(r, y) {
    const groupe = new THREE.Group();
    groupe.position.y = y + 2;
    const fond = new THREE.Mesh(new THREE.TorusGeometry(r * 0.82, 3.2, 8, 64), this._materiau('#FFFFFF', { transparent: true, opacite: 0.25 }));
    fond.rotation.x = -Math.PI / 2;
    const fondRam = new THREE.Mesh(new THREE.TorusGeometry(r * 0.55, 2.2, 8, 64), this._materiau('#FFFFFF', { transparent: true, opacite: 0.25 }));
    fondRam.rotation.x = -Math.PI / 2;
    groupe.add(fond, fondRam);
    let cpu = null;
    let ram = null;
    let cle = '';
    groupe.userData.maj = (temps, c) => {
      const s = c.ville.systeme;
      if (!s) return;
      const pc = Math.max(0.01, Math.min(1, s.cpu / 100));
      const pr = Math.max(0.01, Math.min(1, s.ram_utilisee / s.ram_totale));
      const nouvelle = `${Math.round(pc * 100)}|${Math.round(pr * 100)}`;
      if (nouvelle === cle) return;
      cle = nouvelle;
      for (const m of [cpu, ram]) if (m) { groupe.remove(m); m.geometry.dispose(); m.material.dispose(); }
      const arc = (rayon, tube, part, couleur) => {
        const m = new THREE.Mesh(new THREE.TorusGeometry(rayon, tube, 8, 64, part * Math.PI * 2),
          new THREE.MeshLambertMaterial({ color: couleur, emissive: couleur, emissiveIntensity: 0.35 }));
        // Départ en haut (nord), sens des aiguilles d'une montre vu du ciel, comme en 2D.
        m.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
        return m;
      };
      cpu = arc(r * 0.82, 3.6, pc, pc > 0.85 ? ROUGE : '#F2A541');
      ram = arc(r * 0.55, 2.6, pr, pr > 0.9 ? ROUGE : '#3FA9E0');
      groupe.add(cpu, ram);
    };
    return groupe;
  }

  // Jauge de remplissage d'un disque : bloc qui monte avec l'espace utilisé (rouge au-delà de 90 %).
  _jaugeDisque(e, l, p, y) {
    const groupe = new THREE.Group();
    groupe.position.y = y;
    const rempli = this._boite(l, 1, p, '#3FA9E0', { propre: true });
    groupe.add(rempli);
    groupe.userData.maj = () => {
      // Les disques sont renouvelés à chaque relevé : on relit le disque à jour par son id.
      const d = this.ville.entrepots?.find(x => x.disque.id === e.disque.id)?.disque ?? e.disque;
      const occupe = Math.max(0.02, Math.min(1, d.utilise / d.total));
      rempli.scale.y = 2 + 30 * occupe;
      // Teinte des caisses : celle du disque, éclaircie, pour se détacher du toit.
      rempli.material.color.set(occupe > 0.9 ? ROUGE : eclaircir(versCss(e.toit ?? '#3FA9E0'), 0.45));
    };
    return groupe;
  }

  // Épingle d'alerte rouge, qui flotte et tourne au-dessus d'un volume.
  _epingle(h) {
    const groupe = new THREE.Group();
    const tige = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 10, 8), this._materiau('#FFFFFF'));
    tige.position.y = 5;
    const tete = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), new THREE.MeshLambertMaterial({ color: ROUGE, emissive: ROUGE, emissiveIntensity: 0.4 }));
    tete.position.y = 13;
    groupe.add(tige, tete);
    groupe.position.y = h;
    groupe.userData.maj = temps => {
      groupe.position.y = h + 2 * Math.sin(temps / 300);
      tete.material.emissiveIntensity = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(temps / 180));
    };
    return groupe;
  }

  // Panneau plat portant un texte (enseigne, nom de disque), à poser sur une face.
  _panneauTexte(texte, l, h, { fond = '#E8504F', couleur = '#FFFFFF', gras = 800 } = {}) {
    const toile = document.createElement('canvas');
    toile.width = 256;
    toile.height = Math.max(32, Math.round(256 * h / l));
    const ctx = toile.getContext('2d');
    ctx.fillStyle = fond;
    ctx.fillRect(0, 0, toile.width, toile.height);
    ctx.fillStyle = couleur;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${gras} ${Math.round(toile.height * 0.62)}px ${POLICE}`;
    ctx.fillText(texte, toile.width / 2, toile.height / 2 + 1, toile.width - 12);
    const texture = new THREE.CanvasTexture(toile);
    texture.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(l, h), new THREE.MeshBasicMaterial({ map: texture }));
    return m;
  }

  // ---------- Sol ----------

  _majSol(maintenant) {
    const b = this.ville.bornes;
    if (!b) return;
    const p = this.palette;
    const cleTaille = `${b.x},${b.y},${b.l},${b.h},${this.ville.version}`;
    const changeTaille = cleTaille !== this._cleSol;
    const changeCouleur = p !== this._paletteSol;
    if (!changeTaille && !changeCouleur) return;
    // Pendant un fondu, les couleurs changent à chaque image : on ne redessine pas le sol aussi souvent.
    if (!changeTaille && maintenant - (this._dernierSol ?? 0) < REFAIRE_SOL_MS) return;
    this._dernierSol = maintenant;
    this._paletteSol = p;

    const marge = Math.max(b.l, b.h) * MARGE_SOL;
    const [L, H] = [b.l + 2 * marge, b.h + 2 * marge];
    const max = Math.min(TEXELS_MAX, this.renderer.capabilities.maxTextureSize);
    const echelle = Math.min(1.6, max / Math.max(L, H));
    const r2 = this.r2;
    if (changeTaille) {
      r2.canvas.width = Math.round(L * echelle);
      r2.canvas.height = Math.round(H * echelle);
      r2.largeur = r2.canvas.width;
      r2.hauteur = r2.canvas.height;
      r2.ratio = 1;
      r2.camera = { x: b.x + b.l / 2, y: b.y + b.h / 2, zoom: echelle };
    }
    r2.palette = p;
    let image;
    if (this.formes.sol) image = this.formes.sol(r2, this._temps);
    else if (typeof r2._dessinerDecor === 'function') { r2._dessinerDecor(); image = r2._decor; }
    else { r2.dessiner(this._temps); image = r2.canvas; }

    if (changeTaille || !this.sol || this.sol.material.map.image !== image) {
      if (this.sol) { this.scene.remove(this.sol); this.sol.geometry.dispose(); this.sol.material.map.dispose(); this.sol.material.dispose(); }
      const texture = new THREE.CanvasTexture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.sol = new THREE.Mesh(new THREE.PlaneGeometry(L, H), new THREE.MeshLambertMaterial({ map: texture }));
      this.sol.rotation.x = -Math.PI / 2;
      this.sol.position.set(b.x + b.l / 2, 0, b.y + b.h / 2);
      this.sol.receiveShadow = true;
      this.scene.add(this.sol);
      this._cleSol = cleTaille;
      this._reglerOmbres(b, L, H);
    } else {
      this.sol.material.map.needsUpdate = true;
    }
  }

  _reglerOmbres(b, L, H) {
    const s = this.soleil;
    const [cx, cy] = [b.x + b.l / 2, b.y + b.h / 2];
    const portee = Math.max(L, H) * 0.62;
    s.position.set(cx - portee * 0.45, portee * 1.1, cy + portee * 0.7);
    s.target.position.set(cx, 0, cy);
    s.target.updateMatrixWorld();
    Object.assign(s.shadow.camera, { left: -portee, right: portee, top: portee, bottom: -portee, near: 10, far: portee * 4 });
    s.shadow.camera.updateProjectionMatrix();
    this.fondSol.scale.set(L * 12, H * 12, 1);
    this.fondSol.position.set(cx, -0.5, cy);
  }

  // Lumière, ciel et brume selon la palette (jour → nuit).
  _majAmbiance() {
    const p = this.palette;
    const nuit = Math.max(0, Math.min(1, p.obscurite ?? (this.nuit ? 1 : 0)));
    const ciel = new THREE.Color(versCss(this.formes.ciel(p)));
    this.scene.background = ciel;
    this.scene.fog.color.copy(ciel);
    this.fondSol.material.color.copy(ciel);
    this.hemi.intensity = 1.9 - 1.35 * nuit;
    this.hemi.color.set(0xffffff).lerp(new THREE.Color(0x8fa6ff), nuit);
    this.hemi.groundColor.set(0x9a8f80).lerp(new THREE.Color(0x202640), nuit);
    this.soleil.intensity = 1.9 - 1.6 * nuit;
    this.soleil.color.set(0xfff4e0).lerp(new THREE.Color(0x9fb4ff), nuit);
    const d = this._distance;
    this.scene.fog.near = d * 1.6;
    this.scene.fog.far = d * 5;
  }

  // ---------- Éléments de la ville ----------

  _liberer(objet) {
    objet.traverse(o => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m.userData?.partage) continue;
        m.map?.dispose();
        m.dispose();
      }
    });
  }

  _remplacer(ancien, nouveau, pick) {
    if (ancien) { this.racine.remove(ancien); this._liberer(ancien); }
    if (nouveau) {
      nouveau.userData.pick = pick;
      this.racine.add(nouveau);
    }
    return nouveau;
  }

  _majElements(c, dt) {
    const v = this.ville;
    const f = this.formes;

    // Applications : reconstruites quand leur état change, déplacées à chaque image (décors animés).
    const vus = new Set();
    for (const lot of v.lots ?? []) {
      vus.add(lot);
      const cle = f.cleApplication(lot, c);
      let objet = this.objetsApps.get(lot);
      if (!objet || objet.userData.cle !== cle) {
        const nouveau = f.application(lot, c);
        nouveau.userData.cle = cle;
        // Un nouveau programme « pousse » ; une reconstruction garde la croissance en cours.
        nouveau.userData.croissance = objet ? objet.userData.croissance : (lot.app.nouveau ? 0 : 1);
        objet = this._remplacer(objet, nouveau, true);
        this.objetsApps.set(lot, objet);
      }
      const [x, y] = centreLot(lot);
      objet.position.x = x;
      objet.position.z = y;
      objet.userData.centre = [x, y];
      if (objet.userData.croissance < 1) objet.userData.croissance = Math.min(1, objet.userData.croissance + dt * 1.5);
      objet.scale.y = Math.max(0.02, objet.userData.croissance);
    }
    for (const [lot, objet] of this.objetsApps) {
      if (vus.has(lot)) continue;
      this._remplacer(objet, null);
      this.objetsApps.delete(lot);
    }

    // Tour, disques, Internet et volumes fixes : refaits quand le plan change, ou quand la lumière
    // change de palier (leurs couleurs viennent de la palette).
    const version = `${v.version}|${c.nuitArrondie}`;
    if (this._versionElements !== version) {
      this._versionElements = version;
      // Les couleurs interpolées au fil de la journée ne doivent pas accumuler des matériaux.
      if (this._materiaux.size > 300) this._materiaux.clear();
      this.objetTour = this._remplacer(this.objetTour, v.tour ? f.tour(v.tour, c) : null, true);
      if (this.objetTour) {
        this.objetTour.position.set(v.tour.x, 0, v.tour.y);
        this.objetTour.userData.centre = [v.tour.x, v.tour.y];
      }
      for (const objet of this.objetsEntrepots.values()) this._remplacer(objet, null);
      this.objetsEntrepots.clear();
      for (const e of v.entrepots ?? []) {
        const objet = this._remplacer(null, f.entrepot(e, c), true);
        const [x, y] = centreRect(e);
        objet.position.set(x, 0, y);
        objet.userData.centre = [x, y];
        objet.userData.entrepot = e;
        this.objetsEntrepots.set(e.disque.id, objet);
      }
      const a = v.aeroport;
      this.objetInternet = this._remplacer(this.objetInternet, a ? f.internet(a, c) : null, true);
      if (this.objetInternet) {
        const centre = a.terminal ? centreRect(a.terminal) : centreRect(a);
        // Le volume est construit à l'origine de l'aéroport (ses parties sont placées par la forme).
        const [x, y] = a.terminal || a.cx === undefined ? [a.x + (a.l ?? 0) / 2, a.y + (a.h ?? 0) / 2] : [a.cx, a.cy];
        this.objetInternet.position.set(x, 0, y);
        this.objetInternet.userData.centre = centre;
      }
      this.objetExtras = this._remplacer(this.objetExtras, f.extras(v, c), false);
      this._signaturePick = null;
    }
    // Les entrepôts suivent les disques (objets renouvelés à chaque relevé) et les décors animés.
    for (const e of v.entrepots ?? []) {
      const objet = this.objetsEntrepots.get(e.disque.id);
      if (!objet) continue;
      objet.userData.entrepot = e;
      const [x, y] = centreRect(e);
      objet.position.set(x, 0, y);
      objet.userData.centre = [x, y];
    }

    // Animations propres à chaque volume
    const temps = this._temps;
    this.racine.traverse(o => o.userData.maj?.(temps, c, o));
    f.dynamique?.(this.dynamique, c, temps, o => this._liberer(o));

    // Liste des volumes cliquables (refaite seulement quand elle change)
    const signature = this.racine.children.length;
    if (signature !== this._signaturePick) {
      this._signaturePick = signature;
      this.pickables = this.racine.children.filter(o => o.userData.pick);
    }
  }

  _majVehicules(c) {
    const t = this.trafic;
    const m = this.vehicules3d;
    const g = this.D.GABARITS;
    const matrice = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const axe = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const taille = new THREE.Vector3();
    const couleur = new THREE.Color();
    let n = 0;
    for (const v of t.vehicules) {
      if (n >= MAX_VEHICULES) break;
      if (v.app && !v.app.lot) continue;
      if (v.s !== undefined && v.s <= 0) continue;
      const p = t.position(v);
      if (!p || !Number.isFinite(p.x)) continue;
      const gab = g[v.gabarit] ?? { longueur: 10 };
      const longueur = gab.longueur ?? 10;
      const largeur = gab.largeur ?? longueur * 0.55;
      const haut = largeur * 0.9;
      const altitude = this.formes.altitudeVehicule(v, c, p) ?? 0;
      pos.set(p.x, altitude + haut / 2 + 0.3, p.y);
      q.setFromAxisAngle(axe, -(p.angle ?? 0));
      taille.set(longueur, haut, largeur);
      matrice.compose(pos, q, taille);
      m.setMatrixAt(n, matrice);
      const teinte = v.bouchon || v.freine ? melanger(v.couleur, ROUGE, 0.35) : v.couleur;
      couleur.set(versCss(teinte));
      m.setColorAt(n, couleur);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  _majRepere() {
    const cible = this.selection ?? this.survol;
    let rayon = 0;
    let centre = null;
    if (cible?.type === 'app' && cible.app.lot) {
      centre = centreLot(cible.app.lot);
      rayon = Math.max(cible.app.lot.l, cible.app.lot.h) * 0.62;
    } else if (cible?.type === 'tour' && this.ville.tour) {
      centre = [this.ville.tour.x, this.ville.tour.y];
      rayon = (this.ville.tour.rayon ?? 50) + 12;
    } else if (cible?.type === 'entrepot') {
      centre = centreRect(cible.entrepot);
      rayon = Math.max(cible.entrepot.l ?? 80, cible.entrepot.h ?? 80) * 0.65;
    } else if (cible?.type === 'aeroport' && this.ville.aeroport) {
      const a = this.ville.aeroport;
      centre = a.terminal ? centreRect(a.terminal) : (a.cx !== undefined ? [a.cx, a.cy] : centreRect(a));
      rayon = a.terminal ? Math.max(a.terminal.l, a.terminal.h) * 0.65 : (a.rayon ?? 60) + 12;
    } else if (cible?.type === 'vehicule' || this.trafic.suivi) {
      const p = this.trafic.position(cible?.vehicule ?? this.trafic.suivi);
      centre = [p.x, p.y];
      rayon = 16;
    }
    this.repere.visible = !!centre;
    if (!centre) return;
    this.repere.position.x = centre[0];
    this.repere.position.z = centre[1];
    this.repere.scale.set(rayon, rayon, 1);
    this.repere.material.color.set(this.selection ? 0xffffff : 0xffe2a8);
  }

  // ---------- Dessin ----------

  dessiner(temps) {
    const dt = this._precedent === undefined ? 0 : Math.min(0.1, (temps - this._precedent) / 1000);
    this._precedent = temps;
    this._temps = temps;
    this.r2._avancerFondu?.();
    this.palette = this.r2.palette;
    const v = this.ville;
    if (!v.bornes) return;
    v.animer?.(temps);

    if (this.trafic.suivi) {
      const pos = this.trafic.position(this.trafic.suivi);
      this.camera.x += (pos.x - this.camera.x) * Math.min(1, dt * 5);
      this.camera.y += (pos.y - this.camera.y) * Math.min(1, dt * 5);
    }

    const c = this._contexte();
    this._majSol(performance.now());
    this._majAmbiance();
    this._majElements(c, dt);
    this._majVehicules(c);
    this._majRepere();
    this._placerCamera();
    this.renderer.render(this.scene, this.cam);
    this._dessinerEtiquettes();
  }

  // ---------- Noms (calque 2D par-dessus la 3D) ----------

  _dessinerEtiquettes() {
    const ctx = this.ctx;
    const p = this.palette;
    const v = this.ville;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    const texteFort = p.texte ?? (this.nuit ? '#E6E8EE' : '#3A3F4B');
    // Contour opposé au texte : sombre sous un texte clair, clair sous un texte foncé.
    const [r, g, b] = versRgb(texteFort);
    const contour = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? 'rgba(10,12,20,0.75)' : 'rgba(255,255,255,0.85)';
    const ecrire = (texte, x, y, couleur, taille, gras = 700) => {
      ctx.font = `${gras} ${taille}px ${POLICE}`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = contour;
      ctx.strokeText(texte, x, y);
      ctx.fillStyle = couleur;
      ctx.fillText(texte, x, y);
    };
    const visible = ([x, y, z]) => z < 1 && x > -60 && x < this.largeur + 60 && y > -20 && y < this.hauteur + 30;

    // Quartiers : nom au-dessus du centre de leurs applications.
    const parQuartier = new Map();
    for (const lot of v.lots ?? []) {
      const q = lot.app.quartier;
      const [x, y] = centreLot(lot);
      const cumul = parQuartier.get(q) ?? { x: 0, y: 0, n: 0, haut: Infinity };
      cumul.x += x; cumul.y += y; cumul.n++;
      cumul.haut = Math.min(cumul.haut, lot.y ?? y);
      parQuartier.set(q, cumul);
    }
    for (const [q, cumul] of parQuartier) {
      const point = this.versEcran(cumul.x / cumul.n, Math.min(cumul.y / cumul.n, cumul.haut), 90);
      const fondSombre = contour.startsWith('rgba(10');
      if (visible(point)) ecrire(q.nom.toUpperCase(), point[0], point[1], eclaircir(versCss(q.couleur), fondSombre ? 0.35 : -0.25), 12, 800);
    }

    // Applications : de près, ou survolées et sélectionnées.
    const proches = [];
    for (const [lot, objet] of this.objetsApps) {
      const mise = this.survol?.app === lot.app || this.selection?.app === lot.app;
      const [x, y] = centreLot(lot);
      const point = this.versEcran(x, y, (objet.userData.hauteur ?? 30) * objet.scale.y + 6);
      if (!visible(point)) continue;
      const distance = this.cam.position.distanceTo(new THREE.Vector3(x, 0, y));
      if (mise || distance < 900) proches.push({ lot, point, distance, mise });
    }
    proches.sort((a, b) => a.distance - b.distance);
    for (const { lot, point, mise } of proches.slice(0, 40)) {
      const nom = tronquer(this.D.nomVisible(lot.app, this.discret), 22);
      ecrire(nom, point[0], point[1], mise ? texteFort : (p.texteDoux ?? texteFort), mise ? 12 : 11, mise ? 800 : 600);
    }

    // Tour : processeur et mémoire.
    const s = v.systeme;
    if (v.tour && s && this.objetTour) {
      const point = this.versEcran(v.tour.x, v.tour.y, (this.objetTour.userData.hauteur ?? 70) + 26);
      if (visible(point)) {
        ecrire(`${Math.round(s.cpu)} %`, point[0], point[1] - 12, texteFort, 20, 800);
        ecrire(`CPU · RAM ${Math.round(100 * s.ram_utilisee / s.ram_totale)} %`, point[0], point[1] + 2, p.texteDoux ?? texteFort, 11, 700);
      }
    }
    // Disques et Internet
    for (const e of v.entrepots ?? []) {
      const objet = this.objetsEntrepots.get(e.disque.id);
      const [x, y] = centreRect(e);
      const point = this.versEcran(x, y, (objet?.userData.hauteur ?? 40) + 10);
      if (visible(point)) ecrire(`Disque ${e.disque.nom} · ${Math.round(100 * e.disque.utilise / e.disque.total)} %`, point[0], point[1], texteFort, 12, 800);
    }
    const a = v.aeroport;
    if (a && this.objetInternet) {
      const [x, y] = this.objetInternet.userData.centre;
      const point = this.versEcran(x, y, (this.objetInternet.userData.hauteur ?? 50) + 12);
      const sature = (this.trafic.saturation.get('aeroport') ?? 0) > 0;
      if (visible(point)) ecrire('INTERNET', point[0], point[1], sature ? ROUGE : '#2BA3C9', 13, 800);
    }
  }
}

// ---------- Utilitaires ----------

function centreLot(lot) {
  if (lot.cx !== undefined) return [lot.cx, lot.cy];
  return [lot.x + lot.l / 2, lot.y + lot.h / 2];
}

function centreRect(r) {
  if (r.cx !== undefined) return [r.cx, r.cy];
  return [r.x + (r.l ?? 0) / 2, r.y + (r.h ?? 0) / 2];
}

function versRgb(couleur) {
  if (couleur.startsWith('#')) {
    const n = parseInt(couleur.length === 4 ? couleur.slice(1).replace(/./g, c => c + c) : couleur.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return couleur.match(/[\d.]+/g).slice(0, 3).map(Number);
}

// Couleur CSS sans transparence (three.js ignore l'alpha des rgba()).
function versCss(couleur) {
  const [r, g, b] = versRgb(couleur);
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

export function melanger(a, b, t) {
  const [r1, g1, b1] = versRgb(a);
  const [r2, g2, b2] = versRgb(b);
  const m = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${m(r1, r2)},${m(g1, g2)},${m(b1, b2)})`;
}

// Éclaircit (facteur > 0) ou assombrit (facteur < 0) une couleur.
export function eclaircir(couleur, facteur) {
  const [r, g, b] = versRgb(couleur);
  const f = c => Math.round(facteur >= 0 ? c + (255 - c) * facteur : c * (1 + facteur));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function tronquer(texte, n) {
  return texte.length > n ? texte.slice(0, n - 1) + '…' : texte;
}
