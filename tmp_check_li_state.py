#!/usr/bin/env python3
"""Check LinkedIn page state via CDP."""
import json, asyncio, websockets, urllib.request

async def check_page():
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
    print(f"Connecting to: {ws_url[:60]}...")
    
    async with websockets.connect(ws_url, ping_interval=20) as ws:
        # Check page title and URL
        msg = json.dumps({"id": 1, "method": "Runtime.evaluate", 
            "params": {"expression": "JSON.stringify({title: document.title, url: location.href, bodyLen: document.body.innerText.length, hasLogin: document.body.innerText.includes('Sign in'), hasFeed: document.body.innerText.includes('Feed')})"}})
        await ws.send(msg)
        while True:
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            if resp.get('id') == 1:
                result = resp.get('result', {}).get('result', {}).get('value', '')
                data = json.loads(result)
                print(f"Title: {data.get('title','?')}")
                print(f"URL: {data.get('url','?')}")
                print(f"Body length: {data.get('bodyLen','?')}")
                print(f"Has 'Sign in': {data.get('hasLogin','?')}")
                print(f"Has 'Feed': {data.get('hasFeed','?')}")
                break

asyncio.run(check_page())
