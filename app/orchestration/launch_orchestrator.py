#!/usr/bin/env python3
from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from campaign_manager import CampaignManager, load_campaign_config


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


class LaunchOrchestrator:
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.config = load_campaign_config()
        self.mgr = CampaignManager(self.config)
        self.content_dir = Path(self.config["content"]["kit_path"])
        self.scripts_dir = Path(__file__).resolve().parent

    def _run(self, cmd: list[str], desc: str) -> bool:
        print(f"\n[{desc}]")
        if self.dry_run:
            print(f"  Would run: {' '.join(cmd)}")
            return True
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                print(f"  OK: {result.stdout[:200]}")
                return True
            else:
                eprint(f"  FAILED (exit {result.returncode}): {result.stderr[:300]}")
                return False
        except Exception as e:
            eprint(f"  ERROR: {e}")
            return False

    def post_devto(self, day: int) -> bool:
        pieces = [p for p in self.config["content"]["pieces"]
                  if p["day"] == day and p["platform"] == "devto"]
        for p in pieces:
            path = self.content_dir / p["file"]
            if not path.exists():
                eprint(f"  Content not found: {path}")
                continue
            text = path.read_text(encoding="utf-8")
            title = p["title"]
            tags = ["mcp", "opensource", "html", "ai"]
            if self.dry_run:
                print(f"  [DRY RUN] Would post to Dev.to: '{title}' ({path.name})")
            else:
                self._run(
                    ["python3", str(self.scripts_dir / "devto-publisher.py"),
                     "post-file", str(path), "--tags"] + tags,
                    f"Post Dev.to: {title}",
                )
            self.mgr.mark_task_done(p["file"])
        return True

    def post_x_thread(self, day: int) -> bool:
        pieces = [p for p in self.config["content"]["pieces"]
                  if p["day"] == day and p["platform"] == "x"]
        for p in pieces:
            path = self.content_dir / p["file"]
            if not path.exists():
                eprint(f"  Content not found: {path}")
                continue
            thread_script = self.scripts_dir / "x" / "post_thread.py"
            if self.dry_run:
                print(f"  [DRY RUN] Would post X thread from: {path.name}")
                preview = path.read_text(encoding="utf-8")[:200]
                print(f"  Preview: {preview}...")
            else:
                self._run(
                    ["python3", str(thread_script), str(path)],
                    f"Post X thread: {path.name}",
                )
            self.mgr.mark_task_done(p["file"])
        return True

    def post_reddit(self, day: int) -> bool:
        pieces = [p for p in self.config["content"]["pieces"]
                  if p["day"] == day and p["platform"] == "reddit"]
        for p in pieces:
            path = self.content_dir / p["file"]
            if not path.exists():
                continue
            if self.dry_run:
                print(f"  [DRY RUN] Would post Reddit from: {path.name}")
            else:
                print(f"  Manual step: post '{p['title']}' from {path.name}")
            self.mgr.mark_task_done(p["file"])
        return True

    def post_linkedin(self, day: int) -> bool:
        pieces = [p for p in self.config["content"]["pieces"]
                  if p["day"] == day and p["platform"] == "linkedin"]
        for p in pieces:
            path = self.content_dir / p["file"]
            if not path.exists():
                continue
            if self.dry_run:
                print(f"  [DRY RUN] Would post LinkedIn from: {path.name}")
            else:
                print(f"  Manual step: post '{p['title']}' from {path.name}")
            self.mgr.mark_task_done(p["file"])
        return True

    def post_hacker_news(self, day: int) -> bool:
        pieces = [p for p in self.config["content"]["pieces"]
                  if p["day"] == day and p["platform"] == "hacker_news"]
        for p in pieces:
            path = self.content_dir / p["file"]
            if not path.exists():
                continue
            if self.dry_run:
                print(f"  [DRY RUN] Would open HN draft from: {path.name}")
            else:
                print(f"  Manual step: submit Show HN from {path.name}")
            self.mgr.mark_task_done(p["file"])
        return True

    def collect_metrics(self) -> dict[str, Any]:
        print("\n[Collecting campaign metrics]")
        if self.dry_run:
            print("  [DRY RUN] Would fetch GitHub stars + npm downloads")
            return {}
        metrics = self.mgr.collect_metrics()
        stars = metrics.get("github_stars")
        downloads = metrics.get("npm_weekly_downloads")
        print(f"  GitHub Stars: {stars}")
        print(f"  npm Downloads (week): {downloads}")
        return metrics

    def run_day(self, day: int) -> None:
        print(f"\n{'='*60}")
        print(f"  Launch Day {day}/5 — {self.config['start_date']} + {day-1} days")
        print(f"{'='*60}")
        pieces = [p for p in self.config["content"]["pieces"] if p["day"] == day]
        print(f"  Tasks for today: {len(pieces)}")
        for p in pieces:
            print(f"    - [{p['platform']}] {p['title']}")
        self.post_devto(day)
        self.post_x_thread(day)
        self.post_reddit(day)
        self.post_linkedin(day)
        self.post_hacker_news(day)
        self.collect_metrics()
        print(f"\n  Day {day} complete.")

    def run_all(self) -> None:
        for day in range(1, 6):
            self.run_day(day)

    def status(self) -> str:
        return self.mgr.summary_text()


def cmd_status() -> None:
    orch = LaunchOrchestrator(dry_run=True)
    print(orch.status())
    print(f"\nContent kit: {orch.content_dir.resolve()}")
    print(f"Pieces configured: {len(orch.config['content']['pieces'])}")


def cmd_day(args: argparse.Namespace) -> None:
    orch = LaunchOrchestrator(dry_run=args.dry_run)
    orch.run_day(args.day)


def cmd_metrics(args: argparse.Namespace) -> None:
    orch = LaunchOrchestrator(dry_run=args.dry_run)
    orch.collect_metrics()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fast HTML MCP Launch Week Orchestrator")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Show launch campaign status")

    p_day = sub.add_parser("day", help="Execute a specific launch day")
    p_day.add_argument("day", type=int, choices=range(1, 6), help="Day number (1-5)")
    p_day.add_argument("--dry-run", action="store_true", help="Preview without posting")

    p_metrics = sub.add_parser("metrics", help="Collect campaign metrics")
    p_metrics.add_argument("--dry-run", action="store_true", help="Skip API calls")

    args = parser.parse_args()

    if args.command == "status":
        cmd_status()
    elif args.command == "day":
        cmd_day(args)
    elif args.command == "metrics":
        cmd_metrics(args)
