from __future__ import annotations
import json
import os
import sys
import time
from datetime import datetime, date, timezone
from pathlib import Path
from typing import Any
import httpx
from app.tracking import tracker

CAMPAIGN_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "fast-html-mcp-campaign.json"


def load_campaign_config() -> dict[str, Any]:
    if not CAMPAIGN_CONFIG_PATH.exists():
        print(f"Campaign config not found: {CAMPAIGN_CONFIG_PATH}", file=sys.stderr)
        sys.exit(1)
    with open(CAMPAIGN_CONFIG_PATH) as f:
        return json.load(f)


def get_current_day(start_date_str: str) -> int:
    start = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    today = date.today()
    delta = (today - start).days
    if delta < 0:
        return 0
    return min(delta + 1, 5)


class CampaignManager:
    def __init__(self, config: dict[str, Any] = None):
        self.config = config or load_campaign_config()
        self.campaign_name = self.config["campaign"]
        self.start_date = self.config["start_date"]
        self.end_date = self.config["end_date"]
        self.engagement_rules = self.config.get("engagement_rules", {})
        self.platforms = self.config.get("platforms", {})
        self.monitoring = self.config.get("monitoring", {})
        self._state: dict[str, Any] = {}
        self._state_path = Path(f"./workspace/campaigns/{self.campaign_name}/state.json")

    @property
    def state(self) -> dict[str, Any]:
        if not self._state:
            if self._state_path.exists():
                with open(self._state_path) as f:
                    self._state = json.load(f)
            else:
                self._state = {
                    "campaign": self.campaign_name,
                    "current_day": 0,
                    "tasks": {},
                    "metrics_snapshots": [],
                }
        return self._state

    def save_state(self) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._state_path, "w") as f:
            json.dump(self._state, f, indent=2)

    def current_day(self) -> int:
        return get_current_day(self.start_date)

    def tasks_for_day(self, day: int) -> list[dict[str, Any]]:
        return [p for p in self.config.get("content", {}).get("pieces", []) if p["day"] == day]

    def mark_task_done(self, task_id: str) -> None:
        day = self.current_day()
        if day < 1:
            print("Campaign has not started yet.")
            return
        key = f"day_{day}"
        if key not in self.state["tasks"]:
            self.state["tasks"][key] = []
        if task_id not in self.state["tasks"][key]:
            self.state["tasks"][key].append(task_id)
        self.save_state()
        print(f"Task {task_id} marked done for day {day}.")
        tracker.track_campaign_task(self.campaign_name, day, task_id)

    def get_pending_tasks(self) -> list[dict[str, Any]]:
        day = self.current_day()
        if day < 1 or day > 5:
            return []
        done = self.state["tasks"].get(f"day_{day}", [])
        all_tasks = self.tasks_for_day(day)
        return [t for t in all_tasks if t["file"] not in done]

    def fetch_github_stars(self) -> int | None:
        repo = self.monitoring.get("github_repo", "")
        if not repo:
            return None
        try:
            resp = httpx.get(f"https://api.github.com/repos/{repo}", timeout=15)
            if resp.status_code == 200:
                return resp.json().get("stargazers_count", 0)
        except Exception:
            pass
        return None

    def fetch_npm_downloads(self) -> int | None:
        pkg = self.monitoring.get("npm_package", "")
        if not pkg:
            return None
        try:
            resp = httpx.get(f"https://api.npmjs.org/downloads/point/last-week/{pkg}", timeout=15)
            if resp.status_code == 200:
                return resp.json().get("downloads", 0)
        except Exception:
            pass
        return None

    def collect_metrics(self) -> dict[str, Any]:
        stars = self.fetch_github_stars()
        downloads = self.fetch_npm_downloads()
        metrics = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "github_stars": stars,
            "npm_weekly_downloads": downloads,
        }
        self.state["metrics_snapshots"].append(metrics)
        self.save_state()
        tracker.track_metrics(self.campaign_name, stars, downloads, metrics)
        return metrics

    def generate_report(self) -> str:
        report_path = Path("marketing/campaigns/fast-html-mcp-launch/report.md")
        if not report_path.exists():
            return "Report template not found."
        current = self.current_day()
        snapshots = self.state.get("metrics_snapshots", [])
        latest = snapshots[-1] if snapshots else {}
        with open(report_path) as f:
            template = f.read()
        report = template.replace("—", str(latest.get("github_stars", "—")), 1)
        return report

    def summary_text(self) -> str:
        day = self.current_day()
        pending = self.get_pending_tasks()
        snapshots = self.state.get("metrics_snapshots", [])
        latest = snapshots[-1] if snapshots else {}
        lines = [
            f"Campaign: {self.campaign_name}",
            f"Day: {day}/5",
            f"Date: {self.start_date} → {self.end_date}",
            f"GitHub Stars: {latest.get('github_stars', '—')}",
            f"npm Downloads (week): {latest.get('npm_weekly_downloads', '—')}",
            f"Pending Tasks: {len(pending)}",
        ]
        return "\n".join(lines)


def cmd_status() -> None:
    mgr = CampaignManager()
    print(mgr.summary_text())


def cmd_metrics() -> None:
    mgr = CampaignManager()
    metrics = mgr.collect_metrics()
    print(json.dumps(metrics, indent=2))


def cmd_tasks() -> None:
    mgr = CampaignManager()
    day = mgr.current_day()
    if day < 1:
        print(f"Campaign starts {mgr.start_date}. Current day: {day}")
        return
    pending = mgr.get_pending_tasks()
    done = mgr.state["tasks"].get(f"day_{day}", [])
    print(f"Day {day}/5 tasks:")
    for t in mgr.tasks_for_day(day):
        status = "[DONE]" if t["file"] in done else "[PENDING]"
        print(f"  {status} {t['platform']}: {t['title']} ({t['file']})")


def cmd_done(args: list[str]) -> None:
    if not args:
        print("Usage: campaign-manager done <task_file>")
        return
    mgr = CampaignManager()
    mgr.mark_task_done(args[0])


def cmd_report() -> None:
    mgr = CampaignManager()
    report = mgr.generate_report()
    print("Report updated." if "—" not in report else report)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Fast HTML MCP Campaign Manager")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Show campaign status")
    sub.add_parser("metrics", help="Collect current GitHub/npm metrics")
    sub.add_parser("tasks", help="List tasks for current day")
    p_done = sub.add_parser("done", help="Mark a task as completed")
    p_done.add_argument("task_file", help="Task file name from content kit")
    sub.add_parser("report", help="Generate campaign report")

    args = parser.parse_args()

    if args.command == "status":
        cmd_status()
    elif args.command == "metrics":
        cmd_metrics()
    elif args.command == "tasks":
        cmd_tasks()
    elif args.command == "done":
        cmd_done([args.task_file])
    elif args.command == "report":
        cmd_report()
