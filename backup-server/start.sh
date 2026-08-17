#!/bin/sh
# ПВ-Система — аварийный расчётный сервер (Linux/macOS)
cd "$(dirname "$0")" || exit 1

if [ ! -d .venv ]; then
  echo "Первый запуск: создаю окружение..."
  python3 -m venv .venv
  . .venv/bin/activate
  pip install --upgrade pip
  pip install -r requirements.txt
else
  . .venv/bin/activate
fi

echo "Запуск сервера на порту 8800"
exec python server.py --port 8800
