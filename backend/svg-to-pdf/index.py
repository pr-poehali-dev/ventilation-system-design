"""
Конвертация SVG → векторный PDF на бэкенде.
POST / body: { svg: "<svg...>", filename?: "schema", paper?: "A3", orientation?: "landscape" }
Возвращает PDF как base64.
Использует svglib + reportlab (чистый Python, без нативных DLL) —
рендерит SVG в PDF с сохранением векторного качества. Подходит и для
облака, и для desktop-сборки (server.exe), где Cairo недоступен.
"""
import json
import os
import re
import base64
import io
import urllib.request

# Кириллический шрифт DejaVu Sans.
# 1) сначала пробуем файл рядом с функцией (если он попал в деплой),
# 2) иначе — кэш в /tmp,
# 3) иначе — качаем с CDN один раз при холодном старте и кэшируем в /tmp.
_FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
_FONT_URLS = {
    "DejaVuSans.ttf": "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf",
    "DejaVuSans-Bold.ttf": "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf",
}
_FONTS_REGISTERED = False


def _resolve_font(fname: str) -> str:
    """Возвращает путь к TTF: bundle -> /tmp-кэш -> скачивание с CDN."""
    bundled = os.path.join(_FONT_DIR, fname)
    if os.path.exists(bundled) and os.path.getsize(bundled) > 10000:
        return bundled
    cached = os.path.join("/tmp", fname)
    if os.path.exists(cached) and os.path.getsize(cached) > 10000:
        return cached
    req = urllib.request.Request(_FONT_URLS[fname], headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
    with open(cached, "wb") as f:
        f.write(data)
    return cached


def _register_cyrillic_fonts():
    """Регистрирует кириллический TTF (DejaVu Sans) в svglib один раз.

    Регистрируем через svglib.register_font (обычное и жирное начертание
    одной семьи DejaVuSans), чтобы svglib корректно резолвил и
    font-weight="bold". Без кириллического шрифта русский текст в PDF
    превращается в прямоугольники.
    """
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return
    from svglib.svglib import register_font
    reg = _resolve_font("DejaVuSans.ttf")
    bold = _resolve_font("DejaVuSans-Bold.ttf")
    register_font("DejaVuSans", font_path=reg,
                  weight="normal", rlgFontName="DejaVuSans")
    register_font("DejaVuSans", font_path=bold,
                  weight="bold", rlgFontName="DejaVuSans-Bold")
    _FONTS_REGISTERED = True


def _remap_font_family(svg: str) -> str:
    """Заменяет любой font-family в SVG на кириллический DejaVuSans.

    Без этого svglib маппит Arial/Segoe UI/Helvetica на встроенные шрифты
    reportlab, где нет кириллицы -> русский текст превращается в прямоугольники.

    Плюс навешивает font-family="DejaVuSans" на корневой <svg>, чтобы текст
    БЕЗ явного font-family (индикаторы перемычек, замерных станций, метки
    А/D/ПП) тоже наследовал кириллический шрифт, а не дефолтный Helvetica
    reportlab. Иначе такие подписи в PDF превращались в квадратики.
    """
    svg = re.sub(r'font-family\s*=\s*"[^"]*"', 'font-family="DejaVuSans"', svg)
    svg = re.sub(r"font-family\s*:\s*[^;\"']+", "font-family:DejaVuSans", svg)

    # Добавляем шрифт по умолчанию на первый тег <svg>, если его там ещё нет.
    def _add_root_font(m):
        tag = m.group(0)
        if re.search(r'font-family', tag):
            return tag
        return tag[:-1] + ' font-family="DejaVuSans">'

    svg = re.sub(r'<svg\b[^>]*>', _add_root_font, svg, count=1)

    # svglib не всегда наследует font-family от родителя, поэтому явно
    # проставляем DejaVuSans каждому <text>, где шрифт не задан.
    def _add_text_font(m):
        tag = m.group(0)
        if re.search(r'font-family', tag):
            return tag
        return tag[:-1] + ' font-family="DejaVuSans">'

    svg = re.sub(r'<text\b[^>]*>', _add_text_font, svg)
    return svg


def _fix_baseline(svg: str) -> str:
    """svglib игнорирует dominant-baseline -> текст (номера позиций, штамп,
    заголовок) уезжает вверх/вниз относительно ячейки. Переводим
    dominant-baseline в явный dy (в px), опираясь на font-size элемента.

    central/middle -> опустить на ~0.32em (визуальный центр по y),
    hanging        -> опустить на ~0.72em (верх текста по y),
    auto/text-*    -> без сдвига (baseline по y).
    """
    tag_re = re.compile(r"<text\b[^>]*>", re.IGNORECASE)

    def repl(m):
        tag = m.group(0)
        bl = re.search(r'dominant-baseline\s*=\s*"([^"]*)"', tag)
        if not bl:
            return tag
        mode = bl.group(1).strip().lower()
        if mode in ("middle", "central"):
            k = 0.32
        elif mode == "hanging":
            k = 0.72
        else:
            k = 0.0
        # font-size (px) из тега, иначе 12
        fs_m = re.search(r'font-size\s*=\s*"([\d.]+)', tag)
        fs = float(fs_m.group(1)) if fs_m else 12.0
        dy = k * fs
        # убираем dominant-baseline и добавляем/увеличиваем dy
        tag2 = re.sub(r'\s*dominant-baseline\s*=\s*"[^"]*"', "", tag)
        if abs(dy) > 0.01 and "dy=" not in tag2:
            tag2 = tag2[:-1] + f' dy="{dy:.2f}">'
        return tag2

    return tag_re.sub(repl, svg)

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

PAPER_SIZES_MM = {
    "A4":  (210, 297),
    "A3":  (297, 420),
    "A2":  (420, 594),
    "A1":  (594, 841),
    "A0":  (841, 1189),
}


def resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def handler(event: dict, context) -> dict:
    """SVG → векторный PDF. Принимает SVG строку, возвращает PDF base64."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            return resp(400, {"error": "invalid_json"})

    svg_string = body.get("svg", "")
    if not svg_string or not svg_string.strip().startswith("<"):
        return resp(400, {"error": "svg_required"})

    paper    = body.get("paper", "A3").upper()
    orient   = body.get("orientation", "landscape")

    mm = PAPER_SIZES_MM.get(paper, PAPER_SIZES_MM["A3"])
    w_mm, h_mm = (mm[1], mm[0]) if orient == "landscape" else (mm[0], mm[1])

    # reportlab работает в пунктах (points): 1 mm = 72/25.4 pt
    MM_TO_PT = 72.0 / 25.4
    page_w = w_mm * MM_TO_PT
    page_h = h_mm * MM_TO_PT

    try:
        from svglib.svglib import svg2rlg
        from reportlab.graphics import renderPDF
        from reportlab.pdfgen import canvas
        from reportlab.lib.units import mm as RL_MM  # noqa: F401

        # Регистрируем кириллический шрифт и подменяем font-family в SVG,
        # иначе русский текст в PDF станет прямоугольниками.
        # Если шрифт по какой-то причине не зарегистрировался — не ломаем
        # экспорт целиком, просто оставляем исходный font-family.
        font_ok = False
        try:
            _register_cyrillic_fonts()
            font_ok = True
        except Exception:
            font_ok = False
        if font_ok:
            svg_string = _remap_font_family(svg_string)
        # Центрируем текст по вертикали (svglib не понимает dominant-baseline)
        svg_string = _fix_baseline(svg_string)

        # svglib парсит SVG в reportlab-drawing (векторный)
        drawing = svg2rlg(io.BytesIO(svg_string.encode("utf-8")))
        if drawing is None:
            return resp(500, {"error": "conversion_failed", "detail": "svg_parse_failed"})

        # Вписываем drawing в лист с сохранением пропорций, центрируем
        dw = drawing.width or page_w
        dh = drawing.height or page_h
        scale = min(page_w / dw, page_h / dh) if dw and dh else 1.0
        drawing.width = dw * scale
        drawing.height = dh * scale
        drawing.scale(scale, scale)
        off_x = (page_w - dw * scale) / 2.0
        off_y = (page_h - dh * scale) / 2.0

        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(page_w, page_h))
        renderPDF.draw(drawing, c, off_x, off_y)
        c.showPage()
        c.save()
        pdf_bytes = buf.getvalue()

        pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")

        return {
            "statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({
                "pdf": pdf_b64,
                "size_bytes": len(pdf_bytes),
                "paper": paper,
                "orientation": orient,
            }),
        }

    except ImportError as e:
        return resp(500, {"error": "svglib_not_installed", "detail": str(e)})
    except Exception as e:
        return resp(500, {"error": "conversion_failed", "detail": str(e)})