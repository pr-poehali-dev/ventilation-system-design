"""
Административный API для управления лицензиями ПВ-Системы.
Защищён паролем через заголовок X-Admin-Password.

POST /  body: {action, password, ...params}
  list_licenses    — список всех лицензий с занятыми местами
  create_license   — создать новый ключ {owner_name, owner_email, max_seats, expires_at, notes}
  update_license   — изменить лицензию {license_id, owner_name, owner_email, max_seats, expires_at, notes}
  toggle_license   — включить/отключить лицензию {license_id, is_active}
  delete_license   — удалить лицензию и все места {license_id}
  list_seats       — места конкретной лицензии {license_id}
  revoke_seat      — освободить место {seat_id}
  generate_key     — сгенерировать ключ формата PVS-XXXX-XXXX-XXXX-XXXX
"""
import json
import os
import random
import string
import hashlib
import re
from datetime import datetime, timezone
import psycopg2

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
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


def check_auth(event: dict, body: dict) -> bool:
    admin_pass = os.environ.get("ADMIN_PASSWORD", "").strip()
    if not admin_pass:
        print("[admin] ADMIN_PASSWORD not set")
        return False
    provided = (
        body.get("password", "")
        or (event.get("headers") or {}).get("x-admin-password", "")
        or (event.get("headers") or {}).get("X-Admin-Password", "")
    )
    provided = provided.strip()
    match = provided == admin_pass
    print(f"[admin] auth check: provided_len={len(provided)} expected_len={len(admin_pass)} match={match}")
    return match


def generate_key() -> str:
    chars = string.ascii_uppercase + string.digits
    parts = ["".join(random.choices(chars, k=4)) for _ in range(4)]
    return "PVS-" + "-".join(parts)


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            return resp(400, {"error": "invalid_json"})

    if not check_auth(event, body):
        return resp(401, {"error": "unauthorized"})

    action = body.get("action", "").strip()

    conn = get_conn()
    cur = conn.cursor()

    try:
        # ── generate_key ────────────────────────────────────────────────────────
        if action == "generate_key":
            return resp(200, {"key": generate_key()})

        # ── list_licenses ────────────────────────────────────────────────────────
        if action == "list_licenses":
            cur.execute("""
                SELECT l.id, l.key, l.owner_name, l.owner_email,
                       l.max_seats, l.is_active, l.created_at, l.expires_at, l.notes,
                       COUNT(s.id) AS used_seats,
                       MAX(s.last_seen_at) AS last_activity
                FROM licenses l
                LEFT JOIN license_seats s ON s.license_id = l.id
                GROUP BY l.id
                ORDER BY l.created_at DESC
            """)
            rows = cur.fetchall()
            licenses = []
            for r in rows:
                licenses.append({
                    "id": r[0], "key": r[1], "owner_name": r[2],
                    "owner_email": r[3], "max_seats": r[4],
                    "is_active": r[5], "created_at": str(r[6]),
                    "expires_at": str(r[7]) if r[7] else None,
                    "notes": r[8], "used_seats": int(r[9]),
                    "last_activity": str(r[10]) if r[10] else None,
                })
            return resp(200, {"licenses": licenses})

        # ── create_license ───────────────────────────────────────────────────────
        if action == "create_license":
            owner_name  = body.get("owner_name", "").strip()
            owner_email = body.get("owner_email", "").strip()
            max_seats   = int(body.get("max_seats", 5))
            expires_at  = body.get("expires_at") or None
            notes       = body.get("notes", "").strip()
            key         = body.get("key") or generate_key()

            if not owner_name:
                return resp(400, {"error": "owner_name_required"})
            if max_seats < 1 or max_seats > 100:
                return resp(400, {"error": "invalid_seats"})

            cur.execute("""
                INSERT INTO licenses (key, owner_name, owner_email, max_seats, expires_at, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, key, created_at
            """, (key, owner_name, owner_email or None, max_seats, expires_at, notes or None))
            row = cur.fetchone()
            conn.commit()
            return resp(200, {
                "id": row[0], "key": row[1], "created_at": str(row[2]),
                "owner_name": owner_name, "max_seats": max_seats,
            })

        # ── update_license ───────────────────────────────────────────────────────
        if action == "update_license":
            lic_id      = int(body.get("license_id", 0))
            owner_name  = body.get("owner_name", "").strip()
            owner_email = body.get("owner_email", "").strip()
            max_seats   = int(body.get("max_seats", 5))
            expires_at  = body.get("expires_at") or None
            notes       = body.get("notes", "").strip()

            if not owner_name:
                return resp(400, {"error": "owner_name_required"})
            if max_seats < 1 or max_seats > 100:
                return resp(400, {"error": "invalid_seats"})

            cur.execute("""
                UPDATE licenses
                SET owner_name = %s, owner_email = %s, max_seats = %s,
                    expires_at = %s, notes = %s
                WHERE id = %s
                RETURNING id
            """, (owner_name, owner_email or None, max_seats, expires_at, notes or None, lic_id))
            if not cur.fetchone():
                return resp(404, {"error": "not_found"})
            conn.commit()
            return resp(200, {"ok": True})

        # ── toggle_license ───────────────────────────────────────────────────────
        if action == "toggle_license":
            lic_id    = int(body.get("license_id", 0))
            is_active = bool(body.get("is_active", True))
            cur.execute(
                "UPDATE licenses SET is_active = %s WHERE id = %s RETURNING id",
                (is_active, lic_id)
            )
            if not cur.fetchone():
                return resp(404, {"error": "not_found"})
            conn.commit()
            return resp(200, {"ok": True, "is_active": is_active})

        # ── delete_license ───────────────────────────────────────────────────────
        if action == "delete_license":
            lic_id = int(body.get("license_id", 0))
            cur.execute("DELETE FROM license_seats WHERE license_id = %s", (lic_id,))
            cur.execute("DELETE FROM licenses WHERE id = %s RETURNING id", (lic_id,))
            if not cur.fetchone():
                return resp(404, {"error": "not_found"})
            conn.commit()
            return resp(200, {"ok": True})

        # ── list_seats ───────────────────────────────────────────────────────────
        if action == "list_seats":
            lic_id = int(body.get("license_id", 0))
            cur.execute("""
                SELECT id, fingerprint, activated_at, last_seen_at,
                       user_agent, hostname, platform, screen_info
                FROM license_seats WHERE license_id = %s
                ORDER BY activated_at DESC
            """, (lic_id,))
            seats = []
            for r in cur.fetchall():
                seats.append({
                    "id": r[0],
                    "fingerprint": r[1][:12] + "...",
                    "activated_at": str(r[2]),
                    "last_seen_at": str(r[3]),
                    "user_agent": r[4],
                    "hostname":    r[5],
                    "platform":    r[6],
                    "screen_info": r[7],
                })
            return resp(200, {"seats": seats})

        # ── revoke_seat ──────────────────────────────────────────────────────────
        if action == "revoke_seat":
            seat_id = int(body.get("seat_id", 0))
            cur.execute("DELETE FROM license_seats WHERE id = %s RETURNING id", (seat_id,))
            if not cur.fetchone():
                return resp(404, {"error": "not_found"})
            conn.commit()
            return resp(200, {"ok": True})

        return resp(400, {"error": "unknown_action"})

    finally:
        conn.close()