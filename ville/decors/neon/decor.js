// Décor « Ville néon » : plan circulaire autour du cœur du processeur, traînées de lumière.

export { Ville, nomVisible } from './modele.js';
export { Rendu, PALETTES, paletteDuMoment, momentDeLaJournee } from './rendu2d.js';
export { COULEURS_FLUX, GABARITS, cleCible } from './trafic.js';
import { Trafic } from './trafic.js';

export const nom = 'Ville néon';

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
    ligne('〰', 'Traînées de lumière : plus épaisses et plus longues quand le débit est fort'),
    ligne('✦', 'Impulsions vers le cœur : le processeur utilisé par chaque application'),
    ligne('⭕', 'Périphérique : relie toutes les avenues aux coffres et au portail'),
  ];
}

export function legendeReperes({ ligne }) {
  return [
    ligne('◉', 'Cœur au centre : CPU (anneau orange) et RAM (anneau cyan)'),
    ligne('▦', 'Un secteur par quartier, ses applications le long de son avenue'),
    ligne('▣', 'Coffres de données : les disques (jauge de remplissage)'),
    ligne('◎', 'Portail : Internet'),
  ];
}

export function touche() {
  return false;
}
