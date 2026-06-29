#!/usr/bin/env bash
# ============================================================
# ПВ-Система — подготовка к сборке (Linux)
# Запусти один раз перед сборкой.
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
TAURI_DIR="$SCRIPT_DIR/tauri"

echo ""
echo "============================================================"
echo "  ПВ-Система — подготовка к сборке (Linux)"
echo "============================================================"

# ── Шаг 1: Копируем backend-функции ─────────────────────────────
echo ""
echo "[1/4] Копирование backend-функций..."
rm -rf "$SERVER_DIR/functions"
mkdir -p "$SERVER_DIR/functions"

for fn in aerodynamics airflow rescue-calculator water-hydraulics explosion-calculator svg-to-pdf license; do
  src="$ROOT_DIR/backend/$fn"
  if [ -d "$src" ]; then
    cp -r "$src" "$SERVER_DIR/functions/$fn"
    echo "  OK: $fn"
  else
    echo "  SKIP: $fn (не найден)"
  fi
done

# ── Шаг 2: Python venv ───────────────────────────────────────────
echo ""
echo "[2/4] Создание Python окружения..."
cd "$SERVER_DIR"
python3 -m venv .venv
source .venv/bin/activate
pip install --quiet -r requirements.txt pyinstaller

# ── Шаг 3: PyInstaller ───────────────────────────────────────────
echo ""
echo "[3/4] Сборка python-server (может занять 3-7 минут)..."
mkdir -p "$TAURI_DIR/binaries"

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

# ── Шаг 4: Переименование ────────────────────────────────────────
echo ""
echo "[4/4] Переименование бинарника..."
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
  TRIPLE="x86_64-unknown-linux-gnu"
elif [ "$ARCH" = "aarch64" ]; then
  TRIPLE="aarch64-unknown-linux-gnu"
else
  TRIPLE="${ARCH}-unknown-linux-gnu"
fi

mv "$TAURI_DIR/binaries/python-server" "$TAURI_DIR/binaries/python-server-$TRIPLE"
chmod +x "$TAURI_DIR/binaries/python-server-$TRIPLE"
echo "  OK: python-server-$TRIPLE"

echo ""
echo "============================================================"
echo "  Готово! Теперь выполни в корне проекта:"
echo ""
echo "  1. bun run build:desktop"
echo "  2. cd desktop/tauri"
echo "  3. cargo tauri build"
echo ""
echo "  Результат будет в:"
echo "  desktop/tauri/target/release/bundle/"
echo "============================================================"
