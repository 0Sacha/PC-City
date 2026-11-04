// Décor « Fourmilière », vue en coupe : reine (processeur), ailes de chambres (quartiers), chambres
// (applications), réserves (disques), entrée sur le monticule (Internet), fourmis porteuses (flux).

export { Ville, nomVisible } from './modele.js';
export { Rendu, PALETTES, paletteDuMoment, momentDeLaJournee } from './rendu2d.js';
export { COULEURS_FLUX, GABARITS, cleCible } from './trafic.js';
import { Trafic } from './trafic.js';

export const nom = 'Fourmilière';

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
    ligne('🐜', 'Fourmis porteuses : ouvrière, soldat ou porteuse de feuille selon le débit ; la charge a la couleur du flux'),
    ligne('🕳', 'Galeries : du puits central vers les réserves (en bas) ou vers l\'entrée (en haut)'),
  ];
}

export function legendeReperes({ ligne }) {
  return [
    ligne('👑', 'Reine au centre : le processeur (elle pond plus quand il travaille) ; anneau bleu : la RAM'),
    ligne('🏘', 'Une aile de chambres par quartier'),
    ligne('🥚', 'Une chambre par application : taille selon la RAM, fourmis au travail selon le CPU'),
    ligne('⚬', 'Alvéoles autour d\'une chambre : ses processus'),
    ligne('🪨', 'Chambre grise et éboulée : programme fermé (elle se rouvre s\'il est relancé)'),
    ligne('🌾', 'Réserves de graines en bas : les disques (hauteur du tas = remplissage)'),
    ligne('⛰', 'Entrée sur le monticule : Internet'),
  ];
}

export function touche() {
  return false;
}
