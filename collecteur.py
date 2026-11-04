"""Collecte de l'activité du PC (lecture seule, aucune donnée ne sort du PC).

Les processus sont lus en un seul appel Windows (NtQuerySystemInformation),
qui donne pour chacun : nom, parent, mémoire privée (comme le Gestionnaire
des tâches), temps CPU et volumes lus/écrits. psutil sert pour le reste :
chemins des exécutables, disques, réseau, totaux système.
"""

import ctypes
import os
import struct
import threading
import time

import psutil

import cache_dns
from registre import Registre

_ntdll = ctypes.WinDLL("ntdll")
_INFO_PROCESSUS = 5
_TAMPON_TROP_PETIT = 0xC0000004

_pdh = ctypes.WinDLL("pdh")
_PDH_DOUBLE = 0x200


class _ValeurCompteur(ctypes.Structure):
    _fields_ = [("statut", ctypes.c_ulong), ("valeur", ctypes.c_double)]


_pdh.PdhOpenQueryW.argtypes = [ctypes.c_wchar_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
_pdh.PdhAddEnglishCounterW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_void_p,
                                       ctypes.POINTER(ctypes.c_void_p)]
_pdh.PdhCollectQueryData.argtypes = [ctypes.c_void_p]
_pdh.PdhGetFormattedCounterValue.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p,
                                             ctypes.POINTER(_ValeurCompteur)]


class _OccupationDisques:
    """Temps d'activité de chaque disque, comme le Gestionnaire des tâches (compteurs de performance
    Windows, lecture locale). Sert aux embouteillages (F11)."""

    def __init__(self):
        self.requete = ctypes.c_void_p()
        if _pdh.PdhOpenQueryW(None, None, ctypes.byref(self.requete)):
            self.requete = None
        self.compteurs = {}

    def mesurer(self, disques):
        if not self.requete:
            return {}
        for disque in disques:
            if disque not in self.compteurs:
                compteur = ctypes.c_void_p()
                # Nom anglais du compteur : fonctionne quelle que soit la langue de Windows.
                if not _pdh.PdhAddEnglishCounterW(self.requete, f"\\LogicalDisk({disque})\\% Idle Time",
                                                  None, ctypes.byref(compteur)):
                    self.compteurs[disque] = compteur
        _pdh.PdhCollectQueryData(self.requete)
        occupation = {}
        for disque, compteur in self.compteurs.items():
            valeur = _ValeurCompteur()
            # Au premier relevé d'un compteur, Windows n'a pas encore de valeur : on l'ignore.
            if not _pdh.PdhGetFormattedCounterValue(compteur, _PDH_DOUBLE, None, ctypes.byref(valeur)):
                occupation[disque] = round(max(0.0, min(100.0, 100 - valeur.valeur)))
        return occupation


def _lire_processus():
    """Renvoie {pid: (nom, ppid, ram_privee, temps_cpu_100ns, lu, ecrit, date_creation)}."""
    taille = 1 << 20
    while True:
        tampon = ctypes.create_string_buffer(taille)
        requis = ctypes.c_ulong(0)
        statut = _ntdll.NtQuerySystemInformation(
            _INFO_PROCESSUS, tampon, taille, ctypes.byref(requis)) & 0xFFFFFFFF
        if statut == _TAMPON_TROP_PETIT:
            taille = requis.value + 65536
            continue
        if statut:
            raise OSError(f"NtQuerySystemInformation : 0x{statut:08X}")
        break

    base = ctypes.addressof(tampon)
    brut = tampon.raw
    resultat = {}
    pos = 0
    while True:
        suivant, = struct.unpack_from("<I", brut, pos)
        ram, = struct.unpack_from("<q", brut, pos + 0x08)
        creation, utilisateur, noyau = struct.unpack_from("<qqq", brut, pos + 0x20)
        longueur, pointeur = struct.unpack_from("<H6xQ", brut, pos + 0x38)
        pid, ppid = struct.unpack_from("<QQ", brut, pos + 0x50)
        lu, ecrit = struct.unpack_from("<qq", brut, pos + 0xE8)
        if pointeur:
            debut = pointeur - base
            nom = brut[debut:debut + longueur].decode("utf-16-le")
        else:
            nom = ""
        resultat[pid] = (nom, ppid, ram, utilisateur + noyau, lu, ecrit, creation)
        if not suivant:
            break
        pos += suivant
    return resultat


