// Interface : données en direct, barre du haut, navigation, panneau de détail, légende, recherche.

import { DECORS, DECOR_DEFAUT } from './decors/liste.js';

const $ = id => document.getElementById(id);

// Module du décor choisi (decors/<id>/decor.js) : placement, circulation et dessin propres à ce décor.
let D;

const simulation = new URLSearchParams(location.search).get('simuler');
// Aperçu des embouteillages sans saturer le PC : ?bouchon=disque, reseau ou tout
const bouchonForce = new URLSearchParams(location.search).get('bouchon') ?? '';
const modeDebug = new URLSearchParams(location.search).has('debug');
const decorDemande = new URLSearchParams(location.search).get('decor');
const vueDemandee = new URLSearchParams(location.search).get('vue');
// Prise de vue 3D précise, pour un essai : ?camera3d=zoom,azimut°,inclinaison°[,x,y]
const camera3d = new URLSearchParams(location.search).get('camera3d');

// Le jeton arrive dans l'adresse ouverte par lancer.bat ; on le garde pour la session puis on le retire de l'adresse.
const jeton = (() => {
  const dansAdresse = new URLSearchParams(location.search).get('t');
  try {
    if (dansAdresse) sessionStorage.setItem('jeton', dansAdresse);
    history.replaceState(null, '', '/');
    return dansAdresse ?? sessionStorage.getItem('jeton');
  } catch {
    return dansAdresse;
  }
})();

async function api(chemin, methode = 'GET') {
  const reponse = await fetch(chemin, { method: methode, headers: { 'X-Jeton': jeton ?? '' }, cache: 'no-store' });
  if (!reponse.ok) throw new Error(`${chemin} : ${reponse.status}`);
  return reponse.json();
}

let ville, rendu, trafic, config, etat;
let enPause = false;
let discret = false;
let redemarrage = false;
let themeApplique = null;
let periodeMs = 2000;

// ---------- Formats ----------

const nombre = (n, dec = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function octets(n) {
  const unites = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < unites.length - 1) { n /= 1024; i++; }
  return `${nombre(n, n < 10 && i > 0 ? 1 : 0)} ${unites[i]}`;
}

const debit = n => `${octets(n)}/s`;

function depuis(dateSecondes) {
  if (!dateSecondes) return '';
  const date = new Date(dateSecondes * 1000);
  const aujourdhui = new Date().toDateString() === date.toDateString();
  return aujourdhui
    ? `aujourd'hui à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    : `le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}

// ---------- Données en direct ----------

// « immediat » : recrée toute la circulation à partir de ce relevé (ouverture, sortie de pause).
async function actualiser(immediat = false) {
  try {
    const recu = await api('/api/etat');
    if (enPause) return;  // relevé parti juste avant la pause : ignoré
    etat = recu;
    ville.mettreAJour(etat);
    trafic.planifier(etat, periodeMs, performance.now(), immediat);
    if (immediat && rendu.selection?.type === 'vehicule') afficherDetail(null);  // véhicule suivi retiré
    majBarre();
    if (rendu.selection && rendu.selection.type !== 'vehicule') afficherDetail(rafraichirSelection(rendu.selection));
    if ($('message').className !== 'info') cacherMessage();  // les messages d'information s'effacent seuls
  } catch {
    if (!redemarrage) afficherMessage('PC City ne répond plus. Relancez lancer.bat.');
  }
}

// Après une mise à jour de PC City : le serveur redémarre (même port, même jeton), puis la page se recharge.
async function actualiserApplication() {
  redemarrage = true;
  $('b-actualiser').disabled = true;
  afficherMessage('Mise à jour de PC City…', 'info');
  let ancienne = null;
  try {
    ancienne = (await api('/api/redemarrer', 'POST')).instance;
  } catch {
    // Le serveur a pu couper la connexion en redémarrant : on attend qu'il revienne.
  }
  const limite = performance.now() + 20000;
  while (performance.now() < limite) {
    await new Promise(r => setTimeout(r, 500));
    try {
      // On attend le nouveau serveur, pas une dernière réponse de l'ancien.
      if ((await api('/api/ping')).instance !== ancienne) {
        location.reload();
        return;
      }
    } catch {
      // Pas encore prêt
    }
  }
  redemarrage = false;
  $('b-actualiser').disabled = false;
  afficherMessage('PC City n\'a pas redémarré. Relancez lancer.bat.');
}

// Touche B : aperçu des embouteillages sans saturer le PC (disque → réseau → les deux → arrêt).
const APERCUS_BOUCHON = ['', 'disque', 'reseau', 'tout'];
const NOMS_APERCUS = { disque: 'disque saturé', reseau: 'réseau saturé', tout: 'disque et réseau saturés' };

