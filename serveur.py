"""Serveur local de PC City.

Sert la page de la ville et les données collectées, uniquement sur 127.0.0.1.
Protections (§8 du CDC) : en-tête Host contrôlé (contre le « DNS rebinding »),
jeton aléatoire exigé sur chaque appel de données, aucun en-tête CORS.
Le serveur s'arrête seul quand la fenêtre de la ville est fermée.
"""

import base64
import hmac
import json
import logging
import mimetypes
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psutil

# Version .exe (PyInstaller) : les fichiers fournis (ville\, config.json d'origine) sont extraits
# dans un dossier temporaire (sys._MEIPASS) ; donnees\ et config.json restent à côté du .exe.
EMPAQUETE = getattr(sys, "frozen", False)
if EMPAQUETE:
    DOSSIER = os.path.dirname(os.path.abspath(sys.executable))
    DOSSIER_RESSOURCES = getattr(sys, "_MEIPASS", DOSSIER)
else:
    DOSSIER = os.path.dirname(os.path.abspath(__file__))
    DOSSIER_RESSOURCES = DOSSIER
# Le Python portable n'ajoute pas le dossier du script aux chemins d'import.
sys.path.insert(0, DOSSIER_RESSOURCES)

import icones  # noqa: E402
from collecteur import Collecteur  # noqa: E402
from historique import Historique  # noqa: E402

DOSSIER_VILLE = os.path.join(DOSSIER_RESSOURCES, "ville")
DOSSIER_DONNEES = os.path.join(DOSSIER, "donnees")
FICHIER_INSTANCE = os.path.join(DOSSIER_DONNEES, "serveur.json")
ADRESSE = "127.0.0.1"

NAVIGATEURS = [
    r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
    r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
]

ENTETES_SECURITE = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
}


def charger_config():
    fichier = os.path.join(DOSSIER, "config.json")
    if EMPAQUETE and not os.path.isfile(fichier):
        # Premier lancement du .exe : on dépose une copie modifiable de config.json à côté.
        import shutil
        try:
            shutil.copyfile(os.path.join(DOSSIER_RESSOURCES, "config.json"), fichier)
        except OSError:
            fichier = os.path.join(DOSSIER_RESSOURCES, "config.json")
    with open(fichier, encoding="utf-8") as f:
        return json.load(f)


def ouvrir_fenetre(url):
    """Ouvre la ville dans une fenêtre dédiée (profil séparé, sans extensions ni synchronisation)."""
    profil = os.path.join(DOSSIER_DONNEES, "navigateur")
    for modele in NAVIGATEURS:
        chemin = os.path.expandvars(modele)
        if os.path.isfile(chemin):
            return subprocess.Popen([
                chemin, f"--app={url}", f"--user-data-dir={profil}",
                "--no-first-run", "--no-default-browser-check", "--disable-sync",
                "--window-size=1440,900",
            ])
    import webbrowser
    webbrowser.open(url)
    return None


