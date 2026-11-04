# PC City

L'activité de votre PC, dessinée comme une ville vue de dessus, dans l'esprit du jeu *Mini Motorways*.
Tout se passe sur votre PC : aucune donnée n'est envoyée sur Internet.

## Démarrer

Double-cliquez sur **`lancer.bat`**. La ville s'ouvre dans une fenêtre dédiée.

La toute première fois, `lancer.bat` lance l'installation (`installer.bat`). Elle a besoin d'Internet une seule fois pour télécharger Python portable et psutil dans `vendor\`. Ensuite, PC City fonctionne hors ligne.

**Arrêter :** fermez la fenêtre. Le serveur s'arrête tout seul.

## Lire la ville

| Dans la ville | Sur le PC |
|---|---|
| Grand bâtiment | Une application. Sa taille dépend de la mémoire qu'elle occupe. |
| Petites maisons autour | Les processus de cette application. |
| Pastilles blanches sur le toit | L'activité du processeur : plus il y en a d'allumées, plus l'application travaille. |
| Épingle rouge | Application qui sature le processeur ou la mémoire. |
| Couleurs pâles et petits « z » | Application ouverte mais inactive depuis 5 minutes (en veille). |
| Bâtiment gris « FERMÉ » | Programme fermé. Il garde sa place, même après un redémarrage de PC City, et disparaît après 30 jours sans utilisation. |
| Véhicules bleus | Lecture sur le disque : de l'entrepôt vers l'application. |
| Véhicules orange | Écriture sur le disque : de l'application vers l'entrepôt. |
| Véhicules verts | Échanges avec Internet (débit estimé). Voiture, camionnette ou camion selon le volume. |
| File de véhicules, feux stop, halo rouge | Embouteillage : le disque ou la connexion réseau est saturé. |
| Ruban saumon numéroté (A1, A2…) au-dessus de la ville | Autoroute : une application échange beaucoup de données (plus de 1 Mo/s pendant 6 s) avec un disque ou Internet. Elle disparaît quand le flux retombe. |
| Ronds-points et feux tricolores | Les véhicules font le tour des ronds-points. Les feux ne s'allument que quand des véhicules arrivent par les deux rues d'un carrefour. Un véhicule retardé accélère pour rester fidèle au direct. Les véhicules ne se superposent jamais : ils font la queue. |
| Tour centrale | Le processeur (chiffre au centre et anneau orange extérieur) et la mémoire (anneau bleu intérieur, pourcentage écrit en dessous). |
| Entrepôts du port | Les disques, remplis selon l'espace utilisé. |
| Aéroport | Internet. |
| Couleur du quartier | Le type d'application (navigateurs, communication, bureautique…). |

Un clic sur une application montre son icône, ses mesures et les **sites qu'elle contacte**. Les noms des sites viennent du cache DNS de Windows (PC City ne fait aucune requête) : une adresse sans nom n'y figurait pas. Il y en a peu au lancement, puis de plus en plus pendant la session.

La ville suit le thème clair ou sombre de Windows. Le menu en haut à droite permet aussi de choisir « Clair », « Sombre » ou « Selon l'heure » : un cycle jour/nuit progressif, avec aube, lever du soleil, plein jour de 9 h 30 à 17 h 30, coucher du soleil et crépuscule.

## Commandes

| Action | Commande |
|---|---|
| Se déplacer | Clic gauche et glisser |
| Zoomer | Molette |
| Vue d'ensemble | Touche `Espace` ou bouton « Recentrer » |
| Détail d'un élément | Clic dessus |
| Trouver un programme | Taper son nom dans la recherche, puis `Entrée` |
| Suivre un véhicule | Clic dessus (glisser la carte ou `Échap` pour arrêter) |
| Figer la ville | Bouton « Pause » (la ville se met à jour toute seule toutes les 2 s) |
| Masquer les noms des programmes et des sites (partage d'écran) | Bouton « Discret » ou touche `D` (le choix est mémorisé) |
| Voir à quoi ressemble un embouteillage | Touche `B`, plusieurs fois : disque saturé, réseau saturé, les deux, puis retour à la normale |
| Voir à quoi ressemblent les autoroutes | Touche `A` (une seconde fois pour arrêter) |
| Prendre en compte une mise à jour de PC City ou de `config.json` | Bouton « ↻ Actualiser » (sans fermer la fenêtre) |

## Personnaliser

Tout se règle dans **`config.json`** :

- `quartiers` : les quartiers, leur couleur et les programmes qu'ils contiennent (nom de l'exécutable en minuscules, par exemple `"spotify.exe"`) ;
- `noms` : le nom affiché pour un exécutable ;
- `seuils_alerte` : à partir de quand une épingle rouge apparaît ;
- `autoroutes` : débit (en Ko/s) et durée à partir desquels une autoroute s'ouvre ;
- `embouteillages` : à partir de quelle occupation (en %) du disque ou de la carte réseau la circulation ralentit (`debut`), puis se bloque (`plein`) ;
- `delai_veille_s`, `duree_min_fermee_s`, `demolition_jours` : délais du passage en veille, du bâtiment fermé et de son effacement ;
- `port` : le port local (8765 par défaut ; si occupé, le suivant libre est pris).

Un programme inconnu va dans le quartier Divers, ou dans la Zone système s'il fait partie de Windows.

## Confidentialité

- PC City lit l'activité de votre PC sans rien modifier, et sans droits administrateur.
- Il n'envoie rien sur Internet. Le serveur n'est joignable que depuis ce PC, et seulement par la fenêtre ouverte par `lancer.bat` (jeton secret changé à chaque lancement).
- Il ne lit jamais le contenu de vos fichiers, de vos échanges réseau, les titres de vos fenêtres ni les lignes de commande.
- Les noms des sites contactés sont gardés en mémoire seulement, jamais écrits sur le disque. En partage d'écran, activez le mode discret.
- Le dossier **`donnees\`** contient le profil de la fenêtre dédiée et `programmes_vus.json` (nom, quartier et date de dernière utilisation de chaque application, effacée après 30 jours). **Ne le partagez pas** et ne placez pas PC City dans un dossier synchronisé (OneDrive…).

## Désinstaller

Supprimez le dossier `pc-city`. Rien n'est installé ailleurs sur le PC.

## En cas de problème

- La fenêtre affiche « PC City ne répond plus » : fermez-la et relancez `lancer.bat`.
- Les erreurs techniques sont notées dans `donnees\erreurs.log`, y compris celles de la fenêtre de la ville : en cas de blocage, ce fichier aide à comprendre ce qui s'est passé.
- La ville semble figée après « ↻ Actualiser » : fermez la fenêtre et relancez `lancer.bat`.