function apercuBouchon() {
  const suivant = APERCUS_BOUCHON[(APERCUS_BOUCHON.indexOf(trafic.forcer) + 1) % APERCUS_BOUCHON.length];
  trafic.forcer = suivant;
  $('direct').textContent = suivant ? 'Aperçu bouchon' : (enPause ? 'En pause' : 'En direct');
  afficherMessage(suivant ? `Aperçu d'embouteillage : ${NOMS_APERCUS[suivant]} (touche B pour la suite)` : 'Aperçu d\'embouteillage arrêté', 'info');
  setTimeout(cacherMessage, 2500);
  if (etat) trafic.mesurerSaturation(etat);
}

function basculerPause() {
  enPause = !enPause;
  // En pause, les départs prévus sont annulés ; à la reprise, un relevé immédiat relance la circulation.
  if (enPause) trafic.aVenir = [];
  else actualiser(true);
  $('b-pause').textContent = enPause ? '▶ Reprendre' : '⏸ Pause';
  $('direct').classList.toggle('arrete', enPause);
  $('direct').textContent = enPause ? 'En pause' : (trafic.forcer ? 'Aperçu bouchon' : 'En direct');
}

function rafraichirSelection(sel) {
  if (sel.type === 'app') {
    const app = ville.apps.get(sel.app.id);
    return app ? { type: 'app', app } : null;
  }
  if (sel.type === 'entrepot') {
    const e = ville.entrepots?.find(x => x.disque.id === sel.entrepot.disque.id);
    return e ? { type: 'entrepot', entrepot: e } : null;
  }
  return sel;
}

function majBarre() {
  const s = etat.systeme;
  $('m-cpu').textContent = `${nombre(s.cpu)} %`;
  $('m-ram').textContent = `${nombre(100 * s.ram_utilisee / s.ram_totale)} %`;
  $('m-disque').textContent = `L ${octets(s.disque_lecture)} · É ${octets(s.disque_ecriture)}`;
  $('m-reseau').textContent = `↓${octets(s.reseau_recu)} ↑${octets(s.reseau_envoye)}`;
  $('m-disque').title = `Lecture ${debit(s.disque_lecture)} · Écriture ${debit(s.disque_ecriture)}`;
  $('m-reseau').title = `Reçu ${debit(s.reseau_recu)} · Envoyé ${debit(s.reseau_envoye)}`;
}

// ---------- Mode discret (F22) ----------

// Masque les noms des programmes et des sites, pour un partage d'écran. Le choix est mémorisé :
// mieux vaut rester discret par oubli que l'inverse.
function lireDiscret() {
  try {
    return localStorage.getItem('discret') === '1';
  } catch {
    return false;
  }
}

function appliquerDiscret(actif) {
  discret = actif;
  rendu.discret = actif;
  try {
    localStorage.setItem('discret', actif ? '1' : '0');
  } catch {
    // Préférence non mémorisée : sans conséquence
  }
  const bouton = $('b-discret');
  bouton.setAttribute('aria-pressed', String(actif));
  bouton.title = actif
    ? 'Mode discret actif : noms des programmes et des sites masqués (touche D pour les afficher)'
    : 'Masquer les noms des programmes et des sites, pour un partage d\'écran (touche D)';
  $('infobulle').hidden = true;
  if (actif) $('recherche').value = '';  // un nom déjà tapé resterait visible
  if (rendu.selection) afficherDetail(rafraichirSelection(rendu.selection));
}

// ---------- Icônes des programmes (F23) ----------

const icones = new Map();  // id de l'application -> Promise de l'image (data: URL) ou null

function icone(id) {
  if (!icones.has(id)) {
    icones.set(id, api(`/api/icone?id=${encodeURIComponent(id)}`)
      .then(r => r.png)
      .catch(() => { icones.delete(id); return null; }));
  }
  return icones.get(id);
}

// Pastille du quartier, remplacée par l'icône réelle du programme dès qu'elle est connue.
function marqueApplication(app, couleur) {
  const pastille = el('span', { classe: 'd-pastille', fond: couleur });
  if (discret || app.donnees.etat === 'ferme') return pastille;
  icone(app.id).then(png => {
    if (png && pastille.isConnected && !discret) pastille.replaceWith(el('img', { classe: 'd-icone', src: png, alt: '' }));
  });
  return pastille;
}

// ---------- Thème ----------

// « systeme » suit le thème clair/sombre de Windows ; « heure » passe en nuit de 20 h à 7 h.
const themeSysteme = window.matchMedia('(prefers-color-scheme: dark)');

function lireChoixTheme() {
  try {
    return localStorage.getItem('theme') ?? 'systeme';
  } catch {
    return 'systeme';
  }
}

