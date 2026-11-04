// Décor « Ville isométrique » : boulevard, quartiers en pâtés de maisons, immeubles en volume dont la
// hauteur suit la RAM ; tour du processeur, antenne Internet, data centers.

export { Ville, nomVisible } from './modele.js';
export { Rendu, PALETTES, paletteDuMoment, momentDeLaJournee } from './rendu2d.js';
export { COULEURS_FLUX, GABARITS, cleCible } from './trafic.js';
import { Trafic } from './trafic.js';

export const nom = 'Ville isométrique';

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
    ligne('🛣', 'Boulevard au centre : relie les quartiers à l\'antenne (ouest) et aux data centers (est)'),
  ];
}

export function legendeReperes({ ligne }) {
  return [
    ligne('🏙', 'Un immeuble par application : hauteur selon la RAM, fenêtres allumées selon le CPU'),
    ligne('🏚', 'Bloc bas et gris : programme fermé (il se reconstruit s\'il est relancé)'),
    ligne('🗼', 'Tour du processeur : étages éclairés jusqu\'au niveau de la RAM, couronne orange = CPU'),
    ligne('🏢', 'Data centers : les disques (jauge de remplissage sur le toit)'),
    ligne('📡', 'Antenne : Internet'),
  ];
}

export function touche() {
  return false;
}
