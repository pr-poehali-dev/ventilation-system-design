"""
Публичная конфигурация расчётного сервера ПВ-Системы.
Клиент читает при старте, чтобы знать, какой сервер расчёта использовать:
основной (primary) или аварийный резервный (backup).

GET /  →  {active: 'primary'|'backup', backup_url: str, autofailover: bool}

Настройки задаёт администратор через админ-панель (backend/admin-licenses,
действия get_compute_config/set_compute_config). Здесь — только чтение, без
пароля, чтобы любое рабочее место могло узнать актуальный сервер.
"""
import json
import os
import psycopg2

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def get_conn():
    dsn = os.environ["DATABASE_URL"]
    schema = os.environ.get("MAIN_DB_SCHEMA", "public")
    return psycopg2.connect(dsn, options=f"-c search_path={schema}")


def resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body, default=str),
    }


def handler(event: dict, context) -> dict:
    """Возвращает активный расчётный сервер и адрес резерва (только чтение)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT key, value FROM app_settings WHERE key IN "
            "('compute_active','compute_backup_url','compute_autofailover')"
        )
        cfg = {r[0]: r[1] for r in cur.fetchall()}
        return resp(200, {
            "active": cfg.get("compute_active", "primary"),
            "backup_url": cfg.get("compute_backup_url", ""),
            "autofailover": cfg.get("compute_autofailover", "1") == "1",
        })
    finally:
        conn.close()