function enregistrerChoixTheme(choix) {
  try {
    localStorage.setItem('theme', choix);
  } catch {
    // Préférence non mémorisée : sans conséquence
  }
}

// Heure du cycle jour/nuit : l'heure réelle, ou celle passée dans l'adresse (?simuler=06:45) pour un aperçu.
function minutesDuJour() {
  const simulee = /^(\d{1,2}):(\d{2})$/.exec(simulation ?? '');
  if (simulee) return Number(simulee[1]) * 60 + Number(simulee[2]);
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function majTheme() {
  const choix = $('theme').value;
  let palette = D.PALETTES.jour;
  if (choix === 'sombre' || (choix === 'systeme' && themeSysteme.matches)) palette = D.PALETTES.nuit;
  if (choix === 'heure') palette = D.paletteDuMoment(minutesDuJour());
  if (palette !== themeApplique) {
    rendu.definirPalette(palette);
    themeApplique = palette;
  }
  document.body.dataset.theme = rendu.nuit ? 'nuit' : 'jour';
  majHeure();
}

function majHeure() {
  const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const champ = $('m-heure');
  if ($('theme').value === 'heure') {
    const moment = D.momentDeLaJournee(minutesDuJour());
    champ.textContent = `${moment.icone} ${heure}`;
    champ.title = moment.nom;
  } else {
    champ.textContent = heure;
    champ.title = '';
  }
}

// ---------- Construction d'éléments ----------

function el(balise, attributs = {}, ...enfants) {
  const e = document.createElement(balise);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (cle === 'classe') e.className = valeur;
    else if (cle === 'fond') e.style.background = valeur;
    else if (cle === 'largeur') e.style.width = valeur;
    else e.setAttribute(cle, valeur);
  }
  for (const enfant of enfants) if (enfant != null) e.append(enfant);
  return e;
}

function mesures(lignes) {
  const dl = el('dl', { classe: 'd-mesures' });
  for (const [libelle, valeur] of lignes) dl.append(el('dt', {}, libelle), el('dd', {}, valeur));
  return dl;
}

function jauge(part, couleur) {
  return el('div', { classe: 'd-jauge' }, el('div', { fond: couleur, largeur: `${Math.min(100, part * 100)}%` }));
}

// ---------- Panneau de détail ----------

function afficherDetail(sel) {
  rendu.selection = sel;
  if (sel?.type !== 'vehicule') trafic.suivi = null;
  const panneau = $('detail');
  if (!sel) { panneau.hidden = true; return; }
  $('detail-contenu').replaceChildren(...contenuDetail(sel).filter(e => e != null));
  panneau.hidden = false;
}

const LIBELLES_FLUX = {
  lecture: 'Lecture sur le disque',
  ecriture: 'Écriture sur le disque',
  recu: 'Données reçues d\'Internet',
  envoye: 'Données envoyées sur Internet',
};

const nomApp = app => D.nomVisible(app, discret);

// Ce qu'un décor peut utiliser pour composer ses propres lignes de panneau et de légende.
const aide = () => ({ el, mesures, jauge, nombre, octets, debit, trafic, etat, config, afficherMessage, cacherMessage });

// Nom d'une application à partir des données brutes du relevé.
function nomDonnees(donnees) {
  const app = ville.apps.get(donnees.id);
  return app ? nomApp(app) : (discret ? 'Programme' : donnees.nom);
}

function libelleSite(site) {
  if (site.nature === 'lan') return `${site.nom} (réseau local)`;
  return site.nom;
}

// Adresse restée sans nom : absente du cache DNS de Windows (IPv4 en chiffres, ou IPv6 avec des « : »).
const sansNom = site => /^[\d.]+$/.test(site.nom) || site.nom.includes(':');

// Liste des sites contactés, ceux sans nom réunis en une seule ligne ; en mode discret, seulement leur nombre.
function listeSites(sites, titre) {
  if (!sites.length) return [];
  if (discret) {
    return [el('p', { classe: 'l-section' }, titre), el('p', { classe: 'd-note d-masque' },
      `${nombre(sites.length)} site${sites.length > 1 ? 's' : ''} : noms masqués (mode discret)`)];
  }
  const nommes = sites.filter(s => !sansNom(s)).slice(0, 10);
  const inconnus = sites.filter(sansNom);
  const lignes = nommes.map(site => [libelleSite(site), site.connexions]);
  if (inconnus.length) {
    lignes.push([`${nombre(inconnus.length)} adresse${inconnus.length > 1 ? 's' : ''} sans nom`,
      inconnus.reduce((n, s) => n + s.connexions, 0)]);
  }
  return [
    el('p', { classe: 'l-section' }, titre),
    el('dl', { classe: 'd-mesures d-sites' }, ...lignes.flatMap(([libelle, connexions]) => [
      el('dt', { title: libelle }, libelle),
      el('dd', { title: 'Connexions' }, nombre(connexions)),
    ])),
  ];
}

