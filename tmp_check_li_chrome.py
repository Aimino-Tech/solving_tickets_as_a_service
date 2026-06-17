#!/usr/bin/env python3
"""Check if Chrome on port 9240 is ready."""
import urllib.request, json, time

time.sleep(4)
try:
    req = urllib.request.urlopen('http://localhost:9240/json/version', timeout=3)
    version = json.loads(req.read())
    print(f'Chrome ready: {version.get("Browser","")}')
    req2 = urllib.request.urlopen('http://localhost:9240/json/list', timeout=3)
    tabs = json.loads(req2.read())
    for t in tabs:
        if t.get('type') == 'page':
            print(f'  {t["id"][:8]} | {t.get("url","?")[:80]}')
except Exception as e:
    print(f'Error: {e}')
