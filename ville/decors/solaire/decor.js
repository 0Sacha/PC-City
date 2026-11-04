// Décor « Système solaire » : Soleil (processeur), planètes (quartiers), lunes (applications),
// stations spatiales (disques), trou de ver (Internet), vaisseaux (flux).

export { Ville, nomVisible } from './modele.js';
export { Rendu, PALETTES, paletteDuMoment, momentDeLaJournee } from './rendu2d.js';
export { COULEURS_FLUX, GABARITS, cleCible } from './trafic.js';
import { Trafic } from './trafic.js';

export const nom = 'Système solaire';

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
    ligne('🚀', 'Vaisseaux : navette, cargo ou vaisseau-cargo selon le débit ; ils suivent les lunes qui tournent'),
  ];
}

export function legendeReperes({ ligne }) {
  return [
    ligne('☀', 'Soleil : le processeur (il grossit et s\'embrase avec le CPU) ; anneau bleu autour : la RAM'),
    ligne('🪐', 'Une planète par quartier ; les gros quartiers ont un anneau'),
    ligne('🌕', 'Une lune par application : taille selon la RAM, lueur selon le CPU'),
    ligne('🛰', 'Stations spatiales : les disques (jauge de remplissage)'),
    ligne('🌀', 'Trou de ver : Internet'),
  ];
}

export function touche() {
  return false;
}
