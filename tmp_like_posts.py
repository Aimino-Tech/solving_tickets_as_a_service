#!/usr/bin/env python3
"""Like 2-3 posts on LinkedIn feed via CDP."""
import json, asyncio, websockets, urllib.request, re

async def like_posts():
    req = urllib.request.urlopen("http://localhost:9240/json/list", timeout=3)
    tabs = json.loads(req.read())
    page = None
    for t in tabs:
        if t.get('type') == 'page' and 'linkedin' in t.get('url', ''):
            page = t
            break
    if not page:
        print("No LinkedIn tab found")
        return []
    
    ws_url = page['webSocketDebuggerUrl']
    liked_posts = []
    
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
        
        # Scroll down to load more posts
        for i in range(4):
            await send_eval(f"window.scrollBy(0, 1000); 'scroll_{i}'")
            await asyncio.sleep(1.5)
        
        # Scroll back up to see posts
        await send_eval("window.scrollTo(0, 600); 'scroll_top'")
        await asyncio.sleep(1)
        
        # Find unliked reaction buttons and map them to posts
        result = await send_eval("""
        (function() {
            const allBtns = Array.from(document.querySelectorAll('button'));
            const unlikedBtns = [];
            
            for (let i = 0; i < allBtns.length; i++) {
                const btn = allBtns[i];
                const label = btn.getAttribute('aria-label') || '';
                if (label.includes('Reaction button state: no reaction') || 
                    label.includes('Status des Reaktionsbuttons: Keine Reaktion')) {
                    unlikedBtns.push({index: i, label: label});
                }
            }
            
            // For each unliked button, try to find the author by looking at nearby elements
            const results = [];
            for (const info of unlikedBtns) {
                const btn = allBtns[info.index];
                // Walk up to find the post container
                let el = btn;
                let postText = '';
                for (let j = 0; j < 30; j++) {
                    el = el.parentElement;
                    if (!el) break;
                    const text = el.innerText || '';
                    // Posts typically have "Feed post" or author name followed by content
                    if (text.length > 200) {
                        postText = text.substring(0, 400);
                        break;
                    }
                }
                
                // Extract author from the text
                const lines = postText.split('\\n').filter(l => l.trim());
                let author = 'Unknown';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.includes('Feed post') && !trimmed.includes('Sponsored') &&
                        !trimmed.includes('Follow') && !trimmed.includes('•') &&
                        trimmed.length > 2 && trimmed.length < 60 &&
                        !trimmed.includes('reaction') && !trimmed.includes('comment')) {
                        author = trimmed;
                        break;
                    }
                }
                
                // Get a short preview
                const preview = lines.slice(0, 3).join(' | ').substring(0, 150);
                
                results.push({
                    btnIndex: info.index,
                    author: author,
                    preview: preview
                });
                
                if (results.length >= 8) break;
            }
            
            return JSON.stringify(results);
        })()
        """)
        
        posts = json.loads(result)
        print(f"Found {len(posts)} unliked posts:")
        for p in posts:
            print(f"  [{p['btnIndex']}] {p['author']}: {p['preview'][:80]}")
        
        # Like the first 3 non-self posts
        count = 0
        for p in posts:
            if count >= 3:
                break
            if 'Xuan Duc' in p['author'] or 'Innovation Engineer' in p['author']:
                print(f"  Skipping self: {p['author']}")
                continue
            
            btn_idx = p['btnIndex']
            like_result = await send_eval(f"""
            (function() {{
                const btn = document.querySelectorAll('button')[{btn_idx}];
                if (!btn) return 'no_btn';
                const label = btn.getAttribute('aria-label') || '';
                if (!label.includes('no reaction') && !label.includes('Keine Reaktion')) {{
                    return 'already_liked: ' + label.substring(0, 40);
                }}
                btn.click();
                return 'clicked';
            }})()
            """)
            print(f"\n  Liked: {p['author']} ({like_result})")
            liked_posts.append({
                'author': p['author'],
                'preview': p['preview']
            })
            count += 1
            await asyncio.sleep(2)
        
        print(f"\n=== SUMMARY: Liked {len(liked_posts)} posts ===")
        for p in liked_posts:
            print(f"  {p['author']}: {p['preview'][:100]}")
    
    return liked_posts

result = asyncio.run(like_posts())
# Output as JSON for easy parsing
print("\n===JSON_OUTPUT===")
print(json.dumps(result))
