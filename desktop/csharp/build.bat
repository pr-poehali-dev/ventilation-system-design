@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM  Сборка десктопного приложения ПВ-Система (PVS.exe)
REM  Запускать двойным кликом или из командной строки:
REM      desktop\csharp\build.bat
REM  Файл сам находит корень проекта — путь менять не нужно.
REM ============================================================

REM Корень проекта = на два уровня выше этого bat (desktop\csharp\ -> корень)
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%\..\.."
set "ROOT=%CD%"
popd

set "CS_DIR=%ROOT%\desktop\csharp"
set "CORE_DIR=%ROOT%\desktop\pywebview\pvs-core"
set "ICON_URL=https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/icons/desktop-icon.ico"

echo.
echo ============================================================
echo   ПВ-Система — сборка десктопной программы
echo   Корень проекта: %ROOT%
echo ============================================================
echo.

REM ---------- Проверка окружения ----------
echo [0/5] Проверка окружения...
where node >nul 2>nul || (echo ОШИБКА: не найден Node.js ^(https://nodejs.org^) & goto :fail)
where python >nul 2>nul || (echo ОШИБКА: не найден Python ^(https://python.org^) & goto :fail)
where dotnet >nul 2>nul || (echo ОШИБКА: не найден .NET 8 SDK ^(https://dotnet.microsoft.com/download/dotnet/8.0^) & goto :fail)
echo     OK
echo.

REM ---------- Шаг 1: интерфейс ----------
echo [1/5] Сборка интерфейса (desktop-режим)...
cd /d "%ROOT%"
call npm install || goto :fail
call "%ROOT%\node_modules\.bin\vite" build --config vite.config.desktop.ts || goto :fail

echo     Перенос интерфейса в расчётное ядро...
if exist "%CORE_DIR%\dist" rmdir /S /Q "%CORE_DIR%\dist"
xcopy /E /I /Y "%ROOT%\dist-desktop" "%CORE_DIR%\dist" || goto :fail

if not exist "%CORE_DIR%\dist\index.html" (
    echo ОШИБКА: интерфейс не собрался ^(нет index.html^)
    goto :fail
)
echo     OK
echo.

REM ---------- Шаг 2: расчётное ядро ----------
echo [2/5] Сборка расчётного ядра server.exe...
cd /d "%CS_DIR%"
call pip install pyinstaller flask numpy || goto :fail
call pyinstaller --onefile --noconsole --name "server" ^
  --add-data "..\pywebview\pvs-core;pvs-core" ^
  --hidden-import flask ^
  --hidden-import numpy ^
  --distpath "%CS_DIR%\dist" ^
  --workpath "%CS_DIR%\build" ^
  --specpath "%CS_DIR%" ^
  server_entry.py || goto :fail

if not exist "%CS_DIR%\dist\server" mkdir "%CS_DIR%\dist\server"
copy /Y "%CS_DIR%\dist\server.exe" "%CS_DIR%\dist\server\server.exe" || goto :fail
echo     OK
echo.

REM ---------- Шаг 3: иконка ----------
echo [3/5] Иконка приложения (pvs.ico)...
if exist "%CS_DIR%\PvsApp\pvs.ico" (
    echo     Иконка уже есть — пропускаю
) else (
    echo     Скачиваю иконку...
    curl -s -o "%CS_DIR%\PvsApp\pvs.ico" "%ICON_URL%"
    if exist "%CS_DIR%\PvsApp\pvs.ico" (echo     OK) else (echo     Иконку скачать не удалось — соберём без неё)
)
echo.

REM ---------- Шаг 4: PVS.exe ----------
echo [4/5] Сборка PVS.exe (C#)...
cd /d "%CS_DIR%\PvsApp"
call dotnet publish -c Release -r win-x64 --self-contained true ^
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true ^
  -o "%CS_DIR%\dist" || goto :fail
echo     OK
echo.

REM ---------- Шаг 5: готово ----------
echo [5/5] Готово!
echo.
echo ============================================================
echo   Сборка завершена успешно.
echo   Папка для пользователя: %CS_DIR%\dist
echo     PVS.exe
echo     server\server.exe
echo   Запускать: PVS.exe
echo ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo ============================================================
echo   СБОРКА ПРЕРВАНА — произошла ошибка на одном из шагов.
echo   Прочитай сообщение выше и исправь причину.
echo ============================================================
echo.
pause
exit /b 1
