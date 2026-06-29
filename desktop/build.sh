#!/usr/bin/env bash
# =============================================================================
# ПВ-Система Desktop — скрипт сборки (Linux / macOS)
# =============================================================================
# Требования:
#   - Node.js / bun
#   - Python 3.11+
#   - Rust + cargo (https://rustup.rs)
#   - tauri-cli: cargo install tauri-cli --version "^2"
#   - PyInstaller: pip install pyinstaller
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
FUNCTIONS_DIR="$SERVER_DIR/functions"
TAURI_DIR="$SCRIPT_DIR/tauri"

echo ""
echo "════════════════════════════════════════════"
echo "  ПВ-Система Desktop — сборка (Linux)"
echo "════════════════════════════════════════════"
echo ""

# ── Шаг 1: Копируем backend-функции в server/functions/ ──────────────────────
echo "[1/5] Копирование backend-функций..."
rm -rf "$FUNCTIONS_DIR"
mkdir -p "$FUNCTIONS_DIR"

for fn in aerodynamics airflow rescue-calculator water-hydraulics explosion-calculator svg-to-pdf license; do
  SRC="$ROOT_DIR/backend/$fn"
  if [ -d "$SRC" ]; then
    cp -r "$SRC" "$FUNCTIONS_DIR/$fn"
    echo "  ✓ $fn"
  else
    echo "  ✗ $fn — не найден, пропускаем"
  fi
done

# ── Шаг 2: Устанавливаем Python-зависимости и собираем бинарник ──────────────
echo ""
echo "[2/5] Сборка Python-сервера в бинарник..."

cd "$SERVER_DIR"

# Создаём venv
python3 -m venv .venv
source .venv/bin/activate
pip install --quiet -r requirements.txt pyinstaller

# PyInstaller: один файл, без консоли
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
  --distpath "$TAURI_DIR/binaries" \
  main.py

deactivate

# Tauri sidecar требует суффикс платформы
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
  TRIPLE="x86_64-unknown-linux-gnu"
elif [ "$ARCH" = "aarch64" ]; then
  TRIPLE="aarch64-unknown-linux-gnu"
else
  TRIPLE="$ARCH-unknown-linux-gnu"
fi

mv "$TAURI_DIR/binaries/python-server" "$TAURI_DIR/binaries/python-server-$TRIPLE" 2>/dev/null || true
echo "  ✓ python-server-$TRIPLE"

# ── Шаг 3: Собираем фронтенд ─────────────────────────────────────────────────
echo ""
echo "[3/5] Сборка фронтенда..."
cd "$ROOT_DIR"
bun run build:desktop
echo "  ✓ dist-desktop/"

# ── Шаг 4: Tauri сборка ──────────────────────────────────────────────────────
echo ""
echo "[4/5] Сборка Tauri-приложения..."
cd "$TAURI_DIR"
cargo tauri build
echo "  ✓ Tauri сборка завершена"

# ── Шаг 5: Итог ──────────────────────────────────────────────────────────────
echo ""
echo "[5/5] Готово!"
echo "  Installer: $TAURI_DIR/target/release/bundle/"
echo ""
echo "════════════════════════════════════════════"