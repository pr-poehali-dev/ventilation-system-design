"""
ПВ-Система — АВАРИЙНЫЙ РАСЧЁТНЫЙ СЕРВЕР.

Поднимается на любом втором ПК (Windows/Linux) и считает ровно то же самое,
что облачный основной сервер: воздухораспределение, аэродинамику,
горноспасательные расчёты, взрывы, водопровод.

Адрес этого сервера админ вписывает в панели администратора:
    Сервер расчёта → Адрес аварийного сервера (URL)

Запуск:
    pip install -r requirements.txt
    python server.py                 # слушает 0.0.0.0:8800
    python server.py --port 9000     # другой порт

Проверка живости:  GET http://<ip-этого-пк>:8800/health
Расчёт:            POST http://<ip-этого-пк>:8800/          (тело как у облака)
"""
import argparse
import importlib.util
import json
import os
import sys
import traceback

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from flask import Flask, Response, jsonify, request

APP_NAME = "ПВ-Система — аварийный расчётный сервер"

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token",
    "Access-Control-Max-Age": "86400",
}

# Какие расчётные функции обслуживает резерв. Имена совпадают с папками
# в каталоге backend основного проекта.
FUNCTIONS = [
    "airflow",
    "aerodynamics",
    "rescue-calculator",
    "explosion-calculator",
    "water-hydraulics",
]

# Функция по умолчанию: фронтенд шлёт расчёт воздухораспределения
# прямо на корневой URL резерва, без пути.
DEFAULT_FUNCTION = "airflow"

_HANDLERS = {}


def _script_dir() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def _function_dirs(name: str):
    """Где ищем index.py конкретной функции."""
    here = _script_dir()
    return [
        os.path.join(here, "functions", name),          # рядом с сервером (рекомендуется)
        os.path.join(here, "backend", name),
        os.path.join(here, "..", "backend", name),      # запуск прямо из репозитория
    ]


