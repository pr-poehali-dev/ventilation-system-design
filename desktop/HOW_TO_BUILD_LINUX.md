# Сборка ПВ-Система Desktop для Linux — пошаговая инструкция

## Что получится в итоге
- `пв-система_1.0.0_amd64.AppImage` — запускается без установки на любом дистрибутиве
- `пв-система_1.0.0_amd64.deb` — установщик для Ubuntu/Debian

---

## ШАГ 1 — Установка инструментов (Ubuntu/Debian)

Открой терминал.

### 1.1 — Системные зависимости
```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  libffi-dev
```

### 1.2 — Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Нажми 1 (default)
source "$HOME/.cargo/env"
```
Проверь:
```bash
rustc --version
cargo --version
```

### 1.3 — Node.js + bun
```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc   # или перезапусти терминал
```
Проверь:
```bash
bun --version
```

### 1.4 — Python 3.11+
```bash
sudo apt-get install -y python3 python3-pip python3-venv python3-dev
```
Проверь:
```bash
python3 --version
pip3 --version
```

### 1.5 — tauri-cli
```bash
cargo install tauri-cli --version "^2"
```
> Занимает 5-15 минут.

---

## ШАГ 2 — Подготовка проекта

Перейди в папку проекта (там где `package.json`).

### 2.1 — Установи зависимости Node
```bash
bun install
```

### 2.2 — Добавь скрипты в package.json
Открой `package.json` и добавь в раздел `"scripts"`:
```json
"build:desktop": "vite build --config vite.config.desktop.ts",
"dev:desktop": "vite --config vite.config.desktop.ts --port 5174"
```

---

## ШАГ 3 — Иконки приложения

### 3.1 — Создай папку
```bash
mkdir -p desktop/tauri/icons
```

### 3.2 — Подготовь иконку
Нужен PNG файл 1024×1024 пикселей. Положи как `app-icon.png`.

### 3.3 — Сгенерируй через Tauri (рекомендуется)
```bash
cd desktop/tauri
cargo tauri icon /путь/к/app-icon.png
```

**Или вручную через ImageMagick:**
```bash
sudo apt-get install -y imagemagick

# Создаём все нужные размеры
convert app-icon.png -resize 32x32   desktop/tauri/icons/32x32.png
convert app-icon.png -resize 128x128 desktop/tauri/icons/128x128.png
convert app-icon.png -resize 256x256 desktop/tauri/icons/128x128@2x.png
# .ico и .icns для Linux не нужны, создаём пустышки:
touch desktop/tauri/icons/icon.icns
# .ico — можно создать через convert:
convert app-icon.png -define icon:auto-resize=64,48,32,16 desktop/tauri/icons/icon.ico
```

---

## ШАГ 4 — Сборка Python-сервера

```bash
cd desktop/server
```

### 4.1 — Скопируй backend-функции
```bash
mkdir -p functions
cp -r ../../backend/aerodynamics       functions/
cp -r ../../backend/airflow            functions/
cp -r ../../backend/rescue-calculator  functions/
cp -r ../../backend/water-hydraulics   functions/
cp -r ../../backend/explosion-calculator functions/
cp -r ../../backend/svg-to-pdf         functions/
cp -r ../../backend/license            functions/
```

### 4.2 — Виртуальное окружение Python
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 4.3 — Установи зависимости
```bash
pip install -r requirements.txt pyinstaller
```

### 4.4 — Собери бинарник
```bash
pyinstaller \
  --onefile \
  --name python-server \
  --add-data "functions:functions" \
  --add-data "integrity.py:." \
  --add-data "machine_id.py:." \
  --hidden-import numpy \
  --hidden-import cairosvg \
  --hidden-import psycopg2 \
  --hidden-import uuid \
  --hidden-import socket \
  --hidden-import subprocess \
  --distpath ../tauri/binaries \
  main.py
```

### 4.5 — Переименуй под платформу
```bash
# Определяем архитектуру
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
  TRIPLE="x86_64-unknown-linux-gnu"
elif [ "$ARCH" = "aarch64" ]; then
  TRIPLE="aarch64-unknown-linux-gnu"
fi

mv ../tauri/binaries/python-server "../tauri/binaries/python-server-$TRIPLE"
chmod +x "../tauri/binaries/python-server-$TRIPLE"
echo "Готово: python-server-$TRIPLE"
```

### 4.6 — Деактивируй venv
```bash
deactivate
```

---

## ШАГ 5 — Сборка фронтенда

Вернись в корень проекта:
```bash
cd ../..
bun run build:desktop
```
> Создаст `dist-desktop/`

---

## ШАГ 6 — Финальная сборка Tauri

```bash
cd desktop/tauri
cargo tauri build
```

**Результаты:**
```
desktop/tauri/target/release/bundle/appimage/пв-система_1.0.0_amd64.AppImage
desktop/tauri/target/release/bundle/deb/пв-система_1.0.0_amd64.deb
```

---

## Установка и запуск

### AppImage (без установки)
```bash
chmod +x пв-система_1.0.0_amd64.AppImage
./пв-система_1.0.0_amd64.AppImage
```

### deb пакет
```bash
sudo dpkg -i пв-система_1.0.0_amd64.deb
# Потом запуск:
пв-система
```

---

## Проверка Python-сервера

```bash
cd desktop/tauri/binaries
./python-server-x86_64-unknown-linux-gnu &

curl http://127.0.0.1:54321/health
# → {"status": "ok", "version": "1.0"}

# Остановить
pkill -f python-server
```

---

## Частые ошибки

| Ошибка | Решение |
|--------|---------|
| `libwebkit2gtk-4.1 not found` | `sudo apt-get install libwebkit2gtk-4.1-dev` |
| `error[E0463]: can't find crate for...` | Обнови Rust: `rustup update` |
| `cairosvg` при сборке ошибка | `sudo apt-get install libcairo2-dev libpango1.0-dev` |
| AppImage не запускается | `sudo apt-get install libfuse2` |
| `icons not found` | Создай все файлы в `desktop/tauri/icons/` |
| Sidecar не запускается | Проверь что файл исполняемый: `chmod +x binaries/python-server-*` |

---

## Для Fedora/RHEL вместо apt используй:
```bash
sudo dnf install -y \
  webkit2gtk4.0-devel \
  openssl-devel \
  gtk3-devel \
  cairo-devel pango-devel \
  librsvg2-devel
```

## Для Arch Linux:
```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 gtk3 libappindicator-gtk3 \
  librsvg cairo pango
```
