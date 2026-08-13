"""
Административный API для управления лицензиями ПВ-Системы.
Защищён паролем через заголовок X-Admin-Password.
Rev: offline-key-2

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
  get_compute_config — текущий расчётный сервер {active, backup_url, autofailover}
  set_compute_config — переключить сервер {active: 'primary'|'backup', backup_url, autofailover}
  create_offline_key — аварийный оффлайн-ключ {org, days?, seats?, expires_at?, notes?}
  list_offline_keys  — реестр выпущенных аварийных ключей
  update_offline_key — изменить {offline_key_id, org, seats?, expires_at?, notes?}
  toggle_offline_key — активировать/отозвать {offline_key_id, is_active}
  delete_offline_key — удалить запись {offline_key_id}
"""
import json
import os
import random
import string
import hashlib
import re
import base64
from datetime import datetime, timezone, timedelta
import psycopg2


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _decode_priv_key(s: str) -> bytes:
    """Устойчивое декодирование приватного ключа из секрета.

    Терпимо к пробелам/переносам строк, поддерживает и url-safe, и обычный
    base64-алфавит, а также hex. Возвращает сырые байты ключа.
    """
    import re as _re
    # Приводим url-safe символы к стандартным, затем оставляем ТОЛЬКО символы
    # base64-алфавита (выкидываем пробелы, кавычки, переводы строк, любой мусор).
    conv = s.replace("-", "+").replace("_", "/")
    b64chars = _re.sub(r"[^A-Za-z0-9+/]", "", conv)
    std = b64chars.rstrip("=")
    pad = "=" * (-len(std) % 4)
    # Диагностика без раскрытия значения: длина и «маска» (первые/последние 3 симв.)
    masked = f"{s[:3]}…{s[-3:]}" if len(s) > 6 else "***"
    print(f"[admin] priv key: raw_len={len(s)} b64_len={len(b64chars)} mask={masked}")
    try:
        raw = base64.b64decode(std + pad)
        if len(raw) >= 32:
            return raw
    except Exception:
        pass
    # Возможно, ключ задан в hex
    try:
        hexs = _re.sub(r"[^0-9a-fA-F]", "", s)
        raw = bytes.fromhex(hexs)
        if len(raw) >= 32:
            return raw
    except Exception:
        pass
    raise ValueError(f"bad_private_key_format len={len(b64chars)}")


