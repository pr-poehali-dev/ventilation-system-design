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

## Шаг 0 — Собрать React-фронтенд (ОБЯЗАТЕЛЬНО, desktop-режим!)

> ⚠️ КРИТИЧНО: фронт нужно собирать именно desktop-конфигом
> `vite.config.desktop.ts`. Он включает флаг `__IS_DESKTOP__=true` и
> направляет все запросы на локальный сервер `http://127.0.0.1:5173/api/...`.
> Если собрать обычным `vite build` — активация лицензии и расчёты работать
> НЕ будут (запросы уйдут в облако/пустоту, ошибка "Unexpected token '<'").

```cmd
cd C:\PVS

npm install           # если ещё не ставили зависимости
npx vite build --config vite.config.desktop.ts
```

Результат появится в папке `dist-desktop`. Копируем его в ядро сервера:

```cmd
rmdir /S /Q desktop\pywebview\pvs-core\dist
xcopy /E /I /Y dist-desktop desktop\pywebview\pvs-core\dist
```

Теперь `desktop\pywebview\pvs-core\dist\index.html` — это готовый десктопный
фронт, который упакует PyInstaller на следующем шаге.

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

## Шаг 2.5 — Иконка приложения (pvs.ico)

Иконка окна и панели задач берётся из файла
`desktop\csharp\PvsApp\pvs.ico`. Если его нет — приложение соберётся, но
будет со стандартной иконкой Windows.

Готовый логотип уже есть в проекте: `public\icon.svg`. Сконвертируй его в
`.ico` (многоразмерный: 16, 32, 48, 256 px) любым способом:

- Онлайн: https://convertio.co/ru/svg-ico/ или https://icoconvert.com
  (загрузи `public\icon.svg`, выбери размеры 16/32/48/256, скачай `.ico`)
- Либо через ImageMagick:
  ```cmd
  magick public\icon.svg -define icon:auto-resize=256,48,32,16 desktop\csharp\PvsApp\pvs.ico
  ```

Положи результат как `desktop\csharp\PvsApp\pvs.ico`. `.csproj` подхватит его
автоматически (иконка подключается только если файл существует).

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