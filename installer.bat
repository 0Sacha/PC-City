@echo off
rem Prépare PC City (une seule fois, avec Internet).
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer.ps1"
pause
