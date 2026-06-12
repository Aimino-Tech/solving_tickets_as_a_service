"""Bidirectional Google Sheet ↔ SQLite sync for guerrilla marketing campaigns.

Uses the same Google Sheets REST API pattern as
``cron/hermes_marketing_check.py`` — ``urllib`` + ``google.auth``, no
``gspread`` dependency.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from google.auth.transport.requests import Request as AuthRequest
from google.oauth2.service_account import Credentials

from marketing.store import CampaignStore

logger = logging.getLogger(__name__)

# ── Sheet column indices (guerrilla-content-plan, 0-indexed) ──
# Matching cron/hermes_marketing_check.py constants exactly.
COL_CONTENT_ID = 0
COL_ACTION_TYPE = 1
COL_PLATFORM = 2
COL_PLATFORM_URL = 3
COL_TACTIC = 4
COL_CONTENT = 5
COL_SCHEDULE = 6
COL_LAST_UPDATE = 7
COL_APPROVAL = 8
COL_STATUS = 9
COL_PROFILE = 10
COL_AGENT_NOTES = 11
COL_HUMAN_NOTES = 12

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")

# Sentinel campaign ID for sheet-originated actions that don't belong to
# an existing tracked campaign.
_DEFAULT_CAMPAIGN_ID = "guerrilla-content-plan"


# ── helpers ─────────────────────────────────────────────────────────────────


def _now() -> str:
    """Return current UTC timestamp as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _content_id_from_action(action: dict[str, Any]) -> str:
    """Generate a stable ContentID string for a CampaignStore action."""
    return f"ODA{action['id']:06d}"


def _action_id_from_content_id(content_id: str) -> int | None:
    """Extract the action ID from a ContentID like ``ODA000042``.

    Returns ``None`` if the prefix doesn't match or the suffix isn't numeric.
    """
    if content_id.startswith("ODA") and len(content_id) > 3:
        suffix = content_id[3:]
        try:
            return int(suffix)
        except ValueError:
            return None
    return None


def _ensure_marketing_campaign(store: CampaignStore) -> str:
    """Return the default marketing campaign ID, creating it if missing.

    ``CampaignStore.create_campaign`` auto-generates a random UUID, so we
    search by name to find existing campaigns and fall back to listing all
    campaigns after creating a new one.
    """
    # First try direct lookup by sentinel ID
    existing = store.get_campaign(_DEFAULT_CAMPAIGN_ID)
    if existing:
        return existing["id"]

    # Search by name across all campaigns
    all_camps = store.list_campaigns()
    for camp in all_camps:
        if camp.get("name") == "Guerrilla Content Plan":
            return camp["id"]

    # Create a new campaign
    store.create_campaign({
        "name": "Guerrilla Content Plan",
        "product": "OpenTalk2HTML-NotMD",
        "start_date": _now()[:10],
    })

    # Find the newly created campaign by name
    all_camps = store.list_campaigns()
    for camp in all_camps:
        if camp.get("name") == "Guerrilla Content Plan":
            return camp["id"]

    # Fallback: return sentinel (will fail with FK constraint, but caller
    # will see a clear error)
    return _DEFAULT_CAMPAIGN_ID


# ── Sheet header ─────────────────────────────────────────────────────────────

_HEADER_ROW = [
    "ContentID",
    "ActionType",
    "Platform",
    "PlatformURL",
    "GuerillaTactic",
    "Content",
    "Schedule",
    "Last_Update",
    "Approval",
    "Status",
    "Chrome_Profile",
    "Agent's Notes",
    "Human's Notes",
]


# ═══════════════════════════════════════════════════════════════════════════════
#  SheetSync
# ═══════════════════════════════════════════════════════════════════════════════


