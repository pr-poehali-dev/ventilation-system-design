"""
Дымовой тест собранного server.exe.

Запускается в конце build.bat: поднимает server.exe, ждёт готовности и дёргает
ключевые API. Если хоть один не отвечает — печатает причину и возвращает код 1,
чтобы сборка упала СРАЗУ, а не когда пользователь откроет программу.

Проверяем именно те точки, что уже ломались после защиты .pyc:
  /api/airflow        — расчёт сети (F9)
  /api/svg-to-pdf     — экспорт PDF+
  /api/aerodynamics   — аэродинамика (встроенный модуль)
  /                   — раздача интерфейса (index.html)

Использование:
    python smoke_test.py <path-to-server.exe>
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:5173"
STARTUP_TIMEOUT = 40  # сек на запуск server.exe
REQ_TIMEOUT = 15


def wait_ready() -> bool:
    """Ждём, пока сервер начнёт отвечать на корневой маршрут."""
    deadline = time.time() + STARTUP_TIMEOUT
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(BASE + "/", timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.7)
    return False


def post(path: str, payload: dict):
    """POST JSON; возвращает (ok, статус, короткое описание)."""
    url = BASE + path
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=REQ_TIMEOUT) as r:
            return _judge(r.status, r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        return _judge(e.code, detail)
    except Exception as e:
        return False, 0, str(e)


def _judge(status: int, body: str):
    # Главное — модуль НАЙДЕН и не упал внутри.
    # "модуль не найден" или 5xx = поломка сборки (FAIL).
    # 4xx (валидация неполного payload) считаем нормой — сервер жив (OK).
    if "модуль не найден" in body:
        return False, status, body[:200]
    if status >= 500:
        return False, status, body[:200]
    return True, status, body[:100]


def get(path: str):
    try:
        with urllib.request.urlopen(BASE + path, timeout=REQ_TIMEOUT) as r:
            return (r.status < 400), r.status, ""
    except Exception as e:
        return False, 0, str(e)


def main():
    if len(sys.argv) != 2:
        print("Usage: python smoke_test.py <server.exe>")
        sys.exit(2)

    exe = os.path.abspath(sys.argv[1])
    if not os.path.exists(exe):
        print(f"SMOKE FAIL: server.exe not found: {exe}")
        sys.exit(1)

    print("  Starting server.exe for smoke test...")
    proc = subprocess.Popen([exe], cwd=os.path.dirname(exe),
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not wait_ready():
            print("SMOKE FAIL: server.exe did not start / not responding on :5173")
            sys.exit(1)

        # Минимальные валидные payload'ы: сеть из 2 узлов и 1 ветви.
        net = {
            "nodes": [
                {"id": "n1", "x": 0, "y": 0, "z": 0},
                {"id": "n2", "x": 100, "y": 0, "z": 0},
            ],
            "branches": [
                {"id": "b1", "fromId": "n1", "toId": "n2", "resistance": 1.0},
            ],
        }
        svg = {"svg": "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'></svg>",
               "width_mm": 100, "height_mm": 100}

        checks = [
            ("GET  /", lambda: get("/")),
            ("POST /api/airflow", lambda: post("/api/airflow", net)),
            ("POST /api/aerodynamics", lambda: post("/api/aerodynamics", net)),
            ("POST /api/svg-to-pdf", lambda: post("/api/svg-to-pdf", svg)),
        ]

        failed = []
        for label, fn in checks:
            ok, status, detail = fn()
            mark = "OK " if ok else "FAIL"
            print(f"    [{mark}] {label}  (status {status}) {detail if not ok else ''}")
            if not ok:
                failed.append(label)

        if failed:
            print("SMOKE FAIL: " + ", ".join(failed))
            sys.exit(1)

        print("  Smoke test passed: all core APIs respond.")
        sys.exit(0)
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


if __name__ == "__main__":
    main()