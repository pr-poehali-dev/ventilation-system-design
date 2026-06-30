@echo off
echo ===================================================
echo   PV-Sistema Electron Build
echo ===================================================
echo.

cd /d %~dp0..\..
echo Working dir: %CD%
echo.

:: Step 1: Icons
echo [1/4] Checking icons...
if not exist "desktop\electron\icons" mkdir "desktop\electron\icons"
if not exist "desktop\electron\icons\icon.ico" (
  if exist "desktop\tauri\icons\icon.ico" (
    copy "desktop\tauri\icons\icon.ico" "desktop\electron\icons\icon.ico" >nul
    echo     icon.ico copied from desktop\tauri\icons\
  ) else (
    echo     WARNING: icon.ico not found, building without icon
  )
) else (
  echo     icon.ico OK
)

:: Step 2: Python server
echo.
echo [2/4] Building python-server.exe...
cd desktop\server
pip install pyinstaller >nul 2>&1
if exist dist\python-server.exe del /F /Q dist\python-server.exe
pyinstaller --onefile main.py -n python-server --distpath dist --noconfirm
if %errorlevel% neq 0 (
  echo ERROR: Failed to build python-server.exe
  cd ..\..
  pause
  exit /b 1
)
cd ..\..
echo     python-server.exe built OK

:: Step 3: Frontend
echo.
echo [3/4] Building frontend...
call bunx vite build --config vite.config.electron.ts
if %errorlevel% neq 0 (
  echo ERROR: Frontend build failed
  pause
  exit /b 1
)
echo     Frontend built to dist-electron\

:: Step 4: Распаковываем в win-unpacked
echo.
echo [4/4] Packaging (dir only)...
call bunx electron-builder --config desktop/electron/electron-builder.yml --win --x64 --dir
if %errorlevel% neq 0 (
  echo ERROR: Packaging failed
  pause
  exit /b 1
)

:: Step 5: Патчим win-unpacked
set APP=%CD%\dist-installer\win-unpacked\resources\app
set SRC=%CD%\desktop\electron
echo.
echo [5] Patching...
echo     APP = %APP%
echo     SRC = %SRC%

if not exist "%APP%" (
  echo ERROR: app dir not found: %APP%
  pause
  exit /b 1
)

copy /Y "%SRC%\main.cjs" "%APP%\main.cjs" || echo ERROR copying main.cjs
copy /Y "%SRC%\preload.cjs" "%APP%\preload.cjs" || echo ERROR copying preload.cjs

node -e "try{var fs=require('fs'),p=process.argv[1],j=JSON.parse(fs.readFileSync(p,'utf8'));delete j.type;j.main='main.cjs';fs.writeFileSync(p,JSON.stringify(j,null,2),'utf8');console.log('package.json OK');}catch(e){console.error('FAIL:',e.message);process.exit(1);}" "%APP%\package.json"

echo [5] Patch done. Files in app dir:
dir "%APP%\*.cjs" 2>nul || echo     No .cjs files found!

:: Step 6: NSIS из пропатченного win-unpacked
echo.
echo [6] Building NSIS installer...
call bunx electron-builder --config desktop/electron/electron-builder.yml --win nsis --prepackaged "%CD%\dist-installer\win-unpacked"
if %errorlevel% neq 0 (
  echo ERROR: NSIS build failed
  pause
  exit /b 1
)

echo.
echo ===================================================
echo   DONE! Installer: dist-installer\
echo ===================================================
echo.
pause