def montrer_fenetre_existante():
    """Ramène au premier plan la fenêtre de la ville déjà ouverte ; renvoie False si elle est introuvable."""
    import ctypes
    from ctypes import wintypes
    profil = os.path.normcase(os.path.join(DOSSIER_DONNEES, "navigateur"))
    pids = set()
    for p in psutil.process_iter(["name", "cmdline"]):
        ligne = p.info["cmdline"] or []
        if (p.info["name"] or "").lower() in ("msedge.exe", "chrome.exe") \
                and not any(a.startswith("--type=") for a in ligne) \
                and any(os.path.normcase(a) == "--user-data-dir=" + profil for a in ligne):
            pids.add(p.pid)
    if not pids:
        return False
    user32 = ctypes.windll.user32
    trouvees = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def examiner(hwnd, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and user32.IsWindowVisible(hwnd) and user32.GetWindowTextLengthW(hwnd):
            trouvees.append(hwnd)
        return True

    user32.EnumWindows(examiner, 0)
    if not trouvees:
        return False
    if user32.IsIconic(trouvees[0]):
        user32.ShowWindow(trouvees[0], 9)  # SW_RESTORE
    user32.SetForegroundWindow(trouvees[0])
    return True


def instance_existante():
    """Si PC City tourne déjà, renvoie son adresse ; sinon None."""
    try:
        with open(FICHIER_INSTANCE, encoding="utf-8") as f:
            infos = json.load(f)
        url = f"http://{ADRESSE}:{infos['port']}"
        requete = urllib.request.Request(url + "/api/ping", headers={"X-Jeton": infos["jeton"]})
        with urllib.request.urlopen(requete, timeout=1) as reponse:
            if reponse.status == 200:
                return f"{url}/?t={infos['jeton']}"
    except (OSError, ValueError, KeyError):
        pass
    return None


class Serveur(ThreadingHTTPServer):
    """Serveur HTTP qui exige l'usage exclusif de son port.

    Par défaut, Python active SO_REUSEADDR, qui sous Windows laisse un second serveur s'ouvrir
    sur un port déjà pris : les requêtes partent alors au hasard vers l'un ou l'autre.
    """
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Gestionnaire(BaseHTTPRequestHandler):
    server_version = "PCCity"
    sys_version = ""

    def log_message(self, format, *args):
        pass  # aucun journal des requêtes : elles contiennent le jeton

    def _envoyer(self, code, corps=b"", type_contenu="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", type_contenu)
        self.send_header("Content-Length", str(len(corps)))
        for cle, valeur in ENTETES_SECURITE.items():
            self.send_header(cle, valeur)
        self.end_headers()
        self.wfile.write(corps)

    def _json(self, objet):
        self._envoyer(200, json.dumps(objet, ensure_ascii=False).encode("utf-8"),
                      "application/json; charset=utf-8")

    def _jeton_valide(self):
        app = self.server.app
        if not hmac.compare_digest(self.headers.get("X-Jeton", ""), app.jeton):
            return False
        app.dernier_signe_de_vie = time.monotonic()
        return True

    def do_POST(self):
        app = self.server.app
        if self.headers.get("Host", "") not in app.hotes_autorises:
            return self._envoyer(403, b"Hote refuse")
        if self.path not in ("/api/redemarrer", "/api/erreur"):
            return self._envoyer(404, b"Introuvable")
        if not self._jeton_valide():
            return self._envoyer(403, b"Jeton invalide")
        if self.path == "/api/erreur":
            # Erreur survenue dans la page : notée dans erreurs.log (taille limitée).
            taille = min(int(self.headers.get("Content-Length") or 0), 4000)
            texte = self.rfile.read(taille).decode("utf-8", errors="replace")
            logging.warning("Erreur dans la page : %s", texte)
            return self._json({"ok": True})
        self._json({"ok": True, "instance": os.getpid()})
        app.redemarrer()

    def do_GET(self):
        app = self.server.app
        if self.headers.get("Host", "") not in app.hotes_autorises:
            return self._envoyer(403, b"Hote refuse")

        chemin = self.path.split("?", 1)[0]

        if chemin.startswith("/api/"):
            if not self._jeton_valide():
                return self._envoyer(403, b"Jeton invalide")
            if chemin == "/api/ping":
                return self._json({"ok": True, "instance": os.getpid()})
            if chemin == "/api/config":
                return self._json(app.config_publique)
            if chemin == "/api/etat":
                return self._json(app.collecteur.dernier_etat())
            if chemin == "/api/icone":
                parametres = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                return self._json({"png": app.icone(parametres.get("id", [""])[0])})
            return self._envoyer(404, b"Introuvable")

        if chemin == "/":
            chemin = "/index.html"
        fichier = os.path.normpath(os.path.join(DOSSIER_VILLE, chemin.lstrip("/")))
        if not fichier.startswith(DOSSIER_VILLE + os.sep) or not os.path.isfile(fichier):
            return self._envoyer(404, b"Introuvable")
        type_contenu = mimetypes.guess_type(fichier)[0] or "application/octet-stream"
        if fichier.endswith(".js"):
            type_contenu = "text/javascript"
        if type_contenu.startswith("text/"):
            type_contenu += "; charset=utf-8"
        with open(fichier, "rb") as f:
            self._envoyer(200, f.read(), type_contenu)


class Application:
    def __init__(self, config, avec_fenetre=True, relance=None, fichier_historique=None):
        """relance : {"port", "jeton", "pid_navigateur"} quand le serveur redémarre sous une fenêtre déjà ouverte."""
        self.config = config
        self.avec_fenetre = avec_fenetre
        # Un serveur lancé sans fenêtre (tests) ne se déclare pas : lancer.bat doit retrouver la vraie fenêtre.
        self.declarer_instance = avec_fenetre or relance is not None
        self.jeton = relance["jeton"] if relance else secrets.token_urlsafe(32)
        self.pid_navigateur = relance["pid_navigateur"] if relance else None
        self.collecteur = Collecteur(config, DOSSIER, os.path.join(DOSSIER_DONNEES, "programmes_vus.json"))
        # Historique (V3). Un serveur de test (sans fenêtre) n'enregistre rien, sauf dans la base qu'on lui
        # désigne (--historique FICHIER) : l'historique du PC n'est jamais mêlé aux essais.
        self.historique = None
        if fichier_historique or self.declarer_instance:
            try:
                self.historique = Historique(config, fichier_historique or os.path.join(DOSSIER_DONNEES, "historique.db"))
                self.collecteur.enrichir = self.historique.traiter
            except Exception:
                logging.exception("Historique indisponible")
        self.config_publique = {
            "quartiers": [{k: q[k] for k in ("id", "nom", "couleur")} for q in config["quartiers"]],
            "frequence_collecte_s": config["frequence_collecte_s"],
            "embouteillages": config["embouteillages"],
            "historique_jours": config.get("historique_jours", 7),
            "delabrement_jours": config.get("delabrement_jours", 7),
            "demolition_jours": config["demolition_jours"],
            "autoroutes": config.get("autoroutes", {"seuil_ko_s": 1024, "duree_s": 6}),
            "electricite": config.get("electricite", {"repos_w": 9, "max_w": 60}),
        }
        self._icones = {}  # exécutable -> image (data: URL) ou None
        self._verrou_icones = threading.Lock()
        self.dernier_signe_de_vie = time.monotonic()
        self.navigateur = None
        self.surveiller_navigateur = False
        self.serveur = self._creer_serveur(config["port"], relance["port"] if relance else None)
        self.port = self.serveur.server_address[1]
        self.hotes_autorises = {f"{ADRESSE}:{self.port}", f"localhost:{self.port}"}
        self.url = f"http://{ADRESSE}:{self.port}/?t={self.jeton}"

    def _creer_serveur(self, port, port_impose=None):
        if port_impose:
            # Redémarrage : même port que la fenêtre ouverte, le temps que l'ancien serveur le libère.
            for _ in range(50):
                try:
                    serveur = Serveur((ADRESSE, port_impose), Gestionnaire)
                    serveur.app = self
                    return serveur
                except OSError:
                    time.sleep(0.1)
            raise OSError(f"Port {port_impose} toujours occupé")
        for essai in range(port, port + 20):
            try:
                serveur = Serveur((ADRESSE, essai), Gestionnaire)
                serveur.app = self
                return serveur
            except OSError:
                continue
        raise OSError(f"Aucun port libre entre {port} et {port + 19}")

    def icone(self, id_app):
        """Icône du programme (F23), en image PNG intégrée ; le chemin de l'exécutable reste côté serveur."""
        chemin = self.collecteur.chemins_apps.get(id_app)
        if not chemin:
            return None
        with self._verrou_icones:
            if chemin not in self._icones:
                try:
                    png = icones.icone_png(chemin)
                except OSError:
                    png = None
                self._icones[chemin] = png and "data:image/png;base64," + base64.b64encode(png).decode("ascii")
            return self._icones[chemin]

    def _boucle_collecte(self):
        while True:
            time.sleep(self.config["frequence_collecte_s"])
            try:
                self.collecteur.collecter()
            except Exception:
                logging.exception("Erreur de collecte")

    def _surveiller_fermeture(self):
        delai = self.config["arret_sans_page_s"]
        while True:
            time.sleep(5)
            navigateur_ferme = (
                (self.surveiller_navigateur and self.navigateur.poll() is not None)
                or (self.pid_navigateur and not psutil.pid_exists(self.pid_navigateur))
            )
            sans_page = time.monotonic() - self.dernier_signe_de_vie > delai
            if navigateur_ferme or sans_page:
                self.serveur.shutdown()
                return

    def redemarrer(self):
        """Relance le serveur (code et config.json relus) sans fermer la fenêtre : même port, même jeton."""
        def relancer():
            time.sleep(0.3)  # laisse partir la réponse à la page
            self.serveur.shutdown()
            self.serveur.server_close()
            self.collecteur.registre.sauvegarder()
            if self.historique:
                self.historique.fermer()
            pid =self.navigateur.pid if self.surveiller_navigateur else (self.pid_navigateur or 0)
            arguments = ["--relance", str(self.port), self.jeton, str(pid)]
            if EMPAQUETE:
                # Nouvelle instance indépendante du .exe (sinon elle réutiliserait le dossier
                # temporaire de celle-ci, effacé à sa fermeture).
                commande = [sys.executable] + arguments
                environnement = dict(os.environ, PYINSTALLER_RESET_ENVIRONMENT="1")
            else:
                commande = [sys.executable, os.path.abspath(__file__)] + arguments
                environnement = None
            subprocess.Popen(commande, cwd=DOSSIER, env=environnement,
                             creationflags=subprocess.CREATE_NO_WINDOW)
            os._exit(0)
        threading.Thread(target=relancer, daemon=True).start()

    def demarrer(self):
        if self.declarer_instance:
            with open(FICHIER_INSTANCE, "w", encoding="utf-8") as f:
                json.dump({"port": self.port, "jeton": self.jeton, "pid": os.getpid()}, f)

        threading.Thread(target=self._boucle_collecte, daemon=True).start()
        threading.Thread(target=self.serveur.serve_forever, daemon=True).start()

        if self.avec_fenetre:
            self.navigateur = ouvrir_fenetre(self.url)
            if self.navigateur is not None:
                # Si le navigateur rend la main tout de suite (fenêtre confiée à une instance
                # déjà ouverte), on ne peut pas suivre sa fermeture : on se fie aux signes de vie.
                try:
                    self.navigateur.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.surveiller_navigateur = True
        else:
            print(self.url, flush=True)

        self._surveiller_fermeture()
        self.collecteur.registre.sauvegarder()
        if self.historique:
            self.historique.fermer()
        if self.declarer_instance:
            try:
                os.remove(FICHIER_INSTANCE)
            except OSError:
                pass


def main():
    os.makedirs(DOSSIER_DONNEES, exist_ok=True)
    logging.basicConfig(filename=os.path.join(DOSSIER_DONNEES, "erreurs.log"), level=logging.WARNING,
                        format="%(asctime)s %(levelname)s %(message)s")
    avec_fenetre = "--sans-fenetre" not in sys.argv
    try:
        if "--relance" in sys.argv:
            i = sys.argv.index("--relance")
            port, jeton, pid = sys.argv[i + 1:i + 4]
            relance = {"port": int(port), "jeton": jeton, "pid_navigateur": int(pid) or None}
            Application(charger_config(), avec_fenetre=False, relance=relance).demarrer()
            return
        if avec_fenetre:
            url = instance_existante()
            if url:
                if not montrer_fenetre_existante():
                    ouvrir_fenetre(url)
                return
        historique = sys.argv[sys.argv.index("--historique") + 1] if "--historique" in sys.argv else None
        Application(charger_config(), avec_fenetre, fichier_historique=historique).demarrer()
    except Exception:
        logging.exception("Erreur fatale")
        raise


if __name__ == "__main__":
    main()
