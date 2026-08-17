@echo off
chcp 65001 >nul
title PVS Backup - PUBLIC ADDRESS via ngrok
cd /d "%~dp0"

if not exist "ngrok.exe" (
  echo Downloading ngrok ^(one time^)...
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip -OutFile ngrok.zip; Expand-Archive -Path ngrok.zip -DestinationPath . -Force; Remove-Item ngrok.zip"
  if not exist "ngrok.exe" goto dlfail
)

if not exist "ngrok_token.txt" (
  echo.
  echo ============================================================
  echo   ONE-TIME SETUP
  echo   1. Register free account:  https://dashboard.ngrok.com/signup
  echo   2. Copy your authtoken from the dashboard
  echo   3. Paste it below and press Enter
  echo ============================================================
  echo.
  set /p TOKEN="Authtoken: "
  echo %%TOKEN%% > ngrok_token.txt
  ngrok.exe config add-authtoken %%TOKEN%%
)

echo.
echo ============================================================
echo   Look for line:  Forwarding  https://xxxx.ngrok-free.app
echo   Copy that address into admin panel.
echo ============================================================
echo.
ngrok.exe http 8800
pause
exit /b 0

:dlfail
echo [ERROR] Download failed.
pause
exit /b 1