def load_handler(name: str):
    """Импортирует handler(event, context) расчётной функции."""
    if name in _HANDLERS:
        return _HANDLERS[name]

    path = None
    for d in _function_dirs(name):
        candidate = os.path.join(d, "index.py")
        if os.path.exists(candidate):
            path = candidate
            break

    if not path:
        _HANDLERS[name] = None
        return None

    spec = importlib.util.spec_from_file_location(f"pvs_{name.replace('-', '_')}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    handler = getattr(module, "handler", None)
    _HANDLERS[name] = handler
    return handler


def cors(payload: dict, status: int = 200):
    resp = jsonify(payload)
    resp.status_code = status
    for k, v in CORS_HEADERS.items():
        resp.headers[k] = v
    return resp


def options_ok():
    resp = Response("")
    resp.status_code = 200
    for k, v in CORS_HEADERS.items():
        resp.headers[k] = v
    return resp


def run_function(name: str):
    """Вызывает расчётную функцию так же, как облачная платформа."""
    handler = load_handler(name)
    if handler is None:
        return cors({
            "error": f"Расчётный модуль «{name}» не найден на резервном сервере. "
                     f"Скопируйте папку backend/{name} в functions/{name}.",
        }, 500)

    event = {
        "httpMethod": request.method,
        "body": request.get_data(as_text=True) or "",
        "headers": dict(request.headers),
        "queryStringParameters": dict(request.args),
        "isBase64Encoded": False,
        "requestContext": {"identity": {"sourceIp": request.remote_addr or ""}},
    }

    try:
        result = handler(event, None)
    except BaseException as ex:
        print("CALC_FAIL:", name, ex)
        traceback.print_exc()
        return cors({"error": str(ex)}, 500)

    status = result.get("statusCode", 200)
    raw = result.get("body", "")
    try:
        data = json.loads(raw) if isinstance(raw, str) and raw else (raw or {})
    except Exception:
        data = {"raw": raw}
    return cors(data, status)


app = Flask(__name__)


@app.route("/", methods=["GET", "POST", "OPTIONS"])
def root():
    if request.method == "OPTIONS":
        return options_ok()
    if request.method == "GET":
        return cors(health_payload())
    return run_function(DEFAULT_FUNCTION)


@app.route("/health", methods=["GET", "OPTIONS"])
def health():
    if request.method == "OPTIONS":
        return options_ok()
    return cors(health_payload())


@app.route("/<name>", methods=["GET", "POST", "OPTIONS"])
@app.route("/api/<name>", methods=["GET", "POST", "OPTIONS"])
def by_name(name: str):
    if request.method == "OPTIONS":
        return options_ok()
    if name not in FUNCTIONS:
        return cors({"error": f"Неизвестный расчёт «{name}»"}, 404)
    if request.method == "GET":
        return cors({"ok": True, "function": name})
    return run_function(name)


def health_payload() -> dict:
    ready = {n: load_handler(n) is not None for n in FUNCTIONS}
    return {
        "ok": all(ready.values()),
        "role": "backup",
        "service": "pvs-compute",
        "functions": ready,
    }


def lan_ip() -> str:
    """IP этого ПК в локальной сети — его вписывают в админ-панели."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


def ensure_cert(ip: str):
    """Готовит самоподписанный сертификат для режима --https.

    Нужен, когда программа открыта по https, а интернет-туннель недоступен
    (закрытая сеть предприятия). Сертификат выписывается на IP этого ПК.
    """
    here = _script_dir()
    cert = os.path.join(here, "cert.pem")
    key = os.path.join(here, "key.pem")
    if os.path.exists(cert) and os.path.exists(key):
        return cert, key

    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime
        import ipaddress
    except ImportError:
        print("\n[!] Для режима --https нужен пакет cryptography.")
        print("    Установите:  .venv\\Scripts\\python.exe -m pip install cryptography\n")
        return None, None

    pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, ip),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "PVS Backup Compute Server"),
    ])
    now = datetime.datetime.utcnow()
    san = [x509.DNSName("localhost")]
    try:
        san.append(x509.IPAddress(ipaddress.ip_address(ip)))
        san.append(x509.IPAddress(ipaddress.ip_address("127.0.0.1")))
    except Exception:
        pass

    crt = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name)
        .public_key(pk.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .sign(pk, hashes.SHA256())
    )

    with open(key, "wb") as f:
        f.write(pk.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))
    with open(cert, "wb") as f:
        f.write(crt.public_bytes(serialization.Encoding.PEM))

    print(f"Создан сертификат на 10 лет для {ip}")
    return cert, key


def main():
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--host", default="0.0.0.0", help="Адрес прослушивания")
    parser.add_argument("--port", type=int, default=8800, help="Порт (по умолчанию 8800)")
    parser.add_argument("--https", action="store_true",
                        help="Защищённый режим со своим сертификатом (для браузерной версии)")
    args = parser.parse_args()

    state = health_payload()
    ip = lan_ip()
    scheme = "https" if args.https else "http"
    addr = f"{scheme}://{ip}:{args.port}/"

    print(f"\n{APP_NAME}")
    for name, ok in state["functions"].items():
        print(f"  {'OK ' if ok else '-- '} {name}")
    if not state["ok"]:
        print("\nВНИМАНИЕ: часть расчётных модулей не найдена — скопируйте их в папку functions/")

    print("\n" + "=" * 62)
    print("  АДРЕС ДЛЯ АДМИН-ПАНЕЛИ (скопируйте в поле «Адрес аварийного сервера»):")
    print(f"\n      {addr}\n")
    print(f"  Проверка в браузере: {addr}health")
    print("=" * 62)

    if args.https:
        print("\n  ЗАЩИЩЁННЫЙ РЕЖИМ. Один раз на каждом рабочем ПК откройте адрес")
        print("  проверки в браузере и разрешите переход («Дополнительно» →")
        print("  «Перейти на сайт»). После этого резерв заработает в программе.")

    print("\nОкно не закрывать — пока оно открыто, сервер работает.\n")

    ssl_ctx = None
    if args.https:
        cert, key = ensure_cert(ip)
        if not cert:
            return 1
        ssl_ctx = (cert, key)

    if ssl_ctx:
        app.run(host=args.host, port=args.port, threaded=True,
                debug=False, ssl_context=ssl_ctx)
        return 0

    try:
        from waitress import serve
        serve(app, host=args.host, port=args.port, threads=8)
    except ImportError:
        app.run(host=args.host, port=args.port, threaded=True, debug=False)


if __name__ == "__main__":
    sys.exit(main())