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

# ── All tracked sheet tabs ────────────────────────────────────────────────────
# Each entry is (tab_name, column_range).
_ALL_TABS: list[tuple[str, str]] = [
    ("reddit-campaign",         "A:T"),   # 20 cols — has ProductID at index 1, up to Reply_Status
    ("project-overview",        "A:L"),   # 12 cols
    ("twitter-campaign",        "A:P"),   # 16 cols — has ProductID at index 1
    ("linkedin-campaign",       "A:P"),   # 16 cols — has ProductID at index 1
    ("hacker-news-campaign",    "A:N"),   # 14 cols — has ProductID at index 1
    ("discord-campaign",        "A:N"),   # 14 cols — has ProductID at index 1
    ("instagram-campaign",      "A:L"),   # 11 cols (Date…PlatformURL)
    ("threads-campaign",        "A:L"),   # 11 cols (Date…PlatformURL)
    ("Public-marketplaces",     "A:G"),   #  7 cols
]

ALL_TABS: list[str] = [name for name, _range in _ALL_TABS]

_TAB_RANGES: dict[str, str] = dict(_ALL_TABS)


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


# ── Per-tab row parsers ────────────────────────────────────────────────────────
# Each returns (content_id, platform, content_preview, timestamp, status,
#                action_type, target_url, profile_name) or None if row is empty.

_TAB_PARSER_COL_MAPS: dict[str, dict[str, int | str]] = {
    "reddit-campaign": {
        "content_id": 0, "product_id": 1, "action_type": 2, "platform": 3,
        "target_url": 4, "content_preview": 6, "timestamp": 8, "status": 10,
        "profile_name": 11,
    },
    "linkedin-campaign": {
        "content_id": 0, "product_id": 1, "action_type": 2, "platform": "linkedin",
        "target_url": 4, "content_preview": 6, "timestamp": 9, "status": 11,
        "profile_name": 12,
    },
    "twitter-campaign": {
        "content_id": 0, "product_id": 1, "action_type": 2, "platform": "twitter",
        "target_url": 4, "content_preview": 6, "timestamp": 9, "status": 11,
        "profile_name": 12,
    },
    "discord-campaign": {
        "content_id": 0, "product_id": 1, "action_type": 2, "platform": 3,
        "target_url": 4, "content_preview": 6, "timestamp": 8, "status": 10,
    },
    "hacker-news-campaign": {
        "content_id": 0, "product_id": 1, "action_type": 2, "platform": "hacker-news",
        "target_url": 4, "content_preview": 6, "timestamp": 9, "status": 11,
        "profile_name": 12,
    },
    "instagram-campaign": {
        "content_id": 1, "product_id": 8, "action_type": "comment",
        "platform": "instagram", "target_url": 10, "content_preview": 2,
        "timestamp": 0, "status": 6, "profile_name": 7,
    },
    "threads-campaign": {
        "content_id": 1, "product_id": 8, "action_type": "post",
        "platform": "threads", "target_url": 10, "content_preview": 2,
        "timestamp": 0, "status": 6, "profile_name": 7,
    },
    # 7 cols: Project-ID, Platform, URL, Status, Last_Update, Method, Notes
    "Public-marketplaces": {
        "content_id": 0, "action_type": "publish", "platform": 1,
        "target_url": 2, "content_preview": 6, "timestamp": 4, "status": 3,
    },
}


def _parse_tab_row(row: list[str], tab_name: str) -> dict[str, str]:
    """Parse a sheet row using the column map for *tab_name*.

    Returns a dict with keys content_id, platform, content_preview,
    timestamp, status, action_type, target_url, profile_name.
    Uses empty/default values when a column is missing or unmapped.
    """
    col_map = _TAB_PARSER_COL_MAPS.get(tab_name, {})
    result: dict[str, str] = {"content_id": "", "platform": "unknown",
                               "content_preview": "", "timestamp": "",
                               "status": "pending", "action_type": "comment",
                               "target_url": "", "profile_name": ""}

    for key, default in col_map.items():
        idx = default
        if isinstance(idx, str):
            result[key] = idx  # literal string value (e.g. platform="linkedin")
        elif isinstance(idx, int) and idx < len(row):
            val = row[idx].strip() if row[idx] else ""
            if val:
                result[key] = val

    # Normalize status
    status = result.get("status", "").lower()
    if "posted" in status or "published" in status or "publish" in status:
        result["status"] = "completed"
    elif "planned" in status or "draft" in status:
        result["status"] = "pending"
    elif "approve" in status:
        result["status"] = "active"
    elif "flag" in status or "attempt" in status:
        result["status"] = "failed"

    return result


