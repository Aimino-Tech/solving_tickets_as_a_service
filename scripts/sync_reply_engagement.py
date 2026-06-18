#!/usr/bin/env python3
"""Improved sync reply engagement - proper tab management."""
import json, sqlite3, time, urllib.request, websocket, sys, os, re

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'marketing.db')
CDP_PORT = 9235
HANDLE = 'Hello374565'

def get_tabs():
    req = urllib.request.Request(f'http://127.0.0.1:{CDP_PORT}/json/list')
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())

def create_tab(url):
    """Create a NEW tab and return its info."""
    req = urllib.request.Request(
        f'http://127.0.0.1:{CDP_PORT}/json/new?{urllib.parse.quote(url, safe="")}',
        method='PUT')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            tab = json.loads(r.read())
        return tab
    except:
        # Fallback: navigate existing blank tab
        return None

def close_tab(tab_id):
    try:
        req = urllib.request.Request(
            f'http://127.0.0.1:{CDP_PORT}/json/close/{tab_id}',
            method='POST')
        urllib.request.urlopen(req, timeout=5)
    except:
        pass

def connect_tab(tab_id=None):
    """Connect to a tab's websocket. If tab_id, find it; else use first page tab."""
    tabs = get_tabs()
    for t in tabs:
        if tab_id and t['id'] == tab_id:
            return websocket.create_connection(
                t['webSocketDebuggerUrl'], timeout=15,
                origin=f'http://127.0.0.1:{CDP_PORT}',
                header=[f'Origin: http://127.0.0.1:{CDP_PORT}']), t['id']
        if not tab_id and t['type'] == 'page':
            return websocket.create_connection(
                t['webSocketDebuggerUrl'], timeout=15,
                origin=f'http://127.0.0.1:{CDP_PORT}',
                header=[f'Origin: http://127.0.0.1:{CDP_PORT}']), t['id']
    return None, None

def eval_js(ws, expr, timeout=15):
    msg_id = int(time.time() * 1000000) % 1000000
    msg = json.dumps({'id': msg_id, 'method': 'Runtime.evaluate',
        'params': {'expression': expr, 'awaitPromise': True}})
    ws.send(msg)
    start = time.time()
    while time.time() - start < timeout:
        try:
            ws.settimeout(1)
            resp = json.loads(ws.recv())
            if resp.get('id') == msg_id:
                result = resp.get('result', {})
                if 'exceptionDetails' in result:
                    print(f'  JS Error: {result["exceptionDetails"].get("text","")}')
                    return None
                return result.get('result', {}).get('value')
        except:
            pass
    return None

def wait_page_load(ws, timeout=15):
    for _ in range(timeout):
        ready = eval_js(ws, 'document.readyState')
        if ready == 'complete':
            return True
        time.sleep(1)
    return False

def navigate(ws, url):
    msg_id = int(time.time() * 1000000) % 1000000
    msg = json.dumps({'id': msg_id, 'method': 'Page.navigate', 'params': {'url': url}})
    ws.send(msg)
    # Wait for load
    time.sleep(3)
    wait_page_load(ws)

