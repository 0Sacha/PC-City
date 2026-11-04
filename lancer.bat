@echo off
rem Lance PC City : le serveur démarre sans console et la ville s'ouvre dans une fenêtre dédiée.
chcp 65001 >nul
if not exist "%~dp0vendor\python\pythonw.exe" (
    echo PC City n'est pas encore installé : lancement de l'installation ^(Internet requis une seule fois^).
    call "%~dp0installer.bat"
    if not exist "%~dp0vendor\python\pythonw.exe" exit /b 1
)
start "" "%~dp0vendor\python\pythonw.exe" "%~dp0serveur.py"
