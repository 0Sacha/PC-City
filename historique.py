"""Historique de l'activité (V3) : la ville qui se souvient.

F15 : enregistrement local dans donnees\\historique.db (SQLite), agrégé à la minute.
F19 : purge automatique au-delà de N jours (7 par défaut).
F25 : liste d'exclusion : ces applications ne sont jamais enregistrées.
F18 : alertes d'activité inhabituelle, comparée aux jours précédents.

Ce qui est gardé (§8 du CDC) : par application et par minute, CPU moyen, RAM maximale, volumes lus et
écrits sur le disque, volumes reçus et envoyés sur le réseau (estimés), et le nom des sites contactés
(ou leur adresse) avec leur nombre de connexions. Jamais chaque connexion, ni aucun contenu.
"""

import logging
import sqlite3
import threading
import time

_SCHEMA = """
CREATE TABLE IF NOT EXISTS minutes (
    minute INTEGER NOT NULL, app TEXT NOT NULL, nom TEXT NOT NULL,
    cpu REAL, ram INTEGER, lecture INTEGER, ecriture INTEGER, recu INTEGER, envoye INTEGER,
    PRIMARY KEY (minute, app));
CREATE TABLE IF NOT EXISTS systeme (
    minute INTEGER PRIMARY KEY, cpu REAL, ram INTEGER,
    lecture INTEGER, ecriture INTEGER, recu INTEGER, envoye INTEGER);
CREATE TABLE IF NOT EXISTS sites (
    minute INTEGER NOT NULL, app TEXT NOT NULL, site TEXT NOT NULL, connexions INTEGER,
    PRIMARY KEY (minute, app, site));
CREATE TABLE IF NOT EXISTS alertes (
    instant REAL NOT NULL, app TEXT NOT NULL, nom TEXT NOT NULL, type TEXT NOT NULL,
    message TEXT NOT NULL, valeur REAL);
CREATE INDEX IF NOT EXISTS minutes_app ON minutes (app, minute);
"""

_MO = 1024 * 1024


