@echo off
rem Construit dist\PC-City.exe en local (Python et Internet requis la premiere fois).
chcp 65001 >nul
cd /d "%~dp0"
python -m pip install --upgrade pyinstaller psutil==7.2.2 || goto :erreur
python -m PyInstaller serveur.py --onefile --noconsole --name PC-City --icon ville\icone.ico --add-data "ville;ville" --add-data "config.json;." --hidden-import icones --hidden-import collecteur --hidden-import historique --hidden-import registre --hidden-import cache_dns --noconfirm || goto :erreur
echo.
echo PC-City.exe est pret dans le dossier dist\
pause
exit /b 0
:erreur
echo La construction a echoue.
pause
exit /b 1
