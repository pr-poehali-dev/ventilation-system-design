"""
Проверка версии и управление обновлениями ПВС-Система.

Файлы обновлений (PVS-Setup.exe, server.exe) НЕ хранятся в нашем хранилище —
они лежат на Яндекс.Диске. Мы храним только публичную ссылку, а прямую ссылку
на скачивание выдаём свежую при каждом запросе (они у Яндекса временные).

GET  /                      → версия + свежие прямые ссылки на скачивание
GET  /  ?file=exe           → редирект на свежую прямую ссылку установщика
GET  /  ?file=server        → редирект на свежую прямую ссылку расчётного ядра
POST /  action=set_url      → сохранить публичную ссылку Я.Диска + версию
POST /  action=set_version  → обновить только номер версии и заметки
"""
import json
import os
import urllib.request
import urllib.parse
import boto3

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
}

VERSION_KEY = "updates/version.json"
BUCKET      = "files"


def get_s3():
    return boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    )


def get_version_info(s3):
    default = {
        "version":         "1.0.0",
        "server_version":  "1.0.0",
        "notes":           "",
        "exe_public_url":  "",   # публичная ссылка Я.Диска на установщик
        "server_public_url": "", # публичная ссылка Я.Диска на расчётное ядро
    }
    try:
        obj    = s3.get_object(Bucket=BUCKET, Key=VERSION_KEY)
        data   = obj["Body"].read().decode()
        parsed = json.loads(data)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return {**default, **parsed}
    except Exception:
        return default


def save_version_info(s3, info):
    s3.put_object(Bucket=BUCKET, Key=VERSION_KEY,
                  Body=json.dumps(info, ensure_ascii=False).encode(),
                  ContentType="application/json")


def resolve_download_url(src_url: str) -> str:
    """Публичную ссылку → прямую ссылку на скачивание файла.

    Поддерживает Яндекс.Диск через официальный API. Прямые ссылки временные,
    поэтому запрашиваем свежую при каждом обращении. Остальные ссылки — как есть.
    """
    if not src_url:
        return ""
    if "disk.yandex" in src_url or "yadi.sk" in src_url:
        api = ("https://cloud-api.yandex.net/v1/disk/public/resources/download"
               f"?public_key={urllib.parse.quote(src_url, safe='')}")
        req = urllib.request.Request(api, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode())
        href = data.get("href")
        if not href:
            raise ValueError("Не удалось получить прямую ссылку с Яндекс.Диска")
        return href
    return src_url


def check_admin(event):
    password = (event.get("headers") or {}).get("X-Admin-Password", "")
    return password == os.environ.get("ADMIN_PASSWORD", "")


def handler(event: dict, context) -> dict:
    """Версия приложения и управление обновлениями ПВС-Система."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    s3     = get_s3()
    params = event.get("queryStringParameters") or {}

    # ── GET ?file=exe|server: редирект на свежую прямую ссылку скачивания ──────
    if method == "GET" and params.get("file") in ("exe", "server"):
        info = get_version_info(s3)
        pub  = info["exe_public_url"] if params["file"] == "exe" else info["server_public_url"]
        if not pub:
            return {"statusCode": 404, "headers": CORS,
                    "body": json.dumps({"error": "Файл ещё не опубликован"}, ensure_ascii=False)}
        try:
            direct = resolve_download_url(pub)
        except Exception as e:
            return {"statusCode": 502, "headers": CORS,
                    "body": json.dumps({"error": str(e)}, ensure_ascii=False)}
        return {"statusCode": 302, "headers": {**CORS, "Location": direct}, "body": ""}

    # ── GET: информация о версии + свежие прямые ссылки ───────────────────────
    if method == "GET":
        info = get_version_info(s3)
        out = {
            "version":        info["version"],
            "server_version": info["server_version"],
            "notes":          info["notes"],
        }
        try:
            out["download_url"] = resolve_download_url(info["exe_public_url"])
        except Exception:
            out["download_url"] = ""
        try:
            out["server_url"] = resolve_download_url(info["server_public_url"])
        except Exception:
            out["server_url"] = ""
        return {"statusCode": 200, "headers": CORS, "body": json.dumps(out, ensure_ascii=False)}

    # ── POST: требует пароль ───────────────────────────────────────────────────
    if method == "POST":
        if not check_admin(event):
            return {"statusCode": 403, "headers": CORS,
                    "body": json.dumps({"error": "Неверный пароль"}, ensure_ascii=False)}

        body   = json.loads(event.get("body") or "{}")
        action = body.get("action")

        # ── Сохранить публичную ссылку Я.Диска + версию (без скачивания) ──────
        if action == "set_url":
            file_type = body.get("file_type", "exe")
            src_url   = (body.get("url") or "").strip()
            if not src_url.startswith("http"):
                return {"statusCode": 400, "headers": CORS,
                        "body": json.dumps({"error": "Нужна публичная ссылка (http...)"}, ensure_ascii=False)}

            # Сразу проверяем, что ссылка рабочая и отдаёт файл (получаем прямую ссылку)
            try:
                resolve_download_url(src_url)
            except Exception as e:
                return {"statusCode": 400, "headers": CORS,
                        "body": json.dumps({"error": f"Ссылка недоступна: {e}"}, ensure_ascii=False)}

            info = get_version_info(s3)
            if file_type == "exe":
                info["exe_public_url"] = src_url
                info["version"]        = body.get("version", info["version"])
                info["notes"]          = body.get("notes", info.get("notes", ""))
            else:
                info["server_public_url"] = src_url
                info["server_version"]    = body.get("server_version", info.get("server_version", "1.0.0"))
            save_version_info(s3, info)
            return {"statusCode": 200, "headers": CORS,
                    "body": json.dumps({"ok": True, "info": info}, ensure_ascii=False)}

        # ── Обновить только номер версии и заметки ────────────────────────────
        if action == "set_version":
            info = get_version_info(s3)
            info["version"] = body.get("version", info["version"])
            info["notes"]   = body.get("notes",   info.get("notes", ""))
            save_version_info(s3, info)
            return {"statusCode": 200, "headers": CORS,
                    "body": json.dumps({"ok": True, "info": info}, ensure_ascii=False)}

        return {"statusCode": 400, "headers": CORS,
                "body": json.dumps({"error": "Неизвестный action"}, ensure_ascii=False)}

    return {"statusCode": 405, "headers": CORS, "body": ""}
