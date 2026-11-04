# Versions sauvegardées

| Archive | Date | Contenu |
|---|---|---|
| `PC-City-V1.zip` | 22/10/2026 | V1 : ville 2D, mise à jour manuelle, boutique fermée pendant la session (délai 10 s). |
| `PC-City-V2.zip` | 22/10/2026 | V2 validée : ville en direct, véhicules (disque et réseau), suivi d'un véhicule, pause qui fige la ville (circulation recréée à la reprise), thème clair/sombre suivant Windows et cycle jour/nuit progressif, bouton « Actualiser » (redémarrage à chaud), veille, bâtiments fermés gardés d'un lancement à l'autre, décor (parcs, étangs, côte, bateaux), icône. Pas encore : embouteillages, noms des sites, mode discret. |
| `PC-City-V2-complete.zip` | 23/10/2026 | V2 complète (avant la V3) : tout ce qui précède, plus embouteillages (touche B), noms des sites (cache DNS, adresses sans nom regroupées), mode discret (touche D), icônes réelles, autoroutes 2 × 2 voies (échangeur en trèfle au départ, arrivée par une zone de péage prolongée d'une route à 4 voies jusqu'au disque ou au terminal, touche A), ronds-points, feux intelligents, véhicules qui ne se superposent pas et rattrapent leur retard, tour CPU/RAM à deux anneaux, décor en cache (moins de charge pour le PC), erreurs de la page notées dans `erreurs.log`. Checklist finale pas encore entièrement validée. |
| `PC-City-archipel.zip` | 23/10/2026 | Essai « archipel » (îles autour du hall central et de l'Étoile, centrale électrique et voitures de course), sans menu de décor. Jugé pas assez beau ; repris ensuite comme décor « Archipel (essai) ». |
| `PC-City-decors-etape1.zip` | 23/10/2026 | Menu « Décor » : décor Ville (la V2 complète) et décor Archipel (essai) ; les autres décors sont annoncés « bientôt ». Côté serveur : historique (V3) et estimation de la consommation électrique. |
| `PC-City-3d-phase1-ville.zip` | 26/10/2026 | Vue 3D (bouton « Vue 3D / Vue 2D ») : moteur commun `ville\rendu3d.js` (three.js 0.170 stocké dans `ville\lib\`), sol tiré du décor 2D, caméra qui tourne au clic droit. Décor Ville en relief complet (`decors\ville\formes3d.js`) ; les autres décors en volumes simples. |
| `PC-City-decors-etape5-circuit-medieval-fourmiliere.zip` | 26/10/2026 | Trois nouveaux décors : Circuit imprimé (puce centrale, composants, impulsions sur les pistes de cuivre), Village médiéval (château, maisons à colombages, charrettes, port et greniers) et Fourmilière (vue en coupe, reine, chambres, fourmis porteuses). |

Les archives ne contiennent ni `vendor\` (Python portable, recréé par `installer.bat`) ni `donnees\` (données personnelles).

## Revenir à une version

1. Fermez PC City.
2. Décompressez l'archive dans le dossier `pc-city`, en remplaçant les fichiers existants.
3. Relancez `lancer.bat`.

`vendor\` et `donnees\` ne sont pas touchés.

Les fichiers ajoutés par une version plus récente (par exemple `ville\trafic.js` en revenant à la V1) peuvent rester : ils ne sont alors plus utilisés.
