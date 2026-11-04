# Prépare le dossier vendor\ : Python portable + psutil.
# À lancer une seule fois, avec Internet. Ensuite, PC City fonctionne hors ligne.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$PythonVersion = '3.13.17'
$PythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$PsutilWheel = 'psutil-7.2.2-cp37-abi3-win_amd64.whl'
$PsutilSha256 = 'eb7e81434c8d223ec4a219b5fc1c47d0417b12be7ea866e24fb5ad6e84b3d988'

$Racine = Split-Path -Parent $MyInvocation.MyCommand.Path
$Vendor = Join-Path $Racine 'vendor'
$DossierPython = Join-Path $Vendor 'python'
$Temp = Join-Path $Vendor 'telechargements'

if (Test-Path (Join-Path $DossierPython 'pythonw.exe')) {
    Write-Host 'Python portable déjà présent dans vendor\python.'
} else {
    New-Item -ItemType Directory -Force $Temp | Out-Null
    $Zip = Join-Path $Temp "python-$PythonVersion-embed-amd64.zip"
    Write-Host "Téléchargement de Python $PythonVersion (python.org)..."
    Invoke-WebRequest -UseBasicParsing $PythonUrl -OutFile $Zip
    Expand-Archive -Force $Zip $DossierPython

    $Signature = Get-AuthenticodeSignature (Join-Path $DossierPython 'python.exe')
    if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
        Remove-Item -Recurse -Force $DossierPython
        throw "Signature de python.exe invalide ($($Signature.Status)) : installation annulée."
    }
    Write-Host 'Signature Python Software Foundation vérifiée.'
}

# Le Python portable n'utilise que les chemins listés dans son fichier ._pth :
# on y ajoute site-packages pour qu'il trouve psutil.
$SitePackages = Join-Path $DossierPython 'Lib\site-packages'
$Pth = Get-ChildItem $DossierPython -Filter 'python*._pth' | Select-Object -First 1
$Lignes = Get-Content $Pth.FullName
if ($Lignes -notcontains 'Lib\site-packages') {
    Add-Content -Encoding ascii $Pth.FullName 'Lib\site-packages'
}

if (Test-Path (Join-Path $SitePackages 'psutil')) {
    Write-Host 'psutil déjà présent.'
} else {
    New-Item -ItemType Directory -Force $Temp, $SitePackages | Out-Null
    Write-Host 'Recherche de psutil sur PyPI...'
    $Infos = Invoke-RestMethod 'https://pypi.org/pypi/psutil/7.2.2/json'
    $Fichier = $Infos.urls | Where-Object { $_.filename -eq $PsutilWheel }
    $Whl = Join-Path $Temp "$PsutilWheel.zip"
    Invoke-WebRequest -UseBasicParsing $Fichier.url -OutFile $Whl
    $Hash = (Get-FileHash -Algorithm SHA256 $Whl).Hash.ToLower()
    if ($Hash -ne $PsutilSha256) {
        throw "Empreinte de psutil inattendue ($Hash) : installation annulée."
    }
    Write-Host 'Empreinte SHA-256 de psutil vérifiée.'
    Expand-Archive -Force $Whl $SitePackages
}

if (Test-Path $Temp) { Remove-Item -Recurse -Force $Temp }

& (Join-Path $DossierPython 'python.exe') -c "import psutil; print('psutil', psutil.__version__, 'OK')"
Write-Host 'Installation terminée. Lancez PC City avec lancer.bat.'
