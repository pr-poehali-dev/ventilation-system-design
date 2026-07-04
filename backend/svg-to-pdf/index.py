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
import base64
import io

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