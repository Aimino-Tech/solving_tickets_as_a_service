#!/usr/bin/env python3
"""Migrate SQLite marketing.db to Supabase PostgreSQL — full migration."""
import sqlite3
import psycopg2
import json
import sys
from datetime import datetime

DB_CONN = dict(
    host='db.jijrengojedvsfltatin.supabase.co',
    port=5432,
    dbname='postgres',
    user='postgres',
    password='99RvCUn7vc!LY@Q',
    sslmode='require'
)

SQLITE_PATH = "/home/agent/Documents/hermes-agent/marketing.db"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def main():
    # Connect
    log("Connecting to Supabase PostgreSQL...")
    pg = psycopg2.connect(**DB_CONN)
    pg.autocommit = True
    cur = pg.cursor()
    
    log("Connecting to SQLite...")
    sq = sqlite3.connect(SQLITE_PATH)
    sq.row_factory = sqlite3.Row
    
    # =============================================
    # STEP 1: Create tables
    # =============================================
    log("\n📦 STEP 1: Creating tables...")
    
    tables_sql = """
    CREATE TABLE IF NOT EXISTS public.accounts (
        id SERIAL PRIMARY KEY,
        platform TEXT NOT NULL,
        username TEXT,
        email TEXT,
        profile_dir TEXT,
        port INTEGER,
        status TEXT DEFAULT 'active',
        notes TEXT,
        password TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE TABLE IF NOT EXISTS public.campaigns (
        id SERIAL PRIMARY KEY,
        content_id TEXT UNIQUE,
        project_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        action_type TEXT,
        target_url TEXT,
        target_author TEXT,
        content TEXT,
        topic TEXT,
        status TEXT DEFAULT 'pending',
        reply_url TEXT,
        posted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE TABLE IF NOT EXISTS public.engagement (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES public.campaigns(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        likes INTEGER DEFAULT 0,
        retweets INTEGER DEFAULT 0,
        replies INTEGER DEFAULT 0,
        views INTEGER DEFAULT 0,
        notes TEXT
    );
    
    CREATE TABLE IF NOT EXISTS public.reply_engagement (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES public.campaigns(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        reply_likes INTEGER DEFAULT 0,
        reply_replies INTEGER DEFAULT 0,
        reply_views INTEGER DEFAULT 0,
        reply_retweets INTEGER DEFAULT 0,
        notes TEXT
    );
    
    CREATE TABLE IF NOT EXISTS public.all_campaigns (
        id SERIAL PRIMARY KEY,
        content_id TEXT,
        sheet_name TEXT,
        project_id TEXT,
        platform TEXT,
        action_type TEXT,
        target_url TEXT,
        target_author TEXT,
        content TEXT,
        topic TEXT,
        status TEXT,
        posted_at TEXT,
        extra_col1 TEXT,
        extra_col2 TEXT,
        extra_col3 TEXT,
        extra_col4 TEXT
    );
    
    CREATE TABLE IF NOT EXISTS public.marketplaces (
        id SERIAL PRIMARY KEY,
        project_id TEXT,
        platform TEXT,
        url TEXT,
        status TEXT,
        last_update TEXT,
        method TEXT,
        notes TEXT
    );
    
    CREATE TABLE IF NOT EXISTS public.platform_status (
        id SERIAL PRIMARY KEY,
        platform TEXT NOT NULL,
        is_running BOOLEAN DEFAULT FALSE,
        has_cookies BOOLEAN DEFAULT FALSE,
        last_check TIMESTAMP,
        notes TEXT
    );
    """
    
    # Execute each statement
    for stmt in tables_sql.split(';'):
        stmt = stmt.strip()
        if stmt and stmt.upper().startswith('CREATE'):
            try:
                cur.execute(stmt + ';')
                table_name = stmt.split('TABLE')[1].split('(')[0].strip().replace('IF NOT EXISTS', '').replace('public.', '').strip()
                log(f"  ✅ Created: {table_name}")
            except Exception as e:
                log(f"  ❌ Error: {e}")
    
    # Disable RLS for migration
    log("\n📦 STEP 2: Disabling RLS...")
    for t in ['accounts', 'campaigns', 'engagement', 'reply_engagement', 'all_campaigns', 'marketplaces', 'platform_status']:
        cur.execute(f"ALTER TABLE public.{t} DISABLE ROW LEVEL SECURITY;")
    log("  ✅ RLS disabled on all tables")
    
    # =============================================
    # STEP 3: Migrate data
    # =============================================
    log("\n📦 STEP 3: Migrating data...")
    
    tables_info = [
        ('accounts', ['platform', 'username', 'email', 'profile_dir', 'port', 'status', 'notes', 'password', 'created_at']),
        ('campaigns', ['content_id', 'project_id', 'platform', 'action_type', 'target_url', 'target_author', 'content', 'topic', 'status', 'reply_url', 'posted_at', 'created_at']),
        ('all_campaigns', ['content_id', 'sheet_name', 'project_id', 'platform', 'action_type', 'target_url', 'target_author', 'content', 'topic', 'status', 'posted_at', 'extra_col1', 'extra_col2', 'extra_col3', 'extra_col4']),
        ('engagement', ['campaign_id', 'date', 'likes', 'retweets', 'replies', 'views', 'notes']),
        ('reply_engagement', ['campaign_id', 'date', 'reply_likes', 'reply_replies', 'reply_views', 'reply_retweets', 'notes']),
        ('marketplaces', ['project_id', 'platform', 'url', 'status', 'last_update', 'method', 'notes']),
        ('platform_status', ['platform', 'is_running', 'has_cookies', 'last_check', 'notes']),
    ]
    
    for table_name, cols in tables_info:
        # Read from SQLite
        sq_cursor = sq.execute(f'SELECT * FROM "{table_name}"')
        rows = [dict(r) for r in sq_cursor.fetchall()]
        log(f"  📋 {table_name}: {len(rows)} rows")
        
        if not rows:
            log(f"     ⏭️  Empty, skipping")
            continue
        
        # Build insert SQL
        placeholders = ', '.join([f'%({c})s' for c in cols])
        col_names = ', '.join(cols)
        insert_sql = f'INSERT INTO public.{table_name} ({col_names}) VALUES ({placeholders})'
        
        # Insert in batches
        batch_size = 100
        total = 0
        errors = []
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i+batch_size]
            for row in batch:
                # Filter to only known columns
                clean = {k: row.get(k) for k in cols}
                # Handle None vs empty string
                clean = {k: (v if v is not None else None) for k, v in clean.items()}
                try:
                    cur.execute(insert_sql, clean)
                    total += 1
                except Exception as e:
                    errors.append(str(e)[:100])
        
        log(f"     ✅ Inserted {total} rows")
        if errors:
            log(f"     ⚠️  Errors: {len(errors)} (first: {errors[0]})")
    
    # Re-enable RLS
    log("\n📦 STEP 4: Re-enabling RLS...")
    for t in ['accounts', 'campaigns', 'engagement', 'reply_engagement', 'all_campaigns', 'marketplaces', 'platform_status']:
        cur.execute(f"ALTER TABLE public.{t} ENABLE ROW LEVEL SECURITY;")
    
    # Verify
    log("\n📊 VERIFICATION:")
    for t in ['accounts', 'campaigns', 'engagement', 'reply_engagement', 'all_campaigns', 'marketplaces', 'platform_status']:
        cur.execute(f'SELECT COUNT(*) FROM public.{t}')
        count = cur.fetchone()[0]
        log(f"  ✅ {t}: {count} rows")
    
    cur.close()
    pg.close()
    sq.close()
    log("\n🎉 Migration complete!")

if __name__ == "__main__":
    main()
