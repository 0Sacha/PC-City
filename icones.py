"""Icône réelle d'un programme (F23), extraite de son exécutable et convertie en PNG.

Tout se fait localement avec les fonctions de Windows : aucune bibliothèque d'image.
Les applications du Microsoft Store n'ont souvent pas d'icône dans leur exécutable :
on prend alors le logo déclaré dans leur manifeste.
"""

import ctypes
import glob
import os
import re
import struct
import zlib
from ctypes import wintypes as w

_shell32 = ctypes.WinDLL("shell32")
_user32 = ctypes.WinDLL("user32")
_gdi32 = ctypes.WinDLL("gdi32")
_ole32 = ctypes.WinDLL("ole32")

TAILLE = 64  # nette sur un écran à haute densité, affichée en 32 px


class _InfoIcone(ctypes.Structure):
    _fields_ = [("fIcon", w.BOOL), ("xHotspot", w.DWORD), ("yHotspot", w.DWORD),
                ("hbmMask", w.HANDLE), ("hbmColor", w.HANDLE)]


class _Bitmap(ctypes.Structure):
    _fields_ = [("bmType", w.LONG), ("bmWidth", w.LONG), ("bmHeight", w.LONG), ("bmWidthBytes", w.LONG),
                ("bmPlanes", w.WORD), ("bmBitsPixel", w.WORD), ("bmBits", ctypes.c_void_p)]


class _EnteteBitmap(ctypes.Structure):
    _fields_ = [("biSize", w.DWORD), ("biWidth", w.LONG), ("biHeight", w.LONG), ("biPlanes", w.WORD),
                ("biBitCount", w.WORD), ("biCompression", w.DWORD), ("biSizeImage", w.DWORD),
                ("biXPelsPerMeter", w.LONG), ("biYPelsPerMeter", w.LONG), ("biClrUsed", w.DWORD),
                ("biClrImportant", w.DWORD), ("couleurs", w.DWORD * 3)]


_shell32.SHDefExtractIconW.argtypes = [w.LPCWSTR, ctypes.c_int, w.UINT, ctypes.POINTER(w.HANDLE),
                                       ctypes.POINTER(w.HANDLE), w.UINT]
_user32.GetIconInfo.argtypes = [w.HANDLE, ctypes.POINTER(_InfoIcone)]
_user32.DestroyIcon.argtypes = [w.HANDLE]
_user32.GetDC.argtypes = [w.HWND]
_user32.GetDC.restype = w.HANDLE
_user32.ReleaseDC.argtypes = [w.HWND, w.HANDLE]
_gdi32.GetObjectW.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p]
_gdi32.GetDIBits.argtypes = [w.HANDLE, w.HANDLE, w.UINT, w.UINT, ctypes.c_void_p,
                             ctypes.POINTER(_EnteteBitmap), w.UINT]
_gdi32.DeleteObject.argtypes = [w.HANDLE]
_ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, w.DWORD]


def _pixels(dc, bitmap, largeur, hauteur):
    """Pixels BGRA d'un bitmap, de haut en bas."""
    entete = _EnteteBitmap(biSize=40, biWidth=largeur, biHeight=-hauteur, biPlanes=1, biBitCount=32)
    tampon = ctypes.create_string_buffer(largeur * hauteur * 4)
    if not _gdi32.GetDIBits(dc, bitmap, 0, hauteur, tampon, ctypes.byref(entete), 0):
        return None
    return bytearray(tampon.raw)


def _png(largeur, hauteur, rgba):
    def bloc(type_, donnees):
        return (struct.pack(">I", len(donnees)) + type_ + donnees
                + struct.pack(">I", zlib.crc32(type_ + donnees) & 0xFFFFFFFF))
    ligne = largeur * 4
    brut = b"".join(b"\x00" + bytes(rgba[y * ligne:(y + 1) * ligne]) for y in range(hauteur))
    return (b"\x89PNG\r\n\x1a\n"
            + bloc(b"IHDR", struct.pack(">IIBBBBB", largeur, hauteur, 8, 6, 0, 0, 0))
            + bloc(b"IDAT", zlib.compress(brut, 9))
            + bloc(b"IEND", b""))


