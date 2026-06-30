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

:: Step 2: Python server (always rebuild to pick up latest code)
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

:: Step 4: Installer
echo.
echo [4/4] Building Windows installer...

:: Сборка без упаковки в .exe (только win-unpacked)
call bunx electron-builder --config desktop/electron/electron-builder.yml --win --x64 --dir
if %errorlevel% neq 0 (
  echo ERROR: Packaging failed
  pause
  exit /b 1
)

:: Патчим app/ в win-unpacked — заменяем старые файлы нашими
set APP=dist-installer\win-unpacked\resources\app
echo.
echo [patching] Fixing app files in win-unpacked...
copy /Y desktop\electron\main.cjs "%APP%\main.cjs"
copy /Y desktop\electron\preload.cjs "%APP%\preload.cjs"
node -e "var fs=require('fs'),p='%APP%\\package.json',j=JSON.parse(fs.readFileSync(p,'utf8'));delete j.type;j.main='main.cjs';fs.writeFileSync(p,JSON.stringify(j,null,2),'utf8');console.log('package.json fixed');"
echo // entry point > "%APP%\main.js"
echo require('./main.cjs'); >> "%APP%\main.js"
echo [patching] Done.

:: Теперь собираем установщик из уже пропатченного win-unpacked
echo.
echo [4b] Building NSIS installer from patched dir...
set ELECTRON_BUILDER_SKIP_UNPACK=true
call bunx electron-builder --config desktop/electron/electron-builder.yml --win nsis --prepackaged dist-installer\win-unpacked
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