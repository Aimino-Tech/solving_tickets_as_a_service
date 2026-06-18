#!/usr/bin/env python3
"""Check Twitter login status on Chrome port 9235."""
import json, urllib.request, websocket, time, sys

port = sys.argv[1] if len(sys.argv) > 1 else "9235"

req = urllib.request.Request(f'http://127.0.0.1:{port}/json/list')
tabs = json.loads(urllib.request.urlopen(req, timeout=5).read())

# Find x.com tab
for t in tabs:
    url = t.get('url', '')
    if 'x.com' in url:
        ws_url = t['webSocketDebuggerUrl']
        ws = websocket.create_connection(ws_url, timeout=10)
        
        # Check login status
        evalu = 'document.querySelector(\'[data-testid="SideNav_NewTweet_Button"]\') ? "LOGGED_IN" : "NOT_LOGGED_IN"'
        msg = json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': evalu}})
        ws.send(msg)
        time.sleep(2)
        ws.settimeout(5)
        try:
            while True:
                resp = json.loads(ws.recv())
                if resp.get('id') == 1:
                    val = resp.get('result', {}).get('result', {}).get('value', 'unknown')
                    print(f'Tab: {t.get("title","")[:60]}')
                    print(f'Status: {val}')
                    ws.close()
                    sys.exit(0)
        except:
            pass
        
        # Also check document title
        ws2 = websocket.create_connection(ws_url, timeout=10)
        msg2 = json.dumps({'id': 2, 'method': 'Runtime.evaluate', 'params': {'expression': 'document.title'}})
        ws2.send(msg2)
        time.sleep(1)
        try:
            while True:
                resp = json.loads(ws2.recv())
                if resp.get('id') == 2:
                    print(f'Title: {resp.get("result",{}).get("result",{}).get("value","unknown")}')
                    ws2.close()
                    break
        except:
            pass
        
        ws.close()
        break
else:
    print(f'No x.com tab found on port {port}')
    print(f'Tabs: {[t.get("title","")[:40] for t in tabs]}')
