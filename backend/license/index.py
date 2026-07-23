"""
Лицензионный сервис ПВ-Системы.
POST / body: {action, fingerprint, hw_fingerprint?, key?, hostname?, platform?, screen_info?}

  fingerprint    — SHA256(UUID + железо): точный, меняется при сбросе PWA/браузера
  hw_fingerprint — SHA256(только железо): стабилен при переустановке PWA/ОС

  check    — проверить лицензию по fingerprint; если не найден — искать по hw_fingerprint
  activate — привязать ключ к месту; если hw_fingerprint совпадает — обновить fingerprint
  transfer — перенос лицензии на новый fingerprint (ручная операция)
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
    return psycopg2.connect(dsn, options=f"-c search_path={schema}")


def resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body, default=str),
    }


def validate_key(key: str) -> bool:
    return bool(re.match(r"^PVS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$", key))


def fp_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()[:64]


def client_ip(event: dict) -> str:
    """IP клиента из заголовков/контекста запроса."""
    hdrs = event.get("headers") or {}
    xff = hdrs.get("x-forwarded-for") or hdrs.get("X-Forwarded-For") or ""
    if xff:
        return xff.split(",")[0].strip()[:64]
    ident = (event.get("requestContext") or {}).get("identity") or {}
    return (ident.get("sourceIp") or "")[:64]


def log_event(cur, *, license_id=None, license_key=None, seat_id=None,
              event_type="", fph=None, hostname=None, platform=None,
              app_version=None, ip=None, detail=None):
    """Записать событие в журнал license_events (не критично при ошибке)."""
    try:
        cur.execute("""
            INSERT INTO license_events
              (license_id, license_key, seat_id, event_type, fingerprint,
               hostname, platform, app_version, ip, detail)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (license_id, license_key, seat_id, event_type, fph,
              hostname or None, platform or None, app_version or None,
              ip or None, detail or None))
    except Exception as e:
        print(f"[license] log_event failed: {e}")


