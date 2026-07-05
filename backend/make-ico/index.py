import os
import io
import json
import boto3
import urllib.request
from PIL import Image

# Источник по умолчанию — логотип ПВ-Система (чёткий, без фона, 512×512)
DEFAULT_SOURCE_URL = "https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/14e46911-d90d-4bc5-a7c1-8676aa5e350d.png"


def load_source_image(url: str) -> Image.Image:
    """Скачивает картинку и возвращает RGBA (PNG/JPG)."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()
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

    # ICO — несколько размеров в одном файле (для Windows ярлыка).
    # ВАЖНО: каждый размер готовим отдельно через LANCZOS.
    # Формат кадра внутри ICO критичен для чёткости:
    #   • размеры < 256  → классический BMP/DIB (32-bit BGRA). Загрузчик иконок
    #     ярлыков/проводника Windows читает его надёжно и без масштабирования.
    #   • размер 256      → PNG (стандарт для крупной иконки, экономит размер).
    # Раньше ВСЕ кадры писались как PNG — на мелких размерах Windows часто
    # ресайзил крупный кадр «на лету», отсюда и мыло.
    import struct

    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_frames = [src.resize((s, s), Image.LANCZOS).convert("RGBA") for s in ico_sizes]

    def frame_as_dib(img):
        """32-bit BMP/DIB (BGRA) + AND-маска — тело кадра ICO без BMP-заголовка."""
        w, h = img.size
        px = img.load()
        # XOR-часть: BGRA, снизу вверх
        xor = bytearray()
        for y in range(h - 1, -1, -1):
            for x in range(w):
                r, g, b, a = px[x, y]
                xor += bytes((b, g, r, a))
        # AND-маска: 1 бит на пиксель, строки выровнены по 4 байта
        row_bytes = ((w + 31) // 32) * 4
        and_mask = bytearray()
        for y in range(h - 1, -1, -1):
            row = bytearray(row_bytes)
            for x in range(w):
                if px[x, y][3] == 0:            # полностью прозрачный → бит маски = 1
                    row[x // 8] |= 0x80 >> (x % 8)
            and_mask += row
        # BITMAPINFOHEADER: высота = 2*h (XOR + AND)
        header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0,
                             len(xor) + len(and_mask), 0, 0, 0, 0)
        return bytes(header) + bytes(xor) + bytes(and_mask)

    def frame_as_png(img):
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    def build_ico(frames):
        out = io.BytesIO()
        n = len(frames)
        out.write(struct.pack("<HHH", 0, 1, n))   # ICONDIR
        payloads = [frame_as_png(im) if im.width >= 256 else frame_as_dib(im)
                    for im in frames]
        offset = 6 + n * 16                        # после всех ICONDIRENTRY
        for img, data in zip(frames, payloads):
            w = img.width if img.width < 256 else 0
            h = img.height if img.height < 256 else 0
            out.write(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset))
            offset += len(data)
        for data in payloads:
            out.write(data)
        return out.getvalue()

    ico_bytes = build_ico(ico_frames)
    s3.put_object(Bucket="files", Key="icons/desktop-icon.ico",
        Body=ico_bytes, ContentType="image/x-icon")
    results["ico"] = f"{cdn}/icons/desktop-icon.ico"
    results["ico_sizes"] = ico_sizes

    return {"statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps({"ok": True, "files": results}, ensure_ascii=False)}