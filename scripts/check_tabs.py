#!/usr/bin/env python3
"""Check if port 9235 Chrome is still logged in."""
import json
import time
import urllib.request

# Check tabs
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

print(f"Tabs: {len(tabs)}")
for tab in tabs:
    print(f"  {tab.get('url', '')[:80]}")
    print(f"  Title: {tab.get('title', '')[:50]}")
