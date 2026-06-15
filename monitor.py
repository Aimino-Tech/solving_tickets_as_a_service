#!/usr/bin/env python3
"""
Marketing Monitoring System — Core Database & Tracker

Tracks all marketing activities across platforms in SQLite.
Enables analysis, A/B testing, and self-improvement.

Tables:
- content: All posts/comments across platforms
- metrics: Daily aggregated metrics per platform
- conversions: Track signups/revenue attribution
- experiments: A/B test tracking
- daily_log: Raw activity log

Usage:
    python3 monitor.py sync          # Sync from Google Sheets
    python3 monitor.py report        # Generate analysis report
    python3 monitor.py daily         # Daily summary
    python3 monitor.py week          # Weekly analysis
"""

import os
import sys
import json
import sqlite3
from datetime import datetime, timezone, timedelta
from collections import Counter, defaultdict
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request
import requests

# ── Config ──────────────────────────────────────────────────────────────────
SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")
DB_PATH = os.path.expanduser("~/.hermes/marketing_monitor.db")

SHEETS = {
    "reddit-campaign": "A2:M",
    "reply-tracking": "A2:N",
    "linkedin-campaign": "A2:O",
    "twitter-campaign": "A2:O",
    "discord-campaign": "A2:M",
    "hacker-news-campaign": "A2:M",
}


# ── Database Setup ──────────────────────────────────────────────────────────
def init_db():
    """Initialize SQLite database with tables."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Main content table
    c.execute("""
        CREATE TABLE IF NOT EXISTS content (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_id TEXT UNIQUE,
            platform TEXT,
            platform_url TEXT,
            action_type TEXT,
            status TEXT,
            approval TEXT,
            product TEXT,
            content_preview TEXT,
            chrome_profile TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            sync_batch TEXT
        )
    """)
    
    # Daily metrics per platform
    c.execute("""
        CREATE TABLE IF NOT EXISTS metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            platform TEXT,
            product TEXT,
            posts_published INTEGER DEFAULT 0,
            replies_received INTEGER DEFAULT 0,
            replies_responded INTEGER DEFAULT 0,
            upvotes INTEGER DEFAULT 0,
            new_followers INTEGER DEFAULT 0,
            signups INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(date, platform, product)
        )
    """)
    
    # Reply tracking
    c.execute("""
        CREATE TABLE IF NOT EXISTS replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_id TEXT,
            reply_author TEXT,
            reply_text TEXT,
            reply_url TEXT,
            reply_time TEXT,
            response_status TEXT,
            response_text TEXT,
            sentiment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # A/B experiments
    c.execute("""
        CREATE TABLE IF NOT EXISTS experiments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            variant_a TEXT,
            variant_b TEXT,
            metric TEXT,
            result_a REAL,
            result_b REAL,
            winner TEXT,
            started_at TIMESTAMP,
            ended_at TIMESTAMP
        )
    """)
    
    # Daily activity log
    c.execute("""
        CREATE TABLE IF NOT EXISTS daily_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            platform TEXT,
            action TEXT,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    conn.commit()
    return conn


# ── Google Sheets API ───────────────────────────────────────────────────────
def get_sheets_client():
    creds = Credentials.from_service_account_file(SA_PATH, scopes=[
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ])
    creds.refresh(Request())
    headers = {"Authorization": f"Bearer {creds.token}"}
    return creds, headers


def read_sheet_range(headers, sheet_name, cell_range):
    import urllib.parse
    range_str = f"{sheet_name}!{cell_range}"
    encoded_range = urllib.parse.quote(range_str)
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json().get("values", [])


# ── Sync Logic ──────────────────────────────────────────────────────────────
def sync_guerrilla_content(conn, headers):
    """Sync reddit-campaign sheet to database."""
    rows = read_sheet_range(headers, "reddit-campaign", "A2:M2000")
    
    c = conn.cursor()
    batch = datetime.now().strftime("%Y%m%d_%H%M%S")
    synced = 0
    
    for row in rows:
        if not row or not row[0]:
            continue
        
        content_id = row[0]
        platform = row[2] if len(row) > 2 else ""
        url = row[3] if len(row) > 3 else ""
        action_type = row[1] if len(row) > 1 else ""
        approval = row[8] if len(row) > 8 else ""
        status = row[9] if len(row) > 9 else ""
        profile = row[10] if len(row) > 10 else ""
        notes = row[11] if len(row) > 11 else ""
        content = row[5] if len(row) > 5 else ""
        
        # Extract product from content_id
        product = ''.join(c for c in content_id if c.isalpha())
        
        # Extract platform name
        if "Reddit" in platform:
            platform_name = "Reddit"
        elif "Hacker News" in platform:
            platform_name = "HackerNews"
        elif "LinkedIn" in platform:
            platform_name = "LinkedIn"
        elif "Twitter" in platform:
            platform_name = "Twitter"
        elif "Discord" in platform:
            platform_name = "Discord"
        else:
            platform_name = platform
        
        try:
            c.execute("""
                INSERT OR REPLACE INTO content 
                (content_id, platform, platform_url, action_type, status, approval, 
                 product, content_preview, chrome_profile, notes, updated_at, sync_batch)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (content_id, platform_name, url, action_type, status, approval,
                  product, content[:200] if content else "", profile, notes, 
                  datetime.now().isoformat(), batch))
            synced += 1
        except Exception as e:
            print(f"  ⚠️ Error syncing {content_id}: {e}")
    
    conn.commit()
    return synced


