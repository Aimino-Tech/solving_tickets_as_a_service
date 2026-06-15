#!/usr/bin/env python3
"""Try to navigate to Twitter and extract tweets from search without login."""
import json
import urllib.request
import time
import websocket

# Get tabs
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

ws_url = tabs[0]['webSocketDebuggerUrl']
print(f"Connecting to: {ws_url}")

ws = websocket.create_connection(ws_url, timeout=30, 
    origin="http://127.0.0.1:9235",
    header=["Origin: http://127.0.0.1:9235"])

def send_cmd(method, params=None, cmd_id=1):
    msg = {"id": cmd_id, "method": method}
    if params:
        msg["params"] = params
    ws.send(json.dumps(msg))
    while True:
        result = json.loads(ws.recv())
        if result.get("id") == cmd_id:
            return result

# Try to accept cookies first
print("Accepting cookies...")
result = send_cmd("Runtime.evaluate", {
    "expression": """
        (function() {
            var btn = document.querySelector('button[aria-label="Accept all cookies"]');
            if (btn) { btn.click(); return 'clicked'; }
            return 'no cookie button found';
        })()
    """,
    "returnByValue": True
}, 1)
print(f"Cookie result: {result.get('result', {}).get('result', {}).get('value', '')}")

time.sleep(2)

# Now try to navigate to search - even without login, some results might show
print("\nNavigating to search...")
result = send_cmd("Page.navigate", {
    "url": "https://x.com/search?q=MCP+protocol&src=typed_query&f=live"
}, 2)

time.sleep(8)

# Check if we got redirected to login or if we can see tweets
result = send_cmd("Runtime.evaluate", {
    "expression": """
        (function() {
            var url = window.location.href;
            var isLogin = url.includes('/login') || url.includes('/flow/login');
            var hasTweets = document.querySelectorAll('article[data-testid="tweet"]').length;
            var bodyText = document.body ? document.body.innerText.substring(0, 2000) : '';
            return JSON.stringify({
                url: url,
                isLogin: isLogin,
                hasTweets: hasTweets,
                bodyText: bodyText
            });
        })()
    """,
    "returnByValue": True
}, 3)

response = result.get('result', {}).get('result', {}).get('value', '')
print(f"\nResponse: {response}")

ws.close()
