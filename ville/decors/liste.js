// Décors disponibles dans le menu « Décor ». Chacun a son dossier et son propre placement de la ville.
// « pret: false » : prévu, affiché grisé dans le menu.
// « vue3d: false » : décor déjà en relief, toujours affiché en 2D (le bouton « Vue 3D » est masqué).

export const DECORS = [
  { id: 'ville', nom: '🏙 Ville', pret: true },
  { id: 'neon', nom: '🌃 Ville néon', pret: true },
  { id: 'solaire', nom: '🪐 Système solaire', pret: true },
  { id: 'aquarium', nom: '🐠 Aquarium', pret: true },
  { id: 'iso', nom: '🧊 Ville isométrique', pret: true, vue3d: false },
  { id: 'circuit', nom: '🔌 Circuit imprimé', pret: true },
  { id: 'medieval', nom: '🏰 Village médiéval', pret: true },
  { id: 'fourmiliere', nom: '🐜 Fourmilière', pret: true },
  { id: 'archipel', nom: '🏝 Archipel (essai)', pret: true },
];

export const DECOR_DEFAUT = 'ville';
