#!/usr/bin/env python3
"""Check what's on the LinkedIn feed page via CDP."""
import json, asyncio, websockets, urllib.request

async def check_feed():
    req = urllib.request.urlopen("http://localhost:9240/json/list", timeout=3)
    tabs = json.loads(req.read())
    page = None
    for t in tabs:
        if t.get('type') == 'page' and 'linkedin' in t.get('url', ''):
            page = t
            break
    if not page:
        print("No LinkedIn tab found")
        return
    
    ws_url = page['webSocketDebuggerUrl']
    
    async with websockets.connect(ws_url, ping_interval=20) as ws:
        msg = json.dumps({"id": 1, "method": "Runtime.evaluate", 
            "params": {"expression": "document.body.innerText.substring(0, 3000)"}})
        await ws.send(msg)
        while True:
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=8))
            if resp.get('id') == 1:
                text = resp.get('result', {}).get('result', {}).get('value', '')
                print(text[:3000])
                break

asyncio.run(check_feed())
