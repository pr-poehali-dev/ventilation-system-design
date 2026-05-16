"""
Скачивает woff2-файлы шрифтов IBM Plex с fonts.gstatic.com и сохраняет в S3.
Вызывается один раз для подготовки локальных шрифтов.
"""
import os
import json
import urllib.request
import boto3

FONTS = [
    # IBM Plex Mono 400
    ("ibm-plex-mono-400-cyrillic-ext.woff2", "https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1iIq131nj-otFQ.woff2"),
    ("ibm-plex-mono-400-cyrillic.woff2",     "https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1isq131nj-otFQ.woff2"),
    ("ibm-plex-mono-400-latin-ext.woff2",    "https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1iEq131nj-otFQ.woff2"),
    ("ibm-plex-mono-400-latin.woff2",        "https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q131nj-o.woff2"),
    # IBM Plex Mono 500
    ("ibm-plex-mono-500-cyrillic-ext.woff2", "https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwl1FgsAXHNlYzg.woff2"),
    ("ibm-plex-mono-500-cyrillic.woff2",     "https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlRFgsAXHNlYzg.woff2"),
    ("ibm-plex-mono-500-latin-ext.woff2",    "https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwl5FgsAXHNlYzg.woff2"),
    ("ibm-plex-mono-500-latin.woff2",        "https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgsAXHNk.woff2"),
    # IBM Plex Sans 300
    ("ibm-plex-sans-300-cyrillic-ext.woff2", "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxTKYbSB4ZhRNU.woff2"),
    ("ibm-plex-sans-300-cyrillic.woff2",     "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxaKYbSB4ZhRNU.woff2"),
    ("ibm-plex-sans-300-latin-ext.woff2",    "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxQKYbSB4ZhRNU.woff2"),
    ("ibm-plex-sans-300-latin.woff2",        "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxWKYbSB4Zh.woff2"),
    # IBM Plex Sans 400
    ("ibm-plex-sans-400-cyrillic-ext.woff2", "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxTKYbSB4ZhRNU.woff2"),
    ("ibm-plex-sans-400-cyrillic.woff2",     "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxaKYbSB4ZhRNU.woff2"),
    ("ibm-plex-sans-400-latin-ext.woff2",    "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxQKYbSB4ZhRNU.woff2"),
    ("ibm-plex-sans-400-latin.woff2",        "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxWKYbSB4Zh.woff2"),
    # IBM Plex Sans 500
    ("ibm-plex-sans-500-cyrillic-ext.woff2", "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD2FlDCqg4tIOm6_DeLVQ.woff2"),
    ("ibm-plex-sans-500-cyrillic.woff2",     "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD2FlDA6g4tIOm6_DeLVQ.woff2"),
    ("ibm-plex-sans-500-latin-ext.woff2",    "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD2FlDCag4tIOm6_DeLVQ.woff2"),
    ("ibm-plex-sans-500-latin.woff2",        "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD2FlDCKg4tIOm6_DeLVQ.woff2"),
    # IBM Plex Sans 600
    ("ibm-plex-sans-600-cyrillic-ext.woff2", "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSDNF5DCqg4tIOm6_DeLVQ.woff2"),
    ("ibm-plex-sans-600-cyrillic.woff2",     "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSDNF5DA6g4tIOm6_DeLVQ.woff2"),
    ("ibm-plex-sans-600-latin-ext.woff2",    "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSDNF5DCag4tIOm6_DeLVQ.woff2"),
    ("ibm-plex-sans-600-latin.woff2",        "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSDNF5DCKg4tIOm6_DeLVQ.woff2"),
]

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'}, 'body': ''}

    s3 = boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )

    results = []
    headers_req = {'User-Agent': 'Mozilla/5.0'}

    for filename, url in FONTS:
        try:
            req = urllib.request.Request(url, headers=headers_req)
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            key = f"fonts/{filename}"
            s3.put_object(Bucket='files', Key=key, Body=data, ContentType='font/woff2')
            results.append({"file": filename, "ok": True, "size": len(data)})
        except Exception as e:
            results.append({"file": filename, "ok": False, "error": str(e)})

    access_key = os.environ['AWS_ACCESS_KEY_ID']
    cdn_base = f"https://cdn.poehali.dev/projects/{access_key}/bucket/fonts"

    return {
        'statusCode': 200,
        'headers': {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
        'body': json.dumps({
            "downloaded": len([r for r in results if r["ok"]]),
            "failed": len([r for r in results if not r["ok"]]),
            "cdn_base": cdn_base,
            "results": results,
        })
    }