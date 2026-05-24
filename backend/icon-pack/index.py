import os
import io
import json
import boto3
import urllib.request
from PIL import Image


SOURCE_URL = "https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/9cbce9b6-64f2-457e-93ba-9177d48d71b2.jpg"
BG_COLOR = (14, 99, 176, 255)   # #0E63B0 — синий фирменный


def remove_white_background(img: Image.Image, threshold: int = 238) -> Image.Image:
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r >= threshold and g >= threshold and b >= threshold:
                px[x, y] = (255, 255, 255, 0)
    return img


def crop_to_content(img: Image.Image, pad_ratio: float = 0.04) -> Image.Image:
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    side = max(w, h)
    pad = int(side * pad_ratio)
    side_padded = side + pad * 2
    canvas = Image.new("RGBA", (side_padded, side_padded), (0, 0, 0, 0))
    off_x = (side_padded - w) // 2
    off_y = (side_padded - h) // 2
    canvas.paste(img, (off_x, off_y), img)
    return canvas


def make_maskable(logo: Image.Image, size: int, pad_ratio: float = 0.20) -> Image.Image:
    """Maskable: синий фон + логотип с отступами safe-zone 20% со всех сторон."""
    canvas = Image.new("RGBA", (size, size), BG_COLOR)
    logo_size = int(size * (1.0 - pad_ratio * 2))
    logo_resized = logo.resize((logo_size, logo_size), Image.LANCZOS)
    off = (size - logo_size) // 2
    canvas.paste(logo_resized, (off, off), logo_resized)
    return canvas


def make_plain(logo: Image.Image, size: int) -> Image.Image:
    """Прозрачный фон, логотип по центру — для обычных иконок any."""
    return logo.resize((size, size), Image.LANCZOS)


def save_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def handler(event, context):
    """Генерирует plain и maskable иконки из логотипа, заливает в S3."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"}, "body": ""}

    with urllib.request.urlopen(SOURCE_URL, timeout=20) as resp:
        raw = resp.read()

    src = Image.open(io.BytesIO(raw)).convert("RGBA")
    src = remove_white_background(src, threshold=238)
    src = crop_to_content(src, pad_ratio=0.04)

    s3 = boto3.client("s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"])

    aws_key = os.environ["AWS_ACCESS_KEY_ID"]
    cdn = f"https://cdn.poehali.dev/projects/{aws_key}/bucket"
    results = {}

    # Обычные (any) иконки с прозрачным фоном
    for size in [64, 128, 192, 256, 512, 1024]:
        img = make_plain(src, size)
        key = f"icons/app-icon-{size}.png"
        s3.put_object(Bucket="files", Key=key, Body=save_png(img), ContentType="image/png")
        results[f"any_{size}"] = f"{cdn}/{key}"

    # Maskable иконки (синий фон + safe zone) для Android/PWA
    for size in [192, 512]:
        img = make_maskable(src, size, pad_ratio=0.20)
        key = f"icons/app-icon-maskable-{size}.png"
        s3.put_object(Bucket="files", Key=key, Body=save_png(img), ContentType="image/png")
        results[f"maskable_{size}"] = f"{cdn}/{key}"

    # ICO для favicon
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_imgs = [make_plain(src, s) for s in ico_sizes]
    ico_buf = io.BytesIO()
    ico_imgs[0].save(ico_buf, format="ICO",
        sizes=[(s, s) for s in ico_sizes], append_images=ico_imgs[1:])
    s3.put_object(Bucket="files", Key="icons/app-icon.ico",
        Body=ico_buf.getvalue(), ContentType="image/x-icon")
    results["ico"] = f"{cdn}/icons/app-icon.ico"

    return {"statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps({"ok": True, "files": results}, ensure_ascii=False)}
