"""
ПВС-Система — локальный Flask-сервер.
Раздаёт React-билд и обрабатывает все расчётные API-запросы локально.
Лицензия проверяется через облачный сервер (один раз при запуске).
"""
import json
import os
import sys
import importlib.util

from flask import Flask, jsonify, request, send_from_directory

import calc_aerodynamics
import calc_explosion

def resource(path):
    """Путь к ресурсам внутри .exe (PyInstaller _MEIPASS) или рядом с файлом."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, path)


# ─── Динамическая загрузка backend-функций (airflow, rescue, hydraulics, svg-to-pdf) ──
# Реальные функции лежат рядом в папке backend_functions/<name>/index.py и содержат
# handler(event, context) -> {statusCode, body}. Загружаем handler один раз и кэшируем.
_HANDLER_CACHE = {}


def _load_backend_handler(name: str):
    """Загружает handler(event, context) из backend_functions/<name>/index.py."""
    if name in _HANDLER_CACHE:
        return _HANDLER_CACHE[name]

    script_dir = os.path.dirname(os.path.abspath(__file__))
    meipass = getattr(sys, "_MEIPASS", None)
    # Ищем backend_functions рядом с server.py и во всех вероятных местах bundle.
    # ВАЖНО: в защищённой сборке исходники .py компилируются в .pyc и удаляются,
    # поэтому ищем оба варианта — сперва index.py, затем index.pyc.
    base_dirs = [os.path.join(script_dir, "backend_functions", name)]
    if meipass:
        base_dirs.append(os.path.join(meipass, "pvs-core", "backend_functions", name))
        base_dirs.append(os.path.join(meipass, "backend_functions", name))

    candidates = []
    for d in base_dirs:
        candidates.append(os.path.join(d, "index.py"))
        candidates.append(os.path.join(d, "index.pyc"))

    path = next((c for c in candidates if os.path.exists(c)), None)
    if not path:
        _HANDLER_CACHE[name] = None
        return None

    # Для .pyc нужен SourcelessFileLoader (иначе spec может не подобрать loader).
    if path.endswith(".pyc"):
        from importlib.machinery import SourcelessFileLoader
        loader = SourcelessFileLoader(f"bf_{name}", path)
        spec = importlib.util.spec_from_loader(f"bf_{name}", loader)
    else:
        spec = importlib.util.spec_from_file_location(f"bf_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    handler = getattr(mod, "handler", None)
    _HANDLER_CACHE[name] = handler
    return handler


def call_backend(name: str):
    """Вызывает backend-функцию как в облаке и возвращает Flask-ответ.

    Оборачивает тело запроса в event {httpMethod, body}, вызывает handler,
    распаковывает {statusCode, body} в «сырой» JSON — именно его ждёт фронт.
    """
    handler = _load_backend_handler(name)
    if handler is None:
        return cors_response({"error": f"{name} модуль не найден"}, 500)

    event = {
        "httpMethod": request.method,
        "body": request.get_data(as_text=True) or "",
        "headers": dict(request.headers),
        "queryStringParameters": dict(request.args),
        "isBase64Encoded": False,
    }
    try:
        result = handler(event, None)
    except Exception as e:
        import traceback
        return cors_response({"error": str(e), "trace": traceback.format_exc()}, 500)

    status = result.get("statusCode", 200)
    raw_body = result.get("body", "")
    try:
        data = json.loads(raw_body) if isinstance(raw_body, str) else raw_body
    except Exception:
        data = {"raw": raw_body}
    return cors_response(data, status)


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


@app.after_request
def _no_cache(resp):
    # Десктоп грузит фронтенд из локального сервера. Отключаем кэш браузера,
    # иначе WebView2 после пересборки показывает СТАРЫЙ интерфейс
    # (старые index.html/js/css из кэша). Файлы локальные — кэш не нужен.
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


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
    return call_backend("airflow")


# ─── Горноспасатели ───────────────────────────────────────────────────────────

@app.route("/api/rescue-calculator", methods=["GET", "POST", "OPTIONS"])
def api_rescue():
    if request.method == "OPTIONS":
        return handle_options()
    return call_backend("rescue-calculator")


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
    return call_backend("water-hydraulics")


# ─── SVG → векторный PDF (экспорт PDF+) ──────────────────────────────────────

@app.route("/api/svg-to-pdf", methods=["POST", "OPTIONS"])
def api_svg_to_pdf():
    if request.method == "OPTIONS":
        return handle_options()
    return call_backend("svg-to-pdf")


# ─── Лицензия (проксируем в облако) ──────────────────────────────────────────

@app.route("/api/license", methods=["GET", "POST", "OPTIONS"])
def api_license():
    if request.method == "OPTIONS":
        return handle_options()
    import urllib.request
    import urllib.error
    CLOUD_LICENSE_URL = "https://functions.poehali.dev/a1965362-df5e-40d6-ab62-0b523b49b023"
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
    except urllib.error.HTTPError as e:
        # Облако вернуло ошибку (например неверный ключ) — пробрасываем
        # реальный статус и тело, чтобы интерфейс показал понятную причину.
        try:
            data = json.loads(e.read().decode())
        except Exception:
            data = {"error": "activation_failed"}
        return cors_response(data, e.code)
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