"""
Подготовка аварийного сервера: копирует расчётные модули из backend/
проекта в папку functions/ рядом с server.py.

Запуск из корня проекта:
    python backup-server/prepare.py
"""
import os
import shutil

FUNCTIONS = [
    "airflow",
    "aerodynamics",
    "rescue-calculator",
    "explosion-calculator",
    "water-hydraulics",
]

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
TARGET = os.path.join(HERE, "functions")


def main():
    os.makedirs(TARGET, exist_ok=True)
    for name in FUNCTIONS:
        src = os.path.join(BACKEND, name)
        dst = os.path.join(TARGET, name)
        if not os.path.isdir(src):
            print(f"пропуск: {name} — нет папки {src}")
            continue
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        shutil.copytree(
            src, dst,
            ignore=shutil.ignore_patterns("__pycache__", "tests.json", "*.pyc"),
        )
        print(f"скопировано: {name}")
    print(f"\nГотово. Папка: {os.path.abspath(TARGET)}")
    print("Скопируйте каталог backup-server на второй ПК и запустите start.bat")


if __name__ == "__main__":
    main()
