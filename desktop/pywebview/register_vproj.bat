@echo off
chcp 65001 >nul
echo Регистрация .vproj файлов для ПВС-Система...

REM Определяем путь к exe
set EXE_PATH=%~dp0dist\PVS.exe

REM Регистрируем тип файла .vproj
reg add "HKCU\Software\Classes\.vproj" /ve /d "PVS.Project" /f
reg add "HKCU\Software\Classes\.vproj" /v "Content Type" /d "application/json" /f

REM Регистрируем обработчик
reg add "HKCU\Software\Classes\PVS.Project" /ve /d "ПВ-Система Проект" /f
reg add "HKCU\Software\Classes\PVS.Project\DefaultIcon" /ve /d "%EXE_PATH%,0" /f
reg add "HKCU\Software\Classes\PVS.Project\shell\open\command" /ve /d "\"%EXE_PATH%\" \"%%1\"" /f

echo.
echo Готово! Теперь .vproj файлы открываются двойным кликом через ПВС-Система.
echo.
pause
