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

:: Step 4: Один шаг — electron-builder сам включит main.cjs из desktop/electron/
echo.
echo [4/4] Building installer...
call bunx electron-builder --config desktop/electron/electron-builder.yml --win --x64
if %errorlevel% neq 0 (
  echo ERROR: Build failed
  pause
  exit /b 1
)

:: Проверяем что файлы на месте
set APP=%CD%\dist-installer\win-unpacked\resources\app
echo.
echo [check] Files in app\:
dir "%APP%" 2>nul

echo.
echo ===================================================
echo   DONE! Installer: dist-installer\
echo ===================================================
echo.
pause
