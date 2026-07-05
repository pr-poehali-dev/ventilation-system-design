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
REM Source PNG logo 512x512 - build multi-size .ico from it locally
set "ICON_PNG_URL=https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/14e46911-d90d-4bc5-a7c1-8676aa5e350d.png"

REM Full build log so the reason stays if the window closes
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
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js not found - install from nodejs.org
    goto :fail
)
where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python not found - install from python.org
    goto :fail
)
where dotnet >nul 2>nul
if errorlevel 1 (
    echo ERROR: .NET 8 SDK not found - install dotnet 8.0
    goto :fail
)
echo     OK
echo.

REM ---------- Step 1: frontend ----------
echo [1/5] Building frontend (desktop mode)...
cd /d "%ROOT%"
call npm install || goto :fail
REM Run vite via npx so it finds the local binary regardless of launcher name.
call npx --no-install vite build --config vite.config.desktop.ts || goto :fail

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

REM Kill any running server.exe (e.g. from a previous smoke test or app run),
REM otherwise PyInstaller/copy cannot overwrite the locked .exe.
taskkill /F /IM server.exe >nul 2>nul
timeout /t 1 /nobreak >nul

echo     Copying backend functions into core...
set "BF_DST=%CORE_DIR%\backend_functions"
if exist "%BF_DST%" rmdir /S /Q "%BF_DST%"
call :copyfn airflow
call :copyfn rescue-calculator
call :copyfn water-hydraulics
call :copyfn svg-to-pdf
call :copyfn explosion-calculator
call :copyfn aerodynamics

call pip install pyinstaller flask numpy svglib reportlab || goto :fail

REM --- Protect Python core: compile .py -> .pyc, pack only bytecode ---
REM Compile the whole core to .pyc and pack ONLY the bytecode copy,
REM so no .py source ends up inside server.exe. Free, no license needed.
echo     Compiling Python core to bytecode (.pyc)...
set "CORE_OBF=%CS_DIR%\pvs-core-pyc"
if exist "%CORE_OBF%" rmdir /S /Q "%CORE_OBF%"
python "%CS_DIR%\compile_core.py" "%CORE_DIR%" "%CORE_OBF%"
if errorlevel 1 (
    echo ERROR: core compilation failed
    goto :fail
)
if not exist "%CORE_OBF%\server.pyc" (
    echo ERROR: bytecode core not produced - no server.pyc
    goto :fail
)

echo     Packing server.exe from bytecode core...
call pyinstaller --onefile --noconsole --name "server" --add-data "%CORE_OBF%;pvs-core" --hidden-import flask --hidden-import numpy --hidden-import svglib --hidden-import reportlab --collect-all reportlab --collect-all svglib --distpath "%CS_DIR%\dist" --workpath "%CS_DIR%\build" --specpath "%CS_DIR%" server_entry.py || goto :fail

if not exist "%CS_DIR%\dist\server" mkdir "%CS_DIR%\dist\server"
REM Make sure the target is not locked by a running process before copying
taskkill /F /IM server.exe >nul 2>nul
timeout /t 1 /nobreak >nul
copy /Y "%CS_DIR%\dist\server.exe" "%CS_DIR%\dist\server\server.exe" || goto :fail
echo     OK (Python core compiled to bytecode)
echo.

REM ---------- Step 3: icon ----------
echo [3/5] Application icon (pvs.ico)...
REM Clean any old icon variants (including wrong pvs.png) so C# does not
REM pick a broken file and show a blurry icon.
if exist "%CS_DIR%\PvsApp\pvs.ico" del /Q "%CS_DIR%\PvsApp\pvs.ico"
if exist "%CS_DIR%\PvsApp\pvs.png" del /Q "%CS_DIR%\PvsApp\pvs.png"

echo     Downloading source PNG logo...
curl -s -L -o "%CS_DIR%\PvsApp\pvs_src.png" "%ICON_PNG_URL%"

echo     Building multi-size pvs.ico locally (Pillow)...
call pip install pillow >nul 2>nul
python "%CS_DIR%\make_ico.py" "%CS_DIR%\PvsApp\pvs_src.png" "%CS_DIR%\PvsApp\pvs.ico"
if errorlevel 1 (
    echo     Local ICO build failed - trying to download ready .ico...
    curl -s -L -o "%CS_DIR%\PvsApp\pvs.ico" "%ICON_URL%"
)
if exist "%CS_DIR%\PvsApp\pvs_src.png" del /Q "%CS_DIR%\PvsApp\pvs_src.png"

REM Verify it is really an ICO (first bytes 00 00 01 00), not a PNG.
REM Keep the check out of a nested if, else errorlevel is read before powershell.
if not exist "%CS_DIR%\PvsApp\pvs.ico" (
    echo     WARNING: icon build failed - building without it
    goto :icon_done
)
powershell -NoProfile -Command "$b=[IO.File]::ReadAllBytes('%CS_DIR%\PvsApp\pvs.ico'); if($b.Length -gt 4 -and $b[0]-eq0 -and $b[1]-eq0 -and $b[2]-eq1 -and $b[3]-eq0){exit 0}else{exit 1}"
if errorlevel 1 (
    echo     ERROR: pvs.ico is not a valid ICO file
    goto :fail
)
echo     OK - valid multi-size icon
:icon_done
echo.

REM ---------- Step 4: PVS.exe (build -> obfuscate -> publish) ----------
echo [4/5] Building PVS.exe (C#) with obfuscation...
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
REM obfuscar.console does NOT support -var flags: it only accepts the xml path.
REM Generate obfuscar.gen.xml with real paths substituted into the <Var> tags.
set "OBF_IN=%CS_DIR%\PvsApp\%OBF_OUTDIR%"
set "OBF_OUT=%CS_DIR%\PvsApp\%OBF_OUTDIR%\obf"
powershell -NoProfile -Command "(Get-Content -Raw -LiteralPath '%CS_DIR%\PvsApp\obfuscar.xml').Replace('@@INPATH@@', $env:OBF_IN).Replace('@@OUTPATH@@', $env:OBF_OUT) | Set-Content -Encoding UTF8 -LiteralPath '%CS_DIR%\PvsApp\obfuscar.gen.xml'" || goto :fail
"%OBFUSCAR%" "%CS_DIR%\PvsApp\obfuscar.gen.xml" || goto :fail

REM Replace the clean dll with the obfuscated one
copy /Y "%CS_DIR%\PvsApp\%OBF_OUTDIR%\obf\PVS.dll" "%CS_DIR%\PvsApp\%OBF_OUTDIR%\PVS.dll" || goto :fail

REM 4.3 - publish WITHOUT recompiling, so the obfuscated dll is packed as-is
echo     Packing single-file PVS.exe...
call dotnet publish -c Release -r win-x64 --self-contained true --no-build -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "%CS_DIR%\dist" || goto :fail
echo     OK (obfuscated)
echo.

REM ---------- Step 5: smoke test (verify server.exe APIs) ----------
echo [5/5] Smoke test - checking server.exe APIs...
python "%CS_DIR%\smoke_test.py" "%CS_DIR%\dist\server\server.exe"
if errorlevel 1 (
    echo ERROR: smoke test failed - core APIs do not respond.
    echo        The build is broken, do not publish this server.exe.
    goto :fail
)
echo     OK (APIs respond)
echo.

echo Done!
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