class Collecteur:
    def __init__(self, config, dossier_projet, fichier_registre=None):
        self.config = config
        self.dossier_projet = os.path.normcase(os.path.abspath(dossier_projet))
        self.nb_coeurs = psutil.cpu_count() or 1
        self.seuils = config["seuils_alerte"]

        self.quartier_de = {}
        for q in config["quartiers"]:
            for prog in q["programmes"]:
                self.quartier_de[prog.lower()] = q["id"]
        self.noms = {k.lower(): v for k, v in config["noms"].items()}
        self.auxiliaires = {n.lower() for n in config["auxiliaires"]}
        self.interpretes = {n.lower() for n in config["interpretes"]}

        self._verrou = threading.Lock()
        self._precedent = None          # (instant, {pid: processus})
        self._chemins = {}              # (pid, creation) -> chemin de l'exécutable ou None
        self._io_systeme = None
        self._io_cartes = None
        self._disques = []
        self._cartes = {}               # carte réseau -> vitesse en Mbit/s
        self._disques_instant = 0
        self._occupation = _OccupationDisques()
        self._dns = {}                  # adresse IP -> nom du site
        self._dns_instant = None
        self._dns_essayees = set()      # adresses déjà cherchées dans le cache dès leur apparition
        self.chemins_apps = {}          # application -> exécutable, pour son icône (jamais envoyé à la page)
        self.enrichir = None            # appelé sur chaque relevé avant publication (historique, alertes)
        self.registre = Registre(config, fichier_registre)
        self.etat = None

        # Deux relevés rapprochés : l'activité (CPU, débits) se calcule par différence.
        psutil.cpu_percent(None)
        self.collecter()
        time.sleep(0.5)
        self.collecter()

    # ---------- Regroupement des processus en applications (§7.2) ----------

    def _chemin(self, pid, creation):
        cle = (pid, creation)
        if cle not in self._chemins:
            try:
                self._chemins[cle] = psutil.Process(pid).exe() or None
            except (psutil.Error, OSError):
                self._chemins[cle] = None
        return self._chemins[cle]

    def _cle_application(self, pid, procs, profondeur=0):
        """Remonte l'arbre des processus jusqu'au processus « racine » de l'application."""
        courant = pid
        while True:
            nom, ppid, *_reste, creation = procs[courant]
            parent = procs.get(ppid)
            if parent is None or ppid == courant or parent[6] > creation:
                break
            nom_l = nom.lower()
            if parent[0].lower() == nom_l or nom_l in self.auxiliaires:
                courant = ppid
                continue
            break

        nom, ppid, *_reste, creation = procs[courant]
        nom_l = nom.lower() or "system"
        chemin = self._chemin(courant, creation)
        if chemin and os.path.normcase(chemin).startswith(self.dossier_projet):
            return "pc-city"
        if nom_l in self.interpretes and profondeur < 5 and ppid in procs and ppid != courant:
            parent = self._cle_application(ppid, procs, profondeur + 1)
            return f"{nom_l}|{parent}"
        return nom_l

    def _nom_affiche(self, cle):
        if cle == "pc-city":
            return "PC City"
        if cle == "composants-windows":
            return "Composants Windows"
        if "|" in cle:
            interprete, parent = cle.split("|", 1)
            return f"{self._nom_affiche(interprete)} ({self._nom_affiche(parent)})"
        if cle in self.noms:
            return self.noms[cle]
        nom = cle[:-4] if cle.endswith(".exe") else cle
        return nom[:1].upper() + nom[1:]

    def _quartier(self, cle, chemin):
        if cle == "pc-city":
            return "systeme"
        if "|" in cle:
            return "developpement"
        if cle in self.quartier_de:
            return self.quartier_de[cle]
        if chemin is None or os.path.normcase(chemin).startswith(os.path.normcase(os.environ.get("SystemRoot", r"C:\Windows"))):
            return "systeme"
        return "divers"

    # ---------- Collecte ----------

    def _collecter_disques(self, maintenant):
        if self._disques and maintenant - self._disques_instant < self.config["frequence_disques_s"]:
            return
        disques = []
        for part in psutil.disk_partitions(all=False):
            if "fixed" not in part.opts:
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
            except OSError:
                continue
            disques.append({
                "id": part.device.rstrip("\\"),
                "nom": part.device.rstrip("\\"),
                "total": usage.total,
                "utilise": usage.used,
                "libre": usage.free,
            })
        self._disques = disques
        self._disques_instant = maintenant
        try:
            self._cartes = {nom: s.speed for nom, s in psutil.net_if_stats().items() if s.isup and s.speed > 0}
        except OSError:
            self._cartes = {}

    def _lire_dns(self, maintenant, adresses):
        """Les noms ne restent que quelques minutes dans le cache de Windows, alors que les connexions
        durent : ceux déjà vus sont retenus, en mémoire seulement, tant que PC City tourne.

        Le cache est relu toutes les 10 s, et aussitôt qu'une connexion vers une adresse encore
        inconnue apparaît : le programme vient de demander ce nom, il est encore dans le cache."""
        nouvelles = {ip for ip in adresses if ip not in self._dns and ip not in self._dns_essayees}
        self._dns_essayees |= nouvelles
        if len(self._dns_essayees) > 20000:
            self._dns_essayees = set(nouvelles)
        recente = self._dns_instant is not None and maintenant - self._dns_instant < self.config["frequence_dns_s"]
        if recente and not nouvelles:
            return
        self._dns_instant = maintenant
        try:
            lus = cache_dns.lire_cache()
        except OSError:
            return
        for ip, (nom, technique) in lus.items():
            if not technique or ip not in self._dns:
                self._dns[ip] = nom
        if len(self._dns) > 20000:
            self._dns = dict(list(self._dns.items())[-10000:])

    def _site(self, ip):
        """Nom affiché pour une adresse distante."""
        nature = cache_dns.nature(ip)
        if nature == "local":
            return "Ce PC", nature
        return self._dns.get(ip, ip), nature

    def _occupation_reseau(self, duree):
        """Part du débit de la carte réseau la plus active, en % (pour les embouteillages)."""
        try:
            cartes = psutil.net_io_counters(pernic=True)
        except OSError:
            return None
        avant, self._io_cartes = self._io_cartes, cartes
        if not avant or not duree:
            return None
        meilleure = None
        for nom, io in cartes.items():
            if nom not in self._cartes or nom not in avant:
                continue
            debit = max(io.bytes_recv - avant[nom].bytes_recv, io.bytes_sent - avant[nom].bytes_sent, 0) / duree
            if meilleure is None or debit > meilleure[0]:
                meilleure = (debit, self._cartes[nom])
        if meilleure is None:
            return None
        return round(min(100.0, meilleure[0] * 8 / (meilleure[1] * 1e6) * 100))

    def collecter(self):
        maintenant = time.monotonic()
        procs = _lire_processus()
        procs.pop(0, None)  # processus inactif du système

        connexions = {}
        distants = {}  # pid -> {adresse IP: nombre de connexions}
        try:
            for c in psutil.net_connections("inet"):
                if c.raddr and c.pid and c.status in ("ESTABLISHED", "NONE"):
                    connexions[c.pid] = connexions.get(c.pid, 0) + 1
                    ip = cache_dns.normaliser_ip(c.raddr.ip)
                    adresses = distants.setdefault(c.pid, {})
                    adresses[ip] = adresses.get(ip, 0) + 1
        except (psutil.Error, OSError):
            pass
        self._lire_dns(maintenant, {ip for adresses in distants.values() for ip in adresses
                                    if cache_dns.nature(ip) != "local"})

        precedent_instant, precedent = self._precedent or (None, {})
        duree = (maintenant - precedent_instant) if precedent_instant else None

        apps = {}
        adresses_apps = {}  # application -> {adresse IP: nombre de connexions}
        classement = {}  # clé brute -> (clé finale, quartier)
        for pid, (nom, ppid, ram, cpu, lu, ecrit, creation) in procs.items():
            cle = self._cle_application(pid, procs)
            if cle not in classement:
                chemin = self._chemin(pid, creation)
                if chemin and cle not in self.chemins_apps:
                    self.chemins_apps[cle] = chemin
                quartier = self._quartier(cle, chemin)
                # Disque où est installé le programme : ses véhicules iront vers cet entrepôt (§11).
                disque = os.path.splitdrive(chemin)[0].upper() if chemin else None
                # Les petits composants Windows sans nom connu forment un seul bâtiment,
                # sinon ils envahiraient la Zone système.
                if quartier == "systeme" and cle not in self.noms and cle != "pc-city":
                    classement[cle] = ("composants-windows", quartier, disque)
                else:
                    classement[cle] = (cle, quartier, disque)
            cle, quartier, disque = classement[cle]
            app = apps.get(cle)
            if app is None:
                app = apps[cle] = {
                    "id": cle,
                    "nom": self._nom_affiche(cle),
                    "quartier": quartier,
                    "disque": disque,
                    "nb_processus": 0,
                    "ram": 0,
                    "cpu": 0.0,
                    "lecture": 0.0,
                    "ecriture": 0.0,
                    "connexions": 0,
                }
            app["nb_processus"] += 1
            app["ram"] += ram
            app["connexions"] += connexions.get(pid, 0)
            if pid in distants:
                cumul = adresses_apps.setdefault(cle, {})
                for ip, n in distants[pid].items():
                    cumul[ip] = cumul.get(ip, 0) + n
            avant = precedent.get(pid)
            if duree and avant and avant[6] == creation:
                app["cpu"] += max(0, cpu - avant[3]) / (duree * 1e7 * self.nb_coeurs) * 100
                app["lecture"] += max(0, lu - avant[4]) / duree
                app["ecriture"] += max(0, ecrit - avant[5]) / duree

        memoire = psutil.virtual_memory()
        for app in apps.values():
            app["cpu"] = round(app["cpu"], 1)
            app["lecture"] = round(app["lecture"])
            app["ecriture"] = round(app["ecriture"])
            app["alerte"] = (app["cpu"] >= self.seuils["cpu_pct"]
                             or app["ram"] >= memoire.total * self.seuils["ram_pct"] / 100)
            app["etat"] = "ouvert"
            # Sites contactés, regroupés par nom : plusieurs adresses d'un même site n'en font qu'un.
            sites = {}
            for ip, n in adresses_apps.get(app["id"], {}).items():
                nom, nature = self._site(ip)
                site = sites.setdefault(nom, {"nom": nom, "nature": nature, "connexions": 0})
                site["connexions"] += n
            app["sites"] = sorted(sites.values(), key=lambda s: (-s["connexions"], s["nom"]))[:12]

        # Emplacements, veille, et bâtiments fermés gardés d'un lancement à l'autre (§4.1).
        self.registre.mettre_a_jour(apps)

        io_disque = psutil.disk_io_counters()
        io_reseau = psutil.net_io_counters()
        debits = {"disque_lecture": 0, "disque_ecriture": 0, "reseau_recu": 0, "reseau_envoye": 0}
        if self._io_systeme and duree:
            d_avant, r_avant = self._io_systeme
            if io_disque and d_avant:
                debits["disque_lecture"] = round(max(0, io_disque.read_bytes - d_avant.read_bytes) / duree)
                debits["disque_ecriture"] = round(max(0, io_disque.write_bytes - d_avant.write_bytes) / duree)
            debits["reseau_recu"] = round(max(0, io_reseau.bytes_recv - r_avant.bytes_recv) / duree)
            debits["reseau_envoye"] = round(max(0, io_reseau.bytes_sent - r_avant.bytes_sent) / duree)
        self._io_systeme = (io_disque, io_reseau)
        self._precedent = (maintenant, procs)
        self._chemins = {cle: chemin for cle, chemin in self._chemins.items()
                         if cle[0] in procs and procs[cle[0]][6] == cle[1]}

        self._collecter_disques(maintenant)
        occupation = self._occupation.mesurer([d["id"] for d in self._disques])
        for disque in self._disques:
            disque["occupation"] = occupation.get(disque["id"])
        occupation_reseau = self._occupation_reseau(duree)

        # Consommation électrique ESTIMÉE (aucune mesure possible sur un PC fixe sans droits administrateur
        # ni prise connectée) : consommation au repos + part proportionnelle au processeur, écrans non compris.
        cpu_systeme = psutil.cpu_percent(None)
        elec = self.config.get("electricite", {"repos_w": 9, "max_w": 60})
        watts = elec["repos_w"] + (elec["max_w"] - elec["repos_w"]) * cpu_systeme / 100

        etat = {
            "horodatage": time.time(),
            "systeme": {
                "cpu": cpu_systeme,
                "watts_estimes": round(watts, 1),
                "nb_coeurs": self.nb_coeurs,
                "ram_totale": memoire.total,
                "ram_utilisee": memoire.total - memoire.available,
                "reseau_occupation": occupation_reseau,
                **debits,
            },
            "disques": [dict(d) for d in self._disques],
            "applications": sorted(apps.values(), key=lambda a: -a["ram"]),
        }
        if self.enrichir:
            self.enrichir(etat)
        with self._verrou:
            self.etat = etat
        return etat

    def dernier_etat(self):
        with self._verrou:
            return self.etat
