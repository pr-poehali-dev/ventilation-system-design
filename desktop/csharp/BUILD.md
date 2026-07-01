# Сборка PVS.exe (C# + WebView2)

## Структура на выходе
```
dist/
  PVS.exe          ← C# обёртка (единственный файл для пользователя)
  server/
    server.exe     ← Flask-ядро (PyInstaller)
    pvs-core/      ← расчёты + React-билд
      dist/        ← index.html и assets
      calc_*.py
      ...
```

## Шаг 1 — Собрать server.exe (Python)

```cmd
cd C:\PVS\desktop\csharp

pip install pyinstaller

pyinstaller --onefile --noconsole --name "server" ^
  --add-data "..\pywebview\pvs-core;pvs-core" ^
  --hidden-import flask ^
  --hidden-import numpy ^
  server_entry.py
```

Готовый `server.exe` появится в `dist\server.exe`.

## Шаг 2 — Подготовить папку server/

```cmd
mkdir dist\server
copy dist\server.exe dist\server\server.exe
```

## Шаг 3 — Собрать PVS.exe (C#)

Нужен .NET 8 SDK: https://dotnet.microsoft.com/download/dotnet/8.0

```cmd
cd C:\PVS\desktop\csharp\PvsApp

dotnet publish -c Release -r win-x64 --self-contained true ^
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true ^
  -o ..\dist
```

## Шаг 4 — Итоговая структура

```cmd
C:\PVS\desktop\csharp\dist\
  PVS.exe
  server\
    server.exe
```

Скопируй пользователю эту папку целиком — запускать `PVS.exe`.

## Требования на машине пользователя

- Windows 10/11 x64
- WebView2 Runtime (входит в Windows 11, для Windows 10: https://go.microsoft.com/fwlink/p/?LinkId=2124703)
- .NET Runtime НЕ нужен (self-contained)
- Python НЕ нужен
