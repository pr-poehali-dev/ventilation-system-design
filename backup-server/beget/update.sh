#!/bin/bash
# ПВ-Система — обновление резервного сервера на Beget одной командой.
#
# Забирает свежую версию программы из GitHub и перезапускает приложение.
# Запуск по SSH:   bash ~/pvs-backup/update.sh
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

echo "=============================================="
echo "  ПВ-Система — обновление резервного сервера"
echo "=============================================="

if [ ! -d .git ]; then
  echo "[ОШИБКА] Папка не подключена к GitHub."
  echo "Выполните один раз:"
  echo "  git clone ВАШ-РЕПОЗИТОРИЙ ~/pvs-backup"
  exit 1
fi

echo "[1/4] Загружаю свежую версию..."
git fetch --all --quiet
git reset --hard origin/main --quiet
echo "      готово"

echo "[2/4] Обновляю расчётные модули..."
if [ -f backup-server/prepare.py ]; then
  python3 backup-server/prepare.py
fi

echo "[3/4] Проверяю библиотеки..."
if [ -d .venv ]; then
  . .venv/bin/activate
else
  python3 -m venv .venv
  . .venv/bin/activate
  pip install --upgrade pip --quiet
fi
pip install -r backup-server/requirements.txt --quiet
echo "      готово"

echo "[4/4] Перезапускаю приложение..."
mkdir -p tmp
touch tmp/restart.txt
echo "      готово"

echo
echo "=============================================="
echo "  Обновление завершено."
echo "  Резервный сервер работает на свежей версии."
echo "=============================================="
