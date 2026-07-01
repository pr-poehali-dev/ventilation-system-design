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


def _find_dist():
    meipass = getattr(sys, "_MEIPASS", None)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(meipass, "pvs-core", "dist") if meipass else None,
        os.path.join(meipass, "dist") if meipass else None,
        os.path.join(script_dir, "dist"),
    ]
    candidates = [c for c in candidates if c]

    log_path = os.path.join(os.path.expanduser("~"), "pvs_debug.txt")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(f"_MEIPASS={meipass}\n")
        f.write(f"script_dir={script_dir}\n")
        for c in candidates:
            exists = os.path.isdir(c)
            has_index = os.path.exists(os.path.join(c, "index.html")) if exists else False
            f.write(f"  [{exists}/{has_index}] {c}\n")
            if exists:
                try:
                    files = os.listdir(c)[:10]
                    f.write(f"    files: {files}\n")
                except Exception as e:
                    f.write(f"    listdir error: {e}\n")

    for c in candidates:
        if os.path.isdir(c) and os.path.exists(os.path.join(c, "index.html")):
            return c
    return candidates[-1]


DIST_FOLDER = _find_dist()

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


# ─── Сохранение файла (заглушка — диалог обрабатывает C#-обёртка) ────────────

@app.route("/api/save-file", methods=["POST", "OPTIONS"])
def api_save_file():
    if request.method == "OPTIONS":
        return handle_options()
    return cors_response({"ok": False, "error": "use window.chrome.webview in C# wrapper"}, 501)


# ─── Статус сервера ───────────────────────────────────────────────────────────

@app.route("/api/status")
def api_status():
    return cors_response({"status": "ok", "version": "1.0.0", "mode": "desktop"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5173, threaded=True, debug=False)