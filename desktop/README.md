# ПВ-Система Desktop — инструкция по сборке

Десктопное приложение на базе **Tauri 2** (Rust WebView) + **Python-сервер** (расчётный backend).

## Архитектура

```
┌─────────────────────────────────┐
│   Tauri WebView (фронтенд)      │  ← dist-desktop/ (статический билд)
│   React SPA                     │
└────────────┬────────────────────┘
             │ HTTP localhost:54321
┌────────────▼────────────────────┐
│   Python-сервер (sidecar)       │  ← desktop/server/main.py → python-server.exe
│   aerodynamics / airflow /      │
│   rescue / hydraulics /         │
│   explosion / svg-to-pdf /      │
│   license (с offline-кэшем)     │
└─────────────────────────────────┘
```

## Требования для сборки

### Windows
| Инструмент | Версия | Ссылка |
|-----------|--------|--------|
| Node.js + bun | 20+ | https://bun.sh |
| Python | 3.11+ | https://python.org |
| Rust | stable | https://rustup.rs |
| Visual Studio Build Tools | 2022 | https://visualstudio.microsoft.com/downloads/ |
| WebView2 Runtime | любая | автоматически на Win 11 |

```powershell
# После установки Rust:
cargo install tauri-cli --version "^2"
pip install pyinstaller
```

### Linux (Ubuntu/Debian)
```bash
# Системные зависимости для Tauri
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev libgtk-3-dev patchelf \
  # для cairosvg (svg-to-pdf):
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install tauri-cli --version "^2"
pip3 install pyinstaller
curl -fsSL https://bun.sh/install | bash
```

---

## Сборка

### Windows (одна команда)
```cmd
cd desktop
build.bat
```

### Linux (одна команда)
```bash
cd desktop
chmod +x build.sh
./build.sh
```

Скрипт автоматически:
1. Копирует `backend/*/index.py` → `desktop/server/functions/`
2. Собирает Python-сервер в один бинарник через PyInstaller
3. Запускает `vite build --config vite.config.desktop.ts` → `dist-desktop/`
4. Запускает `cargo tauri build` → installer

**Результат:**
- Windows: `desktop/tauri/target/release/bundle/nsis/ПВ-Система_1.0.0_x64-setup.exe`
- Linux: `desktop/tauri/target/release/bundle/appimage/пв-система_1.0.0_amd64.AppImage`

---

## Ручная пошаговая сборка

### 1. Фронтенд
```bash
# В корне проекта
bun run build:desktop
# → создаст dist-desktop/
```

### 2. Python-сервер (пример для Windows)
```bash
cd desktop/server

# Копируем функции
mkdir -p functions
cp -r ../../backend/aerodynamics functions/
cp -r ../../backend/airflow functions/
cp -r ../../backend/rescue-calculator functions/
cp -r ../../backend/water-hydraulics functions/
cp -r ../../backend/explosion-calculator functions/
cp -r ../../backend/svg-to-pdf functions/
cp -r ../../backend/license functions/

# Устанавливаем зависимости
pip install -r requirements.txt pyinstaller

# Сборка бинарника
pyinstaller --onefile --name python-server \
  --add-data "functions;functions" \
  --hidden-import numpy \
  --hidden-import cairosvg \
  --hidden-import psycopg2 \
  --distpath ../tauri/binaries \
  main.py

# Переименовываем (Tauri требует тройку платформы)
# Windows:
rename "tauri\binaries\python-server.exe" "python-server-x86_64-pc-windows-msvc.exe"
# Linux:
# mv tauri/binaries/python-server tauri/binaries/python-server-x86_64-unknown-linux-gnu
```

### 3. Tauri
```bash
cd desktop/tauri
cargo tauri build
```

---

## package.json — добавить скрипты вручную

В корневой `package.json` добавить в `scripts`:

```json
"build:desktop": "vite build --config vite.config.desktop.ts",
"dev:desktop": "vite --config vite.config.desktop.ts --port 5174"
```

---

## Подмена URL backend в frontend-коде

В `vite.config.desktop.ts` через `define` инжектируется:
- `__IS_DESKTOP__ = true`
- `__DESKTOP_SERVER__ = "http://127.0.0.1:54321"`

В коде фронтенда использовать `src/lib/api-urls.ts` вместо прямых URL:

```typescript
import { API_URLS } from "@/lib/api-urls";

// Вместо:
const res = await fetch("https://functions.poehali.dev/...");
// Использовать:
const res = await fetch(API_URLS.aerodynamics, { ... });
```

Файлы, которые нужно обновить для полного перехода:
| Файл | Константа | Заменить на |
|------|-----------|-------------|
| `src/lib/license.ts` | `LICENSE_URL` | `API_URLS.license` |
| `src/pages/Admin.tsx` | `ADMIN_URL` | `API_URLS.adminLicenses` |
| `src/pages/Cad.tsx` | `AIRFLOW_URL`, `EXPLOSION_URL`, `WATER_URL` | `API_URLS.*` |
| `src/components/cad/PrintDialog.tsx` | хардкод URL | `API_URLS.svgToPdf` |
| `src/components/cad/RescuePanel.tsx` | `RESCUE_URL` | `API_URLS.rescueCalculator` |

---

## Лицензия в offline-режиме

При первом запуске с интернетом лицензия проверяется в облаке и кэшируется в:
- Windows: `%APPDATA%\пв-система\license_cache.json`
- Linux: `~/.config/пв-система/license_cache.json` (рядом с бинарником сервера)

При последующих запусках без интернета — используется кэш. Срок кэша не ограничен.

---

## Тестирование сервера локально

```bash
cd desktop/server
python main.py
# → сервер стартует на http://127.0.0.1:54321

# Проверка:
curl http://127.0.0.1:54321/health
# → {"status": "ok", "version": "1.0"}

# Тест расчёта:
curl -X POST http://127.0.0.1:54321/aerodynamics \
  -H "Content-Type: application/json" \
  -d '{"branches": [{"id":"1","shape":"rect","width":3,"height":2.5,"length":100,"resistanceMode":"alpha","alphaCoef":35,"localXi":0,"flow":10}]}'
```
