@echo off
chcp 65001 >nul
title PVS Backup Server - AUTOSTART SETUP
cd /d "%~dp0"
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set LNK=%STARTUP%\PVS-Backup-Server.lnk
if exist "%LNK%" (
  del "%LNK%"
  echo Autostart DISABLED.
) else (
  powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut(%LNK%); $s.TargetPath=%~dp0run.bat; $s.WorkingDirectory=%~dp0; $s.WindowStyle=7; $s.Save()"
  echo Autostart ENABLED. Server will start with Windows.
)
echo.
pause
