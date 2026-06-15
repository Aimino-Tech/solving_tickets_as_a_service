#!/usr/bin/env python3
"""Check Twitter login with longer wait."""
import json
import time
import websocket
import urllib.request

# Get tabs
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

ws_url = tabs[0]['webSocketDebuggerUrl']
print(f"Connecting to: {ws_url[:60]}...", flush=True)

ws = websocket.create_connection(ws_url, timeout=15,
    origin="http://127.0.0.1:9235",
    header=["Origin: http://127.0.0.1:9235"])
print("Connected!", flush=True)

def cdp(method, params=None):
    msg_id = int(time.time() * 1000) % 100000
    msg = {'id': msg_id, 'method': method}
    if params:
        msg['params'] = params
    ws.send(json.dumps(msg))
    start = time.time()
    while time.time() - start < 10:
        try:
            ws.settimeout(1)
            r = json.loads(ws.recv())
            if r.get('id') == msg_id:
                return r
        except:
            pass
    return None

# Navigate to Twitter home
print("Navigating to Twitter home...", flush=True)
cdp('Page.navigate', {'url': 'https://x.com/home'})

# Wait longer
print("Waiting 15 seconds for page to load...", flush=True)
time.sleep(15)

# Check page
result = cdp('Runtime.evaluate', {'expression': 'document.title'})
if result:
    title = result.get('result', {}).get('result', {}).get('value', '')
    print(f"Title: {title}", flush=True)
    
    if 'Home' in title:
        print("✅ Still logged in!", flush=True)
    elif 'login' in title.lower() or 'happening' in title.lower():
        print("❌ Not logged in - session expired", flush=True)
    else:
        print(f"Unknown state: {title}", flush=True)
else:
    print("Failed to get title", flush=True)

# Check URL
result = cdp('Runtime.evaluate', {'expression': 'window.location.href'})
if result:
    url = result.get('result', {}).get('result', {}).get('value', '')
    print(f"URL: {url}", flush=True)

ws.close()
