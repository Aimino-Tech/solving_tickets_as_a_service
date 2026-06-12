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

from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

TOKEN_FILE = Path.home() / ".openclaw" / "gsheets_token.json"
SPREADSHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
WORKSHEET_NAME = "07-openclaw-action-log"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

# Maximum cell length for Google Sheets cells to avoid truncation errors.
# Google Sheets cells have a 50,000-character limit; values beyond this
# cause write failures or silent truncation.
MAX_CELL_LENGTH = 50000

# Retry configuration for transient Google Sheets API errors.
MAX_RETRIES = 5
RETRY_BASE_DELAY = 1.0

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
    "content_overflow",
]


def _truncate_content(value: str, max_len: int = MAX_CELL_LENGTH) -> str:
    """Truncate a string value to fit within *max_len* characters.

    If the value exceeds *max_len*, the trailing portion is replaced with a
    note indicating the original length so readers know data was removed.

    Returns the (possibly truncated) string.
    """
    if len(value) <= max_len:
        return value
    note = f"... [TRUNCATED: {len(value)} chars]"
    available = max_len - len(note) - 1
    if available < 0:
        # The note itself is longer than max_len — just hard cut
        return value[:max_len]
    return f"{value[:available]} {note}"


def _chunk_large_content(
    content: str, chunk_size: int = MAX_CELL_LENGTH
) -> list[str]:
    """Split *content* into a list of strings each at most *chunk_size* chars.

    Useful for distributing very long text across multiple cells or rows.
    Empty content returns one empty chunk.
    """
    if not content:
        return [""]
    return [content[i : i + chunk_size] for i in range(0, len(content), chunk_size)]


def _is_retryable_error(exc: Exception) -> bool:
    """Check if an exception from the Google Sheets API is likely transient.

    Retryable patterns: HTTP 429 (rate limit), 5xx (server error),
    connection timeouts, and quota-exceeded messages.
    """
    msg = str(exc).lower()
    # Non-retryable first
    if any(code in msg for code in ("401", "403", "404")):
        return False
    # Retryable
    if any(pattern in msg for pattern in ("429", "500", "503", "timeout", "timed out", "quota")):
        return True
    return False


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

    def _append_row_with_retry(self, row: list[Any]) -> None:
        """Append a row with exponential-backoff retry for transient errors.

        Retries up to *MAX_RETRIES* times on retryable errors (rate limits,
        server errors, timeouts). Non-retryable errors (auth, not-found)
        are raised immediately.
        """
        last_exc: Exception | None = None
        for attempt in range(MAX_RETRIES):
            try:
                self._ws.append_row(row, value_input_option="RAW")
                return
            except Exception as exc:
                last_exc = exc
                if not _is_retryable_error(exc):
                    raise
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        "[tracking] Retryable error on attempt %d/%d: %s. Retrying in %.1fs",
                        attempt + 1,
                        MAX_RETRIES,
                        exc,
                        delay,
                    )
                    time.sleep(delay)
        raise last_exc  # type: ignore[misc]

    def append_record(self, record: dict):
        """Append a tracked record to the worksheet.

        If any field value exceeds *MAX_CELL_LENGTH*, the content is split
        into chunks. The first chunk stays in the base row and subsequent
        chunks are written as overflow rows. The ``content_overflow`` column
        is set to ``"TRUE"`` on the base row when overflow occurs.
        """
        if not self.ensure_ready():
            return

        try:
            # Build base row from all headers except content_overflow
            base_row = [str(record.get(h, "")) for h in UNIFIED_HEADERS[:-1]]
            overflow_fields: dict[int, list[str]] = {}

            for i, val in enumerate(base_row):
                if len(val) > MAX_CELL_LENGTH:
                    chunks = _chunk_large_content(val, MAX_CELL_LENGTH)
                    base_row[i] = chunks[0]  # first chunk stays in base row
                    overflow_fields[i] = chunks[1:]  # remainder → overflow rows
                    logger.warning(
                        "[tracking] Field '%s' overflows (%d chars, %d chunks)",
                        UNIFIED_HEADERS[i],
                        len(val),
                        len(chunks),
                    )

            if overflow_fields:
                base_row.append("TRUE")
            else:
                base_row.append("")

            # Write base row
            self._append_row_with_retry(base_row)

            # Write overflow rows — one per chunk across all overflowing fields
            field_names = {
                idx: UNIFIED_HEADERS[idx] for idx in overflow_fields
            }

            # Determine max overflow depth across all fields
            max_depth = max((len(chunks) for chunks in overflow_fields.values()), default=0)

            for depth in range(max_depth):
                overflow_row = [""] * len(UNIFIED_HEADERS)
                overflow_row[0] = f"overflow-{record.get('id', 'unknown')}-chunk-{depth + 1}"
                overflow_row[1] = "overflow"
                overflow_parts = []
                for idx in overflow_fields:
                    chunks = overflow_fields[idx]
                    if depth < len(chunks):
                        overflow_row[idx] = chunks[depth]
                        overflow_parts.append(
                            f"{field_names[idx]}:chunk_{depth + 1}_of_{len(chunks)}"
                        )
                if overflow_parts:
                    overflow_row[UNIFIED_HEADERS.index("content_overflow")] = "; ".join(overflow_parts)
                self._append_row_with_retry(overflow_row)

        except Exception as exc:
            print(f"[tracking] Sheets append failed: {exc}", file=sys.stderr)