def _detect_project(
    content_id: str, content_preview: str, product_id: str | None = None,
) -> str | None:
    """Determine which project a row belongs to.

    Priority order:
    1. Explicit *product_id* column from the sheet (highest accuracy)
    2. ContentID prefix convention (``TW`` → generic, ``OT`` → OT2H)
    3. Keyword matching against *content_preview* (fallback)

    Returns ``"ODW"``, ``"OT2H"``, or ``None`` (generic).
    """
    # 1. ProductID column from sheet — authoritative when present
    if product_id:
        pid = product_id.strip().upper()
        if pid in ("ODW", "OT2H"):
            return pid

    # 2. ContentID prefix
    cid = content_id.upper().strip()
    if cid.startswith("OT"):
        return "OT2H"

    # 3. Keyword fallback (only for untagged rows)
    cp = (content_preview or "").lower()
    odw_keywords = ["opendocswork", "document processing", "rust-native", "sub-millisecond",
                    "office document", "excel", ".xlsx", ".docx", ".pptx", "100mb+",
                    "firecrawl for office", "pdf form", "mcp for document"]
    ot2h_keywords = ["opentalk2html", "html generation", "html in <10ms", "<10ms",
                     "html template", "html components", "assembly", "patch", "read", "raw mode"]

    odds_odw = sum(1 for kw in odw_keywords if kw in cp)
    odds_ot2h = sum(1 for kw in ot2h_keywords if kw in cp)

    if odds_odw > odds_ot2h and odds_odw >= 2:
        return "ODW"
    if odds_ot2h > odds_odw and odds_ot2h >= 2:
        return "OT2H"
    return None


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
        self, sheet_tab: str, column_range: str = "A:M"
    ) -> tuple[list[list[str]], list[str] | None]:
        """Read all rows from *sheet_tab* within *column_range*.

        Args:
            sheet_tab: The sheet tab name.
            column_range: Column range like ``"A:M"`` (default).

        Returns ``(data_rows, header_row)`` where *data_rows* excludes the
        header.
        """
        creds = self._get_creds()
        headers = {"Authorization": f"Bearer {creds.token}"}
        url = (
            f"https://sheets.googleapis.com/v4/spreadsheets/{self._sheet_id}"
            f"/values/{sheet_tab}!{column_range}"
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

    @staticmethod
    def get_tab_ranges() -> dict[str, str]:
        """Return a mapping of every tracked tab name to its column range."""
        return dict(_TAB_RANGES)

    def pull_all_tabs(self) -> dict[str, dict[str, Any]]:
        """Read ALL tracked tabs from the Google Sheet.

        Returns a dict::

            {
                "reddit-campaign":         {"rows": [...], "headers": [...]},
                "project-overview":        {"rows": [...], "headers": [...]},
                ...
            }

        If a tab read fails (missing tab, network error, etc.) a warning is
        logged and that tab's value is ``{"rows": [], "headers": []}``.
        """
        result: dict[str, dict[str, Any]] = {}
        with self._lock:
            for tab_name, column_range in _ALL_TABS:
                try:
                    rows, headers = self._read_sheet(tab_name, column_range=column_range)
                    result[tab_name] = {"rows": rows, "headers": headers or []}
                except (URLError, json.JSONDecodeError, OSError) as exc:
                    logger.warning("Failed to read tab %r: %s", tab_name, exc)
                    result[tab_name] = {"rows": [], "headers": []}
        return result

    def push_to_sheet(
        self, sheet_tab: str = "reddit-campaign"
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
        self, sheet_tab: str = "reddit-campaign"
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
        self, sheet_tab: str = "reddit-campaign"
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

    def import_all_to_store(self) -> dict[str, Any]:
        """Import ALL sheet tabs into the CampaignStore.

        Reads every tracked tab via ``pull_all_tabs()`` and maps them:
        - ``project-overview`` → campaigns (one per row)
        - Platform tabs (reddit-campaign, twitter-campaign, …) → actions

        Idempotent: skips rows whose platform+content_preview already exist
        in the target campaign.  Thread-safe (the underlying ``pull_all_tabs``
        and store operations are individually locked, though the full sweep
        is not atomic).

        Returns a stats dict with keys ``status``, ``campaigns_created``,
        ``actions_imported``, and ``tab_counts``.
        """
        tabs = self.pull_all_tabs()
        stats: dict[str, Any] = {
            "status": "ok",
            "campaigns_created": 0,
            "actions_imported": 0,
            "tab_counts": {},
        }

        # ── 1. Import project-overview → campaigns ────────────────────────
        project_rows = tabs.get("project-overview", {}).get("rows", [])
        campaign_map: dict[str, str] = {}  # project_code → campaign_id

        for row in project_rows:
            if len(row) < 1 or not row[0].strip():
                continue
            code = row[0].strip()
            name = row[1].strip() if len(row) > 1 and row[1].strip() else code
            product = row[2].strip() if len(row) > 2 and row[2].strip() else ""
            # Row indices 3+ may contain GitHub URL, status, dates, etc.
            github_url = row[3].strip() if len(row) > 3 else ""
            status = row[4].strip().lower() if len(row) > 4 else "draft"
            start_date = row[5].strip() if len(row) > 5 else ""
            end_date = row[6].strip() if len(row) > 6 else None

            # Check if campaign exists by name (idempotent upsert)
            existing = self._store.list_campaigns()
            matched = [c for c in existing if c.get("name") == name and c.get("product") == product]  # fmt: skip
            if matched:
                cid = matched[0]["id"]
            else:
                config: dict[str, Any] = {"name": name, "product": product, "start_date": start_date}
                if end_date:
                    config["end_date"] = end_date
                if github_url:
                    config["github_url"] = github_url
                cid = self._store.create_campaign(config)
                stats["campaigns_created"] += 1
            campaign_map[code] = cid

        # Ensure default campaign exists for rows without a project prefix
        default_cid = _ensure_marketing_campaign(self._store)
        campaign_map.setdefault("GCP", default_cid)

        # ── 2. Import platform tabs → actions ─────────────────────────────
        platform_tabs = [
            "reddit-campaign",
            "twitter-campaign",
            "linkedin-campaign",
            "hacker-news-campaign",
            "discord-campaign",
            "instagram-campaign",
            "threads-campaign",
        ]

        for tab_name in platform_tabs:
            rows = tabs.get(tab_name, {}).get("rows", [])
            tab_imported = 0
            for row in rows:
                if len(row) < 1:
                    continue
                parsed = _parse_tab_row(row, tab_name)
                content_id = parsed.get("content_id", "")
                platform = parsed.get("platform", "unknown") or "unknown"
                content_preview = parsed.get("content_preview", "") or ""
                timestamp_raw = parsed.get("timestamp", "") or ""

                if not content_preview and not content_id:
                    continue

                product_id_val = parsed.get("product_id") or ""
                project_code = _detect_project(content_id, content_preview, product_id=product_id_val)
                campaign_id = campaign_map.get(project_code) if project_code else None
                if not campaign_id:
                    campaign_id = default_cid

                # Idempotency check
                existing_actions = self._store.get_actions(campaign_id)
                is_dup = False
                cp_stripped = content_preview.strip().lower()
                if cp_stripped:
                    for ea in existing_actions:
                        if ea.get("platform") == platform and (ea.get("content_preview") or "").strip().lower() == cp_stripped:  # fmt: skip
                            is_dup = True
                            break
                if is_dup:
                    continue

                # Normalize timestamp
                sheet_ts = timestamp_raw if timestamp_raw else _now()
                if " UTC" in sheet_ts:
                    sheet_ts = sheet_ts.replace(" UTC", "+00:00")
                try:
                    datetime.fromisoformat(str(sheet_ts).replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    sheet_ts = _now()

                self._store.log_action(
                    campaign_id=campaign_id,
                    platform=platform,
                    action_type=parsed.get("action_type", "comment") or "comment",
                    target_url=parsed.get("target_url") or None,
                    content_preview=content_preview,
                    status=parsed.get("status", "pending") or "pending",
                    profile_name=parsed.get("profile_name") or None,
                    timestamp=sheet_ts,
                )
                tab_imported += 1

            stats["tab_counts"][tab_name] = {
                "rows": len(rows),
                "imported": tab_imported,
            }
            stats["actions_imported"] += tab_imported

        # ── 3. Import Public-marketplaces → actions (has Project-ID col) ──
        mp_rows = tabs.get("Public-marketplaces", {}).get("rows", [])
        mp_imported = 0
        for row in mp_rows:
            if len(row) < 2 or not row[0].strip():
                continue
            parsed = _parse_tab_row(row, "Public-marketplaces")
            project_code = row[0].strip().upper()
            campaign_id = campaign_map.get(project_code, default_cid)
            content_preview = parsed.get("content_preview", "") or ""
            platform = parsed.get("platform", "marketplace") or "marketplace"
            timestamp = parsed.get("timestamp", "") or _now()
            status = parsed.get("status", "completed")

            existing_actions = self._store.get_actions(campaign_id)
            is_dup = False
            if platform:
                for ea in existing_actions:
                    if ea.get("platform") == platform and ea.get("target_url") == parsed.get("target_url"):  # fmt: skip
                        is_dup = True
                        break
            if is_dup:
                continue

            self._store.log_action(
                campaign_id=campaign_id,
                platform=platform,
                action_type="publish",
                target_url=parsed.get("target_url") or None,
                content_preview=content_preview,
                status=status,
                timestamp=timestamp,
            )
            mp_imported += 1

        stats["tab_counts"]["Public-marketplaces"] = {"rows": len(mp_rows), "imported": mp_imported}
        stats["actions_imported"] += mp_imported

        return stats

    # ── DuckDB sync ───────────────────────────────────────────────────────

    def sync_to_duckdb(self, duckdb_store: Any) -> dict[str, int]:
        """Import all sheet tabs into DuckDB for analytics.

        Calls ``pull_all_tabs()``, transforms each tab's rows into
        ``raw_events`` format, and inserts them into the DuckDB store.
        Tracks imported rows in ``sheet_import_log`` to avoid duplicates.

        Args:
            duckdb_store: A :class:`DuckDBStore` instance. Imported at the
                bottom of this module to avoid circular imports.

        Returns:
            A stats dict mapping ``{tab_name: rows_synced}``.
        """
        tabs = self.pull_all_tabs()
        stats: dict[str, int] = {}

        with self._lock:
            for tab_name, tab_data in tabs.items():
                rows = tab_data.get("rows", [])
                if not rows:
                    stats[tab_name] = 0
                    continue

                # Query already-imported rows to skip duplicates
                already_imported: set[int] = set()
                try:
                    existing = duckdb_store.query(
                        "SELECT row_number FROM sheet_import_log WHERE tab_name = ?",
                        [tab_name],
                    )
                    already_imported = {r["row_number"] for r in existing}
                except Exception:
                    pass  # first sync — no rows yet

                synced = 0
                for row_idx, row in enumerate(rows):
                    row_number = row_idx + 2  # 1-indexed, skip header
                    if row_number in already_imported:
                        continue

                    parsed = _parse_tab_row(row, tab_name)
                    content_preview = parsed.get("content_preview", "") or ""
                    timestamp = parsed.get("timestamp", "") or ""
                    content_id = parsed.get("content_id", "") or ""

                    if not content_preview and not content_id:
                        continue

                    event = {
                        "platform": parsed.get("platform", tab_name),
                        "source_id": content_id,
                        "event_type": parsed.get("action_type", "post"),
                        "content": content_preview,
                        "author": parsed.get("profile_name", ""),
                        "url": parsed.get("target_url", ""),
                        "score": 0,
                        "metadata": {},
                        "campaign_name": tab_name,
                        "occurred_at": timestamp,
                    }

                    try:
                        duckdb_store.insert_raw_events([event])
                        duckdb_store.query(
                            """INSERT INTO sheet_import_log
                               (tab_name, row_number, content_id, imported_at)
                               VALUES (?, ?, ?, ?)""",
                            [tab_name, row_number, content_id, _now()],
                        )
                        synced += 1
                    except Exception as e:
                        logger.warning(
                            "Failed to sync tab %r row %d: %s",
                            tab_name, row_number, e,
                        )

                stats[tab_name] = synced

        return stats

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
