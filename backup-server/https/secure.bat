@echo off
chcp 65001 >nul
title PVS Backup Server - SECURE MODE
cd /d "%~dp0\.."

if not exist ".venv\Scripts\python.exe" (
  echo Run start.bat first.
  pause
  exit /b 1
)

set VPY=.venv\Scripts\python.exe
%VPY% -c "import cryptography" 2>nul
if errorlevel 1 (
  echo Installing certificate tools...
  %VPY% -m pip install cryptography
)

%VPY% server.py --port 8800 --https
pause
