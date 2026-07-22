@echo off
REM Force a stable code page so this .bat is parsed identically on any PC.
REM (This file is pure ASCII - no national characters in commands/comments.)
chcp 65001 >nul 2>nul
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

REM ---------- Build mode ----------
REM Optional arg "noobf" builds PVS.exe WITHOUT obfuscation. Use it to check
REM whether a broken build is caused by obfuscation or by the code itself:
REM     desktop\csharp\build.bat noobf
set "OBFUSCATE=1"
if /i "%~1"=="noobf" set "OBFUSCATE=0"

REM ---------- Read server core version (MANUAL) ----------
REM server.exe (interface + core + backend) updates on the fly by server_version.
REM The core version is set MANUALLY in one place: the file desktop\SERVER_VERSION.
REM No auto-increment: the build takes the number from that file AS IS.
REM To release a new core version, just write a new number (X.Y.Z) into that file
REM before building. IMPORTANT: the number must be GREATER than the previous one,
REM otherwise clients will think their core is already up to date and won't update.
set "SERVER_VERSION_FILE=%ROOT%\desktop\SERVER_VERSION"
if not exist "%SERVER_VERSION_FILE%" echo 1.0.0> "%SERVER_VERSION_FILE%"
for /f "usebackq tokens=* delims=" %%v in (`powershell -NoProfile -Command "$p='%SERVER_VERSION_FILE%'; $v=(Get-Content -Raw $p).Trim(); if($v -notmatch '^\d+\.\d+\.\d+$'){$v='1.0.0'}; Write-Output $v"`) do set "SERVER_VERSION=%%v"
echo     Core (server.exe) version (from SERVER_VERSION): %SERVER_VERSION%

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

REM ---------- Check environment (tools + versions) ----------
echo [0/5] Checking environment...
if "%OBFUSCATE%"=="0" echo     MODE: build WITHOUT obfuscation ^(noobf^)

REM --- Node.js present? ---
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js not found - install LTS from https://nodejs.org
    goto :fail
)
for /f "delims=" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
echo     Node.js: %NODE_VER%

REM --- Python present and a supported version (3.11 / 3.12)? ---
where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python not found - install 3.11 or 3.12 from https://python.org
    echo        During setup tick "Add python.exe to PATH".
    goto :fail
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set "PY_VER=%%v"
echo     Python: %PY_VER%
echo %PY_VER% | findstr /r "^3\.1[12]\." >nul
if errorlevel 1 (
    echo ERROR: Python %PY_VER% is not supported for this build.
    echo        Install Python 3.11 or 3.12 - PyInstaller/numpy wheels must match.
    goto :fail
)

REM --- pip must point to the SAME python (common cross-PC failure) ---
python -m pip --version >nul 2>nul
if errorlevel 1 (
    echo ERROR: pip is not available for this Python.
    echo        Run: python -m ensurepip --upgrade
    goto :fail
)

REM --- .NET SDK present AND version 8.x installed? ---
where dotnet >nul 2>nul
if errorlevel 1 (
    echo ERROR: .NET SDK not found - install .NET 8 SDK from
    echo        https://dotnet.microsoft.com/download/dotnet/8.0
    goto :fail
)
dotnet --list-sdks 2>nul | findstr /r "^8\." >nul
if errorlevel 1 (
    echo ERROR: .NET 8 SDK not found. Installed SDKs:
    dotnet --list-sdks
    echo        Install the .NET 8 SDK ^(not just Runtime^) from
    echo        https://dotnet.microsoft.com/download/dotnet/8.0
    goto :fail
)
echo     .NET 8 SDK: OK
echo.

REM ---------- Check project is copied whole ----------
echo [0/5] Checking project files...
set "VITE_CFG=%ROOT%\vite.config.desktop.ts"
if not exist "%ROOT%\package.json" (
    echo ERROR: package.json not found at %ROOT%
    echo        Copy the WHOLE project ^(webapp root + desktop folder^) to this PC,
    echo        not just the desktop folder.
    goto :fail
)
if not exist "%VITE_CFG%" (
    echo ERROR: vite.config.desktop.ts not found at %VITE_CFG%
    echo        Copy the WHOLE project to this PC, not just the desktop folder.
    goto :fail
)
if not exist "%CORE_DIR%\server.py" if not exist "%CORE_DIR%" (
    echo ERROR: calc core folder missing: %CORE_DIR%
    goto :fail
)
echo     OK
echo.

REM ---------- Step 1: frontend ----------
echo [1/5] Building frontend (desktop mode)...
cd /d "%ROOT%"
call npm install || goto :fail
REM Run vite via npx so it finds the local binary regardless of launcher name.
call npx --no-install vite build --config "%VITE_CFG%" || goto :fail

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

