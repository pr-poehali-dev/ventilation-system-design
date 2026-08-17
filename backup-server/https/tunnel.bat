@echo off
chcp 65001 >nul
title PVS Backup Server - HTTPS tunnel
cd /d "%~dp0"

if not exist "cloudflared.exe" (
  echo Downloading cloudflared ^(one time, ~50 MB^)...
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -OutFile cloudflared.exe"
  if not exist "cloudflared.exe" goto dlfail
)

echo.
echo ============================================================
echo   Waiting for HTTPS address...
echo   Look for a line like:  https://xxxx-yyyy.trycloudflare.com
echo   Copy it into admin panel field "Address of backup server".
echo ============================================================
echo.
cloudflared.exe tunnel --url http://127.0.0.1:8800
pause
exit /b 0

:dlfail
echo.
echo [ERROR] Download failed. Check internet connection.
pause
exit /b 1
