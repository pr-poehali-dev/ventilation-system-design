@echo off
echo ============================================
echo  PVS - Sborka desktop .exe
echo ============================================
echo.

cd /d %~dp0

REM --- Shag 1: React build ---
echo [1/4] Sborka React...
cd ..\..
call bun install
if errorlevel 1 (echo OSHIBKA: bun install && pause && exit /b 1)
call bun run build
if errorlevel 1 (echo OSHIBKA: bun run build && pause && exit /b 1)
cd desktop\pywebview
echo.

REM --- Shag 2: Python zavisimosti ---
echo [2/4] Ustanovka Python-zavisimostey...
pip install -r pvs-core\requirements.txt
if errorlevel 1 (echo OSHIBKA: pip install && pause && exit /b 1)
echo.

REM --- Shag 3: Kopirovaniye dist ---
echo [3/4] Kopirovaniye bilda v pvs-core...
if exist pvs-core\dist rmdir /s /q pvs-core\dist
xcopy /E /I /Q ..\..\dist pvs-core\dist
echo.

REM --- Shag 4: PyInstaller ---
echo [4/4] Sborka .exe...
pyinstaller --onefile --windowed --name "PVS" --add-data "pvs-core;pvs-core" --hidden-import flask --hidden-import webview --hidden-import numpy desktop_app.py
if errorlevel 1 (echo OSHIBKA: PyInstaller && pause && exit /b 1)

echo.
echo ============================================
echo  GOTOVO! Fayl: dist\PVS.exe
echo ============================================
pause