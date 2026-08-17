@echo off
title PVS Backup Compute Server
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (set PY=py -3) else (set PY=python)

%PY% --version >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Python not found. Install Python 3.11 from python.org
  echo         and check "Add python.exe to PATH" during setup.
  echo.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating environment, please wait...
  %PY% -m venv .venv
  if errorlevel 1 goto venvfail
)

set VPY=.venv\Scripts\python.exe

%VPY% -c "import flask" 2>nul
if errorlevel 1 (
  echo Installing dependencies, please wait...
  %VPY% -m pip install --upgrade pip
  %VPY% -m pip install -r requirements.txt
  if errorlevel 1 goto pipfail
)

echo.
echo Server is starting. Keep this window open.
echo.
%VPY% server.py --port 8800
pause
exit /b 0

:venvfail
echo.
echo [ERROR] Cannot create virtual environment.
pause
exit /b 1

:pipfail
echo.
echo [ERROR] Cannot install dependencies. Check internet connection.
pause
exit /b 1
