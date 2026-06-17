#!/usr/bin/env python3
"""Log BROWSE entries to Google Sheet."""
import gspread
from datetime import datetime, timezone

gc = gspread.service_account(filename="/home/agent/.config/gspread/service_account.json")
sh = gc.open_by_key("1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY")
ws = sh.worksheet("linkedin-campaign")

now = datetime.now(timezone.utc)
timestamp = now.strftime('%Y-%m-%d %H:%M:%S')
today = now.strftime('%Y-%m-%d')

# Find next BROWSE number for today
all_data = ws.get_all_values()
max_browse = 0
for row in all_data:
    cid = row[0] if row else ''
    if cid.startswith(f'BROWSE-{today}'):
        parts = cid.split('-')
        if len(parts) >= 5:
            try:
                num = int(parts[-1])
                if num > max_browse:
                    max_browse = num
            except:
                pass

print(f"Max BROWSE number for {today}: {max_browse}")

# Liked posts from this session
liked_posts = [
    {
        'num': max_browse + 1,
        'author': 'The Best of AI',
        'url': 'https://www.linkedin.com/feed/',
        'content': 'Liked: The Best of AI post about AI workflow tools and productivity'
    },
    {
        'num': max_browse + 2,
        'author': 'Natalie Barbu',
        'url': 'https://www.linkedin.com/feed/',
        'content': 'Liked: Natalie Barbu post (Content Creator + Founder, currently building Rella)'
    },
    {
        'num': max_browse + 3,
        'author': 'Thien Tran',
        'url': 'https://www.linkedin.com/feed/',
        'content': 'Liked: Thien Tran post (Fullstack Developer / DevOps / Cloud Engineer)'
    }
]

# Append BROWSE entries
rows_to_add = []
for p in liked_posts:
    content_id = f"BROWSE-{today}-{p['num']}"
    row = [
        content_id,           # A: ContentID
        'Browse+Like',        # B: ActionType
        'Feed',               # C: TargetType
        p['url'],             # D: TargetURL
        p['author'],          # E: TargetAuthor
        p['content'],         # F: Content
        '',                   # G: GuerillaTactic
        '',                   # H: Schedule
        timestamp,            # I: Last_Update
        '',                   # J: Approval
        'Active',             # K: Status
        'Duc Nguyen Xuan',    # L: Account
        f'BROWSE: Feed browsing - liked post by {p["author"]}'  # M: Agent_Notes
    ]
    rows_to_add.append(row)
    print(f"  Adding: {content_id} - {p['author']}")

# Append all rows at once
ws.append_rows(rows_to_add, value_input_option='USER_ENTERED')
print(f"\nSuccessfully added {len(rows_to_add)} BROWSE entries")
print(f"Timestamp: {timestamp}")
