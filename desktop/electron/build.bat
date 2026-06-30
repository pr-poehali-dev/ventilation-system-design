@echo off
chcp 65001 >nul
echo ===================================================
echo   PV-Sistema — Сборка Electron-приложения
echo ===================================================
echo.

cd /d %~dp0..\..
echo Рабочая папка: %CD%
echo.

:: ── Шаг 1: Иконка ────────────────────────────────────────────────────────────
echo [1/4] Проверка иконки...
if not exist "desktop\electron\icons" mkdir "desktop\electron\icons"

if not exist "desktop\electron\icons\icon.ico" (
  if exist "desktop\tauri\icons\icon.ico" (
    copy "desktop\tauri\icons\icon.ico" "desktop\electron\icons\icon.ico" >nul
    echo     Иконка скопирована из desktop\tauri\icons\
  ) else (
    echo     ВНИМАНИЕ: icon.ico не найден, продолжаем без иконки
  )
) else (
  echo     Иконка OK
)

:: ── Шаг 2: Python-сервер ─────────────────────────────────────────────────────
echo.
echo [2/4] Проверка Python-сервера...
if not exist "desktop\server\dist\python-server.exe" (
  echo     python-server.exe не найден — собираем...
  cd desktop\server
  pip install pyinstaller >nul 2>&1
  pyinstaller --onefile main.py -n python-server --distpath dist
  if %errorlevel% neq 0 (
    echo ОШИБКА: Не удалось собрать python-server.exe
    cd ..\..
    pause
    exit /b 1
  )
  cd ..\..
  echo     python-server.exe собран успешно
) else (
  echo     python-server.exe OK — %CD%\desktop\server\dist\python-server.exe
)

:: ── Шаг 3: Фронтенд ──────────────────────────────────────────────────────────
echo.
echo [3/4] Сборка фронтенда (React)...
call bunx vite build --config vite.config.electron.ts
if %errorlevel% neq 0 (
  echo.
  echo ОШИБКА: Сборка фронтенда завершилась с ошибкой
  pause
  exit /b 1
)
echo     Фронтенд собран в dist-electron\

:: ── Шаг 4: Установщик ────────────────────────────────────────────────────────
echo.
echo [4/4] Создание установщика Windows...
call bunx electron-builder --config desktop/electron/electron-builder.yml --win --x64
if %errorlevel% neq 0 (
  echo.
  echo ОШИБКА: Упаковка завершилась с ошибкой
  pause
  exit /b 1
)

echo.
echo ===================================================
echo   ГОТОВО!
echo   Установщик: dist-installer\PV-Sistema Setup 1.0.0.exe
echo ===================================================
echo.
pause
