#!/usr/bin/env python3
"""
Marketing Pipeline - Product Readiness Check

Checks Public-marketplaces sheet to determine if product is ready for marketing.

Flow:
1. Read project-overview for products
2. Read Public-marketplaces for publish status
3. If product has ≥1 PUBLISHED marketplace → READY
4. If not → BLOCKED (need to publish first)

Usage:
    python3 pipeline_ready.py
"""

import os
import json
from datetime import datetime, timezone
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request
import requests

# ── Config ──────────────────────────────────────────────────────────────────
SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")


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


def get_products(headers):
    """Read products from project-overview."""
    rows = read_sheet_range(headers, "project-overview", "A2:L30")
    products = []
    for row in rows:
        if row and len(row) > 0 and row[0] and row[0].strip():
            products.append({
                "id": row[0].strip(),
                "name": row[1].strip() if len(row) > 1 else "",
                "repo": row[2].strip() if len(row) > 2 else "",
            })
    return products


def get_marketplace_status(headers):
    """Read marketplace status from Public-marketplaces sheet."""
    rows = read_sheet_range(headers, "Public-marketplaces", "A1:G100")
    
    if not rows:
        return {}
    
    # Group by product (extract from GitHub URL or URL)
    marketplaces = {}
    headers_row = rows[0]
    
    for row in rows[1:]:
        if not row or len(row) < 4:
            continue
        
        platform = row[0].strip() if row[0] else ""
        url = row[2].strip() if len(row) > 2 and row[2] else ""  # GitHub column
        status = row[3].strip() if len(row) > 3 and row[3] else ""
        
        # Determine product from GitHub URL
        product_id = None
        if "opendocswork-mcp" in url or "office-oxide-mcp" in url:
            product_id = "ODW"
        elif "OpenTalk2HTML" in url:
            product_id = "OT2H"
        
        if product_id:
            if product_id not in marketplaces:
                marketplaces[product_id] = []
            
            marketplaces[product_id].append({
                "platform": platform,
                "url": url,
                "status": status,
                "published": "✅" in status,
            })
    
    return marketplaces


def main():
    print(f"🔄 Marketing Pipeline - Product Readiness Check")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    # Connect to Sheets
    creds, headers = get_sheets_client()
    
    # Get products
    products = get_products(headers)
    print(f"\n📦 Found {len(products)} products in project-overview")
    
    # Get marketplace status
    marketplace_status = get_marketplace_status(headers)
    
    # Check each product
    ready_products = []
    blocked_products = []
    
    for product in products:
        pid = product["id"]
        print(f"\n{'=' * 60}")
        print(f"🔍 {pid} - {product['name']}")
        
        # Get marketplace data for this product
        mp_data = marketplace_status.get(pid, [])
        
        if not mp_data:
            print(f"   ❌ NO marketplace data found")
            print(f"   → Need to add to Public-marketplaces sheet first")
            blocked_products.append(product)
            continue
        
        # Count published vs not
        published = [m for m in mp_data if m["published"]]
        not_published = [m for m in mp_data if not m["published"]]
        
        print(f"\n   📊 Marketplace Status:")
        print(f"   ✅ Published: {len(published)}/{len(mp_data)}")
        
        for m in published:
            print(f"      ✅ {m['platform']}")
        
        if not_published:
            print(f"   ⚠️  Not Published: {len(not_published)}")
            for m in not_published[:5]:
                print(f"      ❌ {m['platform']}")
            if len(not_published) > 5:
                print(f"      ... and {len(not_published) - 5} more")
        
        # Verdict
        print(f"\n   {'=' * 40}")
        if len(published) >= 1:
            print(f"   ✅ READY: {len(published)} marketplace(s) published")
            print(f"   → Can proceed to find live threads!")
            ready_products.append(product)
        else:
            print(f"   ⏸️  BLOCKED: No marketplaces published yet")
            print(f"   → Publish to at least 1 marketplace FIRST")
            blocked_products.append(product)
    
    # Summary
    print(f"\n{'=' * 60}")
    print(f"📊 SUMMARY")
    print(f"{'=' * 60}")
    
    print(f"\n✅ READY FOR MARKETING ({len(ready_products)}):")
    for p in ready_products:
        print(f"   - {p['id']}: {p['name']}")
    
    if blocked_products:
        print(f"\n⏸️  BLOCKED ({len(blocked_products)}):")
        for p in blocked_products:
            print(f"   - {p['id']}: {p['name']}")
    
    print(f"\n{'=' * 60}")
    
    if ready_products:
        print(f"🚀 Next steps for READY products:")
        print(f"   1. Find live threads on Reddit/HN/LinkedIn")
        print(f"   2. Write content tailored to each thread")
        print(f"   3. Post and track in guerrilla-content-plan")
    
    if blocked_products:
        print(f"\n📝 Actions needed for BLOCKED products:")
        print(f"   1. Add to Public-marketplaces sheet")
        print(f"   2. Publish to at least 1 marketplace")
        print(f"   3. Re-run this check")


if __name__ == "__main__":
    main()
