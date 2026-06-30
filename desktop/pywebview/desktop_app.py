"""
ПВС-Система — десктопное приложение.
Запускает локальный Flask-сервер и открывает нативное окно через pywebview.
Поддерживает открытие .vproj двойным кликом из проводника.
Автообновление через S3 хранилище.
"""
import os
import sys
import time
import json
import threading
import urllib.request
import tempfile
import shutil
import subprocess

CURRENT_VERSION = "1.0.0"
VERSION_CHECK_URL = "https://functions.poehali.dev/0ddfea8a-386f-4cb2-9fe0-37274caf2e16"


def resource(path):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, path)


sys.path.insert(0, resource("pvs-core"))

from server import app as flask_app  # noqa: E402

PORT = 5173
URL  = f"http://127.0.0.1:{PORT}"

_pending_file = sys.argv[1] if len(sys.argv) > 1 else None
_window = None
_update_info = None


def check_for_update():
    """Проверяет наличие новой версии на сервере."""
    global _update_info
    try:
        req = urllib.request.Request(VERSION_CHECK_URL, headers={"User-Agent": f"PVS/{CURRENT_VERSION}"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read().decode()
            data = json.loads(raw)
            if isinstance(data, str):
                data = json.loads(data)
            remote_ver = data.get("version", "1.0.0")
            if remote_ver != CURRENT_VERSION:
                _update_info = data
    except Exception:
        pass


def download_and_install_update(download_url):
    """Скачивает новый PVS.exe и перезапускает приложение."""
    try:
        exe_path = sys.executable if not getattr(sys, "frozen", False) else sys.executable
        tmp_path = exe_path + ".new.exe"
        upd_path = exe_path + ".old.exe"

        urllib.request.urlretrieve(download_url, tmp_path)

        bat = tempfile.NamedTemporaryFile(suffix=".bat", delete=False, mode="w", encoding="cp1251")
        bat.write(f"""
@echo off
timeout /t 2 /nobreak >nul
move /Y "{tmp_path}" "{exe_path}"
del "{upd_path}" 2>nul
start "" "{exe_path}"
del "%~f0"
""")
        bat.close()
        subprocess.Popen(["cmd", "/c", bat.name], creationflags=0x08000000)
        sys.exit(0)
    except Exception as e:
        return str(e)


class PvsApi:
    """API доступный из JavaScript через window.pywebview.api.*"""

    def get_pending_file(self):
        global _pending_file
        if not _pending_file or not os.path.exists(_pending_file):
            return None
        try:
            with open(_pending_file, "r", encoding="utf-8") as f:
                content = f.read()
            result = {"path": _pending_file, "content": content}
            _pending_file = None
            return result
        except Exception as e:
            return {"error": str(e)}

    def read_file(self, path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            return {"path": path, "content": content}
        except Exception as e:
            return {"error": str(e)}

    def write_file(self, path, content):
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def save_file_dialog(self, filename):
        """Открывает диалог сохранения файла, возвращает выбранный путь."""
        import webview
        ext = os.path.splitext(filename)[1].lower()
        type_map = {
            ".png":  "PNG файлы (*.png)|*.png",
            ".jpg":  "JPEG файлы (*.jpg)|*.jpg",
            ".jpeg": "JPEG файлы (*.jpg)|*.jpg",
            ".bmp":  "BMP файлы (*.bmp)|*.bmp",
            ".tiff": "TIFF файлы (*.tiff)|*.tiff",
            ".svg":  "SVG файлы (*.svg)|*.svg",
            ".pdf":  "PDF файлы (*.pdf)|*.pdf",
            ".xlsx": "Excel файлы (*.xlsx)|*.xlsx",
            ".dxf":  "DXF файлы (*.dxf)|*.dxf",
            ".csv":  "CSV файлы (*.csv)|*.csv",
        }
        file_types = (type_map.get(ext, "Все файлы (*.*)"),)
        result = _window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=filename,
            file_types=file_types,
        )
        if result:
            return result if isinstance(result, str) else result[0]
        return None

    def save_binary(self, path, data_base64):
        """Сохраняет бинарный файл (base64) на диск."""
        import base64
        try:
            data = base64.b64decode(data_base64)
            with open(path, "wb") as f:
                f.write(data)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def get_version(self):
        return {"current": CURRENT_VERSION, "update": _update_info}

    def install_update(self):
        if not _update_info:
            return {"error": "Нет доступных обновлений"}
        url = _update_info.get("download_url")
        if not url:
            return {"error": "Ссылка на обновление не найдена"}
        err = download_and_install_update(url)
        if err:
            return {"error": err}
        return {"ok": True}


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
    global _window
    if _window is None:
        return
    update_json = json.dumps(_update_info) if _update_info else "null"

    js_static = """
(function() {
    var SAVE_URL = 'http://127.0.0.1:5173/api/save-file';

    function saveViaApi(filename, dataUrl) {
        fetch(SAVE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: filename, data: dataUrl })
        });
    }

    function interceptAnchor(a) {
        if (!a.download) return false;
        var href = a.href;
        var filename = a.download || 'file';
        if (href.startsWith('data:')) {
            saveViaApi(filename, href);
            return true;
        }
        if (href.startsWith('blob:')) {
            fetch(href).then(function(r) { return r.blob(); }).then(function(blob) {
                var reader = new FileReader();
                reader.onload = function() { saveViaApi(filename, reader.result); };
                reader.readAsDataURL(blob);
            });
            return true;
        }
        return false;
    }

    var _origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
        if (interceptAnchor(this)) return;
        _origClick.call(this);
    };

    document.addEventListener('click', function(e) {
        var a = e.target.closest('a[download]');
        if (a && interceptAnchor(a)) e.preventDefault();
    }, true);

    var _xlsxInterval = setInterval(function() {
        if (typeof XLSX !== 'undefined' && XLSX.writeFile) {
            XLSX.writeFile = function(wb, filename) {
                var ext = filename.split('.').pop();
                var data = XLSX.write(wb, { bookType: ext, type: 'base64' });
                saveViaApi(filename, 'data:application/octet-stream;base64,' + data);
            };
            clearInterval(_xlsxInterval);
        }
    }, 300);

    window.electronAPI = {
        onOpenFile: function(handler) {
            window._pvs_open_handler = handler;
            if (window.pywebview && window.pywebview.api) {
                window.pywebview.api.get_pending_file().then(function(result) {
                    if (result && result.content) {
                        handler({ path: result.path, content: result.content });
                    }
                });
            }
        },
        offOpenFile: function() { window._pvs_open_handler = null; },
        readFile:  function(path)          { return window.pywebview && window.pywebview.api.read_file(path); },
        writeFile: function(path, content) { return window.pywebview && window.pywebview.api.write_file(path, content); },
        getVersion:    function() { return window.pywebview && window.pywebview.api.get_version(); },
        installUpdate: function() { return window.pywebview && window.pywebview.api.install_update(); }
    };
})();
"""

    js_update = (
        "var updateInfo = " + update_json + ";\n"
        "if (updateInfo && updateInfo.version) {\n"
        "  setTimeout(function() {\n"
        "    var b = document.createElement('div');\n"
        "    b.id = 'pvs-update-banner';\n"
        "    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#1d4ed8;color:#fff;padding:8px 16px;display:flex;align-items:center;gap:12px;font-family:sans-serif;font-size:13px;';\n"
        "    b.innerHTML = '<span>Доступно обновление <b>v' + updateInfo.version + '</b></span>'\n"
        "      + '<button onclick=\"window.electronAPI.installUpdate()\" style=\"margin-left:auto;background:#fff;color:#1d4ed8;border:none;padding:4px 14px;border-radius:4px;cursor:pointer;font-weight:600;\">Обновить</button>'\n"
        "      + '<button onclick=\"document.getElementById(\\\"pvs-update-banner\\\").remove()\" style=\"background:transparent;color:#fff;border:none;cursor:pointer;font-size:16px;\">✕</button>';\n"
        "    document.body.prepend(b);\n"
        "  }, 3000);\n"
        "}\n"
    )

    _window.evaluate_js(js_static + js_update)


def main():
    t = threading.Thread(target=run_flask, daemon=True)
    t.start()

    upd_thread = threading.Thread(target=check_for_update, daemon=True)
    upd_thread.start()

    ready = wait_for_server()
    if not ready:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("ПВС-Система", "Не удалось запустить локальный сервер.")
        sys.exit(1)

    upd_thread.join(timeout=5)

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

    webview.start(debug=True)


if __name__ == "__main__":
    main()