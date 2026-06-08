"""One-time OAuth setup for Google Sheets access.

Run this once::

    python -m app.tracking.setup_gsheets_oauth

It will:
  1. Open your browser to grant Openclaw access to your Google Sheets.
  2. Save the refresh token to ``~/.openclaw/gsheets_token.json``.
  3. From then on the tracker will auto-refresh the token — no further action needed.

Prerequisites::

    pip install gspread google-auth google-auth-oauthlib
"""

from __future__ import annotations

import sys
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

TOKEN_FILE = Path.home() / ".openclaw" / "gsheets_token.json"
CLIENT_SECRET_FILE = Path.home() / ".openclaw" / "client_secret.json"


def main():
    token_dir = TOKEN_FILE.parent
    token_dir.mkdir(parents=True, exist_ok=True)

    if not CLIENT_SECRET_FILE.exists():
        print("=" * 60)
        print("Google OAuth Setup — Step 1: Create OAuth credentials")
        print("=" * 60)
        print()
        print("You need a Google Cloud OAuth 2.0 Client ID (Desktop app type).")
        print()
        print("1. Go to: https://console.cloud.google.com/apis/credentials")
        print("2. Click  + CREATE CREDENTIALS  →  OAuth client ID")
        print("3. Application type:  Desktop app")
        print("4. Name:  Openclaw Tracking")
        print("5. Click  CREATE")
        print("6. Click  DOWNLOAD JSON  (the download button next to your new client)")
        print(f"7. Save the file as:\n")
        print(f"       {CLIENT_SECRET_FILE}")
        print()
        print("Then run this script again.")
        print()
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET_FILE), SCOPES)
    creds = flow.run_local_server(port=0)

    TOKEN_FILE.write_text(creds.to_json())
    print(f"\n✅ OAuth token saved to {TOKEN_FILE}")
    print("The tracker will now auto-authenticate to Google Sheets.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
