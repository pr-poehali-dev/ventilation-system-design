"""
ПВС-Система — десктопное приложение.
Запускает локальный Flask-сервер и открывает нативное окно через pywebview.
Поддерживает открытие .vproj двойным кликом из проводника.
"""
import os
import sys
import time
import json
import threading
import urllib.request

def resource(path):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, path)

sys.path.insert(0, resource("pvs-core"))

from server import app as flask_app  # noqa: E402

PORT = 5173
URL  = f"http://127.0.0.1:{PORT}"

# Файл переданный через аргумент командной строки (двойной клик на .vproj)
_pending_file = sys.argv[1] if len(sys.argv) > 1 else None
_window = None


class PvsApi:
    """API доступный из JavaScript через window.pywebview.api.*"""

    def get_pending_file(self):
        """Возвращает путь и содержимое файла переданного при запуске."""
        global _pending_file
        if not _pending_file or not os.path.exists(_pending_file):
            return None
        try:
            with open(_pending_file, "r", encoding="utf-8") as f:
                content = f.read()
            result = {"path": _pending_file, "content": content}
            _pending_file = None  # сбрасываем чтобы не открывать повторно
            return result
        except Exception as e:
            return {"error": str(e)}

    def read_file(self, path):
        """Читает произвольный .vproj файл с диска."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            return {"path": path, "content": content}
        except Exception as e:
            return {"error": str(e)}

    def write_file(self, path, content):
        """Сохраняет .vproj файл на диск."""
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}


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


def on_loaded():
    """Вызывается когда страница загрузилась — внедряем pywebviewAPI совместимый с electronAPI."""
    global _window
    if _window is None:
        return
    _window.evaluate_js("""
        window.electronAPI = {
            onOpenFile: function(handler) {
                window._pvs_open_handler = handler;
                // Проверяем есть ли файл переданный при запуске
                window.pywebview.api.get_pending_file().then(function(result) {
                    if (result && result.content) {
                        handler({ path: result.path, content: result.content });
                    }
                });
            },
            offOpenFile: function() {
                window._pvs_open_handler = null;
            },
            readFile: function(path) {
                return window.pywebview.api.read_file(path);
            },
            writeFile: function(path, content) {
                return window.pywebview.api.write_file(path, content);
            }
        };
    """)


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

    global _window
    _window = webview.create_window(
        "ПВ-Система",
        URL,
        width=1400,
        height=900,
        min_size=(1024, 700),
        resizable=True,
        js_api=PvsApi(),
    )
    _window.events.loaded += on_loaded

    webview.start()


if __name__ == "__main__":
    main()
