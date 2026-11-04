// Décor « Archipel » (essai) : une île par catégorie autour du hall central et de l'Étoile, centrale électrique.

export { Ville, nomVisible } from './modele.js';
export { Rendu, PALETTES, paletteDuMoment, momentDeLaJournee } from './rendu2d.js';
export { COULEURS_FLUX, GABARITS, cleCible } from './trafic.js';
import { Trafic } from './trafic.js';

export const nom = 'Archipel (essai)';

export function creerTrafic(ville, config, forcer) {
  return new Trafic(ville, config.embouteillages, forcer);
}

export function detailVehicule() {
  return [];
}

export function detailApp() {
  return [];
}

export function detail(sel, { el, mesures, nombre, trafic, etat, config }) {
  const s = etat.systeme;
  if (sel.type === 'hall') {
    const surAnneau = trafic.vehicules.filter(v => v.surAnneau).length;
    return [
      el('h2', { classe: 'd-titre' }, el('span', { classe: 'd-pastille', fond: '#4C5DA8' }), 'Hall central'),
      el('p', { classe: 'd-sous-titre' }, 'L\'Étoile : tout le trafic de la ville y passe'),
      mesures([['Processeur', `${nombre(s.cpu)} %`], ['Mémoire', `${nombre(100 * s.ram_utilisee / s.ram_totale)} %`],
        ['Véhicules sur l\'anneau', nombre(surAnneau)], ['Véhicules en route', nombre(trafic.vehicules.length)]]),
      el('p', { classe: 'd-note' }, 'Comme place de l\'Étoile : chaque île arrive par son pont, et ceux qui entrent sur l\'anneau ont la priorité. L\'anneau limite le nombre de véhicules, pour ne jamais se bloquer lui-même.'),
    ];
  }
  if (sel.type === 'centrale') {
    return [
      el('h2', { classe: 'd-titre' }, el('span', { classe: 'd-pastille', fond: '#F2C230' }), 'Centrale électrique'),
      el('p', { classe: 'd-sous-titre' }, 'L\'électricité qui alimente l\'ordinateur'),
      mesures([['Consommation (estimée)', `≈ ${nombre(s.watts_estimes ?? 0)} W`],
        ['Au repos', `${nombre(config.electricite?.repos_w ?? 9)} W`], ['Au maximum', `${nombre(config.electricite?.max_w ?? 60)} W`]]),
      el('p', { classe: 'd-note' }, 'Estimation : ce PC n\'a pas de capteur de consommation lisible. Elle part de la consommation au repos et monte avec l\'activité du processeur (réglages dans config.json, écrans non compris). Les voitures de course de la piste vers la tour centrale sont plus nombreuses et plus rapides quand elle augmente.'),
    ];
  }
  return null;
}

export function legendeCirculation({ el, ligne }) {
  return [
    ligne(el('span', { classe: 'l-autoroute' }, '2×2'), 'Ponts 2 × 2 voies : chaque île vers l\'Étoile ; on roule à droite, on double à gauche'),
    ligne('⭕', 'L\'Étoile, autour du hall central : priorité à ceux qui entrent sur l\'anneau'),
  ];
}

export function legendeReperes({ ligne }) {
  return [
    ligne('◉', 'Hall central : tour CPU (anneau orange) et RAM (anneau bleu), au milieu de l\'Étoile'),
    ligne('🏝', 'Une île par catégorie d\'applications'),
    ligne('🏭', 'Île du port : un entrepôt par disque'),
    ligne('✈', 'Île de l\'aéroport : Internet'),
    ligne('⚡', 'Centrale et voitures de course : l\'électricité (estimée) qui va à la tour centrale'),
  ];
}

export function touche() {
  return false;
}
