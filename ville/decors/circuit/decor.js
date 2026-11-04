// Décor « Circuit imprimé » : puce du processeur au centre de la carte mère, zones sérigraphiées
// (quartiers), composants (applications), barrettes (disques), port RJ45 (Internet), impulsions (flux).

export { Ville, nomVisible } from './modele.js';
export { Rendu, PALETTES, paletteDuMoment, momentDeLaJournee } from './rendu2d.js';
export { COULEURS_FLUX, GABARITS, cleCible } from './trafic.js';
import { Trafic } from './trafic.js';

export const nom = 'Circuit imprimé';

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
    ligne('〰', 'Pistes de cuivre : chaque zone a son bus, qui rejoint le port Internet (en haut) et les barrettes des disques (en bas)'),
    ligne('✦', 'Impulsions lumineuses : plus le débit est fort, plus elles sont longues'),
    ligne('🔥', 'Piste rouge près d\'une barrette ou du port : embouteillage, les impulsions s\'accumulent'),
  ];
}

export function legendeReperes({ ligne }) {
  return [
    ligne('🔲', 'Puce centrale : le processeur (chiffre au centre) ; cadre bleu autour : la mémoire'),
    ligne('▭', 'Zone sérigraphiée : un quartier'),
    ligne('⬛', 'Un composant par application : taille selon la RAM, LED allumée selon le processeur'),
    ligne('▫', 'Petites résistances à côté : ses processus'),
    ligne('🔴', 'LED rouge qui clignote : application qui sature le CPU ou la RAM'),
    ligne('◌', 'Empreinte vide en pointillés : programme fermé (le composant revient s\'il est relancé)'),
    ligne('💾', 'Barrettes en bas : les disques (jauge de remplissage)'),
    ligne('🔌', 'Port RJ45 en haut : Internet (ses LED clignotent avec le réseau)'),
  ];
}

export function touche() {
  return false;
}
