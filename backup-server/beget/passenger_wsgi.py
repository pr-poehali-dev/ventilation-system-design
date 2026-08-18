"""
ПВ-Система — точка входа для хостинга Beget (Python-приложение).

Beget запускает приложения через Passenger: он ищет в корне сайта файл
passenger_wsgi.py и берёт из него переменную `application`.

Этот файл кладётся в корень Python-приложения рядом с папкой backup-server
(или внутрь неё — путь определяется автоматически).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# Папка, где лежит server.py: либо рядом, либо на уровень выше.
for candidate in (HERE, os.path.dirname(HERE), os.path.join(HERE, "backup-server")):
    if os.path.isfile(os.path.join(candidate, "server.py")):
        SERVER_DIR = candidate
        break
else:
    SERVER_DIR = HERE

if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from server import app as application  # noqa: E402
