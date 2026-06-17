#!/usr/bin/env python3
"""Scroll more and find more unliked posts to like."""
import json, asyncio, websockets, urllib.request

async def find_more_likes():
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
        
        # Scroll down further to find new posts
        for i in range(8):
            await send_eval(f"window.scrollBy(0, 1200); 's{i}'")
            await asyncio.sleep(2)
        
        # Scroll back to a good position
        await send_eval("window.scrollTo(0, 2000); 'pos'")
        await asyncio.sleep(1.5)
        
        # Find unliked buttons
        result = await send_eval("""
        (function() {
            const allBtns = Array.from(document.querySelectorAll('button'));
            const unliked = [];
            
            for (let i = 0; i < allBtns.length; i++) {
                const label = allBtns[i].getAttribute('aria-label') || '';
                if (label.includes('no reaction') || label.includes('Keine Reaktion')) {
                    const btn = allBtns[i];
                    let el = btn;
                    let postText = '';
                    
                    for (let j = 0; j < 30; j++) {
                        el = el.parentElement;
                        if (!el) break;
                        const text = el.innerText || '';
                        if (text.length > 300) {
                            postText = text;
                            break;
                        }
                    }
                    
                    const lines = postText.split('\\n').filter(l => l.trim());
                    
                    // Better author extraction
                    let author = 'Unknown';
                    let content = '';
                    let foundAuthor = false;
                    
                    for (const line of lines) {
                        const t = line.trim();
                        if (!t || t.length < 3) continue;
                        
                        // Skip common labels
                        if (/^(Feed post|Sponsored|Follow|Like|Comment|Repost|Send|All reactions|Select feed|Most relevant)/i.test(t)) continue;
                        if (/^\\d+[hm]$/.test(t)) continue;
                        if (/^\\d+ (reaction|comment|repost)/i.test(t)) continue;
                        if (t.length > 120) continue;
                        
                        if (!foundAuthor) {
                            // Check if this looks like a name (not a hashtag, not a URL)
                            if (!t.startsWith('#') && !t.startsWith('http') && !t.startsWith('@')) {
                                author = t;
                                foundAuthor = true;
                            }
                        } else if (!content) {
                            content = t;
                            break;
                        }
                    }
                    
                    // Skip self-posts
                    if (author.includes('Xuan Duc') || author.includes('Innovation Engineer')) continue;
                    if (author === 'Unknown') continue;
                    
                    unliked.push({
                        btnIndex: i,
                        author: author.substring(0, 60),
                        content: content.substring(0, 120),
                        preview: lines.slice(0, 5).join(' | ').substring(0, 200)
                    });
                    
                    if (unliked.length >= 10) break;
                }
            }
            
            return JSON.stringify(unliked);
        })()
        """)
        
        posts = json.loads(result)
        print(f"Found {len(posts)} unliked posts:")
        for p in posts:
            print(f"  [{p['btnIndex']}] {p['author']}: {p['content'][:80]}")
        
        # Like up to 2 more posts
        count = 0
        for p in posts:
            if count >= 2:
                break
            
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
            
            print(f"  Like {p['author']}: {like_result}")
            if like_result == 'clicked':
                liked_posts.append({
                    'author': p['author'],
                    'content': p['content']
                })
                count += 1
            await asyncio.sleep(2.5)
        
        print(f"\n=== NEW LIKES: {len(liked_posts)} ===")
        for p in liked_posts:
            print(f"  {p['author']}: {p['content'][:80]}")
    
    return liked_posts

result = asyncio.run(find_more_likes())
print("\n===JSON===")
print(json.dumps(result, indent=2))
