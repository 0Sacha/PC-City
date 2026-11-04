// Décor « Ville » : ville en grille, ronds-points, autoroutes 2 × 2 voies avec péage (V2 complète).

export { Ville, nomVisible } from './modele.js';
export { Rendu, PALETTES, paletteDuMoment, momentDeLaJournee } from './rendu2d.js';
export { COULEURS_FLUX, GABARITS, cleCible } from './trafic.js';
import { Trafic } from './trafic.js';

export const nom = 'Ville';

export function creerTrafic(ville, config, forcer) {
  return new Trafic(ville, config.embouteillages, config.autoroutes, forcer);
}

// Lignes ajoutées au panneau d'un véhicule.
export function detailVehicule(v, { el }) {
  return [v.autoroute ? el('p', { classe: 'd-autoroute' }, `Sur l'autoroute A${v.autoroute.numero ?? ''} : gros flux soutenu.`) : null];
}

// Lignes ajoutées au panneau d'une application.
export function detailApp(app, { el, trafic, debit }) {
  return [...trafic.autoroutes.values()]
    .filter(a => a.active && a.app === app)
    .map(a => el('p', { classe: 'd-autoroute' }, `Autoroute A${a.numero} vers ${a.cible.type === 'aeroport'
      ? 'l\'aéroport' : `le disque ${a.cible.entrepot.disque.nom}`} : ${debit(a.debit)}`));
}

// Panneau d'un élément propre à ce décor (aucun ici).
export function detail() {
  return null;
}

export function legendeCirculation({ el, ligne, nombre, config }) {
  return [
    ligne(el('span', { classe: 'l-autoroute' }, 'A1'), `Autoroute 2 × 2 voies : gros flux soutenu (plus de ${nombre(config.autoroutes.seuil_ko_s / 1024, 1)} Mo/s pendant ${nombre(config.autoroutes.duree_s)} s)`),
    ligne('⭕', 'Ronds-points aux grands carrefours : priorité à ceux qui sont sur l\'anneau'),
  ];
}

export function legendeReperes({ ligne }) {
  return [
    ligne('◉', 'Tour centrale : CPU (chiffre et anneau orange extérieur), RAM (anneau bleu intérieur)'),
    ligne('🏭', 'Entrepôts du port : les disques'),
    ligne('✈', 'Aéroport : Internet'),
  ];
}

// Touche A : aperçu des autoroutes, ouvertes pour les trois flux les plus forts du moment.
export function touche(code, { trafic, afficherMessage, cacherMessage }) {
  if (code !== 'KeyA') return false;
  trafic.forcerAutoroutes = !trafic.forcerAutoroutes;
  afficherMessage(trafic.forcerAutoroutes
    ? 'Aperçu des autoroutes : elles s\'ouvrent au prochain relevé (touche A pour arrêter)'
    : 'Aperçu des autoroutes arrêté : seuls les gros flux réels gardent la leur', 'info');
  setTimeout(cacherMessage, 3000);
  return true;
}
