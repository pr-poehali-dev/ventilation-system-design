"""
Проверка версии и управление обновлениями ПВС-Система.

GET  /                → текущая версия + ссылки на скачивание
POST /  action=set_version   → обновить номер версии и заметки
POST /  action=upload_exe    → загрузить новый PVS-Setup.exe
POST /  action=upload_server → загрузить новый server.exe (расчёты без переустановки)
GET  /  ?file=server         → скачать актуальный server.exe (для автообновления)
"""
import json
import os
import base64
import boto3

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
}

VERSION_KEY    = "updates/version.json"
EXE_KEY        = "updates/PVS-Setup.exe"
SERVER_KEY     = "updates/server.exe"
BUCKET         = "files"


def get_s3():
    return boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    )


def cdn_url(key):
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def get_version_info(s3):
    default = {
        "version":        "1.0.0",
        "download_url":   cdn_url(EXE_KEY),
        "server_url":     cdn_url(SERVER_KEY),
        "server_version": "1.0.0",
        "notes":          "",
    }
    try:
        obj  = s3.get_object(Bucket=BUCKET, Key=VERSION_KEY)
        data = obj["Body"].read().decode()
        parsed = json.loads(data)
        # Если вдруг пришла строка вместо dict — парсим ещё раз
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return {**default, **parsed}
    except Exception:
        return default


def check_admin(event):
    password = (event.get("headers") or {}).get("X-Admin-Password", "")
    return password == os.environ.get("ADMIN_PASSWORD", "")


def handler(event: dict, context) -> dict:
    """Версия приложения и управление обновлениями ПВС-Система."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    s3 = get_s3()
    params = event.get("queryStringParameters") or {}

    # ── GET: отдать server.exe напрямую (для автообновления из C#) ────────────
    if method == "GET" and params.get("file") == "server":
        try:
            obj = s3.get_object(Bucket=BUCKET, Key=SERVER_KEY)
            data = obj["Body"].read()
            return {
                "statusCode": 200,
                "headers": {
                    **CORS,
                    "Content-Type": "application/octet-stream",
                    "Content-Disposition": "attachment; filename=server.exe",
                },
                "body": base64.b64encode(data).decode(),
                "isBase64Encoded": True,
            }
        except Exception as e:
            return {"statusCode": 404, "headers": CORS, "body": json.dumps({"error": str(e)})}

    # ── GET: информация о версии ───────────────────────────────────────────────
    if method == "GET":
        info = get_version_info(s3)
        return {"statusCode": 200, "headers": CORS, "body": json.dumps(info, ensure_ascii=False)}

    # ── POST: требует пароль ───────────────────────────────────────────────────
    if method == "POST":
        if not check_admin(event):
            return {"statusCode": 403, "headers": CORS, "body": json.dumps({"error": "Неверный пароль"})}

        body   = json.loads(event.get("body") or "{}")
        action = body.get("action")

        # Обновить только номер версии и заметки
        if action == "set_version":
            info = get_version_info(s3)
            info["version"] = body.get("version", info["version"])
            info["notes"]   = body.get("notes",   info.get("notes", ""))
            s3.put_object(Bucket=BUCKET, Key=VERSION_KEY,
                          Body=json.dumps(info, ensure_ascii=False).encode(),
                          ContentType="application/json")
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True, "info": info})}

        # Получить presigned PUT URL для прямой загрузки файла в S3 (без base64 через функцию)
        if action == "get_upload_url":
            file_type = body.get("file_type", "exe")  # "exe" или "server"
            key = EXE_KEY if file_type == "exe" else SERVER_KEY
            upload_url = s3.generate_presigned_url(
                "put_object",
                Params={"Bucket": BUCKET, "Key": key, "ContentType": "application/octet-stream"},
                ExpiresIn=3600,
            )
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"upload_url": upload_url})}

        # Подтвердить загрузку exe (обновить version.json после прямой загрузки в S3)
        if action == "confirm_exe":
            info = get_version_info(s3)
            info["version"]      = body.get("version", info["version"])
            info["notes"]        = body.get("notes",   info.get("notes", ""))
            info["download_url"] = cdn_url(EXE_KEY)
            s3.put_object(Bucket=BUCKET, Key=VERSION_KEY,
                          Body=json.dumps(info, ensure_ascii=False).encode(),
                          ContentType="application/json")
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True, "info": info})}

        # Подтвердить загрузку server.exe (обновить version.json после прямой загрузки в S3)
        if action == "confirm_server":
            info = get_version_info(s3)
            info["server_version"] = body.get("server_version", info.get("server_version", "1.0.0"))
            info["server_url"]     = cdn_url(SERVER_KEY)
            s3.put_object(Bucket=BUCKET, Key=VERSION_KEY,
                          Body=json.dumps(info, ensure_ascii=False).encode(),
                          ContentType="application/json")
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True, "info": info})}

        # Загрузить новый PVS-Setup.exe (установщик) — legacy, оставлен для совместимости
        if action == "upload_exe":
            exe_bytes = base64.b64decode(body.get("exe_base64", ""))
            s3.put_object(Bucket=BUCKET, Key=EXE_KEY, Body=exe_bytes,
                          ContentType="application/octet-stream")
            info = get_version_info(s3)
            info["version"]      = body.get("version", info["version"])
            info["notes"]        = body.get("notes",   info.get("notes", ""))
            info["download_url"] = cdn_url(EXE_KEY)
            s3.put_object(Bucket=BUCKET, Key=VERSION_KEY,
                          Body=json.dumps(info, ensure_ascii=False).encode(),
                          ContentType="application/json")
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True, "info": info})}

        # Загрузить новый server.exe (расчёты, без переустановки) — legacy
        if action == "upload_server":
            srv_bytes = base64.b64decode(body.get("exe_base64", ""))
            s3.put_object(Bucket=BUCKET, Key=SERVER_KEY, Body=srv_bytes,
                          ContentType="application/octet-stream")
            info = get_version_info(s3)
            info["server_version"] = body.get("server_version", info.get("server_version", "1.0.0"))
            info["server_url"]     = cdn_url(SERVER_KEY)
            s3.put_object(Bucket=BUCKET, Key=VERSION_KEY,
                          Body=json.dumps(info, ensure_ascii=False).encode(),
                          ContentType="application/json")
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True, "info": info})}

        return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Неизвестный action"})}

    return {"statusCode": 405, "headers": CORS, "body": ""}