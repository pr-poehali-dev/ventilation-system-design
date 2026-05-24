import os
import io
import json
import boto3
import urllib.request
from PIL import Image

# Готовый квадратный логотип 512×512 — используем как основу для всех иконок.
# Логотип уже правильно центрирован, не обрезаем.
SOURCE_URL = "https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/df5a1bde-a42c-4805-9a04-f2a8ff3ba8df.png"


def fit_to_square(img: Image.Image, size: int, bg: tuple = (255, 255, 255)) -> Image.Image:
    """
    Вписывает изображение в квадрат size×size по центру без обрезки.
    Логотип масштабируется с сохранением пропорций, остаток заполняется bg.
    """
    img = img.convert("RGBA")
    iw, ih = img.size
    ratio = min(size / iw, size / ih)
    nw = int(iw * ratio)
    nh = int(ih * ratio)
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), bg + (255,))
    off_x = (size - nw) // 2
    off_y = (size - nh) // 2
    canvas.paste(img, (off_x, off_y), img)
    # Вернём RGB (белый фон)
    result = Image.new("RGB", (size, size), bg)
    result.paste(canvas, mask=canvas.split()[3])
    return result


def fit_to_square_with_pad(img: Image.Image, size: int, pad_ratio: float = 0.08) -> Image.Image:
    """Вписывает логотип в квадрат с отступом safe-zone (для maskable)."""
    img = img.convert("RGBA")
    pad = int(size * pad_ratio)
    inner = size - pad * 2
    iw, ih = img.size
    ratio = min(inner / iw, inner / ih)
    nw = int(iw * ratio)
    nh = int(ih * ratio)
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (size, size), (255, 255, 255))
    off_x = (size - nw) // 2
    off_y = (size - nh) // 2
    # RGBA поверх белого фона
    tmp = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    tmp.paste(img, (off_x, off_y), img)
    canvas = tmp.convert("RGB")
    return canvas


def save_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def handler(event, context):
    """Генерирует иконки всех размеров из правильно центрированного квадратного логотипа."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"}, "body": ""}

    with urllib.request.urlopen(SOURCE_URL, timeout=20) as resp:
        raw = resp.read()

    src = Image.open(io.BytesIO(raw)).convert("RGBA")

    s3 = boto3.client("s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"])

    aws_key = os.environ["AWS_ACCESS_KEY_ID"]
    cdn = f"https://cdn.poehali.dev/projects/{aws_key}/bucket"
    results = {}

    # Обычные иконки — логотип вписан по центру, белый фон
    for size in [16, 32, 48, 64, 128, 192, 256, 512, 1024]:
        img = fit_to_square(src, size, bg=(255, 255, 255))
        key = f"icons/app-icon-{size}.png"
        s3.put_object(Bucket="files", Key=key, Body=save_png(img), ContentType="image/png")
        results[f"any_{size}"] = f"{cdn}/{key}"

    # Maskable — с отступом safe-zone 10%
    for size in [192, 512]:
        img = fit_to_square_with_pad(src, size, pad_ratio=0.10)
        key = f"icons/app-icon-maskable-{size}.png"
        s3.put_object(Bucket="files", Key=key, Body=save_png(img), ContentType="image/png")
        results[f"maskable_{size}"] = f"{cdn}/{key}"

    # ICO для favicon (несколько размеров в одном файле)
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_imgs = [fit_to_square(src, s, bg=(255, 255, 255)) for s in ico_sizes]
    ico_buf = io.BytesIO()
    ico_imgs[0].save(ico_buf, format="ICO",
        sizes=[(s, s) for s in ico_sizes], append_images=ico_imgs[1:])
    s3.put_object(Bucket="files", Key="icons/app-icon.ico",
        Body=ico_buf.getvalue(), ContentType="image/x-icon")
    results["ico"] = f"{cdn}/icons/app-icon.ico"

    return {"statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps({"ok": True, "files": results}, ensure_ascii=False)}
