import json
import uuid
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TRACKING_DIR = Path("./fast-html-mcp-server-marketing")
SPREADSHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"


class FastHtmlMCPTracker:
    """Centralized tracker for all fast-html-mcp marketing actions.

    Writes structured JSON records to disk (always) and optionally pushes
    data to a Google Sheet if GOOGLE_SHEETS_CREDENTIALS is set.
    """

    def __init__(self, tracking_dir: str | Path = None):
        self.tracking_dir = Path(tracking_dir or TRACKING_DIR)
        self._ensure_dirs()
        self._sheets = None
        self._init_sheets_backend()

    def _init_sheets_backend(self):
        try:
            from app.tracking.sheets_backend import GoogleSheetsBackend
            self._sheets = GoogleSheetsBackend()
        except Exception as exc:
            print(f"[tracker] Sheets backend unavailable: {exc}")

    def _ensure_dirs(self):
        for sub in [
            "engagements", "campaign-tasks", "metrics", "leads",
            "directory-submissions", "orchestration-cycles",
        ]:
            (self.tracking_dir / sub).mkdir(parents=True, exist_ok=True)

    def track_engagement(self, platform: str, action: str, target_url: str = None,
                         content_preview: str = None, score: int = 0,
                         status: str = "pending") -> str:
        record = self._make_record("engagement", {
            "platform": platform,
            "action": action,
            "target_url": target_url,
            "content_preview": (content_preview or "")[:200],
            "score": score,
            "status": status,
        })
        self._write("engagements", record)
        return record["id"]

    def track_lead(self, platform: str, source_url: str = None,
                   author_name: str = None, author_handle: str = None,
                   content_snippet: str = None,
                   relevance_score: int = 0, sentiment: str = "neutral",
                   opportunity_score: int = 0, urgency: str = "batch") -> str:
        record = self._make_record("lead", {
            "platform": platform,
            "source_url": source_url,
            "author_name": author_name,
            "author_handle": author_handle,
            "content_snippet": (content_snippet or "")[:500],
            "relevance_score": relevance_score,
            "sentiment": sentiment,
            "opportunity_score": opportunity_score,
            "urgency": urgency,
            "status": "new",
        })
        self._write("leads", record)
        return record["id"]

    def track_campaign_task(self, campaign: str, day: int, task_key: str,
                            platform: str = None, content_file: str = None) -> str:
        record = self._make_record("campaign_task", {
            "campaign": campaign,
            "day": day,
            "task_key": task_key,
            "platform": platform,
            "content_file": content_file,
            "status": "completed",
        })
        self._write("campaign-tasks", record)
        return record["id"]

    def track_metrics(self, campaign: str, github_stars: int = None,
                      npm_downloads: int = None, raw_data: dict = None) -> str:
        record = self._make_record("metrics", {
            "campaign": campaign,
            "github_stars": github_stars,
            "npm_weekly_downloads": npm_downloads,
            "raw_data": raw_data if raw_data else None,
        })
        self._write("metrics", record)
        return record["id"]

    def track_directory_submission(self, directory: str, status: str,
                                   method: str = "manual", url: str = None,
                                   error: str = None) -> str:
        record = self._make_record("directory_submission", {
            "directory": directory,
            "status": status,
            "method": method,
            "url": url,
            "error": error,
        })
        self._write("directory-submissions", record)
        return record["id"]

    def track_orchestration_cycle(self, phases: list[dict]) -> str:
        record = self._make_record("orchestration_cycle", {
            "phases": phases,
        })
        self._write("orchestration-cycles", record)
        return record["id"]

    def _make_record(self, type_name: str, data: dict) -> dict:
        return {
            "type": type_name,
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **data,
        }

    def _write(self, subdir: str, record: dict):
        ts = datetime.now(timezone.utc)
        filename = f"{ts.strftime('%Y%m%d-%H%M%S')}-{record['id'][:8]}.json"
        path = self.tracking_dir / subdir / filename
        path.write_text(json.dumps(record, indent=2))
        self._update_index()

        if self._sheets:
            try:
                self._sheets.append_record(record)
            except Exception as exc:
                print(f"[tracker] Sheets append failed: {exc}")

    def _update_index(self):
        index_path = self.tracking_dir / "index.md"
        engagements = sorted((self.tracking_dir / "engagements").glob("*.json"))
        tasks = sorted((self.tracking_dir / "campaign-tasks").glob("*.json"))
        metric_files = sorted((self.tracking_dir / "metrics").glob("*.json"))
        lead_files = sorted((self.tracking_dir / "leads").glob("*.json"))
        submissions = sorted(
            (self.tracking_dir / "directory-submissions").glob("*.json")
        )

        latest_metrics = {}
        if metric_files:
            try:
                latest_metrics = json.loads(metric_files[-1].read_text())
            except Exception:
                pass

        platform_counts = {}
        for f in engagements[-50:]:
            try:
                rec = json.loads(f.read_text())
                p = rec.get("platform", "unknown")
                platform_counts[p] = platform_counts.get(p, 0) + 1
            except Exception:
                pass

        lines = [
            "# Fast HTML MCP — Action Tracker",
            "",
            f"**Last updated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
            f"**Total engagements:** {len(engagements)}",
            f"**Total campaign tasks completed:** {len(tasks)}",
            f"**Total leads identified:** {len(lead_files)}",
            f"**Total metrics snapshots:** {len(metric_files)}",
            f"**Directory submission attempts:** {len(submissions)}",
            "",
            "---",
            "",
            "## Latest Metrics",
            "",
        ]
        if latest_metrics:
            lines.append(
                f"- **GitHub Stars:** {latest_metrics.get('github_stars', '—')}"
            )
            lines.append(
                f"- **npm Downloads (week):** {latest_metrics.get('npm_weekly_downloads', '—')}"
            )
        else:
            lines.append("- No metrics collected yet.")

        lines += [
            "",
            "## Recent Engagements by Platform",
            "",
        ]
        if platform_counts:
            for p, count in sorted(platform_counts.items()):
                lines.append(f"- **{p}:** {count} actions")
        else:
            lines.append("- No engagements recorded yet.")

        lines += [
            "",
            "---",
            "",
            "*Auto-generated by FastHtmlMCPTracker on every action.*",
        ]

        index_path.write_text("\n".join(lines) + "\n")