// Message d'embouteillage pour un disque ou l'aéroport.
function noteBouchon(cle, quoi) {
  const saturation = trafic.saturation.get(cle) ?? 0;
  if (saturation <= 0) return null;
  const force = trafic.forcer ? ' (aperçu, touche B)' : '';
  return el('p', { classe: 'd-alerte' }, `Embouteillage : ${quoi}${force}. Les véhicules font la queue.`);
}

function contenuDetail(sel) {
  const s = etat.systeme;
  if (sel.type === 'vehicule') {
    const v = sel.vehicule;
    const versApp = v.flux === 'lecture' || v.flux === 'recu';
    const lieu = v.cible.type === 'aeroport' ? 'Aéroport (Internet)' : `Entrepôt ${v.cible.entrepot.disque.nom}`;
    const bouchon = (trafic.saturation.get(D.cleCible(v.cible)) ?? 0) > 0;
    return [
      el('h2', { classe: 'd-titre' }, el('span', { classe: 'd-pastille', fond: v.couleur }), D.GABARITS[v.gabarit].nom),
      el('p', { classe: 'd-sous-titre' }, LIBELLES_FLUX[v.flux]),
      bouchon ? el('p', { classe: 'd-alerte' }, v.cible.type === 'aeroport'
        ? 'Pris dans un embouteillage : la connexion réseau est saturée.'
        : 'Pris dans un embouteillage : le disque est saturé.') : null,
      v.boost ? el('p', { classe: 'd-note d-boost' }, '⚡ Boost : retardé par un feu ou un rond-point, il accélère pour retrouver sa place en direct.') : null,
      ...D.detailVehicule(v, aide()),
      mesures([
        ['Origine', versApp ? lieu : nomApp(v.app)],
        ['Destination', versApp ? nomApp(v.app) : lieu],
        ['Débit estimé', debit(v.debit)],
      ]),
      el('p', { classe: 'd-note' }, v.cible.type === 'aeroport'
        ? 'Windows ne donne pas le volume réseau de chaque programme : il est estimé en répartissant le débit total selon le nombre de connexions.'
        : 'La caméra suit ce véhicule. Faites glisser la carte ou appuyez sur Échap pour arrêter.'),
    ];
  }
  if (sel.type === 'app') {
    const d = sel.app.donnees;
    const q = sel.app.quartier;
    const ferme = d.etat === 'ferme';
    const veille = d.etat === 'veille';
    return [
      el('h2', { classe: 'd-titre' }, marqueApplication(sel.app, ferme ? '#A89F92' : q.couleur), nomApp(sel.app)),
      el('p', { classe: 'd-sous-titre' }, discret ? 'Nom masqué (mode discret)' : `Quartier ${q.nom}`),
      ferme ? el('span', { classe: 'd-etiquette d-ferme' }, 'FERMÉ') : null,
      veille ? el('span', { classe: 'd-etiquette d-veille' }, 'EN VEILLE') : null,
      d.alerte ? el('p', { classe: 'd-alerte' }, d.cpu >= 50 ? 'Cette application sollicite fortement le processeur.' : 'Cette application occupe une grande part de la mémoire.') : null,
      ferme
        ? el('p', { classe: 'd-note' }, `Dernière utilisation ${depuis(d.ferme_depuis)}. Le bâtiment garde sa place et rouvrira si le programme est relancé.`)
        : mesures([
          ['Processus', nombre(d.nb_processus)],
          ['Mémoire', octets(d.ram)],
          ['Part de la RAM', `${nombre(100 * d.ram / s.ram_totale, 1)} %`],
          ['Processeur', `${nombre(d.cpu, 1)} %`],
          ['Lecture disque', debit(d.lecture)],
          ['Écriture disque', debit(d.ecriture)],
          ['Connexions réseau', nombre(d.connexions)],
        ]),
      veille ? el('p', { classe: 'd-note' }, 'Ouvert, mais sans activité depuis plusieurs minutes.') : null,
      ...D.detailApp(sel.app, aide()),
      ...listeSites(d.sites ?? [], 'Sites contactés'),
      ferme ? null : el('p', { classe: 'd-note' }, d.sites?.length && !discret
        ? 'Mémoire et processeur sont calculés comme dans le Gestionnaire des tâches. Les noms des sites viennent du cache DNS de Windows ; une adresse sans nom n\'y figurait pas (connexion ouverte avant PC City, ou programme qui trouve ses noms lui-même).'
        : 'Mémoire et processeur sont calculés comme dans le Gestionnaire des tâches.'),
    ];
  }
  if (sel.type === 'tour') {
    const ram = s.ram_utilisee / s.ram_totale;
    return [
      el('h2', { classe: 'd-titre' }, el('span', { classe: 'd-pastille', fond: '#F2A541' }), 'Tour centrale'),
      el('p', { classe: 'd-sous-titre' }, 'Processeur et mémoire du PC'),
      mesures([['Processeur', `${nombre(s.cpu)} %`], ['Cœurs', nombre(s.nb_coeurs)],
        ...(s.watts_estimes != null ? [['Consommation (estimée)', `≈ ${nombre(s.watts_estimes)} W`]] : [])]),
      jauge(s.cpu / 100, '#F2A541'),
      mesures([['Mémoire utilisée', octets(s.ram_utilisee)], ['Mémoire totale', octets(s.ram_totale)]]),
      jauge(ram, ram > 0.9 ? '#E8504F' : '#F2A541'),
    ];
  }
  if (sel.type === 'entrepot') {
    const d = sel.entrepot.disque;
    const occupe = d.utilise / d.total;
    return [
      el('h2', { classe: 'd-titre' }, el('span', { classe: 'd-pastille', fond: sel.entrepot.toit }), `Entrepôt ${d.nom}`),
      el('p', { classe: 'd-sous-titre' }, 'Disque'),
      noteBouchon(`disque:${d.id}`, 'le disque est saturé'),
      mesures([['Capacité', octets(d.total)], ['Utilisé', octets(d.utilise)], ['Libre', octets(d.libre)]]),
      jauge(occupe, occupe > 0.9 ? '#E8504F' : '#3FA9E0'),
      d.occupation != null ? mesures([['Activité du disque', `${nombre(d.occupation)} %`]]) : null,
      d.occupation != null ? jauge(d.occupation / 100, d.occupation >= config.embouteillages.disque_debut_pct ? '#E8504F' : '#3DBE7A') : null,
      mesures([['Lecture (tous disques)', debit(s.disque_lecture)], ['Écriture (tous disques)', debit(s.disque_ecriture)]]),
      el('p', { classe: 'd-note' }, 'Activité : part du temps où le disque travaille, comme dans le Gestionnaire des tâches. Les véhicules d\'un programme vont vers le disque où il est installé : Windows ne précise pas sur quel disque il lit ou écrit.'),
    ];
  }
  if (sel.type === 'aeroport') {
    const apps = etat.applications.filter(a => a.connexions > 0).sort((a, b) => b.connexions - a.connexions);
    const total = apps.reduce((n, a) => n + a.connexions, 0);
    // Sites de toutes les applications réunis (hors connexions internes au PC)
    const sites = new Map();
    for (const a of apps) {
      for (const site of a.sites ?? []) {
        if (site.nature === 'local') continue;
        const cumul = sites.get(site.nom) ?? { ...site, connexions: 0 };
        cumul.connexions += site.connexions;
        sites.set(site.nom, cumul);
      }
    }
    const principaux = [...sites.values()].sort((a, b) => b.connexions - a.connexions);
    return [
      el('h2', { classe: 'd-titre' }, el('span', { classe: 'd-pastille', fond: '#5BC8E8' }), 'Aéroport'),
      el('p', { classe: 'd-sous-titre' }, 'Internet et réseau'),
      noteBouchon('aeroport', 'la connexion réseau est saturée'),
      mesures([
        ['Reçu', debit(s.reseau_recu)], ['Envoyé', debit(s.reseau_envoye)],
        ...(s.reseau_occupation != null ? [['Utilisation de la carte réseau', `${nombre(s.reseau_occupation)} %`]] : []),
        ['Connexions actives', nombre(total)],
      ]),
      apps.length ? el('p', { classe: 'l-section' }, 'Applications les plus connectées') : null,
      apps.length ? mesures(apps.slice(0, 6).map(a => [nomDonnees(a), nombre(a.connexions)])) : null,
      ...listeSites(principaux, 'Sites les plus contactés'),
    ];
  }
  return D.detail(sel, aide()) ?? [];
}