REM Install pinned build deps into the SAME python (python -m pip), so the wheels
REM always match the interpreter regardless of a stray global pip on the machine.
python -m pip install --upgrade pip >nul 2>nul
python -m pip install -r "%CS_DIR%\requirements-build.txt" || goto :fail

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
REM Stamp the core version next to server.exe. C# reads this file at startup and
REM compares it with server_version from the server to decide whether to update.
powershell -NoProfile -Command "Set-Content -NoNewline -Path '%CS_DIR%\dist\server\server_version.txt' -Value '%SERVER_VERSION%'" || goto :fail
echo     OK (Python core compiled to bytecode, version %SERVER_VERSION%)
echo.

REM ---------- Step 3: icon ----------
echo [3/5] Application icon (pvs.ico)...
if exist "%CS_DIR%\PvsApp\pvs.ico" del /Q "%CS_DIR%\PvsApp\pvs.ico"
echo     Downloading fresh icon...
curl -s -o "%CS_DIR%\PvsApp\pvs.ico" "%ICON_URL%"
if exist "%CS_DIR%\PvsApp\pvs.ico" (
    echo     OK
) else (
    echo     Icon download failed - building without it
)

REM Document icon for .vproj files. Prefer regenerating a crisp multi-size .ico
REM from the committed PNG source; fall back to the committed vproj.ico as-is.
echo     Building document icon for .vproj (vproj.ico)...
if exist "%CS_DIR%\PvsApp\vproj_src.png" (
    python "%CS_DIR%\make_ico.py" "%CS_DIR%\PvsApp\vproj_src.png" "%CS_DIR%\PvsApp\vproj.ico"
)
if exist "%CS_DIR%\PvsApp\vproj.ico" (
    echo     OK - vproj.ico ready
) else (
    echo     WARNING: vproj.ico missing - .vproj files will use app icon
)
echo.

REM ---------- Step 4: PVS.exe (build -> obfuscate -> publish) ----------
if "%OBFUSCATE%"=="1" (
    echo [4/5] Building PVS.exe ^(C#^) with obfuscation...
) else (
    echo [4/5] Building PVS.exe ^(C#^) WITHOUT obfuscation ^(noobf mode^)...
)
cd /d "%CS_DIR%\PvsApp"

set "OBF_OUTDIR=bin\Release\net8.0-windows\win-x64"

REM 4.1 - compile (produces PVS.dll, and prepares single-file host).
REM IMPORTANT: keep PublishSingleFile=true HERE too, so the .NET SDK builds the
REM helper singlefilehost.exe into obj\. Step 4.3 runs publish with --no-build
REM and would otherwise fail with "Could not find singlefilehost.exe" on a clean
REM machine (obj\ empty). PVS.dll is still emitted as a plain dll here, so we can
REM obfuscate it before the single-file packing happens in 4.3.
echo     Compiling...
call dotnet build -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o "%OBF_OUTDIR%" || goto :fail

if "%OBFUSCATE%"=="0" goto :publish

REM 4.2 - install Obfuscar tool locally (idempotent) and obfuscate PVS.dll
echo     Installing Obfuscar tool...
REM Do NOT swallow the output: if install fails we must SEE the real reason
REM (no internet, blocked nuget, proxy). The tool is a no-op if already present.
call dotnet tool install --tool-path "%CS_DIR%\.tools" Obfuscar.GlobalTool
set "OBFUSCAR=%CS_DIR%\.tools\obfuscar.console.exe"
if not exist "%OBFUSCAR%" (
    echo     ERROR: Obfuscar tool did not install.
    echo            Likely no internet / blocked nuget.org / proxy on this PC.
    echo            Fix network access, or run WITHOUT obfuscation:
    echo                desktop\csharp\build.bat noobf
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

:publish
REM 4.3 - publish WITHOUT recompiling, so the (obfuscated) dll is packed as-is
echo     Packing single-file PVS.exe...
call dotnet publish -c Release -r win-x64 --self-contained true --no-build -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "%CS_DIR%\dist" || goto :fail
if "%OBFUSCATE%"=="1" ( echo     OK ^(obfuscated^) ) else ( echo     OK ^(NOT obfuscated^) )
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
echo     server\server.exe   (core version %SERVER_VERSION%)
echo   Run: PVS.exe
echo ------------------------------------------------------------
echo   TO DELIVER THIS UPDATE TO USERS:
echo     1) Upload  dist\server\server.exe  to poehali.dev storage
echo     2) In Admin panel -^> Update -^> publish server.exe
echo        and set server_version = %SERVER_VERSION%
echo   (Without this step clients keep the old core.)
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