def handler(event: dict, context) -> dict:
    """Лицензионный сервис — проверка и активация по fingerprint + hw_fingerprint."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            return resp(400, {"error": "invalid_json"})

    action         = body.get("action", "").strip()
    fingerprint    = body.get("fingerprint", "").strip()[:128]
    hw_fp_raw      = body.get("hw_fingerprint", "").strip()[:128]
    user_agent     = (event.get("headers") or {}).get("user-agent", "")[:500]
    hostname       = (body.get("hostname") or "")[:200]
    platform       = (body.get("platform") or "")[:100]
    screen_info    = (body.get("screen_info") or "")[:50]
    app_version    = (body.get("app_version") or "")[:32]
    core_version   = (body.get("core_version") or "")[:32]
    modules        = (body.get("modules") or "")[:200]
    ip             = client_ip(event)

    if not fingerprint:
        return resp(400, {"error": "fingerprint_required"})

    fph    = fp_hash(fingerprint)
    hw_fph = fp_hash(hw_fp_raw) if hw_fp_raw else None

    conn = get_conn()
    cur  = conn.cursor()

    # ── check ──────────────────────────────────────────────────────────────────
    if action == "check":
        # Привязка к рабочему месту — ТОЛЬКО по железу (hw_fingerprint).
        # Один ПК = одно место в любом браузере: у всех браузеров на одном ПК
        # hw_fingerprint совпадает, поэтому лицензия «подхватывается» автоматически
        # без повторного ввода ключа.
        hw_restored = False
        row = None

        # 1. Ищем место по железу (hw_fingerprint) — основной способ привязки
        if hw_fph:
            cur.execute("""
                SELECT l.key, l.owner_name, l.max_seats, l.is_active, l.expires_at,
                       (SELECT COUNT(*) FROM license_seats WHERE license_id = l.id) AS used_seats,
                       s.id AS seat_id, TRUE AS hw_match, l.id
                FROM license_seats s
                JOIN licenses l ON l.id = s.license_id
                WHERE s.hw_fingerprint = %s
                ORDER BY s.last_seen_at DESC LIMIT 1
            """, (hw_fph,))
            row = cur.fetchone()
            # Совпало по железу, но точный fingerprint (браузер) другой —
            # значит это другой браузер на том же ПК: обновим fingerprint на текущий.
            if row and row[6] is not None:
                # seat_id есть; проверим, отличается ли текущий fingerprint
                hw_restored = True

        # 2. Запасной вариант: найти по точному fingerprint
        #    (например, hw_fingerprint не передан или ещё не заполнен в БД)
        if not row:
            cur.execute("""
                SELECT l.key, l.owner_name, l.max_seats, l.is_active, l.expires_at,
                       (SELECT COUNT(*) FROM license_seats WHERE license_id = l.id) AS used_seats,
                       s.id AS seat_id, FALSE AS hw_match, l.id
                FROM license_seats s
                JOIN licenses l ON l.id = s.license_id
                WHERE s.fingerprint = %s
                ORDER BY s.activated_at DESC LIMIT 1
            """, (fph,))
            row = cur.fetchone()
            hw_restored = False

        if not row:
            conn.close()
            return resp(200, {"licensed": False})

        key, owner, max_seats, is_active, expires_at, used_seats, seat_id, _, lic_id = row

        if not is_active:
            log_event(cur, license_id=lic_id, license_key=key, seat_id=seat_id,
                      event_type="disabled_attempt", fph=fph, hostname=hostname,
                      platform=platform, app_version=app_version, ip=ip)
            conn.commit()
            conn.close()
            return resp(200, {"licensed": False, "reason": "license_disabled"})

        if expires_at and expires_at < datetime.now(timezone.utc):
            log_event(cur, license_id=lic_id, license_key=key, seat_id=seat_id,
                      event_type="expired_attempt", fph=fph, hostname=hostname,
                      platform=platform, app_version=app_version, ip=ip)
            conn.commit()
            conn.close()
            return resp(200, {"licensed": False, "reason": "license_expired"})

        # Обновляем last_seen_at; если восстановили по hw_fp — обновляем fingerprint
        if hw_restored:
            cur.execute("""
                UPDATE license_seats
                SET last_seen_at = NOW(),
                    fingerprint  = %s,
                    user_agent   = COALESCE(NULLIF(%s, ''), user_agent),
                    hostname     = COALESCE(NULLIF(%s, ''), hostname),
                    platform     = COALESCE(NULLIF(%s, ''), platform),
                    screen_info  = COALESCE(NULLIF(%s, ''), screen_info),
                    app_version  = COALESCE(NULLIF(%s, ''), app_version),
                    core_version = COALESCE(NULLIF(%s, ''), core_version),
                    last_ip      = COALESCE(NULLIF(%s, ''), last_ip),
                    last_modules = COALESCE(NULLIF(%s, ''), last_modules)
                WHERE id = %s
            """, (fph, user_agent, hostname, platform, screen_info,
                  app_version, core_version, ip, modules, seat_id))
        else:
            cur.execute("""
                UPDATE license_seats
                SET last_seen_at = NOW(),
                    user_agent   = COALESCE(NULLIF(%s, ''), user_agent),
                    hostname     = COALESCE(NULLIF(%s, ''), hostname),
                    platform     = COALESCE(NULLIF(%s, ''), platform),
                    screen_info  = COALESCE(NULLIF(%s, ''), screen_info),
                    app_version  = COALESCE(NULLIF(%s, ''), app_version),
                    core_version = COALESCE(NULLIF(%s, ''), core_version),
                    last_ip      = COALESCE(NULLIF(%s, ''), last_ip),
                    last_modules = COALESCE(NULLIF(%s, ''), last_modules)
                WHERE id = %s
            """, (user_agent, hostname, platform, screen_info,
                  app_version, core_version, ip, modules, seat_id))

        log_event(cur, license_id=lic_id, license_key=key, seat_id=seat_id,
                  event_type="check_ok", fph=fph, hostname=hostname,
                  platform=platform, app_version=app_version, ip=ip,
                  detail=modules or None)

        conn.commit()
        conn.close()
        return resp(200, {
            "licensed": True,
            "key": key,
            "owner": owner,
            "seats": {"max": max_seats, "used": int(used_seats)},
            "fingerprint_updated": hw_restored,
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
            log_event(cur, license_id=lic_id, license_key=license_key,
                      event_type="disabled_attempt", fph=fph, hostname=hostname,
                      platform=platform, app_version=app_version, ip=ip)
            conn.commit()
            conn.close()
            return resp(403, {"error": "license_disabled"})

        if expires_at and expires_at < datetime.now(timezone.utc):
            log_event(cur, license_id=lic_id, license_key=license_key,
                      event_type="expired_attempt", fph=fph, hostname=hostname,
                      platform=platform, app_version=app_version, ip=ip)
            conn.commit()
            conn.close()
            return resp(403, {"error": "license_expired"})

        hw_restored = False

        # Привязка к рабочему месту — по железу (hw_fingerprint).
        # 1. Ищем существующий seat по железу для ЭТОГО ключа.
        #    Покрывает: другой браузер на том же ПК, переустановка PWA/ОС.
        existing = None
        if hw_fph:
            cur.execute(
                "SELECT id FROM license_seats WHERE license_id = %s AND hw_fingerprint = %s",
                (lic_id, hw_fph)
            )
            existing = cur.fetchone()
            if existing:
                hw_restored = True

        # 2. Запасной вариант: seat по точному fingerprint
        #    (если hw_fingerprint пустой или ещё не заполнен в БД)
        if not existing:
            cur.execute(
                "SELECT id FROM license_seats WHERE license_id = %s AND fingerprint = %s",
                (lic_id, fph)
            )
            existing = cur.fetchone()

        if not existing:
            # Новое место — проверяем лимит
            cur.execute("SELECT COUNT(*) FROM license_seats WHERE license_id = %s", (lic_id,))
            used = cur.fetchone()[0]
            if used >= max_seats:
                log_event(cur, license_id=lic_id, license_key=license_key,
                          event_type="seats_exhausted", fph=fph, hostname=hostname,
                          platform=platform, app_version=app_version, ip=ip,
                          detail=f"{used}/{max_seats}")
                conn.commit()
                conn.close()
                return resp(403, {
                    "error": "seats_exhausted",
                    "max_seats": max_seats,
                    "used_seats": int(used),
                })
            # Создаём новое место с обоими fingerprint
            cur.execute("""
                INSERT INTO license_seats
                    (license_id, fingerprint, hw_fingerprint, user_agent, hostname,
                     platform, screen_info, app_version, core_version, last_ip, last_modules)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (lic_id, fph, hw_fph, user_agent or None,
                  hostname or None, platform or None, screen_info or None,
                  app_version or None, core_version or None, ip or None, modules or None))
            log_event(cur, license_id=lic_id, license_key=license_key,
                      event_type="seat_created", fph=fph, hostname=hostname,
                      platform=platform, app_version=app_version, ip=ip)
        else:
            # Место уже есть — обновляем fingerprint (мог измениться после переустановки)
            # и hw_fingerprint (на случай если раньше был NULL)
            cur.execute("""
                UPDATE license_seats
                SET last_seen_at   = NOW(),
                    fingerprint    = %s,
                    hw_fingerprint = COALESCE(%s, hw_fingerprint),
                    user_agent     = COALESCE(NULLIF(%s, ''), user_agent),
                    hostname       = COALESCE(NULLIF(%s, ''), hostname),
                    platform       = COALESCE(NULLIF(%s, ''), platform),
                    screen_info    = COALESCE(NULLIF(%s, ''), screen_info),
                    app_version    = COALESCE(NULLIF(%s, ''), app_version),
                    core_version   = COALESCE(NULLIF(%s, ''), core_version),
                    last_ip        = COALESCE(NULLIF(%s, ''), last_ip),
                    last_modules   = COALESCE(NULLIF(%s, ''), last_modules)
                WHERE id = %s
            """, (fph, hw_fph, user_agent, hostname, platform, screen_info,
                  app_version, core_version, ip, modules, existing[0]))
            log_event(cur, license_id=lic_id, license_key=license_key, seat_id=existing[0],
                      event_type="activate", fph=fph, hostname=hostname,
                      platform=platform, app_version=app_version, ip=ip)

        conn.commit()
        cur.execute("SELECT COUNT(*) FROM license_seats WHERE license_id = %s", (lic_id,))
        used_seats = cur.fetchone()[0]
        conn.commit()
        conn.close()

        return resp(200, {
            "licensed": True,
            "key": license_key,
            "owner": owner,
            "seats": {"max": max_seats, "used": int(used_seats)},
            "fingerprint_updated": hw_restored,
        })

    # ── heartbeat ───────────────────────────────────────────────────────────────
    # Лёгкий пинг «я жива»: обновляет last_seen_at, версию, IP и активные модули.
    # Программа шлёт его периодически (напр. раз в 2–5 мин), пока открыта.
    if action == "heartbeat":
        cur.execute("""
            SELECT s.id, s.license_id, l.key, l.is_active, l.expires_at
            FROM license_seats s
            JOIN licenses l ON l.id = s.license_id
            WHERE s.fingerprint = %s
            ORDER BY s.last_seen_at DESC LIMIT 1
        """, (fph,))
        srow = cur.fetchone()
        if not srow:
            conn.close()
            return resp(200, {"ok": False, "reason": "seat_not_found"})

        seat_id, lic_id, key, is_active, expires_at = srow
        if not is_active:
            conn.close()
            return resp(200, {"ok": False, "reason": "license_disabled"})
        if expires_at and expires_at < datetime.now(timezone.utc):
            conn.close()
            return resp(200, {"ok": False, "reason": "license_expired"})

        cur.execute("""
            UPDATE license_seats
            SET last_seen_at = NOW(),
                app_version  = COALESCE(NULLIF(%s, ''), app_version),
                core_version = COALESCE(NULLIF(%s, ''), core_version),
                last_ip      = COALESCE(NULLIF(%s, ''), last_ip),
                last_modules = COALESCE(NULLIF(%s, ''), last_modules)
            WHERE id = %s
        """, (app_version, core_version, ip, modules, seat_id))

        # Событие использования модулей пишем только если они переданы
        if modules:
            log_event(cur, license_id=lic_id, license_key=key, seat_id=seat_id,
                      event_type="module_use", fph=fph, hostname=hostname,
                      platform=platform, app_version=app_version, ip=ip,
                      detail=modules)
        conn.commit()
        conn.close()
        return resp(200, {"ok": True})

    # ── transfer ────────────────────────────────────────────────────────────────
    if action == "transfer":
        license_key = body.get("key", "").strip().upper()
        new_fp_raw  = body.get("new_fingerprint", "").strip()[:128]

        if not validate_key(license_key):
            conn.close()
            return resp(400, {"error": "invalid_key_format"})
        if not new_fp_raw:
            conn.close()
            return resp(400, {"error": "new_fingerprint_required"})

        new_fph = fp_hash(new_fp_raw)

        cur.execute("""
            SELECT s.id FROM license_seats s
            JOIN licenses l ON l.id = s.license_id
            WHERE s.fingerprint = %s AND l.key = %s AND l.is_active = TRUE
            LIMIT 1
        """, (fph, license_key))
        seat = cur.fetchone()
        if not seat:
            conn.close()
            return resp(404, {"error": "seat_not_found"})

        cur.execute("""
            UPDATE license_seats
            SET fingerprint    = %s,
                hw_fingerprint = COALESCE(%s, hw_fingerprint),
                last_seen_at   = NOW(),
                user_agent     = COALESCE(NULLIF(%s, ''), user_agent),
                hostname       = COALESCE(NULLIF(%s, ''), hostname),
                platform       = COALESCE(NULLIF(%s, ''), platform),
                screen_info    = COALESCE(NULLIF(%s, ''), screen_info)
            WHERE id = %s
        """, (new_fph, hw_fph, user_agent, hostname, platform, screen_info, seat[0]))
        conn.commit()
        conn.close()
        return resp(200, {"ok": True, "transferred": True})

    conn.close()
    return resp(400, {"error": "unknown_action"})