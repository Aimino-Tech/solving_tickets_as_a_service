#!/usr/bin/env python3
"""Find one more post to like."""
import json, asyncio, websockets, urllib.request

async def find_one_more():
    req = urllib.request.urlopen("http://localhost:9240/json/list", timeout=3)
    tabs = json.loads(req.read())
    page = None
    for t in tabs:
        if t.get('type') == 'page' and 'linkedin' in t.get('url', ''):
            page = t
            break
    if not page:
        print("No LinkedIn tab found")
        return None
    
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
        
        # Scroll down further
        for i in range(10):
            await send_eval(f"window.scrollBy(0, 1500); 's{i}'")
            await asyncio.sleep(2)
        
        # Find unliked
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
                    let author = 'Unknown';
                    let content = '';
                    let foundAuthor = false;
                    
                    for (const line of lines) {
                        const t = line.trim();
                        if (!t || t.length < 3 || t.length > 120) continue;
                        if (/^(Feed post|Sponsored|Follow|Like|Comment|Repost|Send|All reactions|Select feed|Most relevant)/i.test(t)) continue;
                        if (/^\\d+[hm]$/.test(t)) continue;
                        if (/^\\d+ (reaction|comment|repost)/i.test(t)) continue;
                        
                        if (!foundAuthor) {
                            if (!t.startsWith('#') && !t.startsWith('http') && !t.startsWith('@')) {
                                author = t;
                                foundAuthor = true;
                            }
                        } else if (!content) {
                            content = t;
                            break;
                        }
                    }
                    
                    if (author.includes('Xuan Duc') || author.includes('Innovation Engineer')) continue;
                    if (author === 'Unknown') continue;
                    
                    unliked.push({btnIndex: i, author: author.substring(0, 60), content: content.substring(0, 120)});
                    if (unliked.length >= 5) break;
                }
            }
            
            return JSON.stringify(unliked);
        })()
        """)
        
        posts = json.loads(result)
        print(f"Found {len(posts)} unliked posts:")
        for p in posts:
            print(f"  [{p['btnIndex']}] {p['author']}: {p['content'][:80]}")
        
        # Like the first one
        if posts:
            p = posts[0]
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
            print(f"\n  Like {p['author']}: {like_result}")
            if like_result == 'clicked':
                print(f"\n=== LIKED: {p['author']}: {p['content'][:80]} ===")
                return p
        else:
            print("No unliked posts found")
        
    return None

result = asyncio.run(find_one_more())
print("\n===JSON===")
print(json.dumps(result, indent=2) if result else "null")
