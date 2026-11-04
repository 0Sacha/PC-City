# Cahier des charges : PC City

**Version :** 0.4

**État au 23/10/2026 :** V1 réalisée (`releases\PC-City-V1.zip`). V2 validée (`releases\PC-City-V2.zip`) : F7, F8, F9, F10, F13, F26 réalisées. Complément V2 réalisé, en attente de validation : F11 (embouteillages), F21 (noms des sites), F22 (mode discret), F23 (icônes réelles).

**Changements du 23/10/2026 :** le cache DNS est lu avec `ipconfig /displaydns` (les fonctions d'interrogation du cache par nom n'en voient qu'une partie sous Windows 11), toutes les 10 s, et les noms déjà vus sont retenus en mémoire pendant la session ; seuils d'embouteillage dans `config.json` (§6.2) ; applications du Microsoft Store : logo lu dans leur manifeste.

**Changements depuis la v0.3 :** données en direct par relevé HTTP toutes les 2 s (plus simple qu'un flux SSE, et sert aussi de signe de vie) ; mémoire des bâtiments `programmes_vus.json` et emplacements attribués par le serveur ; règles de circulation (§6.1) ; décor moins géométrique (côte arrondie, parcs, étangs, bateaux) ; icône de fenêtre.
**Date :** 23/10/2026
**Demandeur :** slaville

**Changements de la v0.3 :** la V1 est en 2D, vue de dessus, dans l'esprit du jeu *Mini Motorways* (§5.1). Rendu Canvas 2D sans bibliothèque, Three.js n'est plus nécessaire en V1. Séparation entre le modèle de la ville et son rendu (§9.1). Question Q10 sur la suite (2D ou 3D).

**Changements de la v0.2 par rapport à la v0.1 :** vérification du « 100 % local » (DNS, sécurité du serveur local, installation hors ligne), nouvelle section sur les données sensibles (§8), architecture simplifiée (une seule dépendance Python), promesses irréalistes corrigées (trafic par disque, concordance avec le Gestionnaire des tâches), ajout de l'arrêt de l'application et de la gestion du port.

---

## 1. Contexte et objectif

L'activité d'un ordinateur (programmes, mémoire, disque, réseau) est invisible ou cachée dans des outils austères comme le Gestionnaire des tâches.

**PC City** la rend visible et compréhensible : une ville vivante, vue de dessus, dans laquelle :

- chaque programme est un immeuble ;
- le processeur et la mémoire forment la tour centrale ;
- les données qui circulent sont des voitures.

L'objectif est de comprendre d'un coup d'œil ce qui se passe sur le PC, de repérer ce qui consomme ou ce qui communique, et que ce soit agréable à regarder.

---

## 2. Principes fondamentaux

| # | Principe | Détail |
|---|---|---|
| P1 | **100 % local** | Aucune donnée ne quitte le PC. Pas de compte, pas de service en ligne, pas de télémétrie, **aucune requête réseau émise par PC City** (pas même une requête DNS). |
| P2 | **Hors ligne** | Une connexion Internet n'est nécessaire qu'une seule fois, pour préparer le dossier (voir §9.3). Ensuite, tout fonctionne hors ligne : bibliothèques Python et JavaScript stockées dans le dossier du projet, aucune police ni script chargé depuis Internet. |
| P3 | **Lecture seule** | L'application observe sans rien modifier : elle ne ferme aucun programme et ne touche à aucun fichier en dehors de son propre dossier. |
| P4 | **Léger** | L'outil ne doit pas ralentir le PC qu'il observe. |
| P5 | **Simple à lancer** | Un double-clic sur `lancer.bat` démarre tout ; fermer la fenêtre arrête tout. |
| P6 | **Minimisation des données** | Ne collecter que ce qui sert à dessiner la ville, ne conserver que le strict nécessaire (voir §8). |

---

## 3. Périmètre

### Inclus
- Visualisation 2D (vue de dessus) de l'activité du PC Windows sur lequel tourne l'outil.
- Données en temps réel : programmes, CPU, RAM, disque, connexions réseau.
- Interaction : naviguer, cliquer, consulter des détails.
- Historique et rejeu de la journée (V3).

### Exclus
- Surveillance d'autres PC ou d'un réseau d'entreprise.
- Antivirus, détection de menaces ou blocage.
- Version mobile.
- Partage ou export en ligne.
- Lecture du contenu des fichiers, des échanges réseau, des fenêtres ou du clavier.

---

## 4. La métaphore : correspondances ville ↔ PC

| Dans la ville | Sur le PC | Règle visuelle |
|---|---|---|
| 🗼 Tour centrale | CPU + RAM | La luminosité et la pulsation suivent la charge CPU. Deux anneaux de remplissage : CPU à l'extérieur (orange, avec le grand chiffre), RAM à l'intérieur (bleu, avec son pourcentage écrit) ; rouges quand ils saturent. (23/10/2026 : un seul anneau de RAM autour du chiffre du CPU prêtait à confusion.) |
| 🏢 Grand bâtiment | Une application, regroupée selon le §7.2 (les « destinations » de *Mini Motorways*) | Bloc arrondi posé sur une parcelle claire. Surface proportionnelle à la RAM. Pastilles sur le toit qui s'allument selon l'activité CPU. |
| 🏠 Petites maisons | Les processus de l'application (Chrome et ses 30 processus = 1 grand bâtiment + 30 maisons) | Petits blocs de la même couleur, groupés autour de leur grand bâtiment, comme les maisons de *Mini Motorways*. |
| 📍 Épingle d'alerte | Application qui sature le CPU ou la RAM | Épingle rouge au-dessus du bâtiment, avec un compteur et une jauge circulaire qui se remplit tant que la saturation dure. |
| 🛣️ Routes | Liaisons entre les éléments | Générées automatiquement : une artère par quartier vers la tour centrale, des routes vers les entrepôts et l'aéroport. Virages arrondis, ronds-points aux carrefours importants. |
| 🛤️ Autoroute numérotée | Gros flux soutenu (transfert réseau ou disque important) | Large ruban saumon semi-transparent, numéroté, qui passe au-dessus de la ville entre le bâtiment et l'aéroport ou l'entrepôt ; disparaît quand le flux retombe. |
| 🌊 Eau et ponts | Bordure de la carte, séparation entre zones | La ville est une presqu'île : l'aéroport et le port (entrepôts) sont au bord de l'eau, une rivière sépare la Zone système du reste, traversée par des ponts. Purement décoratif. |
| 🌳 Arbres | Espaces vides | Petits bosquets ronds pour habiller les zones libres. Purement décoratif. |
| 🏘️ Quartier | Catégorie d'applications | Couleur de sol propre à chaque quartier. |
| 🏭 Port / entrepôts | Disques (C:, D:…) | Un entrepôt par disque. Taille selon la capacité, remplissage selon l'espace utilisé. |
| ✈️ Aéroport (en bordure) | Internet | Point d'arrivée et de départ du trafic réseau. |
| 🚗🚐🚚 Véhicule | Échange de données | Taille selon le volume : voiture (petit), camionnette (moyen), camion (gros transfert). |
| 🎨 Couleur des véhicules | Type de flux | Bleu : disque en lecture. Orange : disque en écriture. Vert : réseau. |
| 🚦 Embouteillage | Saturation (disque occupé à plus de 90 %, réseau proche du débit maximal observé) | Véhicules ralentis, route qui passe au rouge. |
| 🌙 Jour / nuit | Heure réelle | La nuit, le fond s'assombrit, les bâtiments actifs et les phares ressortent. |
| 🔒 Bâtiment fermé, puis délabré | Application qui n'est plus utilisée | Voir le cycle de vie ci-dessous (§4.1). |

### Quartiers proposés

| Quartier | Exemples |
|---|---|
| Navigateurs | Chrome, Edge, Firefox |
| Communication | Teams, Outlook, Slack, Discord |
| Bureautique | Word, Excel, PowerPoint, PDF |
| Développement | VS Code, Python, Node, Git, terminaux |
| Multimédia et jeux | Spotify, VLC, Steam |
| Zone système | Services Windows, antivirus, pilotes |
| Divers | Tout ce qui n'est pas reconnu |

Le classement repose sur une liste d'applications connues, modifiable dans `config.json`.

### 4.1 Cycle de vie d'un bâtiment

Un bâtiment ne disparaît pas quand on ferme son programme : il « ferme boutique » et garde sa place. La ville se souvient ainsi de ce qui a été utilisé.

| État | Condition | Visuel | Version |
|---|---|---|---|
| 🏢 **Ouvert** | Le programme tourne et travaille | Couleurs vives, pastilles allumées, véhicules qui arrivent et partent | V1 |
| 💤 **En veille** | Lancé, mais aucune activité depuis 5 min (CPU proche de 0, ni disque ni réseau) | Couleurs conservées mais atténuées, pastilles éteintes, petit « z » au-dessus, aucun véhicule | V2 |
| 🔒 **Fermé** | Programme fermé | Bâtiment et maisons **gris**, rideau baissé, **panneau « FERMÉ »** (pictogramme hors ligne), allée d'accès grisée, aucun véhicule | V1 pendant la session, V2 d'un lancement à l'autre |
| 🏚️ **Délabré** | Fermé depuis 7 jours | Fissures, vitres cassées, herbe qui pousse sur la parcelle | V3 |
| 🧱 **Démoli** | Fermé depuis 30 jours | Terrain vague pendant un temps, puis l'emplacement est libéré | V3 |

- Un programme relancé **rouvre au même endroit** : le rideau se lève et la couleur revient.
- Les programmes qui ont tourné moins de 10 s (installateurs, outils ponctuels) ne laissent pas de bâtiment fermé (`duree_min_fermee_s` dans `config.json`).
- Les délais (5 min, 7 jours, 30 jours) sont réglables dans `config.json`.
- Le souvenir est stocké dans `donnees\programmes_vus.json` : nom de l'application, quartier, position dans la ville, date de dernière utilisation. Rien d'autre.

---

## 5. Interface

### 5.1 Style visuel : esprit *Mini Motorways*
- **2D, vue de dessus, minimaliste** : aplats de couleurs, pas de textures, formes simples aux coins arrondis.
- **Deux palettes, d'après les captures de référence** (valeurs à affiner) :

  | Élément | Jour | Nuit |
  |---|---|---|
  | Terre | crème `#F6E7CB` | bleu nuit `#262B36` |
  | Eau | turquoise `#8FDFCF` | bleu ardoise `#3D5873` |
  | Routes | blanc `#FFFFFF` | gris `#5B6170` |
  | Parcelles des bâtiments | blanc cassé | gris foncé |
  | Herbe et arbres | vert-jaune `#E3E39A` / vert `#8DBF6A` | vert sombre |
  | Autoroutes | saumon `#F4B39A` semi-transparent | identique |- **Une couleur franche par quartier**, reprise par ses immeubles et sa route principale ; les véhicules gardent les couleurs de flux (§4).
- **Routes** épaisses, grises, aux virages arrondis ; véhicules en petits rectangles arrondis qui suivent les routes.
- **Ombres portées légères** sous les bâtiments pour donner un peu de relief.
- **Animations douces** : apparition des bâtiments en « pop », pulsation des pastilles, déplacement fluide des véhicules.
- Lisible même avec plus de 100 immeubles.
- Polices du système uniquement (aucune police téléchargée).
- Inspiration de style uniquement : aucun élément graphique du jeu n'est repris, tout est dessiné par le code.

### 5.2 Caméra et navigation
| Action | Contrôle |
|---|---|
| Se déplacer | Clic gauche + glisser |
| Zoomer (vers le curseur) | Molette |
| Revenir à la vue d'ensemble | Touche `Espace` ou bouton « Recentrer » |
| Suivre une voiture | Clic sur la voiture (V2) |

### 5.3 Éléments d'interface
- **Barre du haut** : CPU %, RAM %, activité disque, activité réseau, heure, indicateur d'enregistrement (V3).
- **Panneau de détail** (à droite, au clic sur un élément) :
  - Immeuble : nom, icône du quartier, nombre de processus, RAM, CPU, lectures/écritures disque, connexions réseau actives.
  - Entrepôt : disque, capacité, espace libre, débit actuel.
  - Voiture : origine, destination, type de flux, volume estimé.
- **Légende** repliable en bas à gauche, qui explique les couleurs et les symboles.
- **Recherche** : taper le nom d'un programme pour centrer la caméra sur son immeuble.
- **Infobulle** au survol d'un immeuble, avec son nom et sa RAM.

---

## 6. Fonctionnalités par version

### V1 : la ville instantanée (prototype)
| ID | Fonctionnalité | Priorité |
|---|---|---|
| F1 | Collecte des programmes en cours, du CPU, de la RAM et des disques | Indispensable |
| F2 | Génération de la ville 2D : tour centrale, quartiers, immeubles, entrepôts, aéroport, routes | Indispensable |
| F3 | Navigation (se déplacer, zoomer) | Indispensable |
| F4 | Panneau de détail au clic | Indispensable |
| F5 | Rafraîchissement manuel (bouton « Mettre à jour ») | Indispensable |
| F6 | Légende | Souhaitable |
| F20 | Lancement et arrêt propres : fenêtre dédiée, pas de console visible, arrêt du serveur à la fermeture, port libre choisi automatiquement | Indispensable |

### V2 : la ville vivante
| ID | Fonctionnalité | Priorité |
|---|---|---|
| F7 | Mise à jour en temps réel (toutes les 1 à 2 secondes) | Indispensable |
| F8 | Immeubles qui grandissent ou rétrécissent en douceur, apparaissent quand on ouvre un programme | Indispensable |
| F26 | Cycle de vie des bâtiments, états Ouvert, En veille et Fermé (§4.1), mémorisé d'un lancement à l'autre dans `donnees\programmes_vus.json` | Indispensable |
| F9 | Voitures pour le trafic disque (immeuble ↔ entrepôt) | Indispensable |
| F10 | Voitures pour le trafic réseau (immeuble ↔ aéroport) | Indispensable |
| F11 | Embouteillages en cas de saturation | Souhaitable |
| F12 | Thème clair / sombre : suit par défaut le thème de Windows (et bascule s'il change) ; au choix « Clair », « Sombre » ou « Selon l'heure » : cycle fictif continu, couleurs interpolées minute par minute (nuit → aube 7 h–8 h 15 → lever du soleil → plein jour 9 h 30–17 h 30 → coucher du soleil → crépuscule 18 h 30–20 h → nuit), phares qui s'allument progressivement. Tout changement de thème se fait en fondu. Choix mémorisé ; aperçu possible avec `?simuler=HH:MM` dans l'adresse | Souhaitable |
| F27 | Bouton « Actualiser » : après une mise à jour de PC City, redémarre le serveur (code et `config.json` relus) sans fermer la fenêtre, même port, même jeton | Indispensable |
| F13 | Suivi d'une voiture par la caméra | Souhaitable |
| F14 | Recherche d'un programme | Souhaitable |
| F21 | Noms des sites contactés lus dans le cache DNS de Windows (voir §7.3) | Souhaitable |
| F22 | Mode discret : masque les noms de programmes et de sites (utile en partage d'écran) | Souhaitable |
| F23 | Icône réelle de chaque programme dans le panneau de détail | Optionnel |

### 6.1 Règles de circulation (V2)

| Flux | Trajet | Couleur |
|---|---|---|
| Lecture disque | Entrepôt du disque où est installé le programme → bâtiment | Bleu |
| Écriture disque | Bâtiment → entrepôt | Orange |
| Réseau reçu / envoyé | Aéroport ↔ bâtiment ; débit total réparti au prorata des connexions de chaque application | Vert |

- **Nombre** : à chaque relevé (2 s), 1 véhicule dès 256 octets/s, puis 1 de plus chaque fois que le débit est multiplié par 8 (6 au maximum par flux) ; 300 véhicules au plus en même temps.
- **Gabarit** : voiture sous 256 Ko/s, camionnette sous 4 Mo/s, camion au-delà.
- Les véhicules suivent les routes (allée, rue du quartier, avenues, rocade), roulent à droite et allument leurs phares la nuit.
- Un clic sur un véhicule le fait suivre par la caméra et affiche son origine, sa destination et le débit estimé.

### 6.2 Embouteillages, sites, mode discret, icônes (complément V2)

- **Code de la route** (ajout du 23/10/2026) : les véhicules accélèrent et freinent progressivement et gardent leurs distances avec le véhicule qui les précède sur la même voie, quelle que soit sa destination. **Ronds-points** aux quatre croisements d'avenues autour de la tour : les véhicules en font le tour dans le sens inverse des aiguilles d'une montre ; sur l'anneau, ils ont la priorité et ne s'arrêtent jamais (un anneau plein se bloquerait lui-même). **Feux tricolores intelligents** là où les rues des quartiers débouchent sur les avenues intérieures et aux carrefours de la rocade côté aéroport : éteints (on passe) tant que des véhicules n'arrivent pas par les deux rues à la fois ; allumés, cycle de 10 s (vert 4 s, orange 1 s par direction), et la rue qui attend passe tout de suite au vert si personne n'arrive par l'autre. Arrêt au rouge et à l'orange, sauf si l'on est trop près pour s'arrêter. Les feux se figent pendant la pause.
- **Rester en direct** (23/10/2026) : chaque véhicule connaît la place que lui donnent les données (« place prévue », qui avance à vitesse normale). Retardé par un feu ou un rond-point, il accélère (boost, jusqu'à 2 fois sa vitesse) pour la retrouver. Seul le retard d'un vrai bouchon n'est pas rattrapé. (Le dépassement par l'autre voie a été retiré : on croyait voir des véhicules sur la mauvaise file.)
- **Aucune superposition** (23/10/2026) : chaque véhicule est couvert de 2 ou 3 disques ; il n'avance jamais là où il toucherait le véhicule qui le précède dans sa voie (4 px d'écart). Insertion : on ne tient compte que de celui qui est déjà dans sa voie ; celui qui s'insère attend un trou, et passe en priorité s'il attend depuis plus d'1 s (fermeture éclair). Deux véhicules au même endroit : le plus récent cède. Un départ attend que sa place soit libre (4 s au plus). On n'entre dans un rond-point que si moins de 9 véhicules sont sur l'anneau ; en sortie, on respecte la file (mode bouchon). Aux croisements perpendiculaires, pas de blocage : ce sont les feux qui arbitrent (sinon des blocages en boucle à plusieurs véhicules). Quand le plan de la ville change, les trajets en cours sont recalculés. Mesuré : 0 véhicule bloqué plus de 4 s, 0 à 3 superpositions dans une même voie. **Budget de 8 départs par seconde**, flux les plus forts d'abord : mesuré le 23/10/2026, les ~90 applications faisaient partir 31 véhicules/s, soit ~530 véhicules en route pour 300 places, et la ville était en surcharge permanente (files partout, départs perdus).
- **Autoroutes** (§4, ajout du 23/10/2026) : quand le débit d'une application vers un disque ou vers Internet dépasse 1 Mo/s pendant 6 s, une autoroute numérotée (A1, A2…) s'ouvre au-dessus de la ville, comme dans *Mini Motorways*, avec de vrais échangeurs : on ne quitte une route et on ne s'y insère que par la droite, dans sa propre voie ; quand le péage est de l'autre côté de la route, la bretelle fait une boucle de 270° (trèfle) et un petit pont enjambe la route. Départ sur l'avenue au bout de la rue du quartier (du côté où il y a le plus de place, loin des ronds-points). **Arrivée par une zone de péage** (23/10/2026) : une place partagée par toutes les autoroutes vers une même cible, juste au-dessus de l'entrepôt (à gauche de son allée) ou du terminal de l'aéroport, avec 2 cabines par sens, îlots et auvent au logo « t » ; le ruban s'y arrête net. De la place part une **route à 4 voies, de la largeur de l'autoroute**, qui s'arrête au bord de la cible (sans passer dessus). Les véhicules gardent leur voie de l'autoroute jusqu'au disque, sans resserrement, et ne croisent jamais le trafic des rues à l'arrivée. (Essayés avant et écartés : bretelle + allée, trop lent ; place + route à une voie, trop étroite ; ruban posé sur le disque, pas beau.) Portique de télépéage (barre en travers du ruban, deux cabines, voyants verts, logo « t » orange) à chaque bout. **2 × 2 voies** (23/10/2026, pour ne pas déplacer le bouchon sur l'autoroute) : ligne continue au centre, pointillés entre les voies ; on roule à droite, on ne double que par la gauche (si la voie est libre à sa hauteur et devant), on se rabat dès que possible, jamais de dépassement par la droite ; un véhicule en plein changement de voie compte pour les deux voies (pas de superposition). L'ombre du ruban est nulle aux péages et s'écarte avec la hauteur ; les véhicules passent sous les portiques. Ils empruntent l'autoroute 1,5 fois plus vite, sans feux. Elle se ferme quand le débit reste sous la moitié du seuil pendant 6 s, puis disparaît quand son dernier véhicule est arrivé. Réglages : `autoroutes` dans `config.json`. Aperçu : touche `A` (les trois flux les plus forts).
- **Bouchons sans paralysie** (correctif du 23/10/2026) : la file d'un bouchon est limitée (22 véhicules par sens) ; au-delà, et quand la sortie d'un entrepôt est occupée, le départ est abandonné. Avant ce correctif, des véhicules en attente invisibles occupaient tout le quota de 300 et la circulation s'arrêtait dans toute la ville.

- **Embouteillages (F11)** : un disque est saturé selon son temps d'activité (compteur Windows « % Idle Time », la mesure « Activité » du Gestionnaire des tâches) : à partir de 60 % la circulation ralentit, à 95 % elle est bloquée. Le réseau, selon la part utilisée du débit de la carte réseau la plus active : de 40 % à 80 %. Les véhicules ralentissent sur les 320 derniers pixels de route avant l'entrepôt ou l'aéroport, font la queue en gardant leurs distances, allument leurs feux stop ; un halo rouge pulse autour de la cible saturée. Seuils réglables dans `config.json` (`embouteillages`). Aperçu sans saturer le PC : touche `B` (disque, réseau, les deux, arrêt), ou `?bouchon=disque`, `reseau` ou `tout` dans l'adresse pour les tests.
- **Noms des sites (F21)** : panneau d'une application (« Sites contactés ») et de l'aéroport (« Sites les plus contactés »), avec le nombre de connexions. « Ce PC » pour les connexions internes, « (réseau local) » pour les adresses privées. Les adresses restées sans nom ne sont pas listées une à une : une seule ligne « N adresses sans nom » (choix du 23/10/2026, plutôt que mémoriser les noms sur le disque ou une base « adresse → opérateur »).
- **Mode discret (F22)** : bouton « Discret » ou touche `D`. Les applications deviennent « Quartier n° de place » (stable) sur la carte, dans les infobulles et les panneaux ; les sites ne sont plus que comptés ; les icônes sont retirées ; la recherche est vidée. Le choix est mémorisé.
- **Icônes (F23)** : extraites de l'exécutable par Windows (64 px), ou logo du manifeste pour une application du Microsoft Store. Sans icône, la pastille du quartier reste. Le chemin de l'exécutable ne quitte jamais le serveur : la page demande l'icône par l'identifiant de l'application.

### V3 : la ville qui se souvient
| ID | Fonctionnalité | Priorité |
|---|---|---|
| F15 | Enregistrement local de l'historique (base SQLite dans `donnees\`) | Indispensable |
| ~~F16~~ | ~~Mode timelapse : rejouer la journée en accéléré avec une barre de temps~~ — retiré le 23/10/2026 (jugé inutile par le demandeur) | — |
| F19 | Purge automatique de l'historique après N jours, **activée par défaut** | Indispensable |
| ~~F24~~ | ~~Bouton « Mettre en pause l'enregistrement » et bouton « Effacer l'historique »~~ — retiré le 23/10/2026 (jugé inutile par le demandeur) ; pour tout effacer, supprimer `donnees\historique.db` | — |
| F25 | Liste d'exclusion : applications jamais enregistrées dans l'historique (gestionnaire de mots de passe, etc.) | Souhaitable |
| F17 | Fin du cycle de vie : états Délabré et Démoli (§4.1) | Souhaitable |
| F18 | Alertes visuelles en cas d'activité inhabituelle (exemple : gros envoi réseau la nuit) | Souhaitable |

---

## 7. Données collectées

### 7.1 Ce qui est collecté

| Donnée | Source | Fréquence |
|---|---|---|
| Liste des processus, nom, processus parent, CPU, RAM, lectures/écritures disque | Windows, en **un seul appel** pour tous les processus (`NtQuerySystemInformation`, sans droits administrateur) | 2 s |
| Chemin de l'exécutable (pour le classement, jamais envoyé à la page) | psutil, lu une fois par processus | à l'apparition |
| Capacité et occupation des disques | psutil | 30 s |
| Taux d'occupation des disques (pour les embouteillages) | Compteurs de performance Windows (lecture locale) | 2 s |
| Connexions réseau par processus (adresse distante) | psutil | 2 s |
| Débit réseau global | psutil | 1 s |
| Correspondance adresse IP ↔ nom de site (V2) | Cache DNS de Windows, lu avec `ipconfig /displaydns` (lecture locale, ~30 ms) ; noms retenus en mémoire pendant la session, jamais écrits sur le disque | 10 s, et aussitôt qu'une connexion vers une adresse inconnue apparaît |
| Débit de la carte réseau (pour les embouteillages) | psutil | 30 s |
| Icône d'un programme (V2) | Windows (ressources de l'exécutable) ou manifeste de l'application du Store | à la demande, gardée en mémoire |

### 7.2 Règles de calcul

- **CPU** : divisé par le nombre de cœurs, comme le Gestionnaire des tâches (sinon un programme peut afficher plus de 100 %).
- **RAM** : plage de travail privée du processus, exactement la mesure de la colonne « Mémoire » du Gestionnaire des tâches (vérifié le 22/10/2026 ; la mémoire « privée » de psutil donnait des écarts de 2 à 6 fois).
- **Performance** : la lecture des processus par psutil coûtait 0,8 s de calcul toutes les 2 s (processus protégés) ; l'appel Windows unique prend 4 ms. Mesuré : 12 ms de calcul par relevé au total.
- **Regroupement en immeubles** : par arbre de processus (un programme et ses processus enfants) puis par nom d'exécutable. Cas particuliers :
  - `svchost.exe` forme le bâtiment « Services Windows » ;
  - les composants Windows sans nom connu dans `config.json` sont réunis dans un seul bâtiment « Composants Windows », pour ne pas envahir la Zone système ;
  - `msedgewebview2.exe` est rattaché à l'application qui l'a lancé (Teams, Outlook…), pas à Edge ;
  - `python.exe`, `node.exe` et similaires sont distingués par leur processus parent.

### 7.3 Ce qui n'est jamais collecté

- Lignes de commande des processus (elles peuvent contenir des mots de passe ou des jetons).
- Titres des fenêtres (noms de documents, objets de mails).
- Contenu des fichiers et des échanges réseau, frappes clavier, captures d'écran.

**Noms des sites :** PC City n'envoie **aucune requête DNS**. Il lit uniquement le cache DNS que Windows a déjà constitué pour les autres programmes. Une adresse absente du cache s'affiche telle quelle (adresse IP).

---

## 8. Données sensibles et confidentialité

Même sans rien envoyer sur Internet, PC City manipule des informations personnelles : la liste des logiciels utilisés, les sites contactés (assimilable à un historique de navigation) et, en V3, les horaires d'activité sur le PC.

| Risque | Mesure |
|---|---|
| Une page web ouverte dans le navigateur se connecte au serveur local et lit les données (y compris par « DNS rebinding ») | Le serveur n'accepte que les requêtes dont l'en-tête `Host` vaut `127.0.0.1:<port>`, n'envoie aucune autorisation d'accès entre sites (CORS), et exige un jeton aléatoire généré à chaque lancement, transmis uniquement à la fenêtre ouverte par `lancer.bat`. |
| Les données apparaissent dans des journaux | Le serveur ne journalise que des erreurs techniques, jamais de noms de programmes ni d'adresses. |
| L'historique V3 est copié avec le dossier (sauvegarde, envoi du projet à quelqu'un, synchronisation OneDrive) | Base isolée dans `donnees\`, à exclure de tout partage. Le README le signale. Le dossier du projet ne doit pas se trouver dans un dossier synchronisé. |
| La liste des programmes utilisés (`programmes_vus.json`, §4.1) | Une ligne par application, sans détail d'activité ; chaque entrée est supprimée à la démolition (30 jours sans utilisation). |
| L'historique s'accumule indéfiniment | Purge après 7 jours activée par défaut (F19). Effacement manuel : supprimer `donnees\historique.db` (les boutons F24 ont été retirés). |
| L'historique est trop détaillé | Enregistrement agrégé à la minute ; pour le réseau, seuls le nom de site (ou l'IP) et le volume estimé par application sont gardés, pas chaque connexion. |
| Partage d'écran pendant une réunion | Mode discret (F22). |

La base n'est pas chiffrée : elle est protégée par la session Windows (et BitLocker si actif), comme les autres fichiers personnels.

---

## 9. Architecture technique

```
┌──────────────────────────── PC (local uniquement) ────────────────────────────┐
│                                                                                │
│  collecteur.py ──► serveur.py ──(HTTP 127.0.0.1 : page + relevé /2 s)──► Edge  │
│  (psutil)          (Python,                                         (fenêtre   │
│                    bibliothèque standard)                            dédiée)   │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 9.1 Choix techniques

