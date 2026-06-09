#!/usr/bin/env python3
"""Hourly marketing check: reads the guerrilla-content-plan sheet, decides what needs doing."""

import argparse
import json
import os
import sys
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import URLError

from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request as AuthRequest

# ── Sheet column indices (guerrilla-content-plan, 0-indexed) ──
COL_CONTENT_ID = 0    # ContentID (ODW###)
COL_ACTION_TYPE = 1   # ActionType (reply comment / post)
COL_PLATFORM = 2      # Platform
COL_PLATFORM_URL = 3  # PlatformURL
COL_TACTIC = 4        # GuerillaTactic
COL_CONTENT = 5       # Content (the comment text)
COL_SCHEDULE = 6      # Schedule
COL_LAST_UPDATE = 7   # Last_Update
COL_APPROVAL = 8      # Approval (✅ Approved / ⏳ Awaiting Thread / ✏️ Needs Edit)
COL_STATUS = 9        # Status (📋 planned / ⏳ pending / ✅ Repled / ReadyForBrowser)
COL_PROFILE = 10      # Chrome_Profile
COL_AGENT_NOTES = 11  # Agent's Notes
COL_HUMAN_NOTES = 12  # Human's Notes

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def get_args():
    p = argparse.ArgumentParser()
    p.add_argument("--sheet-id", default=SHEET_ID)
    p.add_argument("--sheet-tab", default="guerrilla-content-plan")
    return p.parse_args()


def get_sheet_data(sheet_id, sheet_tab):
    """Read sheet via Google Sheets REST API — more reliable than gspread."""
    creds = Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
    auth_req = AuthRequest()
    creds.refresh(auth_req)
    headers = {"Authorization": f"Bearer {creds.token}"}
    
    # Get all data
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{sheet_tab}!A:M"
    req = Request(url, headers=headers)
    resp = urlopen(req, timeout=30)
    data = json.loads(resp.read())
    rows = data.get("values", [])
    if not rows:
        return [], None
    return rows[1:], rows[0]  # data rows, headers


def main():
    args = get_args()

    rows, headers = get_sheet_data(args.sheet_id, args.sheet_tab)
    if not rows:
        print("No data rows found in guerrilla-content-plan.")
        return

    today = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Categorize items by status
    planned = [r for r in rows if len(r) > COL_STATUS and "planned" in r[COL_STATUS]]
    pending = [r for r in rows if len(r) > COL_STATUS and "pending" in r[COL_STATUS]]
    ready = [r for r in rows if len(r) > COL_STATUS and "ReadyForBrowser" in r[COL_STATUS]]
    replied = [r for r in rows if len(r) > COL_STATUS and ("Repled" in r[COL_STATUS] or "Posted" in r[COL_STATUS])]

    print(f"📊 Sheet scan ({today}):")
    print(f"   📋 planned: {len(planned)}")
    print(f"   ⏳ pending (needs thread): {len(pending)}")
    print(f"   🖥️  ReadyForBrowser: {len(ready)}")
    print(f"   ✅ already posted: {len(replied)}")

    # Count by profile
    profiles = {}
    for r in planned + ready:
        p = r[COL_PROFILE].strip() if len(r) > COL_PROFILE and r[COL_PROFILE].strip() else "unassigned"
        profiles[p] = profiles.get(p, 0) + 1
    
    print("\n📋 Pending by profile:")
    for p, c in sorted(profiles.items(), key=lambda x: -x[1]):
        print(f"   {p}: {c} items")

    # Check planned items that have URLs (ready to post)
    has_url = [r for r in planned if len(r) > COL_PLATFORM_URL and r[COL_PLATFORM_URL].strip().startswith("http")]
    no_url = [r for r in planned if len(r) > COL_PLATFORM_URL and not r[COL_PLATFORM_URL].strip().startswith("http")]
    
    print(f"\n   📋 planned WITH URLs (ready to post): {len(has_url)}")
    print(f"   📋 planned WITHOUT URLs (need threads): {len(no_url)}")
    print(f"   ⏳ pending items (need threads): {len(pending)}")

    if has_url:
        print(f"\n🔍 Next actionable: {has_url[0][COL_CONTENT_ID]} on {has_url[0][COL_PROFILE]}")
        print(f"   URL: {has_url[0][COL_PLATFORM_URL][:80]}")

    # Summary for Hermes cron prompt
    summary = (
        f"Daily check: {len(planned)} planned / {len(pending)} pending / {len(ready)} ReadyForBrowser / {len(replied)} posted\n"
        f"Ready to post now: {len(has_url)} items with verified URLs\n"
        f"Need threads found: {len(no_url) + len(pending)} items"
    )
    print(f"\n{summary}")


if __name__ == "__main__":
    main()
