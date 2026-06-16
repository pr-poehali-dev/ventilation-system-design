"""
Конвертация SVG → векторный PDF на бэкенде.
POST / body: { svg: "<svg...>", filename?: "schema", paper?: "A3", orientation?: "landscape" }
Возвращает PDF как base64.
Использует cairosvg — рендерит SVG в PDF с сохранением векторного качества.
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

    # px при 96 DPI для cairosvg (внутренне использует 96 DPI)
    # cairosvg сам масштабирует SVG под output_width/output_height
    DPI = 96
    w_px = round(w_mm * DPI / 25.4)
    h_px = round(h_mm * DPI / 25.4)

    try:
        import cairosvg

        pdf_bytes = cairosvg.svg2pdf(
            bytestring=svg_string.encode("utf-8"),
            output_width=w_px,
            output_height=h_px,
        )

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

    except ImportError:
        return resp(500, {"error": "cairosvg_not_installed"})
    except Exception as e:
        return resp(500, {"error": "conversion_failed", "detail": str(e)})
