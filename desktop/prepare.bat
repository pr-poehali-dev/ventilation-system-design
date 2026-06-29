@echo off
REM ============================================================
REM ПВ-Система — подготовка к сборке (Windows)
REM Запусти этот файл ОДИН РАЗ перед первой сборкой.
REM Делает: копирование функций + сборка python-server.exe
REM ============================================================
setlocal enabledelayedexpansion

set ROOT=%~dp0..
set SERVER=%~dp0server
set TAURI=%~dp0tauri

echo.
echo ============================================================
echo   ПВ-Система — подготовка к сборке
echo ============================================================

REM ── Шаг 1: Копируем backend-функции ─────────────────────────
echo.
echo [1/4] Копирование backend-функций...
if exist "%SERVER%\functions" rmdir /s /q "%SERVER%\functions"
mkdir "%SERVER%\functions"

for %%f in (aerodynamics airflow rescue-calculator water-hydraulics explosion-calculator svg-to-pdf license) do (
  if exist "%ROOT%\backend\%%f" (
    xcopy /e /i /q "%ROOT%\backend\%%f" "%SERVER%\functions\%%f\" >nul
    echo   OK %%f
  ) else (
    echo   SKIP %%f (не найден)
  )
)

REM ── Шаг 2: Python venv ────────────────────────────────────────
echo.
echo [2/4] Создание Python окружения...
cd /d "%SERVER%"
python -m venv .venv
if errorlevel 1 (
  echo ОШИБКА: Python не найден. Установи Python 3.11+ и добавь в PATH.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
pip install --quiet -r requirements.txt pyinstaller
if errorlevel 1 (
  echo ОШИБКА: Не удалось установить зависимости.
  pause
  exit /b 1
)

REM ── Шаг 3: PyInstaller ───────────────────────────────────────
echo.
echo [3/4] Сборка python-server.exe (может занять 3-7 минут)...
if exist "%TAURI%\binaries" rmdir /s /q "%TAURI%\binaries"
mkdir "%TAURI%\binaries"

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
  --distpath "%TAURI%\binaries" ^
  main.py

call deactivate

if not exist "%TAURI%\binaries\python-server.exe" (
  echo ОШИБКА: python-server.exe не создан. Смотри ошибки выше.
  pause
  exit /b 1
)

REM ── Шаг 4: Переименование ────────────────────────────────────
echo.
echo [4/4] Переименование бинарника...
rename "%TAURI%\binaries\python-server.exe" "python-server-x86_64-pc-windows-msvc.exe"
echo   OK: python-server-x86_64-pc-windows-msvc.exe

echo.
echo ============================================================
echo   Готово! Теперь выполни в корне проекта:
echo.
echo   1. bun run build:desktop
echo   2. cd desktop\tauri
echo   3. cargo tauri build
echo.
echo   Installer будет в:
echo   desktop\tauri\target\release\bundle\nsis\
echo ============================================================
pause
