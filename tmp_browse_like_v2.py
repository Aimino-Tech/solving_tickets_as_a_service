#!/usr/bin/env python3
"""Browse LinkedIn feed and like posts - v2."""
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
        
        # Scroll down several times to load feed posts
        for i in range(3):
            await send_eval(f"window.scrollBy(0, 1200); 'scroll_{i}'")
            await asyncio.sleep(2)
        
        # Find feed posts - look for posts with reaction buttons that aren't our own
        result = await send_eval("""
        (function() {
            // Find all reaction buttons (unliked ones)
            const allBtns = Array.from(document.querySelectorAll('button'));
            const unlikedBtns = allBtns.filter(btn => {
                const label = btn.getAttribute('aria-label') || '';
                return label.includes('no reaction') || label.includes('Keine Reaktion');
            });
            
            // For each unliked button, walk up to find the post container
            // and extract author + text
            const posts = [];
            for (const btn of unlikedBtns) {
                // Walk up to find the post article/div
                let el = btn;
                let postText = '';
                let authorName = '';
                for (let j = 0; j < 20; j++) {
                    el = el.parentElement;
                    if (!el) break;
                    // LinkedIn posts are often in article or div with role
                    if (el.tagName === 'ARTICLE' || el.getAttribute('data-urn') || 
                        (el.className && el.className.includes('feed'))) {
                        postText = el.innerText || '';
                        break;
                    }
                }
                
                if (!postText) {
                    // Fallback: get text from a wider container
                    el = btn;
                    for (let j = 0; j < 25; j++) {
                        el = el.parentElement;
                        if (!el) break;
                    }
                    postText = el ? el.innerText.substring(0, 500) : '';
                }
                
                // Extract author - usually first meaningful line
                const lines = postText.split('\\n').filter(l => l.trim());
                authorName = lines[0] || 'Unknown';
                
                // Skip if it's our own profile
                if (authorName.includes('Xuan Duc Nguyen') || authorName.includes('Innovation Engineer')) {
                    continue;
                }
                
                // Get button index for clicking later
                const btnIdx = allBtns.indexOf(btn);
                posts.push({
                    btnIndex: btnIdx,
                    author: authorName.substring(0, 80),
                    preview: postText.substring(0, 200)
                });
                
                if (posts.length >= 5) break;
            }
            
            return JSON.stringify({count: posts.length, posts: posts});
        })()
        """)
        
        data = json.loads(result)
        print(f"Feed posts found: {data.get('count', 0)}")
        for p in data.get('posts', []):
            print(f"\n  Button index: {p['btnIndex']}")
            print(f"  Author: {p['author']}")
            print(f"  Preview: {p['preview'][:150]}")
        
        # Like the first 3 posts
        liked = []
        for p in data.get('posts', [])[:3]:
            btn_idx = p['btnIndex']
            like_result = await send_eval(f"""
            (function() {{
                const btn = document.querySelectorAll('button')[{btn_idx}];
                if (!btn) return 'no_btn';
                const label = btn.getAttribute('aria-label') || '';
                if (!label.includes('no reaction') && !label.includes('Keine Reaktion')) {{
                    return 'already_liked: ' + label;
                }}
                btn.click();
                return 'clicked: ' + label;
            }})()
            """)
            print(f"\n  Like result for {p['author'][:30]}: {like_result}")
            await asyncio.sleep(2)
            liked.append(p)
        
        # Return the liked posts info
        print("\n=== LIKED POSTS ===")
        for p in liked:
            print(f"Author: {p['author']}")
            print(f"Preview: {p['preview'][:120]}")
            print()

asyncio.run(browse_feed())
