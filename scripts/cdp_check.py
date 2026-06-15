#!/usr/bin/env python3
"""Get Chrome CDP tabs for Twitter."""
import json
import urllib.request

try:
    req = urllib.request.Request('http://127.0.0.1:9235/json/list')
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read())
    
    print(f"Total tabs: {len(data)}")
    for tab in data[:5]:
        tab_id = tab.get('id', '')[:12]
        url = tab.get('url', '')[:80]
        title = tab.get('title', '')[:50]
        print(f"  {tab_id} | {url}")
        print(f"    Title: {title}")
except Exception as e:
    print(f"Error: {e}")
