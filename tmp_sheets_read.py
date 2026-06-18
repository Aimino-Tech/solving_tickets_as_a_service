import gspread
import json

sa = gspread.service_account(filename="/home/agent/.config/gspread/service_account.json")
sheet = sa.open_by_key("1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY")

# List all worksheets
worksheets = sheet.worksheets()
print("Worksheets:", [ws.title for ws in worksheets])

# Read twitter-campaign sheet
try:
    ws = sheet.worksheet("twitter-campaign")
    data = ws.get_all_values()
    print("\n--- twitter-campaign ---")
    for i, row in enumerate(data):
        print(f"Row {i+1}: {row}")
except Exception as e:
    print(f"Error reading twitter-campaign: {e}")

# Check if twitter-engagement sheet exists
try:
    ws_eng = sheet.worksheet("twitter-engagement")
    eng_data = ws_eng.get_all_values()
    print("\n--- twitter-engagement (existing) ---")
    for i, row in enumerate(eng_data):
        print(f"Row {i+1}: {row}")
except gspread.exceptions.WorksheetNotFound:
    print("\ntwitter-engagement sheet does not exist yet")
except Exception as e:
    print(f"Error reading twitter-engagement: {e}")
