#!/usr/bin/env python3
"""Like posts and get their details."""
import json, asyncio, websockets, urllib.request

async def like_and_log():
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
        for i in range(6):
            await send_eval(f"window.scrollBy(0, 1000); 's{i}'")
            await asyncio.sleep(1.5)
        
        # Scroll back up a bit
        await send_eval("window.scrollTo(0, 1200); 'pos'")
        await asyncio.sleep(1)
        
        # Find unliked reaction buttons with better post extraction
        result = await send_eval("""
        (function() {
            const allBtns = Array.from(document.querySelectorAll('button'));
            const unliked = [];
            
            for (let i = 0; i < allBtns.length; i++) {
                const label = allBtns[i].getAttribute('aria-label') || '';
                if (label.includes('no reaction') || label.includes('Keine Reaktion')) {
                    // Find the post by walking up to find text content
                    const btn = allBtns[i];
                    let el = btn;
                    let postLines = [];
                    
                    // Walk up to find a container with substantial text
                    for (let j = 0; j < 30; j++) {
                        el = el.parentElement;
                        if (!el) break;
                        const text = el.innerText || '';
                        if (text.length > 300) {
                            postLines = text.split('\\n').filter(l => l.trim());
                            break;
                        }
                    }
                    
                    // Find author - first substantial line that's not a label
                    let author = 'Unknown';
                    let contentPreview = '';
                    let skipWords = ['Feed post', 'Sponsored', 'Follow', 'Like', 'Comment', 
                                     'Repost', 'Send', 'All reactions', 'reactions', 'comments',
                                     '0 ', '1 ', '2 ', '3 ', '4 ', '5 ', '6 ', '7 ', '8 ', '9 ',
                                     'Select feed view', 'Most relevant'];
                    
                    for (let k = 0; k < postLines.length; k++) {
                        const line = postLines[k].trim();
                        if (!line || line.length < 3) continue;
                        if (line.length > 100) continue;
                        
                        let isSkip = false;
                        for (const sw of skipWords) {
                            if (line.startsWith(sw) || line === sw) {
                                isSkip = true;
                                break;
                            }
                        }
                        if (isSkip) continue;
                        if (line.match(/^\\d+[hm]$/)) continue; // timestamp
                        if (line.match(/^\\d+ (reaction|comment|repost)/)) continue;
                        
                        if (author === 'Unknown') {
                            author = line;
                        } else if (!contentPreview) {
                            contentPreview = line;
                            break;
                        }
                    }
                    
                    // Get button rect for distance check
                    const rect = btn.getBoundingClientRect();
                    
                    unliked.push({
                        btnIndex: i,
                        author: author.substring(0, 60),
                        content: contentPreview.substring(0, 120),
                        btnY: Math.round(rect.top),
                        allLines: postLines.slice(0, 8).join(' | ').substring(0, 200)
                    });
                }
            }
            
            return JSON.stringify(unliked);
        })()
        """)
        
        posts = json.loads(result)
        print(f"Found {len(posts)} unliked posts:")
        for p in posts:
            print(f"  [{p['btnIndex']}] Author: {p['author']}")
            print(f"      Content: {p['content'][:80]}")
            print(f"      Lines: {p['allLines'][:120]}")
            print()
        
        # Like first 3 non-self posts
        count = 0
        for p in posts:
            if count >= 3:
                break
            if 'Xuan Duc' in p['author'] or 'Innovation Engineer' in p['author'] or 'Aimino' in p['author']:
                continue
            if p['author'] == 'Unknown':
                continue
            
            btn_idx = p['btnIndex']
            like_result = await send_eval(f"""
            (function() {{
                const btn = document.querySelectorAll('button')[{btn_idx}];
                if (!btn) return 'no_btn';
                const label = btn.getAttribute('aria-label') || '';
                if (!label.includes('no reaction') && !label.includes('Keine Reaktion')) {{
                    return 'already_liked';
                }}
                btn.click();
                return 'clicked';
            }})()
            """)
            
            if like_result == 'clicked':
                print(f"  ✓ Liked: {p['author']} - {p['content'][:60]}")
                liked_posts.append({
                    'author': p['author'],
                    'content': p['content']
                })
                count += 1
            else:
                print(f"  ✗ Failed for {p['author']}: {like_result}")
            
            await asyncio.sleep(2)
        
        print(f"\n=== RESULT: Liked {len(liked_posts)} posts ===")
    
    return liked_posts

result = asyncio.run(like_and_log())
print("\n===JSON===")
print(json.dumps(result, indent=2))
