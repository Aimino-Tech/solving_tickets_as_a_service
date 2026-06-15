import os
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request
import requests

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")

creds = Credentials.from_service_account_file(SA_PATH, scopes=[
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
])
creds.refresh(Request())
headers = {"Authorization": f"Bearer {creds.token}"}

# Read all "Replied" items
import urllib.parse
range_str = "guerrilla-content-plan!A2:M1200"
encoded_range = urllib.parse.quote(range_str)
url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
r = requests.get(url, headers=headers, timeout=30)
data = r.json()

rows = data.get("values", [])

# Analyze replied items
replied_items = []
for row in rows:
    if not row or len(row) < 10:
        continue
    
    content_id = row[0] if len(row) > 0 else ""
    status = row[9] if len(row) > 9 else ""
    platform_url = row[3] if len(row) > 3 else ""
    profile = row[10] if len(row) > 10 else ""
    notes = row[11] if len(row) > 11 else ""
    
    if "Replied" in status:
        replied_items.append({
            "id": content_id,
            "url": platform_url,
            "profile": profile,
            "notes": notes,
            "has_comment_url": "comment" in platform_url.lower() or "permalink" in platform_url.lower()
        })

print(f"📊 Reply Analysis")
print(f"{'=' * 60}")
print(f"Total 'Replied' items: {len(replied_items)}")
print(f"With comment URL: {sum(1 for i in replied_items if i['has_comment_url'])}")
print(f"Without comment URL: {sum(1 for i in replied_items if not i['has_comment_url'])}")

# Check profiles
from collections import Counter
profile_counts = Counter(i['profile'] for i in replied_items if i['profile'])
print(f"\nBy Profile:")
for profile, count in profile_counts.most_common():
    print(f"  {profile}: {count}")

# Check which profiles have more items without URLs
print(f"\n⚠️  Items WITHOUT comment URL by Profile:")
no_url_by_profile = Counter()
for item in replied_items:
    if not item['has_comment_url'] and item['profile']:
        no_url_by_profile[item['profile']] += 1

for profile, count in no_url_by_profile.most_common():
    print(f"  {profile}: {count} items")

# Show some examples
print(f"\n🔍 Examples of items without comment URL:")
count = 0
for item in replied_items:
    if not item['has_comment_url']:
        count += 1
        if count <= 5:
            print(f"  {item['id']}: {item['url'][:60]}...")