def sync_reply_tracking(conn, headers):
    """Sync reply-tracking sheet to database."""
    rows = read_sheet_range(headers, "reply-tracking", "A2:N1000")
    
    c = conn.cursor()
    synced = 0
    
    for row in rows:
        if not row or not row[0]:
            continue
        
        content_id = row[0]
        reply_author = row[5] if len(row) > 5 else ""
        reply_text = row[6] if len(row) > 6 else ""
        reply_url = row[7] if len(row) > 7 else ""
        reply_time = row[8] if len(row) > 8 else ""
        response_status = row[9] if len(row) > 9 else ""
        response_text = row[10] if len(row) > 10 else ""
        
        try:
            c.execute("""
                INSERT INTO replies 
                (content_id, reply_author, reply_text, reply_url, reply_time, 
                 response_status, response_text)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (content_id, reply_author, reply_text[:500] if reply_text else "", 
                  reply_url, reply_time, response_status, 
                  response_text[:500] if response_text else ""))
            synced += 1
        except Exception as e:
            print(f"  ⚠️ Error syncing reply: {e}")
    
    conn.commit()
    return synced


# ── Analysis & Reports ──────────────────────────────────────────────────────
def generate_daily_report(conn):
    """Generate daily summary report."""
    c = conn.cursor()
    today = datetime.now().strftime("%Y-%m-%d")
    
    print(f"📊 DAILY MARKETING REPORT — {today}")
    print("=" * 60)
    
    # Total content by platform
    c.execute("""
        SELECT platform, COUNT(*) as total,
               SUM(CASE WHEN status = '✅ Replied' OR status = '✅ Repled' THEN 1 ELSE 0 END) as done,
               SUM(CASE WHEN status = '📋 planned' THEN 1 ELSE 0 END) as planned
        FROM content
        GROUP BY platform
    """)
    
    print("\n🌐 BY PLATFORM:")
    for row in c.fetchall():
        platform, total, done, planned = row
        print(f"  {platform}: {total} total ({done} done, {planned} planned)")
    
    # Content by product
    c.execute("""
        SELECT product, COUNT(*) as total,
               SUM(CASE WHEN status = '✅ Replied' OR status = '✅ Repled' THEN 1 ELSE 0 END) as done
        FROM content
        GROUP BY product
        ORDER BY total DESC
    """)
    
    print("\n🏷️  BY PRODUCT:")
    for row in c.fetchall():
        product, total, done = row
        if product:
            print(f"  {product}: {total} total ({done} done)")
    
    # Approval status
    c.execute("""
        SELECT approval, COUNT(*) as count
        FROM content
        GROUP BY approval
        ORDER BY count DESC
    """)
    
    print("\n✅ BY APPROVAL:")
    for row in c.fetchall():
        approval, count = row
        if approval:
            print(f"  {approval}: {count}")
    
    # Reply tracking
    c.execute("SELECT COUNT(*) FROM replies")
    total_replies = c.fetchone()[0]
    
    c.execute("SELECT COUNT(DISTINCT content_id) FROM replies")
    threads_with_replies = c.fetchone()[0]
    
    print(f"\n💬 REPLIES:")
    print(f"  Total replies received: {total_replies}")
    print(f"  Threads with replies: {threads_with_replies}")
    
    # Success rate
    c.execute("""
        SELECT 
            SUM(CASE WHEN status = '✅ Replied' OR status = '✅ Repled' THEN 1 ELSE 0 END) as done,
            SUM(CASE WHEN status = '⏭️ Skipped' OR status = '❌ Rejected' THEN 1 ELSE 0 END) as failed
        FROM content
    """)
    done, failed = c.fetchone()
    total_actionable = (done or 0) + (failed or 0)
    success_rate = ((done or 0) / total_actionable * 100) if total_actionable > 0 else 0
    
    print(f"\n📈 SUCCESS RATE: {success_rate:.1f}% ({done}/{total_actionable})")
    
    print(f"\n{'=' * 60}")
    print(f"✅ Report complete!")


def generate_weekly_analysis(conn):
    """Generate weekly analysis with trends."""
    c = conn.cursor()
    
    print(f"📊 WEEKLY MARKETING ANALYSIS")
    print("=" * 60)
    
    # This week's activity
    c.execute("""
        SELECT DATE(updated_at) as day, platform, COUNT(*) as count
        FROM content
        WHERE updated_at >= datetime('now', '-7 days')
        GROUP BY day, platform
        ORDER BY day
    """)
    
    print("\n📅 ACTIVITY THIS WEEK:")
    for row in c.fetchall():
        day, platform, count = row
        print(f"  {day}: {platform} — {count} posts")
    
    # Top performing subreddits
    c.execute("""
        SELECT platform, 
               SUM(CASE WHEN status = '✅ Replied' OR status = '✅ Repled' THEN 1 ELSE 0 END) as done,
               COUNT(*) as total
        FROM content
        WHERE platform LIKE 'Reddit%'
        GROUP BY platform
        ORDER BY done DESC
        LIMIT 10
    """)
    
    print("\n🏆 TOP SUBREDDITS (by completion):")
    for row in c.fetchall():
        platform, done, total = row
        rate = (done / total * 100) if total > 0 else 0
        print(f"  {platform}: {done}/{total} ({rate:.0f}%)")
    
    # Product performance
    c.execute("""
        SELECT product,
               COUNT(*) as total,
               SUM(CASE WHEN status = '✅ Replied' OR status = '✅ Repled' THEN 1 ELSE 0 END) as done,
               SUM(CASE WHEN status = '⏭️ Skipped' OR status = '❌ Rejected' THEN 1 ELSE 0 END) as failed
        FROM content
        GROUP BY product
        HAVING total > 10
        ORDER BY done DESC
    """)
    
    print("\n🎯 PRODUCT PERFORMANCE:")
    for row in c.fetchall():
        product, total, done, failed = row
        if product:
            success = (done / (done + failed) * 100) if (done + failed) > 0 else 0
            print(f"  {product}: {done}/{total} success ({success:.0f}%)")
    
    print(f"\n{'=' * 60}")
    print(f"✅ Analysis complete!")


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print("Usage: python3 monitor.py [sync|report|daily|week]")
        sys.exit(1)
    
    command = sys.argv[1]
    
    # Initialize database
    conn = init_db()
    
    if command == "sync":
        print("🔄 Syncing from Google Sheets...")
        creds, headers = get_sheets_client()
        
        print("\n📋 Syncing reddit-campaign...")
        synced = sync_guerrilla_content(conn, headers)
        print(f"   ✅ {synced} rows synced")
        
        print("\n💬 Syncing reply-tracking...")
        synced = sync_reply_tracking(conn, headers)
        print(f"   ✅ {synced} replies synced")
        
        print("\n✅ Sync complete!")
        
    elif command == "report":
        generate_daily_report(conn)
        
    elif command == "daily":
        generate_daily_report(conn)
        
    elif command == "week":
        generate_weekly_analysis(conn)
        
    else:
        print(f"Unknown command: {command}")
        print("Usage: python3 monitor.py [sync|report|daily|week]")
    
    conn.close()


if __name__ == "__main__":
    main()
