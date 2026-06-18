#!/usr/bin/env python3
"""Marketing Dashboard - combined original post + our reply engagement"""
import sqlite3
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
import os
from urllib.parse import urlparse, parse_qs

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'marketing.db')
PORT = 9120

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_pg():
    """Optional Supabase PostgreSQL connection for products."""
    try:
        import psycopg2
        return psycopg2.connect(
            host='db.jijrengojedvsfltatin.supabase.co',
            port=5432,
            dbname='postgres',
            user='postgres',
            password='99RvCUn7vc!LY@Q',
            sslmode='require'
        )
    except Exception:
        return None

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        db = get_db()
        parsed = urlparse(self.path)
        path = parsed.path
        
        if path in ('/', '/campaigns'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(self.render_dashboard(db).encode())
        
        elif path == '/api/stats':
            stats = {
                'total_campaigns': db.execute('SELECT COUNT(*) FROM campaigns').fetchone()[0],
                'posted': db.execute("SELECT COUNT(*) FROM campaigns WHERE status='posted'").fetchone()[0],
                
                'original_likes': db.execute('SELECT COALESCE(SUM(likes),0) FROM engagement').fetchone()[0],
                'original_replies': db.execute('SELECT COALESCE(SUM(replies),0) FROM engagement').fetchone()[0],
                'original_views': db.execute('SELECT COALESCE(SUM(views),0) FROM engagement').fetchone()[0],
                
                'reply_likes': db.execute('SELECT COALESCE(SUM(reply_likes),0) FROM reply_engagement').fetchone()[0],
                'reply_replies': db.execute('SELECT COALESCE(SUM(reply_replies),0) FROM reply_engagement').fetchone()[0],
                'reply_views': db.execute('SELECT COALESCE(SUM(reply_views),0) FROM reply_engagement').fetchone()[0],
                'tracked_replies': db.execute('SELECT COUNT(*) FROM reply_engagement').fetchone()[0],
            }
            self.send_json(stats)
        
        elif path == '/api/engagement':
            rows = db.execute('SELECT * FROM engagement ORDER BY date DESC').fetchall()
            self.send_json([dict(r) for r in rows])
        
        elif path == '/api/reply-engagement':
            rows = db.execute('''
                SELECT r.*, c.content_id, c.topic, c.target_author, c.target_url, c.reply_url
                FROM reply_engagement r
                JOIN campaigns c ON r.campaign_id = c.id
                ORDER BY r.date DESC
            ''').fetchall()
            self.send_json([dict(r) for r in rows])
        
        elif path == '/api/accounts':
            rows = db.execute('SELECT * FROM accounts').fetchall()
            self.send_json([dict(r) for r in rows])
        
        elif path == '/api/products':
            pg = get_pg()
            if pg:
                cur = pg.cursor()
                cur.execute('SELECT * FROM public.products ORDER BY project_id')
                cols = [desc[0] for desc in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
                cur.close()
                pg.close()
                self.send_json(rows)
            else:
                self.send_json([])
        
        elif path == '/api/campaigns':
            rows = db.execute('''
                SELECT c.*, e.likes, e.retweets, e.replies, e.views
                FROM campaigns c LEFT JOIN engagement e ON c.id = e.campaign_id
                ORDER BY c.posted_at DESC
            ''').fetchall()
            self.send_json([dict(r) for r in rows])
        
        elif path == '/api/sync-reply-engagement':
            # Trigger reply engagement sync
            self.send_json({'status': 'ok', 'message': 'Use run_sync script: python3 scripts/sync_reply_engagement.py'})
        
        else:
            self.send_error(404)
        
        db.close()
    
    def send_json(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())
    
    def render_dashboard(self, db):
        # Summary stats
        total = db.execute('SELECT COUNT(*) FROM campaigns').fetchone()[0]
        posted = db.execute("SELECT COUNT(*) FROM campaigns WHERE status='posted'").fetchone()[0]
        
        o_likes = db.execute('SELECT COALESCE(SUM(likes),0) FROM engagement').fetchone()[0]
        o_replies = db.execute('SELECT COALESCE(SUM(replies),0) FROM engagement').fetchone()[0]
        o_views = db.execute('SELECT COALESCE(SUM(views),0) FROM engagement').fetchone()[0]
        
        r_likes = db.execute('SELECT COALESCE(SUM(reply_likes),0) FROM reply_engagement').fetchone()[0]
        r_replies = db.execute('SELECT COALESCE(SUM(reply_replies),0) FROM reply_engagement').fetchone()[0]
        
        # Products from Supabase
        products = []
        try:
            pg = get_pg()
            if pg:
                cur = pg.cursor()
                cur.execute('SELECT * FROM public.products ORDER BY project_id')
                cols = [desc[0] for desc in cur.description]
                products = [dict(zip(cols, r)) for r in cur.fetchall()]
                cur.close()
                pg.close()
        except:
            pass
        p_count = len(products)
        
        # Products HTML
        p_html = ''
        for p in products:
            p_html += f'''<div class="tp">
            <div class="rk" style="color:#a855f7">\U0001f4e6</div>
            <div class="inf">
                <div class="tpc">{p.get('project_name','')}</div>
                <div class="ath">{p.get('project_id','')} | {p.get('tagline','')[:80] if p.get('tagline') else ''}</div>
            </div>
            <div class="eng">{p.get('status','')}</div>
        </div>'''
        if not products:
            p_html = '<div class="tp" style="color:#666;justify-content:center;"><div>Chưa có sản phẩm nào</div></div>'
        
        r_views = db.execute('SELECT COALESCE(SUM(reply_views),0) FROM reply_engagement').fetchone()[0]
        r_count = db.execute('SELECT COUNT(*) FROM reply_engagement').fetchone()[0]
        
        # Top original posts (by original likes)
        top_orig = db.execute('''
            SELECT c.content_id, c.topic, c.target_author, c.target_url,
                   e.likes, e.retweets, e.replies, e.views
            FROM campaigns c JOIN engagement e ON c.id = e.campaign_id
            ORDER BY e.likes DESC LIMIT 5
        ''').fetchall()
        
        # Our replies with engagement (from reply_engagement)
        our_replies = db.execute('''
            SELECT r.*, c.content_id, c.topic, c.target_author, c.target_url, c.reply_url
            FROM reply_engagement r
            JOIN campaigns c ON r.campaign_id = c.id
            ORDER BY r.reply_likes DESC LIMIT 5
        ''').fetchall()
        
        all_c = db.execute('''
            SELECT c.*, e.likes, e.retweets, e.replies, e.views
            FROM campaigns c LEFT JOIN engagement e ON c.id = e.campaign_id
            ORDER BY c.posted_at DESC
        ''').fetchall()
        
        accs = db.execute('SELECT * FROM accounts').fetchall()
        
        # Top original posts HTML
        top_orig_html = ''
        for i, p in enumerate(top_orig, 1):
            top_orig_html += f'''<div class="tp"><div class="rk">#{i}</div>
            <div class="inf"><div class="tpc"><a href="{p['target_url']}" target="_blank">{p['topic']}</a></div>
            <div class="ath">{p['target_author']}</div></div>
            <div class="eng">❤️ {p['likes']} 💬 {p['replies']} 👁️ {p['views']}</div></div>'''
        
        # Our replies HTML
        our_html = ''
        if our_replies:
            for p in our_replies:
                reply_url = p['reply_url'] or p['target_url']
                our_html += f'''<div class="tp"><div class="rk">💬</div>
                <div class="inf"><div class="tpc"><a href="{reply_url}" target="_blank">{p['topic']}</a></div>
                <div class="ath">{p['target_author']} · {p['content_id']}</div></div>
                <div class="eng">❤️ {p['reply_likes']} 💬 {p['reply_replies']} 👁️ {p['reply_views']}</div></div>'''
        else:
            our_html = f'''<div class="tp" style="color:#666;justify-content:center;">
            <div>📊 Chưa có dữ liệu reply engagement — chạy sync script để backfill</div></div>'''
        
        # Campaigns table HTML
        c_html = ''
        for c in all_c:
            c_html += f'''<tr><td>{c['content_id']}</td>
            <td><span class="b b-{c['platform']}">{c['platform']}</span></td>
            <td>{c['topic'] or ''}</td>
            <td><a href="{c['target_url']}" target="_blank">{c['target_author'] or ''}</a></td>
            <td>❤️ {c['likes'] or 0} 💬 {c['replies'] or 0} 👁️ {c['views'] or 0}</td>
            <td>{c['posted_at'] or ''}</td></tr>'''
        
        a_html = ''
        for a in accs:
            a_html += f'''<tr><td><span class="b b-{a['platform']}">{a['platform']}</span></td>
            <td>{a['username'] or '-'}</td><td>{a['email'] or '-'}</td>
            <td>{a['status']}</td><td>{a['port']}</td></tr>'''
        
        return f'''<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIMino Dashboard</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:system-ui,sans-serif;background:#0f0f0f;color:#e0e0e0}}
.h{{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px 32px;border-bottom:1px solid #333}}
.h h1{{font-size:24px;color:#fff}}.h p{{color:#888;margin-top:4px}}
.s{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px 32px}}
.sc{{background:#1a1a2e;border-radius:12px;padding:20px;border:1px solid #333}}
.sc .l{{color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px}}
.sc .v{{font-size:32px;font-weight:700;color:#fff;margin-top:8px}}
.sc .sb{{font-size:14px;margin-top:4px}}
.orig .sb{{color:#4ade80}} .reply .sb{{color:#60a5fa}}
.c{{padding:0 32px 32px}}.st{{font-size:18px;font-weight:600;margin:24px 0 16px;color:#fff}}
.st-reply{{color:#60a5fa}}
table{{width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:12px;overflow:hidden}}
th{{background:#16213e;padding:12px 16px;text-align:left;font-size:12px;text-transform:uppercase;color:#888}}
td{{padding:12px 16px;border-top:1px solid #333;font-size:14px}}
tr:hover td{{background:#1e2a3a}}
.b{{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500;color:#fff}}
.b-twitter{{background:#1d9bf0}}.b-reddit{{background:#ff4500}}.b-linkedin{{background:#0a66c2}}
.b-discord{{background:#5865f2}}.b-hn{{background:#ff6600}}
a{{color:#60a5fa;text-decoration:none}}a:hover{{text-decoration:underline}}
.tp{{display:flex;align-items:center;gap:16px;padding:16px;background:#1a1a2e;border-radius:8px;margin-bottom:8px;border:1px solid #333}}
.rk{{font-size:24px;font-weight:700;color:#4ade80;width:40px}}.rk-reply{{color:#60a5fa}}
.inf{{flex:1}}.tpc{{font-weight:600;color:#fff}}.ath{{color:#888;font-size:13px}}
.eng{{text-align:right;font-size:14px}}
.note{{color:#666;font-size:13px;margin:-8px 0 16px}}
.section-toggle{{display:flex;gap:12px;margin:24px 32px 0}}
.section-toggle a{{padding:8px 20px;border-radius:8px;background:#1a1a2e;border:1px solid #333;font-size:14px;color:#888;text-decoration:none}}
.section-toggle a.active{{background:#16213e;border-color:#60a5fa;color:#fff}}
</style></head><body>
<div class="h"><h1>AIMino Marketing Dashboard</h1><p>Guerrilla Marketing Campaign Tracker</p></div>
<div class="s">
<div class="sc"><div class="l">Campaigns</div><div class="v">{total}</div><div class="sb">{posted} posted</div></div>
<div class="sc orig"><div class="l">Original Likes</div><div class="v">{o_likes}</div><div class="sb">from original posts</div></div>
<div class="sc orig"><div class="l">Original Views</div><div class="v">{o_views:,}</div><div class="sb">impressions</div></div>
<div class="sc reply"><div class="l">Reply Likes</div><div class="v">{r_likes}</div><div class="sb">our replies ({r_count} tracked)</div></div>
<div class="sc" style="border-color:#a855f7"><div class="l">Products</div><div class="v" style="color:#a855f7">{p_count}</div><div class="sb">from project-overview</div></div>
</div>
<div class="c">
<div class="st">📦 Products</div>
{p_html}
<div class="st">📌 Top Original Posts</div>
<div class="note">Engagement metrics của original post (target URL), không phải reply của mình</div>
{top_orig_html}
<div class="st st-reply">💬 Our Reply Performance</div>
<div class="note">Likes/replies/views trên reply của chúng ta. {r_count} replies đang được track.</div>
{our_html}
<div class="st">📋 All Campaigns</div>
<table><thead><tr><th>ID</th><th>Platform</th><th>Topic</th><th>Target</th><th>Engagement</th><th>Date</th></tr></thead><tbody>{c_html}</tbody></table>
<div class="st">👤 Accounts</div>
<table><thead><tr><th>Platform</th><th>Username</th><th>Email</th><th>Status</th><th>Port</th></tr></thead><tbody>{a_html}</tbody></table>
</div></body></html>'''
    
    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    print(f'Dashboard: http://localhost:{PORT}')
    HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
