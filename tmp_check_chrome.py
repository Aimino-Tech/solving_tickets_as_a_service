#!/usr/bin/env python3
"""Check running Chrome instances."""
import urllib.request, json

for port in range(9221, 9246):
    try:
        req = urllib.request.urlopen(f"http://localhost:{port}/json/version", timeout=2)
        version = json.loads(req.read())
        browser = version.get('Browser', '')
        if browser:
            print(f"Port {port}: {browser}")
            try:
                req2 = urllib.request.urlopen(f"http://localhost:{port}/json/list", timeout=2)
                tabs = json.loads(req2.read())
                for t in tabs:
                    if t.get('type') == 'page':
                        print(f"  {t['id'][:8]} | {t.get('url','?')[:80]} | {t.get('title','?')[:50]}")
            except:
                pass
    except:
        pass
