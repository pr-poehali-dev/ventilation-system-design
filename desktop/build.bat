@echo off
REM =============================================================================
REM ПВ-Система Desktop — скрипт сборки (Windows)
REM =============================================================================
REM Требования:
REM   - Node.js / bun  (https://bun.sh)
REM   - Python 3.11+   (https://python.org) — добавить в PATH
REM   - Rust + cargo   (https://rustup.rs)
REM   - tauri-cli:     cargo install tauri-cli --version "^2"
REM   - PyInstaller:   pip install pyinstaller
REM   - Visual Studio Build Tools (для Rust)
REM =============================================================================
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..
set SERVER_DIR=%SCRIPT_DIR%server
set FUNCTIONS_DIR=%SERVER_DIR%\functions
set TAURI_DIR=%SCRIPT_DIR%tauri

echo.
echo ============================================
echo   ПВ-Система Desktop — сборка (Windows)
echo ============================================
echo.

REM ── Шаг 1: Копируем backend-функции ─────────────────────────────────────────
echo [1/5] Копирование backend-функций...
if exist "%FUNCTIONS_DIR%" rmdir /s /q "%FUNCTIONS_DIR%"
mkdir "%FUNCTIONS_DIR%"

for %%f in (aerodynamics airflow rescue-calculator water-hydraulics explosion-calculator svg-to-pdf license) do (
  if exist "%ROOT_DIR%\backend\%%f" (
    xcopy /e /i /q "%ROOT_DIR%\backend\%%f" "%FUNCTIONS_DIR%\%%f\" >nul
    echo   OK: %%f
  ) else (
    echo   SKIP: %%f - не найден
  )
)

REM ── Шаг 2: Python venv + PyInstaller ────────────────────────────────────────
echo.
echo [2/5] Сборка Python-сервера...
cd /d "%SERVER_DIR%"

python -m venv .venv
call .venv\Scripts\activate.bat
pip install --quiet -r requirements.txt pyinstaller

pyinstaller ^
  --onefile ^
  --name python-server ^
  --add-data "functions;functions" ^
  --add-data "integrity.py;." ^
  --add-data "machine_id.py;." ^
  --hidden-import numpy ^
  --hidden-import cairosvg ^
  --hidden-import psycopg2 ^
  --hidden-import uuid ^
  --hidden-import socket ^
  --hidden-import subprocess ^
  --noconsole ^
  --distpath "%TAURI_DIR%\binaries" ^
  main.py

call deactivate

REM Tauri sidecar требует суффикс тройки платформы
set TRIPLE=x86_64-pc-windows-msvc
if exist "%TAURI_DIR%\binaries\python-server.exe" (
  rename "%TAURI_DIR%\binaries\python-server.exe" "python-server-%TRIPLE%.exe"
  echo   OK: python-server-%TRIPLE%.exe
)

REM ── Шаг 3: Фронтенд ─────────────────────────────────────────────────────────
echo.
echo [3/5] Сборка фронтенда...
cd /d "%ROOT_DIR%"
call bun run build:desktop
echo   OK: dist-desktop\

REM ── Шаг 4: Tauri ────────────────────────────────────────────────────────────
echo.
echo [4/5] Сборка Tauri...
cd /d "%TAURI_DIR%"
cargo tauri build
echo   OK: Tauri сборка завершена

REM ── Шаг 5: Итог ─────────────────────────────────────────────────────────────
echo.
echo [5/5] Готово!
echo   Installer: %TAURI_DIR%\target\release\bundle\
echo.
echo ============================================
pause