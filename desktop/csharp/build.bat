@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  PV-Sistema desktop build (PVS.exe)
REM  Run by double-click or from command line:
REM      desktop\csharp\build.bat
REM  Script finds project root by itself.
REM ============================================================

REM Project root = two levels up from this bat (desktop\csharp\ -> root)
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%\..\.."
set "ROOT=%CD%"
popd

set "CS_DIR=%ROOT%\desktop\csharp"
set "CORE_DIR=%ROOT%\desktop\pywebview\pvs-core"
set "ICON_URL=https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/icons/desktop-icon.ico"

echo.
echo ============================================================
echo   PV-Sistema - desktop build
echo   Project root: %ROOT%
echo ============================================================
echo.

REM ---------- Check environment ----------
echo [0/5] Checking environment...
where node >nul 2>nul || (echo ERROR: Node.js not found - https://nodejs.org & goto :fail)
where python >nul 2>nul || (echo ERROR: Python not found - https://python.org & goto :fail)
where dotnet >nul 2>nul || (echo ERROR: .NET 8 SDK not found - https://dotnet.microsoft.com/download/dotnet/8.0 & goto :fail)
echo     OK
echo.

REM ---------- Step 1: frontend ----------
echo [1/5] Building frontend (desktop mode)...
cd /d "%ROOT%"
call npm install || goto :fail
REM Local vite (rolldown-vite). On Windows the launcher is vite.cmd
if exist "%ROOT%\node_modules\.bin\vite.cmd" (
    call "%ROOT%\node_modules\.bin\vite.cmd" build --config vite.config.desktop.ts || goto :fail
) else (
    call "%ROOT%\node_modules\.bin\vite" build --config vite.config.desktop.ts || goto :fail
)

echo     Copying frontend into calc core...
if exist "%CORE_DIR%\dist" rmdir /S /Q "%CORE_DIR%\dist"
xcopy /E /I /Y "%ROOT%\dist-desktop" "%CORE_DIR%\dist" || goto :fail

if not exist "%CORE_DIR%\dist\index.html" (
    echo ERROR: frontend build failed - no index.html
    goto :fail
)
echo     OK
echo.

REM ---------- Step 2: calc core (server.exe) ----------
echo [2/5] Building calc core server.exe...
cd /d "%CS_DIR%"

echo     Copying backend functions into core...
set "BF_DST=%CORE_DIR%\backend_functions"
if exist "%BF_DST%" rmdir /S /Q "%BF_DST%"
call :copyfn airflow
call :copyfn rescue-calculator
call :copyfn water-hydraulics
call :copyfn svg-to-pdf
call :copyfn explosion-calculator
call :copyfn aerodynamics

call pip install pyinstaller flask numpy cairosvg || goto :fail
call pyinstaller --onefile --noconsole --name "server" --add-data "..\pywebview\pvs-core;pvs-core" --hidden-import flask --hidden-import numpy --hidden-import cairosvg --distpath "%CS_DIR%\dist" --workpath "%CS_DIR%\build" --specpath "%CS_DIR%" server_entry.py || goto :fail

if not exist "%CS_DIR%\dist\server" mkdir "%CS_DIR%\dist\server"
copy /Y "%CS_DIR%\dist\server.exe" "%CS_DIR%\dist\server\server.exe" || goto :fail
echo     OK
echo.

REM ---------- Step 3: icon ----------
echo [3/5] Application icon (pvs.ico)...
REM Always re-download the fresh multi-size icon (16..256) so the app
REM never ends up with an old blurry file cached in the project.
if exist "%CS_DIR%\PvsApp\pvs.ico" del /Q "%CS_DIR%\PvsApp\pvs.ico"
echo     Downloading fresh icon...
curl -s -o "%CS_DIR%\PvsApp\pvs.ico" "%ICON_URL%"
if exist "%CS_DIR%\PvsApp\pvs.ico" (echo     OK) else (echo     Icon download failed - building without it)
echo.

REM ---------- Step 4: PVS.exe ----------
echo [4/5] Building PVS.exe ^(C#^)...
cd /d "%CS_DIR%\PvsApp"
call dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "%CS_DIR%\dist" || goto :fail
echo     OK
echo.

REM ---------- Step 5: done ----------
echo [5/5] Done!
echo.
echo ============================================================
echo   Build finished successfully.
echo   User folder: %CS_DIR%\dist
echo     PVS.exe
echo     server\server.exe
echo   Run: PVS.exe
echo ============================================================
echo.
pause
exit /b 0

REM ---------- helper: copy one backend function ----------
:copyfn
if exist "%ROOT%\backend\%~1\index.py" (
    mkdir "%BF_DST%\%~1" 2>nul
    copy /Y "%ROOT%\backend\%~1\index.py" "%BF_DST%\%~1\index.py" >nul
    echo     + %~1
)
exit /b 0

:fail
echo.
echo ============================================================
echo   BUILD ABORTED - error on one of the steps.
echo   Read the message above and fix the cause.
echo ============================================================
echo.
pause
exit /b 1