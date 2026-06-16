"""
Конвертация PNG (высокое DPI) → PDF на бэкенде через reportlab.
POST / body: {
  png: "<base64>",          — PNG изображение схемы в base64 (data:... или чистый base64)
  paper_w_mm: 420,          — ширина бумаги в мм
  paper_h_mm: 297,          — высота бумаги в мм
}
Возвращает { pdf: "<base64>" }

Legacy режим SVG→PDF через cairosvg:
POST / body: { svg: "...", paper?: "A3", orientation?: "landscape" }
"""
import json
import base64
import io

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def png_to_pdf(png_b64: str, w_mm: float, h_mm: float) -> bytes:
    """Вставляет PNG в PDF страницу заданного размера через reportlab."""
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as rl_canvas

    png_bytes = base64.b64decode(png_b64)
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(w_mm * mm, h_mm * mm))
    img_buf = io.BytesIO(png_bytes)
    # drawImage от нижнего левого угла — y=0 в PDF это низ страницы
    c.drawImage(img_buf, 0, 0, width=w_mm * mm, height=h_mm * mm,
                preserveAspectRatio=False)
    c.save()
    return buf.getvalue()


def svg_to_pdf_cairo(svg_str: str, w_mm: float, h_mm: float) -> bytes:
    """Legacy: SVG → PDF через cairosvg."""
    import cairosvg
    DPI = 96
    w_px = round(w_mm * DPI / 25.4)
    h_px = round(h_mm * DPI / 25.4)
    return cairosvg.svg2pdf(
        bytestring=svg_str.encode("utf-8"),
        output_width=w_px,
        output_height=h_px,
    )


def handler(event: dict, context) -> dict:
    """PNG→PDF конвертер для печати схем вентиляции на плоттере."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            return resp(400, {"error": "invalid_json"})

    # ── PNG → PDF (основной режим — полная схема как в рабочей области) ──
    if body.get("png"):
        png_b64 = body["png"]
        if "," in png_b64:
            png_b64 = png_b64.split(",", 1)[1]

        w_mm = float(body.get("paper_w_mm", 420))
        h_mm = float(body.get("paper_h_mm", 297))

        try:
            pdf_bytes = png_to_pdf(png_b64, w_mm, h_mm)
            return {
                "statusCode": 200,
                "headers": {**CORS, "Content-Type": "application/json"},
                "body": json.dumps({
                    "pdf": base64.b64encode(pdf_bytes).decode("ascii"),
                    "size_bytes": len(pdf_bytes),
                }),
            }
        except ImportError:
            return resp(500, {"error": "reportlab_not_installed"})
        except Exception as e:
            return resp(500, {"error": "conversion_failed", "detail": str(e)})

    # ── SVG → PDF (legacy через cairosvg) ────────────────────────────────
    if body.get("svg"):
        svg_str = body["svg"]
        if not svg_str.strip().startswith("<"):
            return resp(400, {"error": "invalid_svg"})

        PAPER_SIZES_MM = {
            "A4": (210, 297), "A3": (297, 420), "A2": (420, 594),
            "A1": (594, 841), "A0": (841, 1189),
        }
        paper  = body.get("paper", "A3").upper()
        orient = body.get("orientation", "landscape")
        mm_pair = PAPER_SIZES_MM.get(paper, PAPER_SIZES_MM["A3"])
        w_mm, h_mm = (mm_pair[1], mm_pair[0]) if orient == "landscape" else mm_pair

        try:
            pdf_bytes = svg_to_pdf_cairo(svg_str, w_mm, h_mm)
            return {
                "statusCode": 200,
                "headers": {**CORS, "Content-Type": "application/json"},
                "body": json.dumps({
                    "pdf": base64.b64encode(pdf_bytes).decode("ascii"),
                    "size_bytes": len(pdf_bytes),
                }),
            }
        except ImportError:
            return resp(500, {"error": "cairosvg_not_installed"})
        except Exception as e:
            return resp(500, {"error": "svg_conversion_failed", "detail": str(e)})

    return resp(400, {"error": "png_or_svg_required"})