class SheetSync:
    """Bidirectional sync between a Google Sheet and the SQLite CampaignStore.

    Thread-safe (uses ``threading.Lock`` internally for write operations).
    """

    def __init__(self, sheet_id: str, store: CampaignStore) -> None:
        self._sheet_id = sheet_id
        self._store = store
        self._lock = threading.Lock()

    # ── Sheet I/O helpers ──────────────────────────────────────────────────

    @staticmethod
    def _get_creds() -> Credentials:
        """Return fresh Google Sheets API credentials."""
        creds = Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
        auth_req = AuthRequest()
        creds.refresh(auth_req)
        return creds

    def _read_sheet(
        self, sheet_tab: str
    ) -> tuple[list[list[str]], list[str] | None]:
        """Read all rows from *sheet_tab*.

        Returns ``(data_rows, header_row)`` where *data_rows* excludes the
        header.
        """
        creds = self._get_creds()
        headers = {"Authorization": f"Bearer {creds.token}"}
        url = (
            f"https://sheets.googleapis.com/v4/spreadsheets/{self._sheet_id}"
            f"/values/{sheet_tab}!A:M"
        )
        req = Request(url, headers=headers)
        resp = urlopen(req, timeout=30)
        data = json.loads(resp.read())
        rows = data.get("values", [])
        if not rows:
            return [], None
        return rows[1:], rows[0]

    def _write_sheet(
        self, sheet_tab: str, rows: list[list[str]]
    ) -> None:
        """Overwrite *sheet_tab* with *rows* (includes header row).

        Uses PUT (``values.update``) to replace the entire data range.
        """
        creds = self._get_creds()
        headers = {
            "Authorization": f"Bearer {creds.token}",
            "Content-Type": "application/json",
        }
        body = json.dumps({"values": rows})
        range_end = self._column_letter(len(rows[0])) + str(len(rows))
        url = (
            f"https://sheets.googleapis.com/v4/spreadsheets/{self._sheet_id}"
            f"/values/{sheet_tab}!A1:{range_end}"
            "?valueInputOption=USER_ENTERED"
        )
        req = Request(
            url, data=body.encode(), headers=headers, method="PUT"
        )
        urlopen(req, timeout=30)

    @staticmethod
    def _column_letter(n: int) -> str:
        """Convert a 1-based column index to a spreadsheet column letter (A, B, … Z, AA, …)."""
        result = ""
        while n > 0:
            n -= 1
            result = chr(ord("A") + n % 26) + result
            n //= 26
        return result or "A"

    # ── Row conversion ─────────────────────────────────────────────────────

    @staticmethod
    def _action_to_row(action: dict[str, Any]) -> list[str]:
        """Convert a CampaignStore action dict to a sheet row (13 columns)."""
        content_id = _content_id_from_action(action) if action.get("id") else ""
        return [
            content_id,
            action.get("action_type", ""),
            action.get("platform", ""),
            action.get("target_url", "") or "",
            "",  # GuerillaTactic
            action.get("content_preview", "") or "",
            "",  # Schedule
            "",  # Last_Update
            "",  # Approval
            action.get("status", "pending"),
            action.get("profile_name", "") or "",
            "",  # Agent's Notes
            "",  # Human's Notes
        ]

    @staticmethod
    def _row_to_action(row: list[str]) -> dict[str, str]:
        """Convert a sheet row to a flat dict matching action fields."""
        return {
            "content_id": row[COL_CONTENT_ID] if len(row) > COL_CONTENT_ID else "",
            "action_type": row[COL_ACTION_TYPE] if len(row) > COL_ACTION_TYPE else "",
            "platform": row[COL_PLATFORM] if len(row) > COL_PLATFORM else "",
            "target_url": row[COL_PLATFORM_URL] if len(row) > COL_PLATFORM_URL else "",
            "tactic": row[COL_TACTIC] if len(row) > COL_TACTIC else "",
            "content_preview": row[COL_CONTENT] if len(row) > COL_CONTENT else "",
            "schedule": row[COL_SCHEDULE] if len(row) > COL_SCHEDULE else "",
            "last_update": row[COL_LAST_UPDATE] if len(row) > COL_LAST_UPDATE else "",
            "approval": row[COL_APPROVAL] if len(row) > COL_APPROVAL else "",
            "status": row[COL_STATUS] if len(row) > COL_STATUS else "pending",
            "profile_name": row[COL_PROFILE] if len(row) > COL_PROFILE else "",
            "agent_notes": row[COL_AGENT_NOTES] if len(row) > COL_AGENT_NOTES else "",
            "human_notes": row[COL_HUMAN_NOTES] if len(row) > COL_HUMAN_NOTES else "",
        }

    # ── Public API ─────────────────────────────────────────────────────────

    def push_to_sheet(
        self, sheet_tab: str = "guerrilla-content-plan"
    ) -> dict[str, Any]:
        """Push CampaignStore actions to the Google Sheet.

        Reads all pending/active actions from the store, merges them with
        existing sheet rows (matched by ContentID), and writes everything
        back.  New actions are appended; existing ones are updated in place.

        Returns a stats dict with keys ``status``, ``pushed``, ``updated``,
        ``new``, and ``total_actions``.
        """
        # 1. Collect actions from active campaigns
        campaigns = self._store.list_campaigns()
        if not campaigns:
            return {"status": "no_campaigns", "pushed": 0}

        all_actions: list[dict[str, Any]] = []
        for camp in campaigns:
            actions = self._store.get_actions(camp["id"])
            all_actions.extend(actions)

        if not all_actions:
            return {"status": "no_actions", "pushed": 0}

        with self._lock:
            # 2. Read existing sheet rows
            rows, _headers = self._read_sheet(sheet_tab)
            existing_rows: list[list[str]] = list(rows)

            # Build index of existing rows by ContentID
            existing_by_cid: dict[str, int] = {}
            for i, row in enumerate(existing_rows):
                cid = (
                    row[COL_CONTENT_ID]
                    if len(row) > COL_CONTENT_ID and row[COL_CONTENT_ID].strip()
                    else ""
                )
                if cid:
                    existing_by_cid[cid] = i

            # 3. Merge: update matching rows, collect new rows
            updated = 0
            new_rows: list[list[str]] = []

            # Track which existing row indices have been claimed
            claimed: set[int] = set()

            # Pass 1 — match by ODA ContentID (most specific)
            for action in all_actions:
                expected_cid = _content_id_from_action(action)
                row_data = self._action_to_row(action)

                if expected_cid in existing_by_cid:
                    idx = existing_by_cid[expected_cid]
                    claimed.add(idx)
                    existing_rows[idx] = row_data
                    updated += 1
                else:
                    new_rows.append((action, row_data))

            # Pass 2 — for unmatched actions, try matching by content fields
            # against remaining existing rows (handles non-ODA rows)
            still_new: list[list[str]] = []
            for action, row_data in new_rows:
                matched = False
                for i, row in enumerate(existing_rows):
                    if i in claimed:
                        continue
                    row_cp = (
                        row[COL_CONTENT].strip().lower()
                        if len(row) > COL_CONTENT and row[COL_CONTENT].strip()
                        else ""
                    )
                    action_cp = (action.get("content_preview") or "").strip().lower()
                    if row_cp and row_cp == action_cp:
                        claimed.add(i)
                        existing_rows[i] = row_data
                        updated += 1
                        matched = True
                        break
                if not matched:
                    still_new.append(row_data)

            # Pass 3 — truly new rows (no match at all)

            # 4. Assemble final data (header + existing rows + new rows)
            all_data = [_HEADER_ROW] + existing_rows + still_new

            # 5. Write back
            self._write_sheet(sheet_tab, all_data)

        return {
            "status": "ok",
            "pushed": len(existing_rows) + len(still_new),
            "updated": updated,
            "new": len(still_new),
            "total_actions": len(all_actions),
        }

    def pull_from_sheet(
        self, sheet_tab: str = "guerrilla-content-plan"
    ) -> dict[str, Any]:
        """Pull Google Sheet rows into the CampaignStore.

        Reads all rows from *sheet_tab*.  Rows whose ContentID matches an
        existing action (ODA-prefixed) update that action's status.
        Unrecognised rows are inserted as new actions under the default
        guerrilla campaign.

        Returns a stats dict with keys ``status``, ``read``, ``updated``,
        ``inserted``, and ``skipped``.
        """
        with self._lock:
            rows, _headers = self._read_sheet(sheet_tab)

        if not rows:
            return {"status": "no_rows", "read": 0}

        # Ensure a default campaign exists for sheet-originated actions
        campaign_id = _ensure_marketing_campaign(self._store)

        stats: dict[str, int] = {"read": len(rows), "updated": 0, "inserted": 0, "skipped": 0}

        for row in rows:
            if len(row) < 1 or not row[COL_CONTENT_ID].strip():
                stats["skipped"] += 1
                continue

            parsed = self._row_to_action(row)
            content_id = parsed.get("content_id", "")

            # Try to match to an existing action by ContentID
            action_id = _action_id_from_content_id(content_id)
            existing_action: dict[str, Any] | None = None
            if action_id is not None:
                # Look up by raw ID across all campaigns
                existing_action = self._find_action_by_id(action_id)

            # Fallback: match by content_preview + platform if ContentID
            # is not ODA-prefixed or direct lookup failed
            if existing_action is None and parsed.get("content_preview"):
                existing_action = self._find_action_by_content(
                    platform=parsed.get("platform", ""),
                    content_preview=parsed.get("content_preview", ""),
                )

            if existing_action is not None:
                # Update existing action status.
                # Use the matched action's real ID (not the parsed
                # ContentID, which may be None for fallback matches).
                matched_id = existing_action.get("id") or action_id
                if matched_id is not None:
                    self._store.update_action(
                        matched_id,
                        status=parsed.get("status", "pending"),
                        profile_name=parsed.get("profile_name", ""),
                        target_url=parsed.get("target_url", ""),
                    )
                stats["updated"] += 1
            else:
                # Insert as a new action
                self._store.log_action(
                    campaign_id=campaign_id,
                    platform=parsed.get("platform", "reddit"),
                    action_type=parsed.get("action_type", "comment"),
                    target_url=parsed.get("target_url"),
                    content_preview=parsed.get("content_preview", ""),
                    status=parsed.get("status", "pending"),
                    profile_name=parsed.get("profile_name"),
                )
                stats["inserted"] += 1

        stats["status"] = "ok"
        return stats

    def sync_bidirectional(
        self, sheet_tab: str = "guerrilla-content-plan"
    ) -> dict[str, Any]:
        """Two-way merge: pull sheet → DB, then push DB → sheet.

        The pull phase imports new rows from the sheet into the CampaignStore.
        The push phase writes all store actions back to the sheet (updating
        matching rows and appending new ones).  This converges both sources
        to the same set of actions.

        Returns a dict with ``pull`` and ``push`` sub-dicts.
        """
        pull_result = self.pull_from_sheet(sheet_tab=sheet_tab)
        push_result = self.push_to_sheet(sheet_tab=sheet_tab)
        return {
            "status": "ok",
            "pull": pull_result,
            "push": push_result,
        }

    # ── Internal helpers ──────────────────────────────────────────────────

    def _find_action_by_id(
        self, action_id: int
    ) -> dict[str, Any] | None:
        """Return an action dict by its primary key across all campaigns."""
        campaigns = self._store.list_campaigns()
        for camp in campaigns:
            actions = self._store.get_actions(camp["id"])
            for a in actions:
                if a.get("id") == action_id:
                    return a
        return None

    def _find_action_by_content(
        self, platform: str, content_preview: str
    ) -> dict[str, Any] | None:
        """Return the first action matching *platform* + *content_preview*.

        This is a fallback lookup for sheet rows whose ContentID is not
        ODA-prefixed (e.g. manually-entered rows).
        """
        if not content_preview or not platform:
            return None
        campaigns = self._store.list_campaigns()
        cp_stripped = content_preview.strip().lower()
        for camp in campaigns:
            actions = self._store.get_actions(camp["id"])
            for a in actions:
                existing_cp = (a.get("content_preview") or "").strip().lower()
                if a.get("platform") == platform and existing_cp == cp_stripped:
                    return a
        return None
