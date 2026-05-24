import os
import io
import json
import boto3
import urllib.request
from PIL import Image

# Логотип с белым фоном — используем как есть
SOURCE_URL = "https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/1037aa86-6f0e-4dc3-b119-78f0a56e07c9.jpg"


def to_square(img: Image.Image) -> Image.Image:
    """Обрезает до квадрата по меньшей стороне (центровка)."""
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def save_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def handler(event, context):
    """Берёт логотип с белым фоном, нарезает в нужные размеры и заливает в S3."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"}, "body": ""}

    with urllib.request.urlopen(SOURCE_URL, timeout=20) as resp:
        raw = resp.read()

    # Открываем как RGB (белый фон сохраняется), приводим к квадрату
    src = Image.open(io.BytesIO(raw)).convert("RGB")
    src = to_square(src)

    s3 = boto3.client("s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"])

    aws_key = os.environ["AWS_ACCESS_KEY_ID"]
    cdn = f"https://cdn.poehali.dev/projects/{aws_key}/bucket"
    results = {}

    # Все размеры — с белым фоном (purpose: any)
    for size in [64, 128, 192, 256, 512, 1024]:
        img = src.resize((size, size), Image.LANCZOS)
        key = f"icons/app-icon-{size}.png"
        s3.put_object(Bucket="files", Key=key, Body=save_png(img), ContentType="image/png")
        results[f"any_{size}"] = f"{cdn}/{key}"

    # Maskable — тот же белый квадрат, но с небольшим отступом (safe-zone)
    for size in [192, 512]:
        canvas = Image.new("RGB", (size, size), (255, 255, 255))
        pad = int(size * 0.08)
        logo_size = size - pad * 2
        logo = src.resize((logo_size, logo_size), Image.LANCZOS)
        canvas.paste(logo, (pad, pad))
        key = f"icons/app-icon-maskable-{size}.png"
        s3.put_object(Bucket="files", Key=key, Body=save_png(canvas), ContentType="image/png")
        results[f"maskable_{size}"] = f"{cdn}/{key}"

    # ICO для favicon
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_imgs = [src.resize((s, s), Image.LANCZOS) for s in ico_sizes]
    ico_buf = io.BytesIO()
    ico_imgs[0].save(ico_buf, format="ICO",
        sizes=[(s, s) for s in ico_sizes], append_images=ico_imgs[1:])
    s3.put_object(Bucket="files", Key="icons/app-icon.ico",
        Body=ico_buf.getvalue(), ContentType="image/x-icon")
    results["ico"] = f"{cdn}/icons/app-icon.ico"

    return {"statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps({"ok": True, "files": results}, ensure_ascii=False)}