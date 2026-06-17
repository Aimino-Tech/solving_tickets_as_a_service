#!/usr/bin/env python3
"""Browse LinkedIn feed and extract posts for liking."""
import json, asyncio, websockets, urllib.request

async def browse_feed():
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
        # First, detect language by checking a reaction button's aria-label
        msg_id = 1
        msg = json.dumps({"id": msg_id, "method": "Runtime.evaluate", 
            "params": {"expression": """
            (function() {
                // Find reaction buttons and check their aria-labels
                const allBtns = document.querySelectorAll('button');
                const reactionInfo = [];
                for (const btn of allBtns) {
                    const label = btn.getAttribute('aria-label') || '';
                    if (label.includes('Reaction button') || label.includes('Reaktionsbutton') || 
                        label.includes('reaction') || label.includes('Reaktion')) {
                        reactionInfo.push(label.substring(0, 80));
                        if (reactionInfo.length >= 3) break;
                    }
                }
                return JSON.stringify({buttons: reactionInfo, total: allBtns.length});
            })()
            """}})
        await ws.send(msg)
        while True:
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            if resp.get('id') == msg_id:
                result = resp.get('result', {}).get('result', {}).get('value', '')
                data = json.loads(result)
                print(f"Reaction buttons found: {len(data.get('buttons', []))}")
                for b in data.get('buttons', []):
                    print(f"  Label: {b}")
                is_german = any('Reaktionsbutton' in b or 'Keine Reaktion' in b for b in data.get('buttons', []))
                print(f"Language: {'German' if is_german else 'English'}")
                break
        
        # Scroll down to load more content
        msg_id = 2
        msg = json.dumps({"id": msg_id, "method": "Runtime.evaluate", 
            "params": {"expression": "window.scrollBy(0, 800); 'scrolled'"}})
        await ws.send(msg)
        while True:
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            if resp.get('id') == msg_id:
                break
        
        await asyncio.sleep(2)
        
        # Find all unliked posts with their info
        msg_id = 3
        unliked_pattern = "'Keine Reaktion'" if is_german else "'no reaction'"
        msg = json.dumps({"id": msg_id, "method": "Runtime.evaluate", 
            "params": {"expression": f"""
            (function() {{
                const allBtns = document.querySelectorAll('button');
                const unliked = [];
                allBtns.forEach((btn, i) => {{
                    const label = btn.getAttribute('aria-label') || '';
                    if (label.includes('no reaction') || label.includes('Keine Reaktion')) {{
                        // Try to find nearby post text
                        let container = btn;
                        for (let j = 0; j < 15; j++) {{
                            container = container.parentElement;
                            if (!container) break;
                        }}
                        const text = container ? container.innerText.substring(0, 200) : '';
                        unliked.push({{index: i, label: label.substring(0, 60), text: text}});
                    }}
                }});
                return JSON.stringify({{count: unliked.length, posts: unliked.slice(0, 10)}});
            }})()
            """}})
        await ws.send(msg)
        while True:
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            if resp.get('id') == msg_id:
                result = resp.get('result', {}).get('result', {}).get('value', '')
                data = json.loads(result)
                print(f"\nUnliked posts found: {data.get('count', 0)}")
                for p in data.get('posts', []):
                    # Extract first line as likely author
                    lines = [l.strip() for l in p.get('text', '').split('\n') if l.strip()]
                    author = lines[0] if lines else 'Unknown'
                    print(f"  Index {p['index']}: Author={author[:50]}")
                    print(f"    Preview: {p.get('text', '')[:100]}")
                break

asyncio.run(browse_feed())