| Élément | Choix |
|---|---|
| Langage du collecteur et du serveur | Python 3.13 portable, fourni dans `vendor\python\` |
| Bibliothèques Python | `psutil` uniquement. Le serveur utilise la bibliothèque standard de Python. |
| Serveur | Un seul serveur HTTP local qui sert la page et les fichiers JavaScript. La page demande le dernier relevé toutes les 2 s (`/api/etat`) ; chaque demande sert aussi de signe de vie. Le collecteur tourne en continu dans le serveur, indépendamment de la page. |
| Affichage | HTML + JavaScript + **Canvas 2D** du navigateur, **sans aucune bibliothèque** |
| Organisation du code | Le **modèle de la ville** (placement des quartiers, immeubles, routes, états) est séparé du **rendu** (dessin). Une vue 3D pourra être ajoutée plus tard sans refaire le modèle (voir Q10). |
| Rendu | Un seul canvas, redessiné à 25 images/s au repos et à pleine cadence pendant un déplacement ou un zoom. Le décor fixe (mer, terre, parcs, routes, arbres) est pré-dessiné dans un canvas caché, refait seulement si la caméra, le plan, les couleurs ou la taille changent (23/10/2026 : PC City consommait ~9 % du processeur et ~430 Mo, surtout dans Edge). Aucun arbre sur une route. |
| Communication | `127.0.0.1` uniquement, port 8765 par défaut ; s'il est occupé, le suivant disponible est pris. Le port est réservé en exclusivité (`SO_EXCLUSIVEADDRUSE`) : constaté le 23/10/2026, le réglage par défaut de Python laissait sous Windows un second serveur s'ouvrir sur le même port. Un serveur lancé sans fenêtre (tests) n'écrit pas `serveur.json`. |
| Sécurité | Contrôle de l'en-tête `Host` (`127.0.0.1:<port>` uniquement) + jeton aléatoire par lancement, vérifiés sur chaque requête ; aucun en-tête CORS |
| Navigateurs | Edge (par défaut) et Chrome récents |
| Système | Windows 10 et 11 |

### 9.2 Lancement et arrêt

- `lancer.bat` démarre le serveur sans console visible, puis ouvre Edge en mode application (`--app`), avec un profil dédié stocké dans `donnees\navigateur\` : pas d'extensions, pas de synchronisation avec le compte habituel.
- Fermer la fenêtre arrête le serveur : il surveille le navigateur qu'il a lancé et, à défaut, s'arrête seul sans signe de vie de la page depuis 3 min (réglable ; délai large car le navigateur ralentit les pages réduites).
- Un second double-clic sur `lancer.bat` n'ouvre pas un second serveur : il rouvre la fenêtre.

### 9.3 Installation (une seule fois)

- Aucun prérequis : `installer.bat` télécharge une seule fois, depuis les sites officiels, Python 3.13 portable (python.org) et psutil 7.2.2 (PyPI), dans `vendor\`.
- Contrôles : signature numérique « Python Software Foundation » de `python.exe`, empreinte SHA-256 du paquet psutil. En cas d'écart, l'installation est annulée.
- Rien n'est installé sur le PC lui-même : supprimer le dossier suffit à tout désinstaller.
- `lancer.bat` appelle l'installation automatiquement si `vendor\` est absent.
- Aucune bibliothèque JavaScript n'est nécessaire en V1.

### 9.4 Arborescence
```
pc-city\
├── CDC.md
├── README.md
├── lancer.bat
├── installer.bat
├── installer.ps1        ← téléchargement et vérification de vendor\
├── config.json          ← quartiers, couleurs, fréquences, port, exclusions
├── collecteur.py        ← processus, disques (dont occupation), réseau
├── cache_dns.py         ← noms des sites, lus dans le cache DNS de Windows
├── icones.py            ← icônes des programmes en PNG
├── registre.py          ← mémoire des bâtiments (emplacements, fermés, veille)
├── serveur.py
├── releases\            ← versions sauvegardées (zip)
├── vendor\
│   └── python\          ← Python portable + psutil (Lib\site-packages)
├── donnees\             ← créé au premier lancement, ne pas partager
│   ├── programmes_vus.json ← V2 : cycle de vie des bâtiments
│   ├── historique.db    ← V3
│   ├── serveur.json     ← port et jeton de l'instance en cours (supprimé à l'arrêt)
│   ├── erreurs.log      ← erreurs techniques uniquement (serveur, et erreurs de la page transmises par /api/erreur)
│   └── navigateur\      ← profil Edge dédié
└── ville\
    ├── index.html
    ├── style.css
    ├── modele.js        ← placement de la ville, routes, états
    ├── trafic.js        ← véhicules : départs, trajets, déplacements
    ├── icone.svg        ← icône de la fenêtre
    ├── rendu2d.js       ← dessin Canvas 2D
    └── interface.js     ← barre du haut, panneau de détail, légende, recherche
