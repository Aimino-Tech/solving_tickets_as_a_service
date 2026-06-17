#!/usr/bin/env python3
"""Add session summary to Google Sheet."""
import gspread
from datetime import datetime, timezone

gc = gspread.service_account(filename="/home/agent/.config/gspread/service_account.json")
sh = gc.open_by_key("1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY")
ws = sh.worksheet("linkedin-campaign")

now = datetime.now(timezone.utc)
timestamp = now.strftime('%Y-%m-%d %H:%M:%S')

# Add session summary row
row = [
    'SESSION-2026-06-16-3',        # A: ContentID
    'Session Summary',              # B: ActionType
    '',                             # C: TargetType
    '',                             # D: TargetURL
    '',                             # E: TargetAuthor
    '',                             # F: Content
    '',                             # G: GuerillaTactic
    '',                             # H: Schedule
    timestamp,                      # I: Last_Update
    '',                             # J: Approval
    'Active',                       # K: Status
    '',                             # L: Account
    'LinkedIn cron session: 0 eligible Draft+Approved items (all blocked by Needs Review/Draft approval or placeholder URLs). Browsed feed and liked 3 posts.'  # M: Agent_Notes
]

ws.append_rows([row], value_input_option='RAW')
print(f"Session summary added at {timestamp}")
