@echo off
chcp 65001 >nul
echo ===================================================
echo   PV-Sistema — Сборка Electron-приложения
echo ===================================================
echo.

cd /d %~dp0..\..

echo [1/3] Проверка иконок...
if not exist "desktop\electron\icons\icon.ico" (
  echo ПРЕДУПРЕЖДЕНИЕ: desktop\electron\icons\icon.ico не найден
  echo Создайте иконку или скопируйте из desktop\tauri\
  echo Продолжаем без иконки...
)

echo [2/3] Сборка фронтенда...
call bunx vite build --config vite.config.electron.ts
if %errorlevel% neq 0 (
  echo.
  echo ОШИБКА: Сборка фронтенда завершилась с ошибкой
  pause
  exit /b 1
)
echo Фронтенд собран в dist-electron\

echo.
echo [3/3] Упаковка в установщик Windows...
call bunx electron-builder --config desktop/electron/electron-builder.yml --win --x64
if %errorlevel% neq 0 (
  echo.
  echo ОШИБКА: Упаковка завершилась с ошибкой
  pause
  exit /b 1
)

echo.
echo ===================================================
echo   ГОТОВО! Установщик находится в папке:
echo   dist-installer\
echo ===================================================
echo.
pause
