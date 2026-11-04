"""Noms des sites contactés (F21), lus dans le cache DNS de Windows.

PC City n'envoie aucune requête DNS (§7.3 du CDC) : il lit le cache que Windows a déjà
constitué pour les autres programmes, avec l'outil intégré « ipconfig /displaydns »
(lecture locale, environ 30 ms). Les fonctions d'interrogation du cache par nom
ne voient qu'une partie des entrées sous Windows 11, d'où ce choix.

La sortie d'ipconfig est traduite selon la langue de Windows : on n'y lit que des
éléments qui ne dépendent pas de la langue (noms d'entrée, adresses IP, mot « CNAME »).
"""

import ipaddress
import os
import subprocess

# Chemin complet : on n'exécute jamais un « ipconfig » trouvé ailleurs dans le PATH.
_IPCONFIG = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "ipconfig.exe")


def _adresse(texte):
    try:
        return ipaddress.ip_address(texte.split("%", 1)[0])
    except ValueError:
        return None


def lire_cache():
    """{adresse IP: (nom du site, nom technique ?)} d'après le cache DNS de Windows.

    Le nom retenu est celui que le programme a demandé (www.exemple.fr), même si l'adresse
    vient d'un alias (exemple.cdn-hebergeur.net). « nom technique » : nom qui n'est lui-même
    que la cible d'un alias, à ne pas préférer à un nom demandé.
    """
    try:
        sortie = subprocess.run(
            [_IPCONFIG, "/displaydns"], capture_output=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ).stdout.decode("oem", errors="replace")
    except (OSError, subprocess.SubprocessError):
        return {}

    lignes = [ligne.strip() for ligne in sortie.splitlines()]
    blocs = []          # (nom de l'entrée, [adresses])
    cibles_alias = set()
    for i, ligne in enumerate(lignes):
        # Chaque entrée commence par son nom, souligné d'une ligne de tirets.
        if ligne.startswith("-----") and i > 0 and lignes[i - 1]:
            blocs.append((lignes[i - 1].lower(), []))
            continue
        if not blocs or ":" not in ligne:
            continue
        libelle, _, valeur = ligne.partition(" : ")
        valeur = valeur.strip()
        if not valeur:
            continue
        if "CNAME" in libelle.upper():
            cibles_alias.add(valeur.lower())
            continue
        adresse = _adresse(valeur)
        if adresse is not None:
            blocs[-1][1].append(normaliser_ip(str(adresse)))

    correspondances = {}
    for nom, adresses in sorted(blocs, key=lambda b: b[0] in cibles_alias):
        for ip in adresses:
            correspondances.setdefault(ip, (nom, nom in cibles_alias))
    return correspondances


def normaliser_ip(ip):
    """Adresse IPv4 « déguisée » en IPv6 (::ffff:1.2.3.4) ramenée à sa forme IPv4."""
    adresse = _adresse(ip)
    if adresse is None:
        return ip
    if adresse.version == 6 and adresse.ipv4_mapped:
        return str(adresse.ipv4_mapped)
    return str(adresse)


def nature(ip):
    """'local' (ce PC), 'lan' (réseau local) ou 'internet'."""
    adresse = _adresse(ip)
    if adresse is None:
        return "internet"
    if adresse.is_loopback or adresse.is_unspecified:
        return "local"
    if adresse.is_private or adresse.is_link_local:
        return "lan"
    return "internet"
