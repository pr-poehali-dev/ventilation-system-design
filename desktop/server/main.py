"""
Локальный HTTP-сервер для ПВ-Система Desktop.
Запускается как sidecar-процесс при старте Tauri-приложения.
Порт: 54321
"""
import sys
import os
import json
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# Добавляем путь к backend-функциям
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "functions")
sys.path.insert(0, BACKEND_DIR)

# ─── Проверка целостности при старте ─────────────────────────────────────────
from integrity import check_exe_integrity, write_exe_signature, save_cache_signed, load_cache_signed

write_exe_signature()
if not check_exe_integrity():
    sys.exit(1)

PORT = 54321

# ─── Импорт обработчиков из backend-функций ───────────────────────────────────

def load_handler(module_name: str):
    import importlib.util
    path = os.path.join(BACKEND_DIR, module_name, "index.py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.handler

handlers = {}

def try_load(name):
    try:
        handlers[name] = load_handler(name)
        print(f"[server] ✓ Загружен модуль: {name}")
    except Exception as e:
        print(f"[server] ✗ Ошибка загрузки {name}: {e}")

for fn in [
    "aerodynamics",
    "airflow",
    "rescue-calculator",
    "water-hydraulics",
    "explosion-calculator",
    "svg-to-pdf",
    "license",
]:
    try_load(fn)

# ─── Кэш лицензии (offline, подписанный HMAC) ────────────────────────────────

LICENSE_CACHE_PATH = os.path.join(BASE_DIR, "license_cache.json")

def load_license_cache() -> dict:
    result = load_cache_signed(LICENSE_CACHE_PATH)
    return result if result is not None else {}

def save_license_cache(data: dict):
    try:
        save_cache_signed(LICENSE_CACHE_PATH, data)
    except Exception as e:
        print(f"[server] Ошибка сохранения кэша лицензии: {e}")

# ─── Роутинг ──────────────────────────────────────────────────────────────────

ROUTES = {
    "/aerodynamics":       "aerodynamics",
    "/airflow":            "airflow",
    "/rescue-calculator":  "rescue-calculator",
    "/water-hydraulics":   "water-hydraulics",
    "/explosion-calculator": "explosion-calculator",
    "/svg-to-pdf":         "svg-to-pdf",
    "/license":            "license",
}

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Authorization",
    "Access-Control-Max-Age": "86400",
}

class Handler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass  # Отключаем стандартный лог, слишком шумный

    def send_json(self, status: int, body: dict, extra_headers: dict = None):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def send_raw(self, status: int, content_type: str, data: bytes):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(200)
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json(200, {"status": "ok", "version": "1.0"})
            return
        if path == "/routes":
            self.send_json(200, {"routes": list(ROUTES.keys())})
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        path = urlparse(self.path).path

        # Читаем body
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length) if length > 0 else b""

        # Строим event в формате cloud function
        event = {
            "httpMethod": "POST",
            "path": path,
            "headers": dict(self.headers),
            "body": raw_body.decode("utf-8") if raw_body else "",
            "queryStringParameters": {},
            "isBase64Encoded": False,
        }

        # Проверяем маршрут
        fn_name = ROUTES.get(path)
        if not fn_name:
            self.send_json(404, {"error": "route_not_found", "path": path})
            return

        # Специальная обработка лицензии с кэшем
        if fn_name == "license":
            self._handle_license(event, raw_body)
            return

        # Вызываем обработчик
        handler_fn = handlers.get(fn_name)
        if not handler_fn:
            self.send_json(503, {"error": "handler_not_loaded", "function": fn_name})
            return

        try:
            result = handler_fn(event, None)
        except Exception as e:
            print(f"[server] Ошибка в {fn_name}: {e}")
            self.send_json(500, {"error": str(e)})
            return

        # Если функция вернула PDF (bytes в body)
        body = result.get("body", "")
        status = result.get("statusCode", 200)

        if result.get("isBase64Encoded") and isinstance(body, str):
            import base64
            raw = base64.b64decode(body)
            ct = (result.get("headers") or {}).get("Content-Type", "application/octet-stream")
            self.send_raw(status, ct, raw)
            return

        if isinstance(body, bytes):
            ct = (result.get("headers") or {}).get("Content-Type", "application/octet-stream")
            self.send_raw(status, ct, body)
            return

        # Обычный JSON-ответ
        try:
            parsed = json.loads(body) if isinstance(body, str) else body
        except Exception:
            parsed = {"raw": body}

        self.send_json(status, parsed)

    def _handle_license(self, event: dict, raw_body: bytes):
        """Лицензия с offline-кэшем: если нет БД — используем кэш."""
        handler_fn = handlers.get("license")
        cache = load_license_cache()

        try:
            body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except Exception:
            body = {}

        action = body.get("action", "")
        fingerprint = body.get("fingerprint", "")

        # Пробуем облако
        if handler_fn:
            try:
                result = handler_fn(event, None)
                parsed = json.loads(result.get("body", "{}"))

                # Успешная проверка/активация — сохраняем в кэш
                if parsed.get("licensed") and action in ("check", "activate"):
                    cache[fingerprint] = {
                        "licensed": True,
                        "key": parsed.get("key"),
                        "owner": parsed.get("owner"),
                        "seats": parsed.get("seats"),
                        "cached_at": __import__("datetime").datetime.now().isoformat(),
                    }
                    save_license_cache(cache)

                self.send_json(result.get("statusCode", 200), parsed)
                return
            except Exception as e:
                print(f"[server] License: облако недоступно ({e}), используем кэш")

        # Облако недоступно — проверяем кэш
        if action == "check" and fingerprint in cache:
            cached = cache[fingerprint]
            self.send_json(200, {
                "licensed": cached.get("licensed", False),
                "key": cached.get("key"),
                "owner": cached.get("owner"),
                "seats": cached.get("seats"),
                "offline": True,
            })
            return

        # Ничего нет
        self.send_json(200, {"licensed": False, "reason": "offline_no_cache"})


# ─── Запуск ───────────────────────────────────────────────────────────────────

def run():
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[server] ПВ-Система Backend запущен на http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[server] Остановлен")
    finally:
        server.server_close()

if __name__ == "__main__":
    run()