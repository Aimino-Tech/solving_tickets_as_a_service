#!/usr/bin/env python3
"""Check Twitter login status with detailed indicators."""
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

# Check login indicators
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var title = document.title;
        var url = window.location.href;
        var hasCompose = !!document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
        var hasHome = !!document.querySelector('[data-testid="primaryColumn"]');
        var hasLogin = !!document.querySelector('[data-testid="loginButton"]') || 
                       document.body.innerText.includes("See what's happening");
        var bodyText = document.body.innerText.substring(0, 500);
        return JSON.stringify({
            title: title,
            url: url,
            hasCompose: hasCompose,
            hasHome: hasHome,
            hasLogin: hasLogin,
            bodySnippet: bodyText.substring(0, 200)
        });
    })()
''', 'returnByValue': True})

if result:
    data = json.loads(result.get('result', {}).get('result', {}).get('value', '{}'))
    print(f"\nLogin status:", flush=True)
    print(f"  Title: {data.get('title')}", flush=True)
    print(f"  URL: {data.get('url')}", flush=True)
    print(f"  Has compose button: {data.get('hasCompose')}", flush=True)
    print(f"  Has home column: {data.get('hasHome')}", flush=True)
    print(f"  Has login prompt: {data.get('hasLogin')}", flush=True)
    print(f"  Body snippet: {data.get('bodySnippet', '')[:100]}", flush=True)
    
    if data.get('hasCompose') or data.get('hasHome'):
        print("\n✅ LOGGED IN!", flush=True)
    elif data.get('hasLogin'):
        print("\n❌ NOT LOGGED IN", flush=True)
    else:
        print("\n❓ UNCERTAIN", flush=True)

ws.close()