// ---------- Légende ----------

function construireLegende() {
  const ligne = (symbole, texte) => el('div', { classe: 'l-ligne' }, el('span', { classe: 'l-symbole' }, symbole), texte);
  const carre = couleur => el('span', { classe: 'l-carre', fond: couleur });
  const vehicule = couleur => el('span', { classe: 'l-vehicule', fond: couleur });
  $('legende-contenu').replaceChildren(
    el('p', { classe: 'l-section' }, 'Quartiers'),
    ...config.quartiers.map(q => ligne(carre(q.couleur), q.nom)),
    el('p', { classe: 'l-section' }, 'Bâtiments'),
    ligne('🏢', 'Grand bâtiment : une application (taille selon la RAM)'),
    ligne('▪', 'Petites maisons : ses processus'),
    ligne('⚪', 'Pastilles allumées : activité du processeur'),
    ligne('📍', 'Épingle rouge : application qui sature le CPU ou la RAM'),
    ligne('💤', 'Couleurs pâles et « z » : en veille (inactive)'),
    ligne(carre('#C9C1B4'), 'Gris « FERMÉ » : programme fermé'),
    el('p', { classe: 'l-section' }, 'Circulation'),
    ligne(vehicule(D.COULEURS_FLUX.lecture), 'Lecture sur le disque (entrepôt → application)'),
    ligne(vehicule(D.COULEURS_FLUX.ecriture), 'Écriture sur le disque (application → entrepôt)'),
    ligne(vehicule(D.COULEURS_FLUX.recu), 'Réseau (application ↔ aéroport)'),
    ligne('🚚', 'Voiture, camionnette, camion : selon le débit'),
    ligne('🚧', 'Halo rouge et file de véhicules : embouteillage, le disque ou le réseau est saturé'),
    ...D.legendeCirculation({ ...aide(), ligne }),
    ligne('🚦', 'Feux tricolores : s\'allument quand des véhicules arrivent des deux côtés d\'un carrefour'),
    ligne('⚡', 'Un véhicule retardé (feu, rond-point) accélère pour rester fidèle au direct'),
    el('p', { classe: 'l-section' }, 'Repères'),
    ...D.legendeReperes({ ...aide(), ligne }),
    ...(rendu.glisser ? [
      el('p', { classe: 'l-section' }, 'Vue 3D'),
      ligne('🖱', 'Clic gauche et glisser : se déplacer ; molette : zoomer'),
      ligne('↻', 'Clic droit et glisser : tourner autour de la ville et changer l\'inclinaison'),
      ligne('⌂', 'Recentrer (Espace) : revenir à la vue d\'ensemble'),
    ] : []),
  );
}

