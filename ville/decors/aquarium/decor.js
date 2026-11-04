// Décor « Aquarium », vu de côté : niveau de l'eau = RAM, bulleur = processeur, récifs = quartiers,
// poissons = applications, coffres au trésor = disques, filtre = Internet, perles et bulles = flux.

export { Ville, nomVisible } from './modele.js';
export { Rendu, PALETTES, paletteDuMoment, momentDeLaJournee } from './rendu2d.js';
export { COULEURS_FLUX, GABARITS, cleCible } from './trafic.js';
import { Trafic } from './trafic.js';

export const nom = 'Aquarium';

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
    ligne('⚪', 'Perles : lecture (bleue) et écriture (dorée) entre le poisson et son coffre'),
    ligne('🫧', 'Bulles : échanges réseau entre le poisson et le filtre'),
  ];
}

export function legendeReperes({ ligne }) {
  return [
    ligne('🌊', 'Niveau de l\'eau : la RAM utilisée (graduation sur la vitre de droite)'),
    ligne('🫧', 'Bulleur au fond : le processeur (plus il travaille, plus il fait de bulles)'),
    ligne('🪸', 'Un récif par quartier'),
    ligne('🐟', 'Un poisson par application : taille selon la RAM, il nage plus vite quand il calcule ; endormi en veille'),
    ligne('💀', 'Poisson gris ventre en l\'air à la surface : programme fermé (il revient à la vie s\'il est relancé)'),
    ligne('🧰', 'Coffres au trésor : les disques (pièces d\'or = remplissage)'),
    ligne('⛲', 'Filtre en haut à gauche : Internet'),
  ];
}

export function touche() {
  return false;
}
