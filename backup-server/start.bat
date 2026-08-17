@echo off
chcp 65001 >nul
title ПВ-Система — аварийный расчётный сервер

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Не найден Python. Установите Python 3.11 с python.org
  echo При установке отметьте галочку "Add python.exe to PATH"
  pause
  exit /b 1
)

if not exist ".venv" (
  echo Первый запуск: создаю окружение...
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  pip install -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)

echo.
echo Запуск сервера. Не закрывайте это окно.
echo.
python server.py --port 8800
pause
