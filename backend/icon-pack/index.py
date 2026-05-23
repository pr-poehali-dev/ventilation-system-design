import os
import io
import json
import boto3
import cairosvg
from PIL import Image


def handler(event, context):
    """Генерирует PNG-набор и .ico-файл из app-icon.svg, заливает в S3 и возвращает CDN-ссылки."""
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

    svg_source = '''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="circleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3FA9F5"/>
      <stop offset="100%" stop-color="#0E63B0"/>
    </linearGradient>
    <linearGradient id="waveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#4DB8F5"/>
      <stop offset="100%" stop-color="#0F5BAF"/>
    </linearGradient>
    <linearGradient id="dropGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#8AD8F8"/>
      <stop offset="100%" stop-color="#1FA0E8"/>
    </linearGradient>
    <clipPath id="circleClip">
      <circle cx="256" cy="256" r="232"/>
    </clipPath>
  </defs>
  <circle cx="256" cy="256" r="232" fill="url(#circleGrad)"/>
  <g clip-path="url(#circleClip)">
    <path d="M70 250 C 130 170, 200 165, 245 230 C 260 250, 270 250, 285 235 L 285 290 L 70 290 Z" fill="#2D8FD6" opacity="0.85"/>
    <path d="M40 360 C 110 310, 180 410, 256 360 C 332 310, 402 410, 472 360 L 472 520 L 40 520 Z" fill="url(#waveGrad)"/>
    <path d="M40 330 C 110 285, 180 380, 256 330 C 332 285, 402 380, 472 330" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round"/>
    <path d="M325 130 C 325 130, 280 200, 280 240 C 280 270, 305 290, 325 290 C 345 290, 370 270, 370 240 C 370 200, 325 130, 325 130 Z" fill="url(#dropGrad)"/>
    <ellipse cx="312" cy="235" rx="7" ry="18" fill="#FFFFFF" opacity="0.55"/>
  </g>
  <circle cx="256" cy="256" r="232" fill="none" stroke="#0A4A8C" stroke-width="4" opacity="0.35"/>
</svg>'''

    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY']
    )

    aws_key = os.environ['AWS_ACCESS_KEY_ID']
    cdn_base = f"https://cdn.poehali.dev/projects/{aws_key}/bucket"
    results = {}

    sizes = [16, 32, 48, 64, 128, 256, 512]
    pil_images = []

    for size in sizes:
        png_bytes = cairosvg.svg2png(
            bytestring=svg_source.encode('utf-8'),
            output_width=size,
            output_height=size
        )
        key = f"icons/app-icon-{size}.png"
        s3.put_object(
            Bucket='files',
            Key=key,
            Body=png_bytes,
            ContentType='image/png'
        )
        results[f"png_{size}"] = f"{cdn_base}/{key}"

        img = Image.open(io.BytesIO(png_bytes)).convert('RGBA')
        if size in (16, 32, 48, 64, 128, 256):
            pil_images.append(img)

    ico_buf = io.BytesIO()
    pil_images[0].save(
        ico_buf,
        format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        append_images=pil_images[1:]
    )
    ico_buf.seek(0)
    s3.put_object(
        Bucket='files',
        Key='icons/app-icon.ico',
        Body=ico_buf.getvalue(),
        ContentType='image/x-icon'
    )
    results['ico'] = f"{cdn_base}/icons/app-icon.ico"

    s3.put_object(
        Bucket='files',
        Key='icons/app-icon.svg',
        Body=svg_source.encode('utf-8'),
        ContentType='image/svg+xml'
    )
    results['svg'] = f"{cdn_base}/icons/app-icon.svg"

    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'isBase64Encoded': False,
        'body': json.dumps({'ok': True, 'files': results}, ensure_ascii=False)
    }