class Historique:
    def __init__(self, config, fichier):
        self.jours = config.get("historique_jours", 7)
        self.exclusions = {n.lower() for n in config.get("exclusions_historique", [])}
        self.regles = config["alertes"]
        self._verrou = threading.Lock()
        self._base = sqlite3.connect(fichier, check_same_thread=False)
        self._base.executescript(_SCHEMA)
        self._minute = None        # minute en cours d'agrégation
        self._apps = {}            # app -> cumul de la minute en cours
        self._systeme = None
        self._sites = {}           # (app, site) -> connexions maximales
        self._instant = None       # dernier relevé (pour la durée écoulée)
        self._habitudes = {}       # app -> (envoi moyen par minute, écriture moyenne, minutes connues)
        self._habitudes_a = 0
        self._purge_a = 0
        self._dernieres = {}       # (app, type) -> instant de la dernière alerte (pas de répétition)
        self.recentes = []         # alertes des dernières 24 h, la plus récente d'abord
        self._purger()
        self._charger_alertes()

    def exclue(self, app):
        return app["id"].lower() in self.exclusions or app["nom"].lower() in self.exclusions

    # ---------- Agrégation à la minute ----------

    def traiter(self, etat):
        """Appelé à chaque relevé : cumule la minute en cours, l'enregistre quand elle est finie,
        et complète l'état (alertes récentes, alerte en cours de chaque application)."""
        maintenant = etat["horodatage"]
        duree = min(10.0, maintenant - self._instant) if self._instant else 0.0
        self._instant = maintenant
        minute = int(maintenant // 60)
        with self._verrou:
            try:
                if self._minute is not None and minute != self._minute:
                    self._enregistrer()
                if self._minute != minute:
                    self._minute = minute
                    self._apps, self._systeme, self._sites = {}, None, {}
                self._cumuler(etat, duree)
                if time.time() - self._purge_a > 3600:
                    self._purger()
            except sqlite3.Error:
                logging.exception("Historique : erreur d'enregistrement")
        self._completer(etat)

    def _cumuler(self, etat, duree):
        s = etat["systeme"]
        sy = self._systeme = self._systeme or {"cpu": [], "ram": 0, "lecture": 0, "ecriture": 0, "recu": 0, "envoye": 0}
        sy["cpu"].append(s["cpu"])
        sy["ram"] = max(sy["ram"], s["ram_utilisee"])
        for cle, debit in (("lecture", s["disque_lecture"]), ("ecriture", s["disque_ecriture"]),
                           ("recu", s["reseau_recu"]), ("envoye", s["reseau_envoye"])):
            sy[cle] += debit * duree
        ouvertes = [a for a in etat["applications"] if a["etat"] != "ferme"]
        connexions = sum(a["connexions"] for a in ouvertes) or 1
        for app in ouvertes:
            if self.exclue(app):
                continue
            c = self._apps.setdefault(app["id"], {"nom": app["nom"], "cpu": [], "ram": 0, "lecture": 0,
                                                  "ecriture": 0, "recu": 0, "envoye": 0})
            part = app["connexions"] / connexions
            c["cpu"].append(app["cpu"])
            c["ram"] = max(c["ram"], app["ram"])
            c["lecture"] += app["lecture"] * duree
            c["ecriture"] += app["ecriture"] * duree
            # Volume réseau par application : estimé (Windows ne le donne pas), comme dans la ville.
            c["recu"] += s["reseau_recu"] * part * duree
            c["envoye"] += s["reseau_envoye"] * part * duree
            for site in app.get("sites", []):
                if site["nature"] == "local":
                    continue
                cle = (app["id"], site["nom"])
                self._sites[cle] = max(self._sites.get(cle, 0), site["connexions"])

    def _enregistrer(self):
        m = self._minute
        b = self._base
        moyenne = lambda valeurs: sum(valeurs) / len(valeurs) if valeurs else 0.0
        if self._systeme:
            sy = self._systeme
            b.execute("INSERT OR REPLACE INTO systeme VALUES (?,?,?,?,?,?,?)",
                      (m, round(moyenne(sy["cpu"]), 1), sy["ram"], round(sy["lecture"]), round(sy["ecriture"]),
                       round(sy["recu"]), round(sy["envoye"])))
        b.executemany("INSERT OR REPLACE INTO minutes VALUES (?,?,?,?,?,?,?,?,?)", [
            (m, app, c["nom"], round(moyenne(c["cpu"]), 1), c["ram"], round(c["lecture"]), round(c["ecriture"]),
             round(c["recu"]), round(c["envoye"])) for app, c in self._apps.items()])
        b.executemany("INSERT OR REPLACE INTO sites VALUES (?,?,?,?)",
                      [(m, app, site, n) for (app, site), n in self._sites.items()])
        b.commit()
        self._detecter(m)

    def _purger(self):
        """F19 : tout ce qui a plus de N jours est effacé."""
        self._purge_a = time.time()
        limite = time.time() - self.jours * 86400
        b = self._base
        b.execute("DELETE FROM minutes WHERE minute < ?", (int(limite // 60),))
        b.execute("DELETE FROM systeme WHERE minute < ?", (int(limite // 60),))
        b.execute("DELETE FROM sites WHERE minute < ?", (int(limite // 60),))
        b.execute("DELETE FROM alertes WHERE instant < ?", (limite,))
        # Une application ajoutée à la liste d'exclusion disparaît aussi de ce qui était déjà enregistré.
        for nom in self.exclusions:
            for table in ("minutes", "sites", "alertes"):
                b.execute(f"DELETE FROM {table} WHERE lower(app) = ?", (nom,))
            b.execute("DELETE FROM minutes WHERE lower(nom) = ?", (nom,))
            b.execute("DELETE FROM alertes WHERE lower(nom) = ?", (nom,))
        b.commit()

    # ---------- F18 : activité inhabituelle ----------

    def _habitudes_a_jour(self, minute):
        """Moyennes par minute de chaque application sur les jours précédents (hors dernière heure),
        recalculées toutes les 10 minutes."""
        if time.time() - self._habitudes_a < 600:
            return self._habitudes
        self._habitudes_a = time.time()
        lignes = self._base.execute(
            "SELECT app, AVG(envoye), AVG(ecriture), COUNT(*) FROM minutes WHERE minute < ? GROUP BY app",
            (minute - 60,)).fetchall()
        self._habitudes = {app: (envoi or 0, ecriture or 0, n) for app, envoi, ecriture, n in lignes}
        return self._habitudes

    def _detecter(self, minute):
        r = self.regles
        habitudes = self._habitudes_a_jour(minute)
        heure = time.localtime(minute * 60).tm_hour
        nuit = r["nuit_debut_h"] <= heure < r["nuit_fin_h"]
        for app, c in self._apps.items():
            envoi, ecriture = c["envoye"], c["ecriture"]
            envoi_habituel, ecriture_habituelle, connues = habitudes.get(app, (0, 0, 0))
            connu = connues >= 30   # au moins une demi-heure d'historique pour juger de « l'habitude »
            if nuit and envoi >= r["nuit_envoi_mo_min"] * _MO:
                self._alerter(app, c["nom"], "nuit", envoi,
                              f"a envoyé environ {envoi / _MO:.0f} Mo sur Internet en une minute, en pleine nuit")
            elif envoi >= r["envoi_mo_min"] * _MO and (not connu or envoi >= r["facteur_habitude"] * max(envoi_habituel, _MO)):
                if connu:
                    texte = (f"a envoyé environ {envoi / _MO:.0f} Mo sur Internet en une minute, "
                             f"{envoi / max(envoi_habituel, 1):.0f} fois plus que d'habitude")
                else:
                    texte = f"nouveau venu, a envoyé environ {envoi / _MO:.0f} Mo sur Internet en une minute"
                self._alerter(app, c["nom"], "envoi", envoi, texte)
            if ecriture >= r["ecriture_go_min"] * 1024 * _MO and (
                    not connu or ecriture >= r["facteur_habitude"] * max(ecriture_habituelle, _MO)):
                self._alerter(app, c["nom"], "ecriture", ecriture,
                              f"a écrit {ecriture / (1024 * _MO):.1f} Go sur le disque en une minute, "
                              "beaucoup plus que d'habitude")

    def _alerter(self, app, nom, type_, valeur, message):
        maintenant = time.time()
        if maintenant - self._dernieres.get((app, type_), 0) < 900:
            return   # même alerte il y a moins de 15 min : on ne répète pas
        self._dernieres[(app, type_)] = maintenant
        self._base.execute("INSERT INTO alertes VALUES (?,?,?,?,?,?)", (maintenant, app, nom, type_, message, valeur))
        self._base.commit()
        self.recentes.insert(0, {"instant": maintenant, "app": app, "nom": nom, "type": type_, "message": message})
        del self.recentes[50:]

    def _charger_alertes(self):
        lignes = self._base.execute(
            "SELECT instant, app, nom, type, message FROM alertes WHERE instant > ? ORDER BY instant DESC LIMIT 50",
            (time.time() - 86400,)).fetchall()
        self.recentes = [{"instant": i, "app": a, "nom": n, "type": t, "message": m} for i, a, n, t, m in lignes]

    def _completer(self, etat):
        """Ajoute à l'état les alertes des dernières 24 h et, sur chaque application, sa dernière alerte
        de moins de 15 minutes (affichée sur son bâtiment)."""
        limite = time.time() - 86400
        self.recentes = [a for a in self.recentes if a["instant"] > limite]
        etat["alertes"] = list(self.recentes)
        etat["historique"] = {"jours": self.jours, "exclusions": len(self.exclusions)}
        recentes = {}
        for a in self.recentes:
            if time.time() - a["instant"] < 900:
                recentes.setdefault(a["app"], a)
        for app in etat["applications"]:
            alerte = recentes.get(app["id"])
            app["inhabituel"] = {"message": alerte["message"], "instant": alerte["instant"]} if alerte else None
            app["exclue"] = self.exclue(app)

    def fermer(self):
        with self._verrou:
            try:
                if self._minute is not None:
                    self._enregistrer()
                self._base.close()
            except sqlite3.Error:
                logging.exception("Historique : erreur à la fermeture")
