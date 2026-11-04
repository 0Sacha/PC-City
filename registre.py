"""Mémoire des bâtiments de la ville (§4.1 du CDC).

Pour chaque application déjà vue : nom, quartier, disque, emplacement dans le
quartier et date de dernière utilisation. Rien d'autre. Le fichier permet de
retrouver les bâtiments fermés, à la même place, d'un lancement à l'autre.
"""

import json
import os
import time

_ACTIVITE_CPU = 0.3          # % de CPU en dessous duquel une application est considérée inactive
_ACTIVITE_DISQUE = 2048      # octets/s lus + écrits, idem
_SAUVEGARDE_S = 60           # au plus une écriture par minute, sauf changement de la ville


class Registre:
    def __init__(self, config, fichier=None):
        self.fichier = fichier
        self.delai_veille = config["delai_veille_s"]
        self.duree_min = config["duree_min_fermee_s"]
        self.demolition = config["demolition_jours"] * 86400
        self.programmes = {}
        self._session = {}       # id -> {"debut", "vu", "actif"} (instants, jamais enregistrés)
        self._modifie = False
        self._sauve_a = time.monotonic()
        if fichier and os.path.isfile(fichier):
            try:
                with open(fichier, encoding="utf-8") as f:
                    self.programmes = json.load(f).get("programmes", {})
            except (OSError, ValueError):
                self.programmes = {}

    def _emplacement_libre(self, quartier):
        pris = {p["emplacement"] for p in self.programmes.values() if p["quartier"] == quartier}
        n = 0
        while n in pris:
            n += 1
        return n

    def mettre_a_jour(self, apps):
        """Complète les applications ouvertes (emplacement, veille) et ajoute les fermées."""
        maintenant = time.monotonic()
        date = time.time()

        for cle, app in apps.items():
            prog = self.programmes.get(cle)
            if prog is None or prog["quartier"] != app["quartier"]:
                prog = self.programmes[cle] = {
                    "nom": app["nom"], "quartier": app["quartier"], "disque": app["disque"],
                    "emplacement": self._emplacement_libre(app["quartier"]),
                }
                self._modifie = True
            prog["nom"] = app["nom"]
            prog["disque"] = app["disque"]
            prog["derniere_utilisation"] = date

            session = self._session.setdefault(cle, {"debut": maintenant, "actif": maintenant})
            session["vu"] = maintenant
            if app["cpu"] >= _ACTIVITE_CPU or app["lecture"] + app["ecriture"] >= _ACTIVITE_DISQUE:
                session["actif"] = maintenant
            app["emplacement"] = prog["emplacement"]
            app["etat"] = "veille" if maintenant - session["actif"] >= self.delai_veille else "ouvert"
            if app["etat"] == "veille":
                app["alerte"] = False

        for cle, prog in list(self.programmes.items()):
            if cle in apps:
                continue
            session = self._session.get(cle)
            # Programme éclair (lancé puis fermé pendant cette session) : pas de bâtiment fermé.
            trop_bref = session and session["vu"] - session["debut"] < self.duree_min
            # Démolition : plus utilisé depuis trop longtemps, l'entrée est effacée.
            trop_vieux = date - prog.get("derniere_utilisation", date) > self.demolition
            if trop_bref or trop_vieux:
                del self.programmes[cle]
                self._session.pop(cle, None)
                self._modifie = True
                continue
            apps[cle] = {
                "id": cle, "nom": prog["nom"], "quartier": prog["quartier"], "disque": prog.get("disque"),
                "emplacement": prog["emplacement"], "etat": "ferme",
                "ferme_depuis": prog.get("derniere_utilisation"),
                "nb_processus": 0, "ram": 0, "cpu": 0.0, "lecture": 0, "ecriture": 0,
                "connexions": 0, "sites": [], "alerte": False,
            }

        if self._modifie or maintenant - self._sauve_a >= _SAUVEGARDE_S:
            self.sauvegarder()

    def sauvegarder(self):
        self._sauve_a = time.monotonic()
        self._modifie = False
        if not self.fichier:
            return
        temporaire = self.fichier + ".tmp"
        with open(temporaire, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "programmes": self.programmes}, f, ensure_ascii=False, indent=1)
        os.replace(temporaire, self.fichier)
