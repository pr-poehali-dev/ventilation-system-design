import os
import io
import json
import boto3
import urllib.request
from PIL import Image


SOURCE_URL = "https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/9cbce9b6-64f2-457e-93ba-9177d48d71b2.jpg"


def remove_white_background(img: Image.Image, threshold: int = 240) -> Image.Image:
    """Делает белый/почти-белый фон прозрачным."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r >= threshold and g >= threshold and b >= threshold:
                px[x, y] = (255, 255, 255, 0)
    return img


def crop_to_content(img: Image.Image, pad_ratio: float = 0.06) -> Image.Image:
    """Обрезает изображение по непрозрачному содержимому и добавляет небольшие поля, центрирует в квадрат."""
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


def handler(event, context):
    """Берёт реальный логотип, делает прозрачный фон, генерирует PNG/ICO во всех размерах и заливает в S3."""
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400'
            },
            'body': ''
        }

    with urllib.request.urlopen(SOURCE_URL, timeout=20) as resp:
        raw = resp.read()

    src = Image.open(io.BytesIO(raw)).convert("RGBA")
    src = remove_white_background(src, threshold=238)
    src = crop_to_content(src, pad_ratio=0.04)

    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY']
    )

    aws_key = os.environ['AWS_ACCESS_KEY_ID']
    cdn_base = f"https://cdn.poehali.dev/projects/{aws_key}/bucket"
    results = {}

    sizes = [16, 32, 48, 64, 128, 256, 512, 1024]
    pil_images_for_ico = []

    for size in sizes:
        img = src.resize((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format='PNG', optimize=True)
        png_bytes = buf.getvalue()
        key = f"icons/app-icon-{size}.png"
        s3.put_object(
            Bucket='files',
            Key=key,
            Body=png_bytes,
            ContentType='image/png'
        )
        results[f"png_{size}"] = f"{cdn_base}/{key}"
        if size in (16, 32, 48, 64, 128, 256):
            pil_images_for_ico.append(img)

    ico_buf = io.BytesIO()
    pil_images_for_ico[0].save(
        ico_buf,
        format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        append_images=pil_images_for_ico[1:]
    )
    ico_buf.seek(0)
    s3.put_object(
        Bucket='files',
        Key='icons/app-icon.ico',
        Body=ico_buf.getvalue(),
        ContentType='image/x-icon'
    )
    results['ico'] = f"{cdn_base}/icons/app-icon.ico"

    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'isBase64Encoded': False,
        'body': json.dumps({'ok': True, 'files': results}, ensure_ascii=False)
    }
