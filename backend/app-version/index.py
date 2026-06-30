"""
Проверка версии и управление обновлениями ПВС-Система.

GET  /        → текущая версия + ссылка на скачивание
POST /upload  → загрузка нового PVS.exe в S3 (требует ADMIN_PASSWORD)
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

VERSION_KEY = "updates/version.json"
EXE_KEY     = "updates/PVS.exe"
BUCKET      = "files"


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
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=VERSION_KEY)
        return json.loads(obj["Body"].read().decode())
    except Exception:
        return {"version": "1.0.0", "download_url": cdn_url(EXE_KEY), "notes": ""}


def handler(event: dict, context) -> dict:
    """Версия приложения и управление обновлениями ПВС-Система."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    s3 = get_s3()

    if method == "GET":
        info = get_version_info(s3)
        return {
            "statusCode": 200,
            "headers": CORS,
            "body": json.dumps(info, ensure_ascii=False),
        }

    if method == "POST":
        password = (event.get("headers") or {}).get("X-Admin-Password", "")
        if password != os.environ.get("ADMIN_PASSWORD", ""):
            return {"statusCode": 403, "headers": CORS, "body": json.dumps({"error": "Неверный пароль"})}

        body = json.loads(event.get("body") or "{}")
        action = body.get("action")

        if action == "set_version":
            version = body.get("version", "1.0.0")
            notes   = body.get("notes", "")
            info = {
                "version":      version,
                "download_url": cdn_url(EXE_KEY),
                "notes":        notes,
            }
            s3.put_object(
                Bucket=BUCKET,
                Key=VERSION_KEY,
                Body=json.dumps(info, ensure_ascii=False).encode(),
                ContentType="application/json",
            )
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True, "info": info})}

        if action == "upload_exe":
            exe_b64 = body.get("exe_base64", "")
            exe_bytes = base64.b64decode(exe_b64)
            s3.put_object(
                Bucket=BUCKET,
                Key=EXE_KEY,
                Body=exe_bytes,
                ContentType="application/octet-stream",
            )
            version = body.get("version", "1.0.0")
            notes   = body.get("notes", "")
            info = {
                "version":      version,
                "download_url": cdn_url(EXE_KEY),
                "notes":        notes,
            }
            s3.put_object(
                Bucket=BUCKET,
                Key=VERSION_KEY,
                Body=json.dumps(info, ensure_ascii=False).encode(),
                ContentType="application/json",
            )
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True, "info": info})}

        return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Неизвестный action"})}

    return {"statusCode": 405, "headers": CORS, "body": ""}
