# Сборка ПВ-Система Desktop для Windows — пошаговая инструкция

## Что получится в итоге
Установщик `ПВ-Система_1.0.0_x64-setup.exe` — устанавливает приложение как обычную программу.

---

## ШАГ 1 — Установка инструментов (один раз)

### 1.1 — Visual Studio Build Tools
Нужен компилятор C++ для Rust.

1. Скачай: https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. Запусти установщик
3. Выбери **"Desktop development with C++"**
4. Установи (занимает ~5 ГБ)

### 1.2 — Rust
1. Открой: https://rustup.rs/
2. Скачай и запусти `rustup-init.exe`
3. Нажми **1** (default install)
4. После установки **закрой и открой cmd заново**
5. Проверь:
```
rust --version
cargo --version
```

### 1.3 — Node.js + bun
1. Скачай Node.js 20+: https://nodejs.org/
2. После установки Node, установи bun:
```
npm install -g bun
```
3. Проверь:
```
bun --version
```

### 1.4 — Python 3.11+
1. Скачай: https://www.python.org/downloads/
2. ⚠️ При установке обязательно поставь галочку **"Add Python to PATH"**
3. Проверь:
```
python --version
pip --version
```

### 1.5 — WebView2 Runtime
На Windows 11 уже установлен. На Windows 10 скачай:
https://developer.microsoft.com/microsoft-edge/webview2/

---

## ШАГ 2 — Подготовка проекта

Открой **cmd** или **PowerShell** в папке проекта (там где `package.json`).

### 2.1 — Установи зависимости Node
```
bun install
```

### 2.2 — Установи tauri-cli
```
cargo install tauri-cli --version "^2"
```
> Это занимает 5-15 минут — компилируется из исходников.

### 2.3 — Добавь скрипты в package.json
Открой `package.json` и добавь в раздел `"scripts"`:
```json
"build:desktop": "vite build --config vite.config.desktop.ts",
"dev:desktop": "vite --config vite.config.desktop.ts --port 5174"
```

Должно получиться:
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "build:dev": "vite build --mode development",
  "build:desktop": "vite build --config vite.config.desktop.ts",
  "dev:desktop": "vite --config vite.config.desktop.ts --port 5174",
  "lint": "eslint .",
  "preview": "vite preview"
},
```

---

## ШАГ 3 — Иконки приложения

Tauri требует иконки в папке `desktop\tauri\icons\`.

### 3.1 — Создай папку
```
mkdir desktop\tauri\icons
```

### 3.2 — Подготовь иконку
Нужен PNG файл 1024×1024 пикселей с логотипом.  
Положи его как `desktop\tauri\icons\app-icon.png`.

### 3.3 — Сгенерируй все форматы через Tauri
```
cd desktop\tauri
cargo tauri icon ..\icons-src\app-icon.png
```
> Это создаст все нужные размеры: 32x32.png, 128x128.png, icon.ico и т.д.

**Или создай иконки вручную:**  
Минимально нужны эти файлы (можно использовать любой онлайн-конвертер):
- `desktop\tauri\icons\32x32.png`
- `desktop\tauri\icons\128x128.png`
- `desktop\tauri\icons\128x128@2x.png` (256x256)
- `desktop\tauri\icons\icon.ico` (https://icoconvert.com/)
- `desktop\tauri\icons\icon.icns` (нужен только для macOS, можно пустой файл)

---

## ШАГ 4 — Сборка Python-сервера

Открой cmd в папке `desktop\server\`.

### 4.1 — Скопируй backend-функции
```
mkdir functions
xcopy /e /i ..\..\backend\aerodynamics functions\aerodynamics\
xcopy /e /i ..\..\backend\airflow functions\airflow\
xcopy /e /i ..\..\backend\rescue-calculator functions\rescue-calculator\
xcopy /e /i ..\..\backend\water-hydraulics functions\water-hydraulics\
xcopy /e /i ..\..\backend\explosion-calculator functions\explosion-calculator\
xcopy /e /i ..\..\backend\svg-to-pdf functions\svg-to-pdf\
xcopy /e /i ..\..\backend\license functions\license\
```

### 4.2 — Создай виртуальное окружение Python
```
python -m venv .venv
.venv\Scripts\activate
```

### 4.3 — Установи зависимости
```
pip install -r requirements.txt pyinstaller
```
> cairosvg может потребовать GTK. Если ошибка — установи:
> https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases
> (скачай GTK3-Runtime Win64 последней версии)

### 4.4 — Собери бинарник
```
pyinstaller ^
  --onefile ^
  --name python-server ^
  --add-data "functions;functions" ^
  --add-data "integrity.py;." ^
  --add-data "machine_id.py;." ^
  --hidden-import numpy ^
  --hidden-import cairosvg ^
  --hidden-import psycopg2 ^
  --hidden-import uuid ^
  --hidden-import socket ^
  --hidden-import subprocess ^
  --noconsole ^
  --distpath ..\tauri\binaries ^
  main.py
```

### 4.5 — Переименуй бинарник (Tauri требует тройку платформы)
```
cd ..\tauri\binaries
rename python-server.exe python-server-x86_64-pc-windows-msvc.exe
```

### 4.6 — Деактивируй venv
```
deactivate
```

---

## ШАГ 5 — Сборка фронтенда

Вернись в корень проекта (там где `package.json`):
```
cd ..\..  
bun run build:desktop
```
> Создаст папку `dist-desktop\` — это и есть фронтенд.

---

## ШАГ 6 — Финальная сборка Tauri

```
cd desktop\tauri
cargo tauri build
```

> Занимает 5-20 минут при первой сборке (компилирует Rust).

**Результат:**
```
desktop\tauri\target\release\bundle\nsis\ПВ-Система_1.0.0_x64-setup.exe
```

---

## Проверка перед установкой

Протестируй Python-сервер отдельно:
```
cd desktop\tauri\binaries
python-server-x86_64-pc-windows-msvc.exe
```
В другом окне:
```
curl http://127.0.0.1:54321/health
```
Должно вернуть: `{"status": "ok", "version": "1.0"}`

---

## Частые ошибки

| Ошибка | Решение |
|--------|---------|
| `cargo: command not found` | Перезапусти cmd после установки Rust |
| `error: failed to run custom build command for openssl` | `pip install pyinstaller --upgrade` |
| `cairosvg` ошибка при сборке | Установи GTK3 Runtime (ссылка выше) |
| `icons not found` | Создай папку `desktop\tauri\icons\` с иконками |
| Tauri: `sidecar not found` | Проверь что файл переименован с суффиксом `-x86_64-pc-windows-msvc.exe` |
| `build:desktop not found` | Добавь скрипты в `package.json` (Шаг 2.3) |

---

## Итоговая структура перед `cargo tauri build`

```
desktop/
├── server/
│   ├── main.py
│   ├── integrity.py
│   ├── machine_id.py
│   ├── requirements.txt
│   └── functions/
│       ├── aerodynamics/
│       ├── airflow/
│       ├── rescue-calculator/
│       ├── water-hydraulics/
│       ├── explosion-calculator/
│       ├── svg-to-pdf/
│       └── license/
└── tauri/
    ├── tauri.conf.json
    ├── Cargo.toml
    ├── build.rs
    ├── src/
    │   └── main.rs
    ├── icons/            ← иконки
    │   ├── 32x32.png
    │   ├── 128x128.png
    │   ├── 128x128@2x.png
    │   ├── icon.ico
    │   └── icon.icns
    └── binaries/         ← python-server
        └── python-server-x86_64-pc-windows-msvc.exe

dist-desktop/             ← фронтенд (bun run build:desktop)
```