def make_offline_key(org: str, expires_iso: str, seats: int) -> str:
    """Формирует подписанный аварийный оффлайн-ключ.

    Формат: PVSO.<payload_b64url>.<sig_b64url>
    payload — JSON {org, exp (ISO), seats, iat}. Подпись Ed25519 приватным
    ключом (секрет OFFLINE_KEY_PRIVATE). Приложение проверяет подпись
    публичным ключом локально, без интернета.
    """
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    priv_b64 = os.environ.get("OFFLINE_KEY_PRIVATE", "")
    if not priv_b64.strip():
        raise RuntimeError("offline_key_private_not_set")
    raw = _decode_priv_key(priv_b64)
    # Секрет может содержать как 32-байтовое «семя» (raw seed), так и полный
    # приватный ключ. Ed25519PrivateKey.from_private_bytes ждёт ровно 32 байта.
    if len(raw) > 32:
        raw = raw[:32]
    sk = Ed25519PrivateKey.from_private_bytes(raw)
    payload = {
        "org": org,
        "exp": expires_iso,
        "seats": int(seats),
        "iat": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    sig = sk.sign(payload_bytes)
    return f"PVSO.{_b64url(payload_bytes)}.{_b64url(sig)}"

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
                       -- 45 минут: программа шлёт сигнал «я на связи» раз в 30
                       -- минут (см. src/hooks/useLicense.ts), порог обязан быть
                       -- больше интервала, иначе место мигало бы «офлайн».
                       (last_seen_at > NOW() - INTERVAL '45 minutes') AS online,
                       core_version,
                       -- Сколько разных адресов в интернете обращалось под этим
                       -- местом за 30 дней. Несколько адресов — признак, что
                       -- одним рабочим местом пользуются с разных компьютеров.
                       (SELECT COUNT(DISTINCT e.ip) FROM license_events e
                        WHERE e.seat_id = license_seats.id
                          AND e.ip IS NOT NULL AND e.ip <> ''
                          AND e.created_at > NOW() - INTERVAL '30 days') AS ip_count
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
                    "ip_count":    int(r[13] or 0),
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
            # Порог «место онлайн». Связан с интервалом сигнала «я на связи» в
            # программе (src/hooks/useLicense.ts, HEARTBEAT_MS = 30 минут):
            # порог обязан быть заметно больше интервала, иначе работающие люди
            # мигали бы «офлайн» между сигналами. Интервал подняли ради экономии
            # обращений к серверу — вместе с ним подняли и порог.
            online_min = int(body.get("online_minutes", 45))
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

            # 5. Версии приложения у клиентов + организации (ПВС), которые их используют
            cur.execute("""
                SELECT v, cnt, json_agg(json_build_object('owner', owner, 'count', owner_cnt)
                                        ORDER BY owner_cnt DESC, owner) AS orgs
                FROM (
                    SELECT COALESCE(s.app_version, '—') AS v,
                           COALESCE(l.owner_name, '—') AS owner,
                           COUNT(*) AS owner_cnt,
                           SUM(COUNT(*)) OVER (PARTITION BY COALESCE(s.app_version, '—')) AS cnt
                    FROM license_seats s
                    LEFT JOIN licenses l ON l.id = s.license_id
                    GROUP BY COALESCE(s.app_version, '—'), COALESCE(l.owner_name, '—')
                ) t
                GROUP BY v, cnt ORDER BY cnt DESC
            """)
            versions = [{"version": r[0], "count": int(r[1]),
                         "orgs": [{"owner": o["owner"], "count": int(o["count"])} for o in (r[2] or [])]}
                        for r in cur.fetchall()]

            # 5a2. Версии расчётного ядра (server.exe) — только там, где известны, + организации
            cur.execute("""
                SELECT v, cnt, json_agg(json_build_object('owner', owner, 'count', owner_cnt)
                                        ORDER BY owner_cnt DESC, owner) AS orgs
                FROM (
                    SELECT s.core_version AS v,
                           COALESCE(l.owner_name, '—') AS owner,
                           COUNT(*) AS owner_cnt,
                           SUM(COUNT(*)) OVER (PARTITION BY s.core_version) AS cnt
                    FROM license_seats s
                    LEFT JOIN licenses l ON l.id = s.license_id
                    WHERE s.core_version IS NOT NULL AND s.core_version <> ''
                    GROUP BY s.core_version, COALESCE(l.owner_name, '—')
                ) t
                GROUP BY v, cnt ORDER BY cnt DESC
            """)
            core_versions = [{"version": r[0], "count": int(r[1]),
                              "orgs": [{"owner": o["owner"], "count": int(o["count"])} for o in (r[2] or [])]}
                             for r in cur.fetchall()]

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

            # 6. РАСХОД ВЫЧИСЛИТЕЛЬНОГО ВРЕМЕНИ — сколько обращений к
            # лицензионной службе пришло за месяц. Считается по отдельному
            # счётчику license_usage_daily (журнал событий для этого не годится:
            # он намеренно пишется не чаще раза в сутки на рабочее место).
            cur.execute("""
                SELECT COALESCE(SUM(cnt) FILTER (WHERE day >= CURRENT_DATE - 29), 0) AS month_total,
                       COALESCE(SUM(cnt) FILTER (WHERE day >= CURRENT_DATE - 6),  0) AS week_total,
                       COALESCE(SUM(cnt) FILTER (WHERE day  = CURRENT_DATE),      0) AS today_total
                FROM license_usage_daily
            """)
            u = cur.fetchone()
            usage_month, usage_week, usage_today = int(u[0]), int(u[1]), int(u[2])

            # Разбивка по видам обращений за месяц (проверка / сигнал / активация)
            cur.execute("""
                SELECT action, SUM(cnt) FROM license_usage_daily
                WHERE day >= CURRENT_DATE - 29
                GROUP BY action ORDER BY SUM(cnt) DESC
            """)
            usage_by_action = [{"action": r[0], "count": int(r[1])} for r in cur.fetchall()]

            # По дням за 30 суток — для графика
            cur.execute("""
                SELECT day, SUM(cnt) FROM license_usage_daily
                WHERE day >= CURRENT_DATE - 29
                GROUP BY day ORDER BY day
            """)
            usage_daily = [{"day": str(r[0]), "count": int(r[1])} for r in cur.fetchall()]

            return resp(200, {
                "usage": {
                    "month": usage_month,
                    "week": usage_week,
                    "today": usage_today,
                    "by_action": usage_by_action,
                    "daily": usage_daily,
                },
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

        # ── get_compute_config — текущая конфигурация расчётного сервера ──────────
        if action == "get_compute_config":
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

        # ── set_compute_config — переключение основной/резервный сервер ───────────
        if action == "set_compute_config":
            active = (body.get("active") or "primary").strip()
            if active not in ("primary", "backup"):
                return resp(400, {"error": "invalid_active"})
            backup_url = (body.get("backup_url") or "").strip()
            autofailover = "1" if body.get("autofailover", True) else "0"
            for k, v in (
                ("compute_active", active),
                ("compute_backup_url", backup_url),
                ("compute_autofailover", autofailover),
            ):
                cur.execute("""
                    INSERT INTO app_settings (key, value, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                """, (k, v))
            conn.commit()
            return resp(200, {"ok": True, "active": active,
                              "backup_url": backup_url,
                              "autofailover": autofailover == "1"})

        # ── create_offline_key — аварийный оффлайн-ключ (подпись Ed25519) ────────
        if action == "create_offline_key":
            org = (body.get("org") or "").strip()
            if not org:
                return resp(400, {"error": "org_required"})
            days = int(body.get("days") or 365)
            if days < 1 or days > 3650:
                return resp(400, {"error": "invalid_days"})
            seats = int(body.get("seats") or 999)
            # Дата истечения: либо явная (для продления), либо now + days
            exp_in = (body.get("expires_at") or "").strip()
            if exp_in:
                expires_iso = exp_in if "T" in exp_in else exp_in + "T23:59:59Z"
            else:
                expires_iso = (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
            try:
                key = make_offline_key(org, expires_iso, seats)
            except RuntimeError:
                return resp(500, {"error": "offline_key_private_not_set"})
            except Exception as e:
                import traceback
                print(f"[admin] offline key sign failed: {e}\n{traceback.format_exc()}")
                _sec = os.environ.get("OFFLINE_KEY_PRIVATE", "")
                return resp(500, {
                    "error": "offline_key_sign_failed",
                    "detail": str(e)[:200],
                    "secret_len": len(_sec.strip()),
                })
            notes = (body.get("notes") or "").strip()
            new_id = None
            # Сохраняем выпущенный ключ в реестр (для показа/редактирования в админке)
            try:
                cur.execute("""
                    INSERT INTO offline_keys (org, key, seats, expires_at, notes)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                """, (org, key, seats, expires_iso, notes or None))
                new_id = cur.fetchone()[0]
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(f"[admin] offline key store failed: {e}")
            # Журналируем факт выдачи (не критично)
            try:
                cur.execute("""
                    INSERT INTO license_events (event_type, detail)
                    VALUES ('offline_key_issued', %s)
                """, (f"org={org}; exp={expires_iso}; seats={seats}",))
                conn.commit()
            except Exception as e:
                print(f"[admin] offline key log failed: {e}")
            return resp(200, {"id": new_id, "key": key, "org": org, "expires_at": expires_iso, "seats": seats})

        # ── list_offline_keys — реестр выпущенных аварийных ключей ────────────────
        if action == "list_offline_keys":
            cur.execute("""
                SELECT id, org, key, seats, expires_at, is_active, notes, created_at,
                       (expires_at IS NOT NULL AND expires_at < NOW()) AS expired
                FROM offline_keys
                ORDER BY created_at DESC
            """)
            keys = []
            for r in cur.fetchall():
                keys.append({
                    "id": r[0], "org": r[1], "key": r[2], "seats": r[3],
                    "expires_at": str(r[4]) if r[4] else None,
                    "is_active": r[5], "notes": r[6],
                    "created_at": str(r[7]),
                    "expired": bool(r[8]),
                })
            return resp(200, {"keys": keys})

        # ── update_offline_key — изменить организацию/срок/места/заметку ──────────
        if action == "update_offline_key":
            oid = int(body.get("offline_key_id", 0))
            org = (body.get("org") or "").strip()
            if not org:
                return resp(400, {"error": "org_required"})
            seats = int(body.get("seats") or 999)
            exp_in = (body.get("expires_at") or "").strip()
            if exp_in:
                expires_iso = exp_in if "T" in exp_in else exp_in + "T23:59:59Z"
            else:
                expires_iso = None
            notes = (body.get("notes") or "").strip()
            cur.execute("""
                UPDATE offline_keys
                SET org = %s, seats = %s, expires_at = %s, notes = %s
                WHERE id = %s RETURNING id
            """, (org, seats, expires_iso, notes or None, oid))
            if not cur.fetchone():
                return resp(404, {"error": "not_found"})
            conn.commit()
            return resp(200, {"ok": True})

        # ── toggle_offline_key — пометить активным/отозванным ─────────────────────
        if action == "toggle_offline_key":
            oid = int(body.get("offline_key_id", 0))
            is_active = bool(body.get("is_active", True))
            cur.execute(
                "UPDATE offline_keys SET is_active = %s WHERE id = %s RETURNING id",
                (is_active, oid)
            )
            if not cur.fetchone():
                return resp(404, {"error": "not_found"})
            conn.commit()
            return resp(200, {"ok": True, "is_active": is_active})

        # ── delete_offline_key — удалить запись из реестра ────────────────────────
        if action == "delete_offline_key":
            oid = int(body.get("offline_key_id", 0))
            cur.execute("DELETE FROM offline_keys WHERE id = %s RETURNING id", (oid,))
            if not cur.fetchone():
                return resp(404, {"error": "not_found"})
            conn.commit()
            return resp(200, {"ok": True})

        return resp(400, {"error": "unknown_action"})

    finally:
        conn.close()