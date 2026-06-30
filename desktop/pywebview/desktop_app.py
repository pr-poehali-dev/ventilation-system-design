"""
ПВС-Система — десктопное приложение.
Запускает локальный Flask-сервер и открывает нативное окно через pywebview.
"""
import os
import sys
import time
import threading
import urllib.request

def resource(path):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, path)

sys.path.insert(0, resource("pvs-core"))

from pvs_core.server import app as flask_app  # noqa: E402

PORT = 5173
URL  = f"http://127.0.0.1:{PORT}"


def run_flask():
    flask_app.run(host="127.0.0.1", port=PORT, threaded=True, debug=False, use_reloader=False)


def wait_for_server(timeout=15):
    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen(f"{URL}/api/status", timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    t = threading.Thread(target=run_flask, daemon=True)
    t.start()

    ready = wait_for_server()
    if not ready:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("ПВС-Система", "Не удалось запустить локальный сервер.")
        sys.exit(1)

    import webview
    webview.create_window(
        "ПВ-Система",
        URL,
        width=1400,
        height=900,
        min_size=(1024, 700),
        resizable=True,
    )
    webview.start()


if __name__ == "__main__":
    main()
