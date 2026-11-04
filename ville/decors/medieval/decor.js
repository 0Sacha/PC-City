// Décor « Village médiéval » : château (processeur et mémoire), quartiers du bourg dans leur enceinte,
// maisons à colombages (applications), greniers à blé (disques), port sur la rivière (Internet), charrettes (flux).

export { Ville, nomVisible } from './modele.js';
export { Rendu, PALETTES, paletteDuMoment, momentDeLaJournee } from './rendu2d.js';
export { COULEURS_FLUX, GABARITS, cleCible } from './trafic.js';
import { Trafic } from './trafic.js';

export const nom = 'Village médiéval';

export function creerTrafic(ville, config, forcer) {
  return new Trafic(ville, config.embouteillages, forcer);
}

export function detailVehicule() {
  return [];
}

export function detailApp() {
  return [];
}

export function detail() {
  return null;
}

export function legendeCirculation({ ligne }) {
  return [
    ligne('🛒', 'Brouette, charrette ou chariot à bœufs selon le débit ; la bâche porte la couleur du flux'),
    ligne('🚪', 'Les charrettes sortent par la porte nord vers le port, par la porte sud vers les greniers'),
  ];
}

export function legendeReperes({ ligne }) {
  return [
    ligne('🏰', 'Château : le processeur (chiffre du donjon, anneau orange, bannière qui flotte plus vite quand il travaille) ; la courtine se colore en bleu avec la mémoire'),
    ligne('🏠', 'Maison à colombages : une application (taille selon la RAM), toit à la couleur du quartier'),
    ligne('🛖', 'Chaumières autour : ses processus'),
    ligne('💨', 'Fumée de cheminée : activité du processeur'),
    ligne('🔥', 'Torche rouge : application qui sature le CPU ou la RAM'),
    ligne('🪟', 'Volets à moitié et « z » : en veille ; volets clos, toit gris et porte barrée : programme fermé'),
    ligne('🌾', 'Greniers à blé : les disques (le tas de grain monte avec l\'espace utilisé)'),
    ligne('⛵', 'Port sur la rivière : Internet (plus de voiliers quand le réseau travaille)'),
    ligne('🎪', 'Place du marché : case libre de la ville'),
  ];
}

export function touche() {
  return false;
}
