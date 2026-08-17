@echo off
chcp 65001 >nul
title PVS Backup Server - STOP
echo Stopping backup compute server (port 8800)...
set FOUND=0
for /f "tokens=5" %%p in (netstat -ano ^| findstr ":8800" ^| findstr "LISTENING") do (
  taskkill /PID %%p /F >nul 2>nul
  set FOUND=1
)
if "%FOUND%"=="0" (echo Server was not running.) else (echo Server stopped.)
timeout /t 3 >nul
