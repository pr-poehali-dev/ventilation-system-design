"""
ПВС-Система — локальный Flask-сервер.
Раздаёт React-билд и обрабатывает все расчётные API-запросы локально.
Лицензия проверяется через облачный сервер (один раз при запуске).
"""
import json
import os
import sys

from flask import Flask, jsonify, request, send_from_directory

import calc_aerodynamics
import calc_explosion

def resource(path):
    """Путь к ресурсам внутри .exe (PyInstaller _MEIPASS) или рядом с файлом."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, path)


DIST_FOLDER = resource("dist")

app = Flask(__name__, static_folder=DIST_FOLDER, static_url_path="")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token",
}


def cors_response(data: dict, status: int = 200):
    resp = jsonify(data)
    resp.status_code = status
    for k, v in CORS_HEADERS.items():
        resp.headers[k] = v
    return resp


def handle_options():
    from flask import Response
    r = Response("")
    r.status_code = 200
    for k, v in CORS_HEADERS.items():
        r.headers[k] = v
    return r


# ─── React SPA ────────────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    full = os.path.join(DIST_FOLDER, path)
    if path and os.path.exists(full):
        return send_from_directory(DIST_FOLDER, path)
    return send_from_directory(DIST_FOLDER, "index.html")


# ─── Аэродинамика ─────────────────────────────────────────────────────────────

@app.route("/api/aerodynamics", methods=["GET", "POST", "OPTIONS"])
def api_aerodynamics():
    if request.method == "OPTIONS":
        return handle_options()
    body = request.get_json(force=True, silent=True) or {}
    result = calc_aerodynamics.run(body)
    return cors_response(result)


# ─── Воздухораспределение ─────────────────────────────────────────────────────

@app.route("/api/airflow", methods=["GET", "POST", "OPTIONS"])
def api_airflow():
    if request.method == "OPTIONS":
        return handle_options()
    try:
        from backend_airflow import airflow_handler
        body = request.get_json(force=True, silent=True) or {}
        result = airflow_handler(body)
        return cors_response(result)
    except ImportError:
        return cors_response({"error": "airflow модуль не найден"}, 500)


# ─── Горноспасатели ───────────────────────────────────────────────────────────

@app.route("/api/rescue-calculator", methods=["GET", "POST", "OPTIONS"])
def api_rescue():
    if request.method == "OPTIONS":
        return handle_options()
    try:
        from backend_rescue import rescue_handler
        body = request.get_json(force=True, silent=True) or {}
        result = rescue_handler(body)
        return cors_response(result)
    except ImportError:
        return cors_response({"error": "rescue модуль не найден"}, 500)


# ─── Взрывы ───────────────────────────────────────────────────────────────────

@app.route("/api/explosion-calculator", methods=["GET", "POST", "OPTIONS"])
def api_explosion():
    if request.method == "OPTIONS":
        return handle_options()
    body = request.get_json(force=True, silent=True) or {}
    result = calc_explosion.run(body)
    return cors_response(result)


# ─── Гидравлика ППЗ ───────────────────────────────────────────────────────────

@app.route("/api/water-hydraulics", methods=["GET", "POST", "OPTIONS"])
def api_water():
    if request.method == "OPTIONS":
        return handle_options()
    try:
        from backend_hydraulics import hydraulics_handler
        body = request.get_json(force=True, silent=True) or {}
        result = hydraulics_handler(body)
        return cors_response(result)
    except ImportError:
        return cors_response({"error": "hydraulics модуль не найден"}, 500)


# ─── Лицензия (проксируем в облако) ──────────────────────────────────────────

@app.route("/api/license", methods=["GET", "POST", "OPTIONS"])
def api_license():
    if request.method == "OPTIONS":
        return handle_options()
    import urllib.request
    CLOUD_LICENSE_URL = "https://functions.poehali.dev/a1965362-29d6-40c8-bdb6-48494e8a7db7"
    body_bytes = request.get_data()
    req = urllib.request.Request(
        CLOUD_LICENSE_URL,
        data=body_bytes,
        method=request.method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            return cors_response(data)
    except Exception as e:
        return cors_response({"error": str(e), "offline": True}, 503)


# ─── Сохранение файла через диалог Windows ────────────────────────────────────

@app.route("/api/save-file", methods=["POST", "OPTIONS"])
def api_save_file():
    if request.method == "OPTIONS":
        return handle_options()
    import base64
    import ctypes
    import threading

    body = request.get_json(force=True, silent=True) or {}
    filename = body.get("filename", "file.png")
    data_b64 = body.get("data", "")
    mime     = body.get("mime", "")

    ext = os.path.splitext(filename)[1].lower()
    filter_map = {
        ".png":  "PNG файлы\0*.png\0Все файлы\0*.*\0",
        ".jpg":  "JPEG файлы\0*.jpg\0Все файлы\0*.*\0",
        ".jpeg": "JPEG файлы\0*.jpg\0Все файлы\0*.*\0",
        ".bmp":  "BMP файлы\0*.bmp\0Все файлы\0*.*\0",
        ".tiff": "TIFF файлы\0*.tiff\0Все файлы\0*.*\0",
        ".svg":  "SVG файлы\0*.svg\0Все файлы\0*.*\0",
        ".pdf":  "PDF файлы\0*.pdf\0Все файлы\0*.*\0",
        ".xlsx": "Excel файлы\0*.xlsx\0Все файлы\0*.*\0",
        ".dxf":  "DXF файлы\0*.dxf\0Все файлы\0*.*\0",
        ".csv":  "CSV файлы\0*.csv\0Все файлы\0*.*\0",
    }
    file_filter = filter_map.get(ext, "Все файлы\0*.*\0")

    save_path_holder = [None]
    event = threading.Event()

    def show_dialog():
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            path = filedialog.asksaveasfilename(
                defaultextension=ext,
                initialfile=filename,
                filetypes=[(filter_map.get(ext, "Все файлы"), "*" + ext)],
            )
            root.destroy()
            save_path_holder[0] = path or None
        except Exception as e:
            save_path_holder[0] = None
        event.set()

    t = threading.Thread(target=show_dialog)
    t.start()
    event.wait(timeout=60)

    save_path = save_path_holder[0]
    if not save_path:
        return cors_response({"ok": False, "cancelled": True})

    try:
        if data_b64.startswith("data:"):
            data_b64 = data_b64.split(",", 1)[1]
        file_bytes = base64.b64decode(data_b64)
        with open(save_path, "wb") as f:
            f.write(file_bytes)
        return cors_response({"ok": True, "path": save_path})
    except Exception as e:
        return cors_response({"ok": False, "error": str(e)}, 500)


# ─── Статус сервера ───────────────────────────────────────────────────────────

@app.route("/api/status")
def api_status():
    return cors_response({"status": "ok", "version": "1.0.0", "mode": "desktop"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5173, threaded=True, debug=False)