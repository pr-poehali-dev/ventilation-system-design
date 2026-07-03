"""
Проверка версии и управление обновлениями ПВС-Система.

GET  /                         → текущая версия + ссылки на скачивание
GET  /  ?file=server           → скачать актуальный server.exe
POST /  action=set_version     → обновить номер версии и заметки
POST /  action=upload_start    → начать multipart upload, вернуть upload_id
POST /  action=upload_chunk    → загрузить один чанк (base64, до 5МБ)
POST /  action=upload_finish   → завершить multipart upload + обновить version.json
POST /  action=upload_abort    → отменить незавершённый multipart upload
"""
import json
import os
import base64
import urllib.request
import boto3

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
}

VERSION_KEY = "updates/version.json"
EXE_KEY     = "updates/PVS-Setup.exe"
SERVER_KEY  = "updates/server.exe"
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
    default = {
        "version":        "1.0.0",
        "download_url":   cdn_url(EXE_KEY),
        "server_url":     cdn_url(SERVER_KEY),
        "server_version": "1.0.0",
        "notes":          "",
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

    # ── GET: отдать server.exe напрямую ───────────────────────────────────────
    if method == "GET" and params.get("file") == "server":
        try:
            obj  = s3.get_object(Bucket=BUCKET, Key=SERVER_KEY)
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

        # ── Загрузить файл по прямой ссылке (сервер сам скачает и зальёт в S3) ─
        # Надёжно для больших файлов (77 МБ+): передача сервер→сервер, минуя браузер.
        if action == "upload_from_url":
            file_type = body.get("file_type", "exe")
            src_url   = (body.get("url") or "").strip()
            if not src_url.startswith("http"):
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Нужна прямая http-ссылка на файл"})}

            key = EXE_KEY if file_type == "exe" else SERVER_KEY

            # Потоковая перекачка через multipart upload (части по 8 МБ), без хранения в памяти
            PART_SIZE = 8 * 1024 * 1024
            mp = s3.create_multipart_upload(Bucket=BUCKET, Key=key, ContentType="application/octet-stream")
            upload_id = mp["UploadId"]
            parts = []
            part_num = 1
            try:
                req = urllib.request.Request(src_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=300) as stream:
                    buf = b""
                    while True:
                        data = stream.read(1024 * 512)
                        if data:
                            buf += data
                        # Отправляем часть когда накопили >= PART_SIZE, либо в конце (остаток)
                        if len(buf) >= PART_SIZE or (not data and buf):
                            resp = s3.upload_part(
                                Bucket=BUCKET, Key=key, UploadId=upload_id,
                                PartNumber=part_num, Body=buf,
                            )
                            parts.append({"PartNumber": part_num, "ETag": resp["ETag"]})
                            part_num += 1
                            buf = b""
                        if not data:
                            break

                if not parts:
                    s3.abort_multipart_upload(Bucket=BUCKET, Key=key, UploadId=upload_id)
                    return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Файл по ссылке пуст или недоступен"})}

                s3.complete_multipart_upload(
                    Bucket=BUCKET, Key=key, UploadId=upload_id,
                    MultipartUpload={"Parts": parts},
                )
            except Exception as e:
                try:
                    s3.abort_multipart_upload(Bucket=BUCKET, Key=key, UploadId=upload_id)
                except Exception:
                    pass
                return {"statusCode": 500, "headers": CORS, "body": json.dumps({"error": f"Не удалось скачать файл: {e}"})}

            # Обновляем version.json
            info = get_version_info(s3)
            if key == EXE_KEY:
                info["version"]      = body.get("version", info["version"])
                info["notes"]        = body.get("notes", info.get("notes", ""))
                info["download_url"] = cdn_url(EXE_KEY)
            else:
                info["server_version"] = body.get("server_version", info.get("server_version", "1.0.0"))
                info["server_url"]     = cdn_url(SERVER_KEY)
            s3.put_object(Bucket=BUCKET, Key=VERSION_KEY,
                          Body=json.dumps(info, ensure_ascii=False).encode(),
                          ContentType="application/json")
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True, "info": info}, ensure_ascii=False)}

        # ── Обновить только номер версии и заметки ────────────────────────────
        if action == "set_version":
            info = get_version_info(s3)
            info["version"] = body.get("version", info["version"])
            info["notes"]   = body.get("notes",   info.get("notes", ""))
            s3.put_object(Bucket=BUCKET, Key=VERSION_KEY,
                          Body=json.dumps(info, ensure_ascii=False).encode(),
                          ContentType="application/json")
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True, "info": info})}

        # ── Начать multipart upload ───────────────────────────────────────────
        if action == "upload_start":
            file_type = body.get("file_type", "exe")
            key = EXE_KEY if file_type == "exe" else SERVER_KEY
            resp = s3.create_multipart_upload(
                Bucket=BUCKET, Key=key,
                ContentType="application/octet-stream",
            )
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({
                "upload_id": resp["UploadId"],
                "key": key,
            })}

        # ── Выдать presigned URL для прямой загрузки части в S3 ───────────────
        # Браузер грузит чанк напрямую в S3 (PUT), минуя лимит тела функции.
        if action == "get_part_url":
            key       = body.get("key")
            upload_id = body.get("upload_id")
            part_num  = int(body.get("part_number", 1))
            url = s3.generate_presigned_url(
                "upload_part",
                Params={
                    "Bucket": BUCKET,
                    "Key": key,
                    "UploadId": upload_id,
                    "PartNumber": part_num,
                },
                ExpiresIn=3600,
            )
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"url": url})}

        # ── Загрузить один чанк (fallback: base64 через функцию) ──────────────
        if action == "upload_chunk":
            key       = body.get("key")
            upload_id = body.get("upload_id")
            part_num  = int(body.get("part_number", 1))
            chunk_b64 = body.get("chunk_base64", "")
            chunk_bytes = base64.b64decode(chunk_b64)
            resp = s3.upload_part(
                Bucket=BUCKET, Key=key,
                UploadId=upload_id,
                PartNumber=part_num,
                Body=chunk_bytes,
            )
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({
                "part_number": part_num,
                "etag": resp["ETag"],
            })}

        # ── Завершить multipart upload + обновить version.json ────────────────
        if action == "upload_finish":
            key       = body.get("key")
            upload_id = body.get("upload_id")
            parts     = body.get("parts", [])  # [{part_number, etag}, ...]
            s3.complete_multipart_upload(
                Bucket=BUCKET, Key=key, UploadId=upload_id,
                MultipartUpload={"Parts": [
                    {"PartNumber": p["part_number"], "ETag": p["etag"]} for p in parts
                ]},
            )
            # Обновляем version.json
            info = get_version_info(s3)
            if key == EXE_KEY:
                info["version"]      = body.get("version", info["version"])
                info["notes"]        = body.get("notes", info.get("notes", ""))
                info["download_url"] = cdn_url(EXE_KEY)
            else:
                info["server_version"] = body.get("server_version", info.get("server_version", "1.0.0"))
                info["server_url"]     = cdn_url(SERVER_KEY)
            s3.put_object(Bucket=BUCKET, Key=VERSION_KEY,
                          Body=json.dumps(info, ensure_ascii=False).encode(),
                          ContentType="application/json")
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True, "info": info})}

        # ── Отменить незавершённый multipart upload ───────────────────────────
        if action == "upload_abort":
            key       = body.get("key")
            upload_id = body.get("upload_id")
            s3.abort_multipart_upload(Bucket=BUCKET, Key=key, UploadId=upload_id)
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

        return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Неизвестный action"})}

    return {"statusCode": 405, "headers": CORS, "body": ""}