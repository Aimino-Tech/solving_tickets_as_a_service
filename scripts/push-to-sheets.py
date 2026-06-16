"""Push latest metrics from MetricsStore to a Google Sheet.

Requires:
  - SHEET_ID in ~/.hermes/.env
  - GOOGLE_SERVICE_ACCOUNT_KEY (JSON content) in ~/.hermes/.env

Dependencies (optional):
  pip install google-api-python-client google-auth

Rate-limit: never pushes more than once per 5 minutes.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from hermes_constants import get_hermes_home
from plugins.monitoring.monitor_store import MetricsStore

RATE_LIMIT_SECONDS = 300
_RATE_LIMIT_FILE = get_hermes_home() / "monitoring" / ".last_sheets_push"


def _load_env() -> dict:
    env_path = get_hermes_home() / ".env"
    env: dict[str, str] = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip().strip("\"'")
    return env


def _check_rate_limit() -> bool:
    try:
        if _RATE_LIMIT_FILE.exists():
            last = float(_RATE_LIMIT_FILE.read_text().strip())
            if time.time() - last < RATE_LIMIT_SECONDS:
                return False
    except (ValueError, OSError):
        pass
    return True


def _update_rate_limit() -> None:
    _RATE_LIMIT_FILE.parent.mkdir(parents=True, exist_ok=True)
    _RATE_LIMIT_FILE.write_text(str(time.time()))


def _build_snapshot(store: MetricsStore) -> dict:
    names = store.list_metric_names()
    latest: dict = {}
    for n in names:
        try:
            v = store.query_latest(n)
            if v:
                latest[n] = v
            else:
                latest[n] = None
        except Exception:
            latest[n] = None
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": latest,
    }


def _push_to_sheet(snapshot: dict, sheet_id: str, credentials_json: str) -> None:
    try:
        from google.auth import service_account
        from googleapiclient.discovery import build
    except ImportError:
        print(json.dumps({"error": "google-api-python-client not installed. Run: pip install google-api-python-client google-auth", "wakeAgent": False}))
        sys.exit(1)

    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = service_account.Credentials.from_service_account_info(
        json.loads(credentials_json), scopes=scopes,
    )
    service = build("sheets", "v4", credentials=creds)
    sheet = service.spreadsheets()

    rows = [["Timestamp", "Metric", "Value", "Source"]]
    ts = snapshot["generated_at"]
    for name, data in snapshot["metrics"].items():
        if data and "value" in data:
            rows.append([ts, name, data["value"], "hermes-agent"])

    body = {"values": rows, "majorDimension": "ROWS"}
    sheet.values().append(
        spreadsheetId=sheet_id,
        range="Sheet1!A:D",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body=body,
    ).execute()


def main() -> None:
    env = _load_env()
    sheet_id = env.get("SHEET_ID") or os.environ.get("SHEET_ID", "")
    service_account_key = env.get("GOOGLE_SERVICE_ACCOUNT_KEY") or os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY", "")

    if not sheet_id or not service_account_key:
        print(json.dumps({
            "error": "SHEET_ID and GOOGLE_SERVICE_ACCOUNT_KEY must be set in ~/.hermes/.env",
            "wakeAgent": False,
        }))
        sys.exit(1)

    if not _check_rate_limit():
        print(json.dumps({"skipped": "rate_limited", "wakeAgent": False}))
        return

    store = MetricsStore()
    snapshot = _build_snapshot(store)
    _push_to_sheet(snapshot, sheet_id, service_account_key)
    _update_rate_limit()

    print(json.dumps({"pushed": True, "metrics_count": len(snapshot["metrics"]), "wakeAgent": False}))


if __name__ == "__main__":
    main()
