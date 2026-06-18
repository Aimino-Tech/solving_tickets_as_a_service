#!/usr/bin/env python3
"""Check Twitter campaign sheet for reply URLs."""
import gspread, json, os

paths = [
    os.path.expanduser('~/.config/gspread/service_account.json'),
    os.path.expanduser('~/Documents/hermes-agent/service-account-key.json'),
    '/home/agent/.config/gspread/service_account.json',
    '/home/agent/Documents/hermes-agent/service-account-key.json'
]
creds_file = None
for p in paths:
    if os.path.exists(p):
        creds_file = p
        break
print('Using creds:', creds_file)

if not creds_file:
    print('No service account found')
    exit()

gc = gspread.service_account(filename=creds_file)
sheet = gc.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY')
worksheets = sheet.worksheets()
print('Worksheets:', [w.title for w in worksheets])

ws = sheet.worksheet('twitter-campaign')
data = ws.get_all_values()
print('\ntwitter-campaign rows:', len(data))
print('Headers:', data[0])
for row in data[1:]:
    print(row)
