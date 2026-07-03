# Сборка десктопного приложения ПВ-Система (PVS.exe)

Десктопное приложение = C#-обёртка (окно WebView2) + локальное расчётное
ядро на Python (Flask) + собранный React-интерфейс внутри ядра.

Пользователю отдаётся папка с `PVS.exe` — он запускает её как обычную
программу, интернет не обязателен.

---

## 0. Что нужно установить один раз (окружение сборки)

| Инструмент | Зачем | Ссылка |
|------------|-------|--------|
| Node.js 18+ | собрать React-интерфейс | https://nodejs.org |
| Python 3.11 | собрать расчётное ядро | https://python.org |
| .NET 8 SDK | собрать PVS.exe | https://dotnet.microsoft.com/download/dotnet/8.0 |

Проверить, что всё установлено:

```cmd
node -v
python --version
dotnet --version
```

Дальше во всех командах считается, что проект лежит в `C:\PVS`.
Замени путь на свой, если он другой.

---

## Структура на выходе

```
desktop\csharp\dist\
  PVS.exe          ← единственный файл, который запускает пользователь
  server\
    server.exe     ← расчётное ядро (Flask, упаковано PyInstaller)
```

---

## Шаг 1 — Собрать интерфейс (⚠️ КЛЮЧЕВОЙ ШАГ, без него не работает активация)

> ⚠️ ОБЯЗАТЕЛЬНО собирать именно этой командой (desktop-режим).
> Она включает флаг десктопа и направляет запросы на локальное ядро
> `http://127.0.0.1:5173/api/...`.
>
> Если собрать обычной `npm run build` — ключ активации НЕ примется,
> появится ошибка `Unexpected token '<', "<!doctype"...`, а расчёты и
> кнопки окна работать не будут.

```cmd
cd C:\PVS

npm install
node_modules\.bin\vite build --config vite.config.desktop.ts
```

> ⚠️ Собирай именно через `node_modules\.bin\vite` — это локальный vite
> проекта (специальная сборка rolldown-vite). НЕ используй `npx vite` —
> он попытается скачать чужую версию vite и спросит подтверждение,
> сборка получится неправильной.

Результат появится в папке `dist-desktop`. Переносим его в расчётное ядро:

```cmd
rmdir /S /Q desktop\pywebview\pvs-core\dist
xcopy /E /I /Y dist-desktop desktop\pywebview\pvs-core\dist
```

После этого должен существовать файл:
`desktop\pywebview\pvs-core\dist\index.html`

---

## Шаг 2 — Собрать расчётное ядро server.exe (Python)

```cmd
cd C:\PVS\desktop\csharp

pip install pyinstaller flask numpy

pyinstaller --onefile --noconsole --name "server" ^
  --add-data "..\pywebview\pvs-core;pvs-core" ^
  --hidden-import flask ^
  --hidden-import numpy ^
  server_entry.py
```

Готовый `server.exe` появится в `desktop\csharp\dist\server.exe`.

Разложим его в папку `server\`:

```cmd
mkdir dist\server
copy dist\server.exe dist\server\server.exe
```

---

## Шаг 3 — Иконка окна и панели задач (pvs.ico)

Готовая иконка из логотипа ПВ-Система уже сгенерирована (размеры
16/32/48/64/128/256 в одном файле). Скачай её в проект одной командой:

```cmd
curl -o C:\PVS\desktop\csharp\PvsApp\pvs.ico ^
  https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/icons/desktop-icon.ico
```

(или просто открой ссылку в браузере и сохрани файл как
`desktop\csharp\PvsApp\pvs.ico`)

Ссылка на иконку:
https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/icons/desktop-icon.ico

`.csproj` подхватит `pvs.ico` автоматически (иконка подключается только
если файл существует). Если файла нет — программа всё равно соберётся,
но со стандартной иконкой Windows.

---

## Шаг 4 — Собрать PVS.exe (C#)

```cmd
cd C:\PVS\desktop\csharp\PvsApp

dotnet publish -c Release -r win-x64 --self-contained true ^
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true ^
  -o ..\dist
```

---

## Шаг 5 — Итог

Готовая папка для пользователя:

```
desktop\csharp\dist\
  PVS.exe
  server\
    server.exe
```

Скопируй эту папку целиком. Пользователь запускает `PVS.exe`.

---

## Проверка, что всё собралось правильно (чек-лист)

1. Запусти `PVS.exe`.
2. Появляется заставка «Запуск расчётного ядра…», затем интерфейс.
3. Открой окно активации → введи ключ → нажми «Активировать лицензию».
   - ✅ Правильно: ключ принимается либо приходит понятный ответ сервера.
   - ❌ Ошибка `Unexpected token '<'` = интерфейс собран не desktop-режимом.
     Вернись к Шагу 1 и пересобери.
4. Кнопки в правом верхнем углу (свернуть / развернуть / закрыть) работают.
5. Логотип отображается в шапке и в окне «О программе».

---

## Частые ошибки

| Симптом | Причина | Решение |
|---------|---------|---------|
| `Unexpected token '<'` при активации | интерфейс собран обычной `npm run build` | пересобрать Шагом 1 (desktop-конфиг) |
| «Не удалось запустить расчётный модуль» | нет `server\server.exe` рядом с `PVS.exe` | проверить Шаг 2 |
| Пустое белое окно | не скопирован `dist` в `pvs-core\dist` | повторить конец Шага 1 |
| Логотип-«битая картинка» без сети | нормально: оффлайн подставляется запасной значок | это ожидаемо |
| Иконка окна стандартная | нет `pvs.ico` | выполнить Шаг 3 |

---

## Требования на компьютере пользователя

- Windows 10/11 x64
- WebView2 Runtime (в Windows 11 уже есть; для Windows 10:
  https://go.microsoft.com/fwlink/p/?LinkId=2124703)
- .NET Runtime НЕ нужен (собрано self-contained)
- Python НЕ нужен
- Интернет НЕ обязателен (кроме первичной онлайн-проверки лицензии)