def _icone_vers_png(icone):
    info = _InfoIcone()
    if not _user32.GetIconInfo(icone, ctypes.byref(info)):
        return None
    dc = _user32.GetDC(None)
    try:
        if not info.hbmColor:
            return None  # icône monochrome, rare : on garde la pastille du quartier
        bitmap = _Bitmap()
        _gdi32.GetObjectW(info.hbmColor, ctypes.sizeof(bitmap), ctypes.byref(bitmap))
        largeur, hauteur = bitmap.bmWidth, bitmap.bmHeight
        bgra = _pixels(dc, info.hbmColor, largeur, hauteur)
        if bgra is None:
            return None
        # Les icônes anciennes n'ont pas de couche alpha : la transparence vient alors du masque.
        if not any(bgra[3::4]):
            masque = _pixels(dc, info.hbmMask, largeur, hauteur) if info.hbmMask else None
            for i in range(3, len(bgra), 4):
                bgra[i] = 0 if masque and masque[i - 3] else 255
        bgra[0::4], bgra[2::4] = bgra[2::4], bgra[0::4]
        return _png(largeur, hauteur, bgra)
    finally:
        _user32.ReleaseDC(None, dc)
        for bitmap in (info.hbmColor, info.hbmMask):
            if bitmap:
                _gdi32.DeleteObject(bitmap)


def _logo_du_store(chemin):
    """Logo d'une application du Microsoft Store (fichier PNG de son paquet), ou None."""
    morceaux = os.path.normpath(chemin).split(os.sep)
    rang = next((i for i, m in enumerate(morceaux) if m.lower() == "windowsapps"), None)
    if rang is None or rang + 1 >= len(morceaux) - 1:
        return None
    paquet = os.sep.join(morceaux[:rang + 2])
    try:
        with open(os.path.join(paquet, "AppxManifest.xml"), encoding="utf-8", errors="replace") as f:
            manifeste = f.read()
    except OSError:
        return None
    logo = re.search(r'Square44x44Logo="([^"]+)"', manifeste) or re.search(r"<Logo>([^<]+)</Logo>", manifeste)
    if not logo:
        return None
    # Windows range plusieurs tailles à côté du nom déclaré : Logo.targetsize-64.png, Logo.scale-200.png…
    base, extension = os.path.splitext(os.path.join(paquet, logo.group(1).replace("\\", os.sep)))

    def taille(fichier):
        trouve = re.search(r"targetsize-(\d+)", fichier) or re.search(r"scale-(\d+)", fichier)
        n = int(trouve.group(1)) if trouve else 0
        if "scale-" in fichier:
            n = n * 44 // 100
        # Plus proche de 64 px ; la version sans fond de couleur (« unplated ») passe avant.
        return (abs(n - TAILLE), "unplated" not in fichier, "contrast" in fichier)

    candidats = sorted(glob.glob(glob.escape(base) + "*" + extension), key=taille)
    for fichier in candidats:
        if "contrast" in fichier:
            continue
        try:
            with open(fichier, "rb") as f:
                return f.read()
        except OSError:
            continue
    return None


def icone_png(chemin):
    """PNG de l'icône de l'exécutable, ou None (la page garde alors la pastille du quartier)."""
    _ole32.CoInitializeEx(None, 0x2)  # requis par le shell dans chaque fil d'exécution
    icone = w.HANDLE()
    if _shell32.SHDefExtractIconW(chemin, 0, 0, ctypes.byref(icone), None, TAILLE) != 0 or not icone:
        return _logo_du_store(chemin)
    try:
        return _icone_vers_png(icone)
    finally:
        _user32.DestroyIcon(icone)