def main():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    
    campaigns = db.execute('''
        SELECT c.id, c.content_id, c.target_url, c.content, c.topic, c.target_author, c.reply_url
        FROM campaigns c
        LEFT JOIN reply_engagement r ON c.id = r.campaign_id
        WHERE c.platform = 'twitter' AND c.status = 'posted'
        AND r.id IS NULL
        ORDER BY c.id
    ''').fetchall()
    
    print(f'Campaigns to sync: {len(campaigns)}')
    if not campaigns:
        print('Nothing to sync!')
        db.close()
        return
    
    # Create a fresh tab
    print('Creating new tab...')
    tab = create_tab('https://x.com/Hello374565/with_replies')
    time.sleep(5)
    
    if not tab:
        print('Failed to create tab, using existing blank tab')
        ws, tab_id = connect_tab()
    else:
        ws, tab_id = connect_tab(tab['id'])
    
    if not ws:
        print('Failed to connect!')
        db.close()
        return
    
    print(f'Connected to tab')
    
    # Wait for page to fully load
    print('Waiting for page load...')
    time.sleep(5)
    
    # Check login status
    check = eval_js(ws, '''(function() {
        return JSON.stringify({
            title: document.title,
            url: window.location.href,
            loggedIn: !!document.querySelector('[data-testid=\"SideNav_NewTweet_Button\"]'),
            tweetCount: document.querySelectorAll('article[data-testid=\"tweet\"]').length
        });
    })()''')
    print(f'Status: {check}')
    
    if not check:
        print('Page not loaded properly, trying again...')
        time.sleep(5)
        check = eval_js(ws, 'JSON.stringify({title: document.title, url: location.href})')
        print(f'Status: {check}')
    
    # Scroll to load ALL replies
    print('Scrolling...')
    for i in range(20):
        eval_js(ws, 'window.scrollBy(0, 2000)')
        time.sleep(0.5)
        if (i+1) % 5 == 0:
            count = eval_js(ws, 'document.querySelectorAll("article[data-testid=\\"tweet\\"]").length')
            print(f'  Scroll {i+1}x - tweets: {count}')
    
    # Extract ALL tweets with metrics
    print('Extracting tweets...')
    result = eval_js(ws, '''(function() {
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        const tweets = [];
        articles.forEach(a => {
            const textEl = a.querySelector('[data-testid="tweetText"]');
            const userLinks = a.querySelectorAll('[data-testid="User-Name"] a, [data-testid="User-Name"] span');
            const linkEl = a.querySelector('a[href*="/status/"]');
            const timeEl = a.querySelector('time');
            
            // Get all aria-labels for metrics
            let likes = 0, replies = 0, retweets = 0, views = 0;
            
            a.querySelectorAll('[aria-label]').forEach(el => {
                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                const nums = label.match(/[\\d,]+/);
                if (!nums) return;
                const n = parseInt(nums[0].replace(/,/g, ''));
                
                if (label.includes('like') || label.includes('favorite')) likes = n;
                else if (label.includes('reply')) replies = n;
                else if (label.includes('repost') || label.includes('retweet')) retweets = n;
                else if (label.includes('view')) views = n;
            });
            
            // Also try to get view count from text
            a.querySelectorAll('[dir="ltr"]').forEach(el => {
                const txt = (el.textContent || '').toLowerCase();
                if (txt.includes('view') || txt.includes('impression')) {
                    const m = txt.match(/([\\d,.]+)\\s*(view|impression)/);
                    if (m) views = parseInt(m[1].replace(/,/g, ''));
                }
            });
            
            const text = textEl ? textEl.textContent : '';
            const user = userLinks.length > 0 ? userLinks[userLinks.length-1].textContent : '';
            
            let tweetUrl = '';
            if (linkEl) {
                const href = linkEl.getAttribute('href') || '';
                tweetUrl = href.startsWith('http') ? href.split('?')[0] : 'https://x.com' + href.split('?')[0];
            }
            
            tweets.push({
                text: text.substring(0, 300),
                user: user.substring(0, 40),
                url: tweetUrl,
                likes: likes,
                replies: replies,
                retweets: retweets,
                views: views,
                timestamp: timeEl ? timeEl.getAttribute('datetime') : ''
            });
        });
        return JSON.stringify(tweets);
    })()''', timeout=20)
    
    if not result:
        print('Failed to extract tweets!')
        ws.close()
        if tab_id: close_tab(tab_id)
        db.close()
        return
    
    try:
        all_tweets = json.loads(result)
    except:
        print(f'Parse error: {result[:200]}')
        ws.close()
        if tab_id: close_tab(tab_id)
        db.close()
        return
    
    print(f'\nFound {len(all_tweets)} tweets on profile page')
    
    # Group tweets by our content_id for matching
    success = 0
    failed = 0
    
    for camp in campaigns:
        cid = camp['content_id']
        content = camp['content']
        existing_url = camp['reply_url']
        
        print(f'\n{cid}: ', end='')
        
        # Try to find matching tweet
        best = None
        best_score = 0
        
        our_lower = content.lower()
        our_words_set = set(re.findall(r'\w+', our_lower))
        
        for t in all_tweets:
            text_lower = t.get('text', '').lower()
            
            # Check for exact content match
            if len(our_lower) > 30 and our_lower[:60] in text_lower:
                best = t
                best_score = 100
                print('✅ Exact match', end='')
                break
            
            # Word overlap
            tweet_words = set(re.findall(r'\w+', text_lower))
            overlap = len(our_words_set & tweet_words)
            if overlap > best_score and overlap >= 5:
                score = overlap / max(len(our_words_set), 1)
                if score > 0.3:
                    best_score = overlap
                    best = t
        
        if best:
            reply_url = best.get('url', '')
            likes = best.get('likes', 0)
            replies_ct = best.get('replies', 0)
            views = best.get('views', 0)
            
            print(f' (score:{best_score}) ❤️{likes} 💬{replies_ct} 👁️{views}')
            if reply_url:
                print(f'  URL: {reply_url}')
            
            today = time.strftime('%Y-%m-%d')
            db.execute('''
                INSERT OR REPLACE INTO reply_engagement 
                (campaign_id, date, reply_likes, reply_replies, reply_views, reply_retweets, notes)
                VALUES (?, ?, ?, ?, ?, 0, ?)
            ''', (camp['id'], today, likes, replies_ct, views,
                  f'Synced {today}'))
            
            if reply_url:
                db.execute('UPDATE campaigns SET reply_url = ? WHERE id = ?',
                          (reply_url, camp['id']))
            
            db.commit()
            success += 1
            print(f'  ✅ Saved')
        else:
            print('❌ No match')
            failed += 1
    
    ws.close()
    if tab_id:
        close_tab(tab_id)
    
    print(f'\n{"="*50}')
    print(f'Done: {success} synced / {failed} not found')
    db.close()

if __name__ == '__main__':
    import urllib.parse
    main()
