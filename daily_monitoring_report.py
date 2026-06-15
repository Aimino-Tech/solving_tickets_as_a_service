#!/usr/bin/env python3
"""
Daily Marketing Monitoring Report - FIXED VERSION
Reads from actual campaign tabs instead of non-existent guerrilla-content-plan.
"""
import os, json, urllib.parse
from datetime import datetime
from collections import Counter
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request
import requests

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")
STATE_FILE = os.path.expanduser("~/.hermes/pipeline_state.json")

CAMPAIGN_TABS = [
    ("reddit-campaign",       8, 9, 2, 0),
    ("discord-campaign",      8, 9, 2, 0),
    ("linkedin-campaign",     9, 10, 2, 0),
    ("twitter-campaign",      9, 10, 2, 0),
    ("hacker-news-campaign",  9, 10, 2, 0),
]

PLATFORM_MAP = {
    "reddit": "Reddit", "discord": "Discord", "linkedin": "LinkedIn",
    "twitter": "Twitter", "x.com": "Twitter",
    "hacker-news": "Hacker News", "hackernews": "Hacker News", "hn": "Hacker News",
}

def get_sheets_client():
    creds = Credentials.from_service_account_file(SA_PATH, scopes=[
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ])
    creds.refresh(Request())
    return {"Authorization": "Bearer " + creds.token}

def read_sheet_range(headers, sheet_name, cell_range):
    range_str = sheet_name + "!" + cell_range
    encoded_range = urllib.parse.quote(range_str)
    url = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID + "/values/" + encoded_range
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json().get("values", [])

def normalize_platform(raw):
    if not raw:
        return "Unknown"
    low = raw.lower().strip()
    for key, norm in PLATFORM_MAP.items():
        if key in low:
            return norm
    return raw.strip()

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}

def main():
    print("=" * 60)
    print("Daily Marketing Monitoring Report")
    print("Date: " + datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    print("=" * 60)

    state = load_state()
    headers = get_sheets_client()

    total_posts = 0
    status_counts = Counter()
    platform_counts = Counter()
    product_counts = Counter()
    approval_counts = Counter()
    tab_totals = {}

    for tab_name, approval_col, status_col, platform_col, id_col in CAMPAIGN_TABS:
        try:
            rows = read_sheet_range(headers, tab_name, "A2:M")
            tab_totals[tab_name] = len(rows)
            total_posts += len(rows)
            for row in rows:
                if not row:
                    continue
                content_id = row[id_col] if len(row) > id_col else ""
                platform_raw = row[platform_col] if len(row) > platform_col else ""
                approval = row[approval_col] if len(row) > approval_col else ""
                status = row[status_col] if len(row) > status_col else ""
                platform = normalize_platform(platform_raw)
                if platform == "Unknown":
                    platform = tab_name.replace("-campaign", "").replace("-", " ").title()
                if status:
                    status_counts[status] += 1
                if platform:
                    platform_counts[platform] += 1
                if content_id:
                    prefix = ""
                    for c in content_id:
                        if c.isalpha():
                            prefix += c
                        else:
                            break
                    if prefix:
                        product_counts[prefix] += 1
                if approval:
                    approval_counts[approval] += 1
        except Exception as e:
            tab_totals[tab_name] = "ERROR: " + str(e)

    print("\nTOTAL CONTENT: " + str(total_posts) + " rows across " + str(len(CAMPAIGN_TABS)) + " tabs")

    print("\n--- BY TAB ---")
    for tab, count in tab_totals.items():
        tag = "OK" if isinstance(count, int) else "ERR"
        print("  [" + tag + "] " + tab + ": " + str(count))

    print("\n--- BY STATUS ---")
    for status, count in status_counts.most_common():
        print("  " + status + ": " + str(count))

    print("\n--- BY PLATFORM ---")
    for platform, count in platform_counts.most_common():
        print("  " + platform + ": " + str(count))

    print("\n--- BY PRODUCT ---")
    for product, count in product_counts.most_common():
        print("  " + product + ": " + str(count))

    print("\n--- BY APPROVAL ---")
    for approval, count in approval_counts.most_common():
        print("  " + approval + ": " + str(count))

    print("\n" + "=" * 60)
    print("PIPELINE HEALTH CHECK")
    print("=" * 60)

    planned = status_counts.get("planned", 0) + status_counts.get("Planned", 0)
    replied = status_counts.get("Done", 0) + status_counts.get("Posted", 0)
    skipped = status_counts.get("Skipped", 0)
    rejected = status_counts.get("Rejected", 0)
    draft = status_counts.get("Draft", 0)

    print("  Planned (waiting): " + str(planned))
    print("  Draft: " + str(draft))
    print("  Done/Posted: " + str(replied))
    print("  Skipped: " + str(skipped))
    print("  Rejected: " + str(rejected))

    total_actionable = replied + skipped + rejected
    if total_actionable > 0:
        success_rate = (replied / total_actionable) * 100
        print("\n  Success Rate: " + "{:.1f}".format(success_rate) + "% (" + str(replied) + "/" + str(total_actionable) + ")")

    total_with_status = sum(status_counts.values())
    if total_with_status > 0:
        fill_pct = (planned / total_with_status) * 100
        print("  Pipeline Fill: " + "{:.1f}".format(fill_pct) + "% planned (" + str(planned) + "/" + str(total_with_status) + ")")

    campaigns = state.get("campaigns_generated", [])
    if campaigns:
        print("\nRECENT CAMPAIGNS GENERATED:")
        for c in campaigns[-5:]:
            print("  - " + c["product_id"] + ": " + str(c["rows_count"]) + " rows (" + c["generated_at"][:10] + ")")

    print("\n" + "=" * 60)
    print("RECOMMENDATIONS")
    print("=" * 60)

    if planned > 200:
        print("  HIGH BACKLOG: " + str(planned) + " planned. Post more frequently.")
    elif planned == 0 and total_posts > 0:
        print("  Pipeline is empty! Generate new content.")

    if total_actionable > 0:
        sr = (replied / total_actionable) * 100
        if sr < 50:
            print("  LOW SUCCESS RATE: " + "{:.1f}".format(sr) + "%. Review rejected/skipped items.")
        elif sr > 80:
            print("  GREAT SUCCESS RATE: " + "{:.1f}".format(sr) + "%. Keep the momentum.")

    error_tabs = [t for t, c in tab_totals.items() if isinstance(c, str) and "ERROR" in str(c)]
    if error_tabs:
        print("  Tab access errors: " + ", ".join(error_tabs))

    if not error_tabs and planned <= 200 and (total_actionable == 0 or ((replied / total_actionable) * 100 >= 50)):
        print("  All metrics look healthy. Keep going!")

    print("\n" + "=" * 60)
    print("PLATFORM BREAKDOWN (for daily-metrics)")
    print("=" * 60)
    for platform, count in platform_counts.most_common():
        print("  " + platform + ": " + str(count) + " content items tracked")

    print("\n" + "=" * 60)
    print("Report complete!")

if __name__ == "__main__":
    main()
