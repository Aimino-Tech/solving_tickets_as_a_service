import os
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request
from datetime import datetime
import requests

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")

creds = Credentials.from_service_account_file(SA_PATH, scopes=[
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
])
creds.refresh(Request())
headers = {"Authorization": f"Bearer {creds.token}"}

# OT2H marketplace data
ot2h_data = [
    ["GitHub", "https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD", "https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD", "✅ PUBLISHED", datetime.now().strftime("%Y-%m-%d"), "Public", "6 stars, 0 forks"],
    ["npm", "https://www.npmjs.com/package/@aimino/opentalk2html-notmd", "https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD", "✅ PUBLISHED v0.1.2", datetime.now().strftime("%Y-%m-%d"), "npm publish", "Package: @aimino/opentalk2html-notmd"],
    ["PyPI", "https://pypi.org/project/opentalk2html-notmd/", "https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD", "❌ NOT PUBLISHED", datetime.now().strftime("%Y-%m-%d"), "uv publish", "Needs to be published"],
    ["MCP Servers", "https://mcpservers.org/", "https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD", "❌ NOT FOUND", datetime.now().strftime("%Y-%m-%d"), "Auto-indexed", "Needs submission"],
    ["MCP.so", "https://mcp.so/", "https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD", "❌ NOT FOUND", datetime.now().strftime("%Y-%m-%d"), "Submit via website", "Needs submission"],
    ["Smithery", "https://smithery.ai/", "https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD", "❌ NOT FOUND", datetime.now().strftime("%Y-%m-%d"), "Auto-indexed from GitHub", "Needs smithery.yaml"],
    ["Glama.ai", "https://glama.ai/mcp/servers", "https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD", "❌ NOT FOUND", datetime.now().strftime("%Y-%m-%d"), "Submit via website", "Needs submission"],
]

# Find next empty row
import urllib.parse
range_str = "Public-marketplaces!A1:A100"
encoded_range = urllib.parse.quote(range_str)
url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
r = requests.get(url, headers=headers, timeout=30)
data = r.json()

rows = data.get("values", [])
next_row = len(rows) + 1

print(f"Adding OT2H data starting at row {next_row}")

# Write data
range_str = f"Public-marketplaces!A{next_row}:G{next_row + len(ot2h_data) - 1}"
encoded_range = urllib.parse.quote(range_str)
url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
body = {"values": ot2h_data}
r = requests.put(url, headers=headers, json=body, params={"valueInputOption": "USER_ENTERED"}, timeout=30)
r.raise_for_status()

print(f"✅ Added {len(ot2h_data)} rows for OT2H to Public-marketplaces sheet")
