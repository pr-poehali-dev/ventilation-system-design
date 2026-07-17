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

REM ---------- Auto-bump server core version ----------
REM server.exe (interface + core + backend) updates on the fly by server_version.
REM Each build must be NEWER than the previous one, otherwise clients think they
REM are already up to date and never download the fresh server.exe.
REM We read desktop\SERVER_VERSION (X.Y.Z), increment the last number, save it
REM back, and later write it next to server.exe as server_version.txt.
set "SERVER_VERSION_FILE=%ROOT%\desktop\SERVER_VERSION"
if not exist "%SERVER_VERSION_FILE%" echo 1.0.0> "%SERVER_VERSION_FILE%"
for /f "usebackq tokens=* delims=" %%v in (`powershell -NoProfile -Command "$p='%SERVER_VERSION_FILE%'; $v=(Get-Content -Raw $p).Trim(); if($v -notmatch '^\d+\.\d+\.\d+$'){$v='1.0.0'}; $a=$v.Split('.'); $a[2]=[int]$a[2]+1; $n=$a -join '.'; Set-Content -NoNewline -Path $p -Value $n; Write-Output $n"`) do set "SERVER_VERSION=%%v"
echo     Core (server.exe) version bumped to: %SERVER_VERSION%

REM ---------- Auto-commit the bumped SERVER_VERSION ----------
REM Persist the new number into git right away, so the next build starts from it
REM and never re-uses the same version (the cause of clients not updating).
git -C "%ROOT%" rev-parse --is-inside-work-tree >nul 2>&1
if not errorlevel 1 (
  git -C "%ROOT%" add "%SERVER_VERSION_FILE%" >nul 2>&1
  git -C "%ROOT%" commit -m "build: bump server core version to %SERVER_VERSION%" -- "%SERVER_VERSION_FILE%" >nul 2>&1
  if not errorlevel 1 (
    echo     SERVER_VERSION committed to git: %SERVER_VERSION%
  ) else (
    echo     SERVER_VERSION unchanged in git ^(nothing to commit^)
  )
) else (
  echo     WARNING: not a git repo, SERVER_VERSION not committed - commit it manually!
)

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