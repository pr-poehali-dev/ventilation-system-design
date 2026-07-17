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
  monitoring_overview — сводка мониторинга: онлайн-сессии, нарушения,
                        истекающие лицензии, версии, использование модулей
  list_events      — журнал событий {license_id?, event_type?, limit?}
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
                       user_agent, hostname, platform, screen_info,
                       app_version, last_ip, last_modules,
                       (last_seen_at > NOW() - INTERVAL '10 minutes') AS online,
                       core_version
                FROM license_seats WHERE license_id = %s
                ORDER BY last_seen_at DESC
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
                    "app_version": r[8],
                    "last_ip":     r[9],
                    "last_modules": r[10],
                    "online":      bool(r[11]),
                    "core_version": r[12],
                })
            return resp(200, {"seats": seats})

        # ── revoke_seat ──────────────────────────────────────────────────────────
        if action == "revoke_seat":
            seat_id = int(body.get("seat_id", 0))
            cur.execute(
                "SELECT license_id, fingerprint, hostname, platform FROM license_seats WHERE id = %s",
                (seat_id,)
            )
            srow = cur.fetchone()
            cur.execute("DELETE FROM license_seats WHERE id = %s RETURNING id", (seat_id,))
            if not cur.fetchone():
                return resp(404, {"error": "not_found"})
            if srow:
                try:
                    cur.execute("""
                        INSERT INTO license_events
                          (license_id, seat_id, event_type, fingerprint, hostname, platform, detail)
                        VALUES (%s, %s, 'revoked', %s, %s, %s, 'revoked by admin')
                    """, (srow[0], seat_id, srow[1], srow[2], srow[3]))
                except Exception as e:
                    print(f"[admin] revoke log failed: {e}")
            conn.commit()
            return resp(200, {"ok": True})

        # ── monitoring_overview — сводка мониторинга по всем 5 направлениям ───────
        if action == "monitoring_overview":
            online_min = int(body.get("online_minutes", 10))
            expiring_days = int(body.get("expiring_days", 30))

            # 1. Живые сессии: онлайн-места (heartbeat < online_min минут)
            cur.execute("""
                SELECT COUNT(*) FROM license_seats
                WHERE last_seen_at > NOW() - (%s || ' minutes')::interval
            """, (online_min,))
            online_seats = int(cur.fetchone()[0])

            cur.execute("SELECT COUNT(*) FROM license_seats")
            total_seats = int(cur.fetchone()[0])

            # Онлайн-места с деталями
            cur.execute("""
                SELECT s.id, l.owner_name, l.key, s.hostname, s.platform,
                       s.app_version, s.last_ip, s.last_seen_at, s.last_modules,
                       s.core_version
                FROM license_seats s
                JOIN licenses l ON l.id = s.license_id
                WHERE s.last_seen_at > NOW() - (%s || ' minutes')::interval
                ORDER BY s.last_seen_at DESC
                LIMIT 100
            """, (online_min,))
            online_list = [{
                "seat_id": r[0], "owner": r[1], "key": r[2], "hostname": r[3],
                "platform": r[4], "app_version": r[5], "ip": r[6],
                "last_seen_at": str(r[7]), "modules": r[8], "core_version": r[9],
            } for r in cur.fetchall()]

            # 3. Нарушения: попытки превышения лимита / доступ к отозв./просроч.
            cur.execute("""
                SELECT event_type, COUNT(*) FROM license_events
                WHERE event_type IN ('seats_exhausted','disabled_attempt','expired_attempt')
                  AND created_at > NOW() - INTERVAL '30 days'
                GROUP BY event_type
            """)
            violations = {r[0]: int(r[1]) for r in cur.fetchall()}

            # Один ключ с разных IP за сутки (риск шаринга)
            cur.execute("""
                SELECT l.owner_name, l.key, COUNT(DISTINCT s.last_ip) AS ips
                FROM license_seats s
                JOIN licenses l ON l.id = s.license_id
                WHERE s.last_ip IS NOT NULL
                  AND s.last_seen_at > NOW() - INTERVAL '1 day'
                GROUP BY l.id, l.owner_name, l.key
                HAVING COUNT(DISTINCT s.last_ip) > 1
                ORDER BY ips DESC LIMIT 20
            """)
            multi_ip = [{"owner": r[0], "key": r[1], "ip_count": int(r[2])} for r in cur.fetchall()]

            # 4. Сроки лицензий: скоро истекают / просрочены
            cur.execute("""
                SELECT id, owner_name, key, expires_at,
                       EXTRACT(DAY FROM (expires_at - NOW()))::int AS days_left
                FROM licenses
                WHERE is_active = TRUE AND expires_at IS NOT NULL
                  AND expires_at <= NOW() + (%s || ' days')::interval
                ORDER BY expires_at ASC
            """, (expiring_days,))
            expiring = [{
                "id": r[0], "owner": r[1], "key": r[2],
                "expires_at": str(r[3]), "days_left": int(r[4]) if r[4] is not None else None,
            } for r in cur.fetchall()]

            # 5. Версии приложения у клиентов
            cur.execute("""
                SELECT COALESCE(app_version, '—') AS v, COUNT(*)
                FROM license_seats
                GROUP BY app_version ORDER BY COUNT(*) DESC
            """)
            versions = [{"version": r[0], "count": int(r[1])} for r in cur.fetchall()]

            # 5a2. Версии расчётного ядра (server.exe) — только там, где известны
            cur.execute("""
                SELECT COALESCE(core_version, '—') AS v, COUNT(*)
                FROM license_seats
                WHERE core_version IS NOT NULL AND core_version <> ''
                GROUP BY core_version ORDER BY COUNT(*) DESC
            """)
            core_versions = [{"version": r[0], "count": int(r[1])} for r in cur.fetchall()]

            # 5b. Использование модулей (за 7 дней по журналу module_use)
            cur.execute("""
                SELECT detail, COUNT(*) FROM license_events
                WHERE event_type = 'module_use' AND detail IS NOT NULL
                  AND created_at > NOW() - INTERVAL '7 days'
                GROUP BY detail ORDER BY COUNT(*) DESC LIMIT 20
            """)
            modules_usage = [{"modules": r[0], "count": int(r[1])} for r in cur.fetchall()]

            # 2. История активности: входы по часам за последние 24 часа
            cur.execute("""
                SELECT COUNT(*) FROM license_events
                WHERE event_type IN ('check_ok','activate','seat_created')
                  AND created_at > NOW() - INTERVAL '24 hours'
            """)
            logins_24h = int(cur.fetchone()[0])

            return resp(200, {
                "sessions": {"online": online_seats, "total": total_seats, "list": online_list},
                "violations": {"counts": violations, "multi_ip": multi_ip},
                "expiring": expiring,
                "versions": versions,
                "core_versions": core_versions,
                "modules_usage": modules_usage,
                "logins_24h": logins_24h,
            })

        # ── list_events — журнал событий (история активности) ────────────────────
        if action == "list_events":
            limit = min(int(body.get("limit", 100)), 500)
            lic_id = body.get("license_id")
            etype = (body.get("event_type") or "").strip()
            where = []
            params = []
            if lic_id:
                where.append("e.license_id = %s")
                params.append(int(lic_id))
            if etype:
                where.append("e.event_type = %s")
                params.append(etype)
            where_sql = ("WHERE " + " AND ".join(where)) if where else ""
            params.append(limit)
            cur.execute(f"""
                SELECT e.id, e.event_type, e.license_key, e.hostname, e.platform,
                       e.app_version, e.ip, e.detail, e.created_at, l.owner_name
                FROM license_events e
                LEFT JOIN licenses l ON l.id = e.license_id
                {where_sql}
                ORDER BY e.created_at DESC
                LIMIT %s
            """, tuple(params))
            events = [{
                "id": r[0], "event_type": r[1], "key": r[2], "hostname": r[3],
                "platform": r[4], "app_version": r[5], "ip": r[6], "detail": r[7],
                "created_at": str(r[8]), "owner": r[9],
            } for r in cur.fetchall()]
            return resp(200, {"events": events})

        return resp(400, {"error": "unknown_action"})

    finally:
        conn.close()