import gspread

gc = gspread.service_account(filename='/home/agent/.config/gspread/service_account.json')
sheet = gc.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY')
ws = sheet.worksheet('linkedin-campaign')

# Check rows 45-50 full URLs
for row_num in range(45, 51):
    row = ws.row_values(row_num)
    content_id = row[0] if len(row) > 0 else ""
    target_url = row[3] if len(row) > 3 else ""
    content = row[5] if len(row) > 5 else ""
    account = row[11] if len(row) > 11 else ""
    print(f"Row {row_num} ({content_id}):")
    print(f"  URL: {target_url}")
    print(f"  Account: {account}")
    print(f"  Content: {content[:200]}")
    print()
