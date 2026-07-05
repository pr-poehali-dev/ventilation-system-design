"""Локальная генерация Windows .ico из PNG-логотипа.

Зачем: раньше build.bat скачивал готовый .ico через curl. Если файл не
скачивался или подменялся на PNG — иконка приложения получалась размытой
(Windows масштабировал один крупный кадр). Здесь мы гарантированно строим
многоразмерный .ico на машине сборки.

Формат кадров критичен для чёткости:
  • размеры < 256  → классический BMP/DIB (32-bit BGRA + AND-маска).
    Загрузчик иконок ярлыков/проводника Windows читает его без масштабирования.
  • размер 256      → PNG (стандарт для крупной иконки).

Использование:
    python make_ico.py <source.png> <out.ico>
"""
import io
import struct
import sys

from PIL import Image

ICO_SIZES = [16, 32, 48, 64, 128, 256]


def frame_as_dib(img: Image.Image) -> bytes:
    """32-bit BMP/DIB (BGRA) + AND-маска — тело кадра ICO без BMP-заголовка."""
    w, h = img.size
    px = img.load()
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))
    row_bytes = ((w + 31) // 32) * 4
    and_mask = bytearray()
    for y in range(h - 1, -1, -1):
        row = bytearray(row_bytes)
        for x in range(w):
            if px[x, y][3] == 0:
                row[x // 8] |= 0x80 >> (x % 8)
        and_mask += row
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0,
                         len(xor) + len(and_mask), 0, 0, 0, 0)
    return bytes(header) + bytes(xor) + bytes(and_mask)


def frame_as_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def build_ico(src: Image.Image) -> bytes:
    frames = [src.resize((s, s), Image.LANCZOS).convert("RGBA") for s in ICO_SIZES]
    payloads = [frame_as_png(im) if im.width >= 256 else frame_as_dib(im)
                for im in frames]
    out = io.BytesIO()
    n = len(frames)
    out.write(struct.pack("<HHH", 0, 1, n))
    offset = 6 + n * 16
    for img, data in zip(frames, payloads):
        w = img.width if img.width < 256 else 0
        h = img.height if img.height < 256 else 0
        out.write(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    for data in payloads:
        out.write(data)
    return out.getvalue()


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: python make_ico.py <source.png> <out.ico>")
        return 2
    src_path, out_path = sys.argv[1], sys.argv[2]
    src = Image.open(src_path).convert("RGBA")
    w, h = src.size
    if w != h:
        side = max(w, h)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(src, ((side - w) // 2, (side - h) // 2))
        src = canvas
    with open(out_path, "wb") as f:
        f.write(build_ico(src))
    print(f"ICO written: {out_path} sizes={ICO_SIZES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
