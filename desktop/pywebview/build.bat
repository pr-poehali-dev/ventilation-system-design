@echo off
chcp 65001 >nul
echo ============================================
echo  ПВС-Система — Сборка десктопного .exe
echo ============================================
echo.

cd /d %~dp0

REM --- Шаг 1: Собираем React-билд ---
echo [1/4] Сборка React-интерфейса...
cd ..\..
call npm install
call npm run build
cd desktop\pywebview
echo.

REM --- Шаг 2: Устанавливаем Python-зависимости ---
echo [2/4] Установка Python-зависимостей...
pip install -r pvs-core\requirements.txt
echo.

REM --- Шаг 3: Копируем dist в pvs-core ---
echo [3/4] Копирование билда в pvs-core...
if exist pvs-core\dist rmdir /s /q pvs-core\dist
xcopy /E /I /Q ..\..\dist pvs-core\dist
echo.

REM --- Шаг 4: Сборка .exe через PyInstaller ---
echo [4/4] Сборка .exe...
pyinstaller ^
  --onefile ^
  --windowed ^
  --name "PVS" ^
  --add-data "pvs-core;pvs-core" ^
  --hidden-import flask ^
  --hidden-import webview ^
  --hidden-import numpy ^
  desktop_app.py

echo.
echo ============================================
echo  ГОТОВО! Файл: dist\PVS.exe
echo ============================================
pause