// ---------- Erreurs ----------

// Chaque erreur de la page est notée une fois dans donnees\erreurs.log (via le serveur local),
// pour pouvoir comprendre un blocage survenu chez l'utilisateur.
const erreursSignalees = new Set();

function signalerErreur(erreur) {
  const texte = String(erreur?.stack ?? erreur?.message ?? erreur).slice(0, 3000);
  if (erreursSignalees.has(texte) || erreursSignalees.size > 20) return;
  erreursSignalees.add(texte);
  console.error(erreur);
  fetch('/api/erreur', {
    method: 'POST',
    headers: { 'X-Jeton': jeton ?? '', 'Content-Type': 'text/plain; charset=utf-8' },
    body: texte,
  }).catch(() => {});
}

window.addEventListener('error', e => signalerErreur(e.error ?? e.message));
window.addEventListener('unhandledrejection', e => signalerErreur(e.reason));

// ---------- Messages ----------

function afficherMessage(texte, type = 'erreur') {
  $('message').textContent = texte;
  $('message').className = type;
  $('message').hidden = false;
}

function cacherMessage() {
  $('message').hidden = true;
}

// ---------- Navigation ----------

function brancherNavigation(canvas) {
  let glisse = null;
  let derniereInteraction = 0;
  const infobulle = $('infobulle');

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    glisse = { x: e.clientX, y: e.clientY, cx: rendu.camera.x, cy: rendu.camera.y, bouge: false };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', e => {
    derniereInteraction = performance.now();
    if (glisse) {
      const dx = e.clientX - glisse.x;
      const dy = e.clientY - glisse.y;
      if (Math.hypot(dx, dy) > 4) glisse.bouge = true;
      if (glisse.bouge) {
        trafic.suivi = null;
        canvas.classList.add('glisse');
        // En 3D, la caméra peut avoir tourné : c'est le rendu qui convertit le geste.
        if (rendu.glisser) rendu.glisser(glisse, dx, dy);
        else {
          rendu.camera.x = glisse.cx - dx / rendu.camera.zoom;
          rendu.camera.y = glisse.cy - dy / rendu.camera.zoom;
        }
        infobulle.hidden = true;
        return;
      }
    }
    const [wx, wy] = rendu.versMonde(e.clientX, e.clientY);
    const vehicule = trafic.vehiculeEn(wx, wy);
    const element = vehicule ? null : ville.elementEn(wx, wy);
    rendu.survol = element;
    canvas.classList.toggle('survol', !!(element || vehicule));
    let contenu = null;
    if (vehicule) contenu = [el('strong', {}, D.GABARITS[vehicule.gabarit].nom), LIBELLES_FLUX[vehicule.flux]];
    else if (element?.type === 'app') {
      const d = element.app.donnees;
      contenu = [el('strong', {}, nomApp(element.app)), d.etat === 'ferme' ? 'Fermé' : `RAM ${octets(d.ram)}`];
    }
    if (contenu) {
      infobulle.replaceChildren(...contenu);
      infobulle.style.left = `${e.clientX + 14}px`;
      infobulle.style.top = `${e.clientY + 14}px`;
      infobulle.hidden = false;
    } else {
      infobulle.hidden = true;
    }
  });

  canvas.addEventListener('pointerup', e => {
    if (glisse && !glisse.bouge) {
      const [wx, wy] = rendu.versMonde(e.clientX, e.clientY);
      const vehicule = trafic.vehiculeEn(wx, wy);
      if (vehicule) {
        trafic.suivi = vehicule;
        afficherDetail({ type: 'vehicule', vehicule });
        rendu.camera.zoom = Math.max(rendu.camera.zoom, 1.4);
      } else {
        afficherDetail(ville.elementEn(wx, wy));
      }
    }
    glisse = null;
    canvas.classList.remove('glisse');
  });

  canvas.addEventListener('pointerleave', () => {
    rendu.survol = null;
    infobulle.hidden = true;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    derniereInteraction = performance.now();
    rendu.zoomer(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') { e.preventDefault(); trafic.suivi = null; rendu.recentrer(); }
    if (e.code === 'Escape') afficherDetail(null);
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === 'KeyD') appliquerDiscret(!discret);
    if (e.code === 'KeyB') apercuBouchon();
    else D.touche(e.code, aide());
  });

  // Rendu à pleine cadence pendant une interaction ou un suivi, à 25 images/s sinon (rester léger).
  // En pause, l'horloge de la ville s'arrête : véhicules et animations restent figés, la caméra reste libre.
  let dernierDessin = null;
  let dernierPas = null;
  let tempsVille = 0;
  const boucle = temps => {
    // Quoi qu'il arrive, l'image suivante est demandée : une erreur ne doit jamais figer la ville.
    requestAnimationFrame(boucle);
    try {
      const dt = dernierPas === null ? 0 : Math.min(0.1, (temps - dernierPas) / 1000);
      dernierPas = temps;
      if (!enPause) {
        tempsVille += dt * 1000;
        // Même horloge que trafic.planifier (l'horodatage de requestAnimationFrame peut en différer).
        trafic.avancer(dt, performance.now());
      }
      const actif = glisse || trafic.suivi || temps - derniereInteraction < 300;
      if (actif || dernierDessin === null || temps - dernierDessin >= 40) {
        rendu.dessiner(tempsVille);
        dernierDessin = temps;
      }
    } catch (erreur) {
      signalerErreur(erreur);
    }
  };
  requestAnimationFrame(boucle);
}

