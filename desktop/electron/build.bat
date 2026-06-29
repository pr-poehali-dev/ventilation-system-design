@echo off
echo === PV-Sistema: Сборка Electron ===

cd /d %~dp0..\..

echo [1/2] Сборка фронтенда...
call bun run vite build --config vite.config.electron.ts
if %errorlevel% neq 0 (echo ОШИБКА сборки фронтенда & pause & exit /b 1)

echo [2/2] Упаковка в установщик...
call bunx electron-builder --config desktop/electron/electron-builder.yml --win
if %errorlevel% neq 0 (echo ОШИБКА упаковки & pause & exit /b 1)

echo.
echo === Готово! Установщик в папке dist-installer\ ===
pause
