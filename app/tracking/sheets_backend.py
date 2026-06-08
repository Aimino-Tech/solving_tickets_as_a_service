"""Google Sheets backend for tracker records.

Writes every action as a row into the worksheet **07-openclaw-action-log**
of the target spreadsheet.

Supports two authentication methods (checked in order):

1. **OAuth** (recommended for personal Google accounts)
   - Run ``python -m app.tracking.setup_gsheets_oauth`` once
   - Authorizes via browser → saves refresh token to ``~/.openclaw/gsheets_token.json``
   - Token auto-refreshes on expiry — zero maintenance after first setup

2. **Service Account** (fallback, better for CI/headless)
   - Set ``GOOGLE_SHEETS_CREDENTIALS`` env var pointing to a service-account JSON
   - Service account email must be granted Editor access on the spreadsheet
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

TOKEN_FILE = Path.home() / ".openclaw" / "gsheets_token.json"
SPREADSHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
WORKSHEET_NAME = "07-openclaw-action-log"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

UNIFIED_HEADERS = [
    "id",
    "type",
    "timestamp",
    "campaign",
    "platform",
    "action",
    "target_url",
    "content_preview",
    "score",
    "status",
    "source_url",
    "author_name",
    "author_handle",
    "content_snippet",
    "relevance_score",
    "sentiment",
    "opportunity_score",
    "urgency",
    "day",
    "task_key",
    "content_file",
    "directory",
    "method",
    "url",
    "error",
    "github_stars",
    "npm_weekly_downloads",
    "raw_data",
    "phases",
]


class GoogleSheetsBackend:
    """Pushes every tracked action as a row to ``07-openclaw-action-log``."""

    def __init__(self):
        self._gc: Any = None
        self._sh: Any = None
        self._ws: Any = None

    def ensure_ready(self) -> bool:
        """Lazy-init the gspread client. Returns True if sheets are active."""
        if self._ws is not None:
            return True
        try:
            import gspread
        except ImportError:
            return False

        creds = self._load_credentials()
        if not creds:
            return False

        try:
            self._gc = gspread.authorize(creds)
            self._sh = self._gc.open_by_key(SPREADSHEET_ID)
            self._ws = self._get_or_create_worksheet()
            return True
        except Exception as exc:
            print(f"[tracking] Google Sheets init failed: {exc}", file=sys.stderr)
            return False

    def _load_credentials(self) -> Optional[Any]:
        """Try OAuth token first, then service account env var."""
        creds = self._try_oauth_token()
        if creds:
            return creds
        return self._try_service_account()

    def _try_oauth_token(self) -> Optional[Any]:
        if not TOKEN_FILE.exists():
            return None
        try:
            import google.auth.transport.requests
            from google.oauth2.credentials import Credentials

            creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(google.auth.transport.requests.Request())
                TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
                TOKEN_FILE.write_text(creds.to_json())
            return creds
        except Exception as exc:
            print(f"[tracking] OAuth token refresh failed: {exc}", file=sys.stderr)
            return None

    def _try_service_account(self) -> Optional[Any]:
        creds_path = os.environ.get("GOOGLE_SHEETS_CREDENTIALS")
        if not creds_path:
            return None
        try:
            from google.oauth2.service_account import Credentials
            return Credentials.from_service_account_file(creds_path, scopes=SCOPES)
        except Exception as exc:
            print(f"[tracking] Service account auth failed: {exc}", file=sys.stderr)
            return None

    def _get_or_create_worksheet(self):
        """Find ``07-openclaw-action-log`` or create it with headers."""
        try:
            ws = self._sh.worksheet(WORKSHEET_NAME)
            return ws
        except Exception:
            ws = self._sh.add_worksheet(title=WORKSHEET_NAME, rows=1000, cols=30)
            ws.append_rows([UNIFIED_HEADERS], value_input_option="RAW")
            return ws

    def append_record(self, record: dict):
        if not self.ensure_ready():
            return

        try:
            row = [str(record.get(h, "")) for h in UNIFIED_HEADERS]
            self._ws.append_row(row, value_input_option="RAW")
        except Exception as exc:
            print(f"[tracking] Sheets append failed: {exc}", file=sys.stderr)
