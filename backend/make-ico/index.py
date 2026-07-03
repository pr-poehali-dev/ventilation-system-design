import os
import io
import json
import boto3
import urllib.request
from PIL import Image

# Источник по умолчанию — квадратный логотип-иконка ПВ-Система
DEFAULT_SOURCE_URL = "https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/2abde3ca-e06f-44e9-979d-d2719ef91292.svg"


def load_source_image(url: str) -> Image.Image:
    """Скачивает картинку и возвращает RGBA. Поддерживает PNG/JPG и SVG (через cairosvg)."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()

    is_svg = url.lower().endswith(".svg") or raw[:200].lstrip().startswith(b"<")
    if is_svg:
        import cairosvg
        png_bytes = cairosvg.svg2png(bytestring=raw, output_width=1024, output_height=1024)
        return Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    return Image.open(io.BytesIO(raw)).convert("RGBA")


def handler(event, context):
    """Генерирует ICO и PNG-иконки из логотипа, заливает в S3."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": {"Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type"}, "body": ""}

    params = event.get("queryStringParameters") or {}
    source_url = params.get("url") or DEFAULT_SOURCE_URL

    src = load_source_image(source_url)
    w, h = src.size
    # Если вдруг не квадрат — вписываем в квадрат по центру без обрезки
    if w != h:
        side = max(w, h)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(src, ((side - w) // 2, (side - h) // 2))
        src = canvas

    s3 = boto3.client("s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"])

    aws_key = os.environ["AWS_ACCESS_KEY_ID"]
    cdn = f"https://cdn.poehali.dev/projects/{aws_key}/bucket"
    results = {}

    # PNG-иконки для favicon (прозрачный фон)
    for size in [16, 32, 48, 64, 128, 256, 512]:
        img = src.resize((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        key = f"icons/desktop-icon-{size}.png"
        s3.put_object(Bucket="files", Key=key, Body=buf.getvalue(), ContentType="image/png")
        results[f"png_{size}"] = f"{cdn}/{key}"

    # ICO — несколько размеров в одном файле (для Windows ярлыка)
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_imgs = [src.resize((s, s), Image.LANCZOS) for s in ico_sizes]
    # ICO не поддерживает RGBA напрямую во всех случаях — конвертируем правильно
    ico_frames = []
    for img in ico_imgs:
        # Сохраняем прозрачность через RGBA
        ico_frames.append(img)

    ico_buf = io.BytesIO()
    ico_frames[0].save(
        ico_buf, format="ICO",
        sizes=[(s, s) for s in ico_sizes],
        append_images=ico_frames[1:]
    )
    s3.put_object(Bucket="files", Key="icons/desktop-icon.ico",
        Body=ico_buf.getvalue(), ContentType="image/x-icon")
    results["ico"] = f"{cdn}/icons/desktop-icon.ico"

    return {"statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps({"ok": True, "files": results}, ensure_ascii=False)}