```

---

## 10. Exigences non fonctionnelles

| Exigence | Cible |
|---|---|
| Consommation du collecteur | Moins de 2 % du CPU et moins de 100 Mo de RAM |
| Fluidité de l'affichage | 60 images/s visées, 30 au minimum, avec 150 immeubles et 300 voitures |
| Démarrage | Ville affichée moins de 5 s après le double-clic |
| Sécurité | Serveur accessible uniquement depuis le PC (127.0.0.1), et uniquement par la page de PC City (en-tête `Host` + jeton) |
| Réseau | Aucune connexion sortante émise par PC City (vérifiable avec le Moniteur de ressources) |
| Droits | Fonctionne sans droits administrateur (certaines infos système seront alors masquées) |

---

## 11. Limites connues

- **Volume réseau par programme** : Windows fournit facilement les connexions de chaque programme (qui parle à qui), mais pas le volume exact de données échangées. Le trafic réseau par immeuble est donc estimé : nombre de connexions actives et débit global réparti entre elles. Une mesure exacte demanderait des outils avancés (ETW) et des droits administrateur.
- **Trafic disque par disque** : Windows indique combien chaque programme lit et écrit, mais pas sur quel disque. Les véhicules vont vers l'entrepôt du disque où est installé le programme ; à défaut, vers C:.
- **Compteurs d'E/S** : Windows compte ensemble toutes les lectures et écritures d'un programme (fichiers, mais aussi certains périphériques et canaux internes). Le trafic « disque » d'un bâtiment peut donc être un peu surestimé.
- **Échanges entre applications** : les communications directes entre deux programmes ne sont pas visibles simplement. Il n'y a donc pas de voitures d'immeuble à immeuble en V1 et en V2.
- **Noms des sites** : seuls les sites passés par le cache DNS de Windows ont un nom ; les autres restent des adresses IP. Constaté le 23/10/2026 : au lancement, très peu d'adresses ont un nom, car le cache se vide en quelques minutes alors que les connexions durent ; la proportion augmente pendant la session. Les navigateurs (Edge, Chrome, Arc…) et les applications qui les embarquent (Teams, Outlook) résolvent souvent les noms eux-mêmes, parfois en DNS chiffré : leurs sites restent surtout en adresses IP.
- **Embouteillage réseau** : la vitesse annoncée par une carte Wi-Fi est théorique ; le débit réel plafonne souvent à la moitié. D'où des seuils réseau plus bas que ceux du disque.
- **Sans droits administrateur**, certains processus système apparaissent comme des immeubles « anonymes ».
- **Navigateur** : PC City n'émet aucune requête, mais Edge peut contacter les services de Microsoft (mises à jour). Le profil dédié limite ce comportement sans pouvoir le supprimer entièrement.

---

## 12. Livrables

| Version | Livrables |
|---|---|
| V1 | Code source complet, `lancer.bat`, `installer.bat`, `config.json`, `vendor\`, court guide d'utilisation (README) |
| V2 | Mise à jour du code et du README |
| V3 | Mise à jour du code et du README, base d'historique |

---

## 13. Critères de validation

- **V1 :** au double-clic, la ville s'affiche avec mes programmes réellement ouverts, chacun dans le bon quartier. Cliquer sur un immeuble affiche un CPU et une RAM cohérents avec le Gestionnaire des tâches (±10 %). Fermer la fenêtre arrête le serveur. Le PC débranché d'Internet, tout fonctionne.
- **V2 :** si j'ouvre un programme, son immeuble apparaît en moins de 3 s. Si je copie un gros fichier, des camions circulent entre l'immeuble de l'explorateur et un entrepôt. Le PC ne ralentit pas de façon perceptible. Le Moniteur de ressources ne montre aucune connexion sortante de PC City.
- **V3 :** je peux rejouer la journée d'hier en accéléré. Après 7 jours, les données les plus anciennes ont disparu. « Effacer l'historique » vide bien la base.

---

## 14. Questions à trancher

Toutes les questions sont tranchées (22/10/2026).

| # | Question | Décision |
|---|---|---|
| Q1 | Les quartiers proposés (§4) te conviennent-ils ? | Oui, modifiables dans `config.json` |
| Q2 | Regrouper tous les processus d'une même application en un seul immeuble ? | Oui, selon les règles du §7.2 |
| Q3 | Autoriser une action « Fermer ce programme » depuis le panneau de détail ? | Non : lecture seule |
| Q4 | Afficher les noms des sites plutôt que les adresses IP ? | Oui, en V2, uniquement via le cache DNS de Windows (aucune requête) |
| Q5 | Dans quel dossier installer le projet ? | `C:\Users\slaville\Documents\code\2026\pc-city\` (vérifié : hors du dossier OneDrive) |
| Q6 | Durée de conservation de l'historique en V3 ? | 7 jours |
| Q7 | Lancement automatique au démarrage de Windows ? | Non |
| Q8 | Embarquer un Python portable dans le projet (aucun prérequis, environ 30 Mo) ? | **Oui** (22/10/2026) : Python n'étant pas installé sur le PC, Python 3.13 portable est fourni dans `vendor\python\` (§9.3) |
| Q9 | Garder les sites contactés dans l'historique V3, ou seulement le volume réseau par application ? | Garder les sites, agrégés à la minute |
| Q10 | Après la V1 en 2D : rester en 2D pour la V2 et la V3, ou passer à la 3D ? | Rester en 2D (véhicules, embouteillages, timelapse s'y prêtent très bien) ; une vue 3D low-poly pourra venir ensuite comme vue alternative, grâce à la séparation modèle / rendu |
