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

REM Полный лог сборки пишем в build.log — если окно закроется, причина останется тут
set "BUILD_LOG=%CS_DIR%\build.log"
echo Build started %DATE% %TIME% > "%BUILD_LOG%"

echo.
echo ============================================================
echo   PV-Sistema - desktop build
echo   Project root: %ROOT%
echo   Log file: %BUILD_LOG%
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

REM --- Protect Python core: compile .py -> .pyc, pack only bytecode ---
REM Without this, PyInstaller-packed sources are plain .py and the
REM calculation formulas (aerodynamics/explosion) are readable.
REM We compile the whole core to .pyc and pack ONLY the bytecode copy,
REM so no .py source ends up inside server.exe. Free, no license needed.
echo     Compiling Python core to bytecode (.pyc)...
set "CORE_OBF=%CS_DIR%\pvs-core-pyc"
if exist "%CORE_OBF%" rmdir /S /Q "%CORE_OBF%"
python "%CS_DIR%\compile_core.py" "%CORE_DIR%" "%CORE_OBF%" 2>>"%BUILD_LOG%"
if errorlevel 1 (
    echo ERROR: core compilation failed - see %BUILD_LOG%
    goto :fail
)
if not exist "%CORE_OBF%\server.pyc" (
    echo ERROR: bytecode core not produced (no server.pyc).
    goto :fail
)

echo     Packing server.exe from bytecode core...
call pyinstaller --onefile --noconsole --name "server" --add-data "%CORE_OBF%;pvs-core" --hidden-import flask --hidden-import numpy --hidden-import cairosvg --distpath "%CS_DIR%\dist" --workpath "%CS_DIR%\build" --specpath "%CS_DIR%" server_entry.py || goto :fail

if not exist "%CS_DIR%\dist\server" mkdir "%CS_DIR%\dist\server"
copy /Y "%CS_DIR%\dist\server.exe" "%CS_DIR%\dist\server\server.exe" || goto :fail
echo     OK (Python core compiled to bytecode)
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

REM ---------- Step 4: PVS.exe (build -> obfuscate -> publish) ----------
echo [4/5] Building PVS.exe ^(C#^) with obfuscation...
cd /d "%CS_DIR%\PvsApp"

set "OBF_OUTDIR=bin\Release\net8.0-windows\win-x64"

REM 4.1 - compile (produces PVS.dll, does NOT pack into single file yet)
echo     Compiling...
call dotnet build -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o "%OBF_OUTDIR%" || goto :fail

REM 4.2 - install Obfuscar tool locally (idempotent) and obfuscate PVS.dll
echo     Installing Obfuscar tool...
call dotnet tool install --tool-path "%CS_DIR%\.tools" Obfuscar.GlobalTool >nul 2>nul
set "OBFUSCAR=%CS_DIR%\.tools\obfuscar.console.exe"
if not exist "%OBFUSCAR%" (
    echo     ERROR: Obfuscar tool not installed. Check internet/nuget access.
    goto :fail
)

echo     Obfuscating PVS.dll...
"%OBFUSCAR%" -var InPath="%CS_DIR%\PvsApp\%OBF_OUTDIR%" -var OutPath="%CS_DIR%\PvsApp\%OBF_OUTDIR%\obf" "%CS_DIR%\PvsApp\obfuscar.xml" || goto :fail

REM Replace the clean dll with the obfuscated one
copy /Y "%CS_DIR%\PvsApp\%OBF_OUTDIR%\obf\PVS.dll" "%CS_DIR%\PvsApp\%OBF_OUTDIR%\PVS.dll" || goto :fail

REM 4.3 - publish WITHOUT recompiling, so the obfuscated dll is packed as-is
echo     Packing single-file PVS.exe...
call dotnet publish -c Release -r win-x64 --self-contained true --no-build -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "%CS_DIR%\dist" || goto :fail
echo     OK (obfuscated)
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