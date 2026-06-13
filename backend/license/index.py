"""
Лицензионный сервис ПВ-Системы.
POST / body: {action: "check"|"activate", fingerprint, key?}
  check    — есть ли уже активный fingerprint в БД
  activate — привязать ключ к fingerprint
"""
import json
import os
import hashlib
import re
from datetime import datetime, timezone
import psycopg2


CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def get_conn():
    dsn = os.environ["DATABASE_URL"]
    schema = os.environ.get("MAIN_DB_SCHEMA", "public")
    # options передаём через DSN, не через SET (SET search_path запрещён прокси)
    conn = psycopg2.connect(dsn, options=f"-c search_path={schema}")
    return conn


def resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def validate_key(key: str) -> bool:
    return bool(re.match(r"^PVS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$", key))


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            return resp(400, {"error": "invalid_json"})

    action      = body.get("action", "").strip()
    fingerprint = body.get("fingerprint", "").strip()[:128]
    user_agent  = (event.get("headers") or {}).get("user-agent", "")[:500]

    if not fingerprint:
        return resp(400, {"error": "fingerprint_required"})

    fp_hash = hashlib.sha256(fingerprint.encode()).hexdigest()[:64]

    conn = get_conn()
    cur  = conn.cursor()

    # ── check ──────────────────────────────────────────────────────────────────
    if action == "check":
        cur.execute("""
            SELECT l.key, l.owner_name, l.max_seats, l.is_active, l.expires_at,
                   (SELECT COUNT(*) FROM license_seats WHERE license_id = l.id) AS used_seats
            FROM license_seats s
            JOIN licenses l ON l.id = s.license_id
            WHERE s.fingerprint = %s
            ORDER BY s.activated_at DESC
            LIMIT 1
        """, (fp_hash,))
        row = cur.fetchone()

        if not row:
            conn.close()
            return resp(200, {"licensed": False})

        key, owner, max_seats, is_active, expires_at, used_seats = row

        if not is_active:
            conn.close()
            return resp(200, {"licensed": False, "reason": "license_disabled"})

        if expires_at and expires_at < datetime.now(timezone.utc):
            conn.close()
            return resp(200, {"licensed": False, "reason": "license_expired"})

        cur.execute(
            "UPDATE license_seats SET last_seen_at = NOW() WHERE fingerprint = %s",
            (fp_hash,)
        )
        conn.commit()
        conn.close()
        return resp(200, {
            "licensed": True,
            "key": key,
            "owner": owner,
            "seats": {"max": max_seats, "used": int(used_seats)},
        })

    # ── activate ───────────────────────────────────────────────────────────────
    if action == "activate":
        license_key = body.get("key", "").strip().upper()

        if not validate_key(license_key):
            conn.close()
            return resp(400, {"error": "invalid_key_format"})

        cur.execute(
            "SELECT id, owner_name, max_seats, is_active, expires_at FROM licenses WHERE key = %s",
            (license_key,)
        )
        lic = cur.fetchone()
        if not lic:
            conn.close()
            return resp(404, {"error": "key_not_found"})

        lic_id, owner, max_seats, is_active, expires_at = lic

        if not is_active:
            conn.close()
            return resp(403, {"error": "license_disabled"})

        if expires_at and expires_at < datetime.now(timezone.utc):
            conn.close()
            return resp(403, {"error": "license_expired"})

        cur.execute(
            "SELECT id FROM license_seats WHERE license_id = %s AND fingerprint = %s",
            (lic_id, fp_hash)
        )
        existing = cur.fetchone()

        if not existing:
            cur.execute("SELECT COUNT(*) FROM license_seats WHERE license_id = %s", (lic_id,))
            used = cur.fetchone()[0]
            if used >= max_seats:
                conn.close()
                return resp(403, {
                    "error": "seats_exhausted",
                    "max_seats": max_seats,
                    "used_seats": int(used),
                })
            cur.execute(
                "INSERT INTO license_seats (license_id, fingerprint, user_agent) VALUES (%s, %s, %s)",
                (lic_id, fp_hash, user_agent)
            )
        else:
            cur.execute(
                "UPDATE license_seats SET last_seen_at = NOW() WHERE license_id = %s AND fingerprint = %s",
                (lic_id, fp_hash)
            )

        conn.commit()
        cur.execute("SELECT COUNT(*) FROM license_seats WHERE license_id = %s", (lic_id,))
        used_seats = cur.fetchone()[0]
        conn.close()

        return resp(200, {
            "licensed": True,
            "key": license_key,
            "owner": owner,
            "seats": {"max": max_seats, "used": int(used_seats)},
        })

    conn.close()
    return resp(400, {"error": "unknown_action"})