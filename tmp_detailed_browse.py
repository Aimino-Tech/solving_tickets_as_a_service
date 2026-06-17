#!/usr/bin/env python3
"""Get more details about feed posts and like better ones."""
import json, asyncio, websockets, urllib.request

async def detailed_browse():
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
        msg_id_counter = [0]
        
        async def send_eval(expression):
            msg_id_counter[0] += 1
            mid = msg_id_counter[0]
            msg = json.dumps({"id": mid, "method": "Runtime.evaluate", 
                "params": {"expression": expression}})
            await ws.send(msg)
            while True:
                resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=8))
                if resp.get('id') == mid:
                    return resp.get('result', {}).get('result', {}).get('value', '')
        
        # Scroll down more to find better posts
        for i in range(5):
            await send_eval(f"window.scrollBy(0, 800); 'scroll_{i}'")
            await asyncio.sleep(1.5)
        
        # Scroll back to a good position
        await send_eval("window.scrollTo(0, 800); 'pos'")
        await asyncio.sleep(1)
        
        # Get full page text to understand the feed
        text = await send_eval("document.body.innerText.substring(0, 5000)")
        print("=== FEED TEXT (first 3000 chars) ===")
        print(text[:3000])
        
        # Find unliked reaction buttons
        result = await send_eval("""
        (function() {
            const allBtns = Array.from(document.querySelectorAll('button'));
            const unliked = [];
            for (let i = 0; i < allBtns.length; i++) {
                const label = allBtns[i].getAttribute('aria-label') || '';
                if (label.includes('no reaction') || label.includes('Keine Reaktion')) {
                    unliked.push(i);
                }
            }
            return JSON.stringify({total: allBtns.length, unliked: unliked});
        })()
        """)
        data = json.loads(result)
        print(f"\nTotal buttons: {data['total']}, Unliked: {len(data['unliked'])}")
        print(f"Unliked indices: {data['unliked'][:15]}")

asyncio.run(detailed_browse())