function brancherRecherche() {
  const champ = $('recherche');
  champ.addEventListener('input', () => champ.classList.remove('introuvable'));
  champ.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const app = ville.chercher(champ.value, discret);
    if (!app) { champ.classList.add('introuvable'); return; }
    trafic.suivi = null;
    rendu.centrerSur(app.lot.x + app.lot.l / 2, app.lot.y + app.lot.h / 2, Math.max(rendu.camera.zoom, 1.3));
    afficherDetail({ type: 'app', app });
  });
}

// ---------- Décor ----------

// Décor choisi : celui de l'adresse (?decor=neon, pour un essai), sinon le dernier choisi, sinon la ville.
function lireDecor() {
  let choix = decorDemande;
  try {
    choix ??= localStorage.getItem('decor');
  } catch {
    // Préférence non mémorisée : décor par défaut
  }
  return DECORS.some(d => d.id === choix && d.pret) ? choix : DECOR_DEFAUT;
}

async function chargerDecor(id) {
  try {
    return await import(`./decors/${id}/decor.js`);
  } catch (erreur) {
    signalerErreur(erreur);
    return import(`./decors/${DECOR_DEFAUT}/decor.js`);
  }
}

// Chaque décor place la ville à sa façon : on recharge la page sur le nouveau décor (rien n'est perdu,
// toutes les données viennent du serveur).
function brancherMenuDecor(actuel) {
  const menu = $('decor');
  menu.replaceChildren(...DECORS.map(d => {
    const option = el('option', { value: d.id }, d.pret ? d.nom : `${d.nom} (bientôt)`);
    option.disabled = !d.pret;
    return option;
  }));
  menu.value = actuel;
  menu.addEventListener('change', () => {
    try {
      localStorage.setItem('decor', menu.value);
    } catch {
      // Préférence non mémorisée : le changement vaut pour cette fois
    }
    afficherMessage('Changement de décor…', 'info');
    location.reload();
  });
}

