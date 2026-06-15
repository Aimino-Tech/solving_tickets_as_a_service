import gspread
from google.oauth2.service_account import Credentials
import json

sa = Credentials.from_service_account_file("service-account-key.json", scopes=["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"])
gc = gspread.authorize(sa)
sh = gc.open_by_key("1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY")

sheets_config = {
    "reddit-campaign": {"url_col": 3, "content_col": 5, "id_col": 0},
    "threads-campaign": {"url_col": 9, "content_col": 2, "id_col": 1},
    "instagram-campaign": {"url_col": 9, "content_col": 2, "id_col": 1},
    "twitter-campaign": {"url_col": 3, "content_col": 5, "id_col": 0},
    "linkedin-campaign": {"url_col": 3, "content_col": 5, "id_col": 0},
    "discord-campaign": {"url_col": 3, "content_col": 5, "id_col": 0},
    "hacker-news-campaign": {"url_col": 3, "content_col": 5, "id_col": 0},
}

grand_total = 0
for sheet_name, cfg in sheets_config.items():
    try:
        ws = sh.worksheet(sheet_name)
        all_data = ws.get_all_values()
        problems = []
        for i, row in enumerate(all_data[1:], 2):
            content = row[cfg["content_col"]].strip() if len(row) > cfg["content_col"] else ""
            url = row[cfg["url_col"]].strip() if len(row) > cfg["url_col"] else ""
            rid = row[cfg["id_col"]].strip() if len(row) > cfg["id_col"] else ""
            if content and not url and rid:
                problems.append({"row": i, "id": rid, "content_preview": content[:60]})
        if problems:
            print(f"\n🔴 {sheet_name}: {len(problems)} rows với content NHƯNG KHÔNG có PlatformURL")
            for p in problems[:5]:
                print(f"   Row {p['row']}: {p['id']} — {p['content_preview']}")
            if len(problems) > 5:
                print(f"   ... và {len(problems)-5} rows nữa")
            grand_total += len(problems)
        else:
            print(f"\n✅ {sheet_name}: OK — tất cả rows có content đều có PlatformURL")
    except Exception as e:
        print(f"\n⚠️ {sheet_name}: Lỗi — {e}")

print(f"\n{'='*60}")
print(f"TỔNG CỘNG: {grand_total} rows vi phạm PlatformURL")