// ---------- Vue 2D / 3D ----------

// Vue choisie : celle de l'adresse (?vue=3d, pour un essai), sinon la dernière choisie, sinon la 2D.
function lireVue() {
  let choix = vueDemandee;
  try {
    choix ??= localStorage.getItem('vue');
  } catch {
    // Préférence non mémorisée : vue 2D
  }
  return choix === '3d' ? '3d' : '2d';
}

// Vue en relief (three.js, chargé seulement dans cette vue). Sans WebGL, on reste en 2D.
async function creerRendu3D(idDecor) {
  try {
    const { Rendu3D } = await import('./rendu3d.js');
    return await Rendu3D.creer($('carte'), ville, trafic, D, idDecor);
  } catch (erreur) {
    signalerErreur(erreur);
    afficherMessage('La vue 3D n\'est pas disponible sur ce PC : retour à la vue 2D.', 'info');
    setTimeout(cacherMessage, 5000);
    return null;
  }
}

// Comme pour le décor, on recharge la page sur l'autre vue.
function brancherVue(actuelle) {
  const bouton = $('b-vue');
  bouton.textContent = actuelle === '3d' ? '🗺 Vue 2D' : '🧊 Vue 3D';
  bouton.title = actuelle === '3d' ? 'Revenir à la vue de dessus (2D)' : 'Voir la ville en relief (3D)';
  bouton.addEventListener('click', () => {
    try {
      localStorage.setItem('vue', actuelle === '3d' ? '2d' : '3d');
    } catch {
      // Préférence non mémorisée : le changement vaut pour cette fois
    }
    afficherMessage('Changement de vue…', 'info');
    location.reload();
  });
}

// ---------- Démarrage ----------

async function demarrer() {
  try {
    config = await api('/api/config');
  } catch {
    afficherMessage('Impossible de joindre PC City. Lancez-le avec lancer.bat.');
    return;
  }
  const decor = lireDecor();
  D = await chargerDecor(decor);
  brancherMenuDecor(decor);
  document.body.dataset.decor = decor;
  periodeMs = config.frequence_collecte_s * 1000;
  ville = new D.Ville(config.quartiers);
  trafic = D.creerTrafic(ville, config, bouchonForce);
  // Diagnostic : avec ?debug dans l'adresse, l'état de la ville est consultable depuis la console.
  if (modeDebug) window.pcCity = { ville, trafic, get rendu() { return rendu; } };
  if (bouchonForce) $('direct').textContent = 'Aperçu bouchon';
  // Un décor déjà en relief reste en 2D, sans changer la vue mémorisée pour les autres décors.
  const sans3d = DECORS.find(d => d.id === decor)?.vue3d === false;
  $('b-vue').hidden = sans3d;
  const vue = sans3d ? '2d' : lireVue();
  rendu = vue === '3d' ? await creerRendu3D(decor) : null;
  const en3d = !!rendu;
  rendu ??= new D.Rendu($('carte'), ville, trafic);
  brancherVue(en3d ? '3d' : '2d');
  document.body.dataset.vue = en3d ? '3d' : '2d';
  if (modeDebug) window.pcCity.vue = en3d ? '3d' : '2d';
  appliquerDiscret(lireDiscret());
  $('theme').value = simulation ? 'heure' : lireChoixTheme();
  $('theme').addEventListener('change', () => { enregistrerChoixTheme($('theme').value); majTheme(); });
  themeSysteme.addEventListener('change', majTheme);
  majTheme();
  construireLegende();
  await actualiser(true);
  rendu.recentrer();
  if (en3d && camera3d) rendu.regler(camera3d);
  if (en3d) {
    afficherMessage('Vue 3D : clic droit et glisser pour tourner autour de la ville.', 'info');
    setTimeout(cacherMessage, 5000);
  }

  brancherNavigation($('carte'));
  brancherRecherche();
  $('b-pause').addEventListener('click', basculerPause);
  $('b-discret').addEventListener('click', () => appliquerDiscret(!discret));
  $('b-actualiser').addEventListener('click', actualiserApplication);
  $('b-recentrer').addEventListener('click', () => { trafic.suivi = null; rendu.recentrer(); });
  $('b-fermer').addEventListener('click', () => afficherDetail(null));

  // Le cycle jour/nuit avance par petites touches : chaque minute change un peu les couleurs.
  setInterval(majTheme, 15000);
  // Relevé en direct ; en pause, un simple signe de vie évite que le serveur s'arrête.
  setInterval(() => (enPause ? api('/api/ping').catch(() => {}) : actualiser()), periodeMs);
}

demarrer();
