"""
MergeQueue -- Ordered PR merge queue manager.

Supports two modes:
  1. GitHub native merge queue -- when the repo has it enabled.
  2. Custom FIFO queue with CI-polling, conflict detection/resolution.
"""
from __future__ import annotations
import json
import logging
import os
import re
import subprocess
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Callable
from workers.github.client import GitHubClient
from workers.review.models import MergeResult, MergeStrategy

logger = logging.getLogger(__name__)

CONFLICT_LABEL = "conflict"
MERGE_QUEUE_LABEL = "merge-queue"
DEFAULT_LEDGER_PATH = os.getenv("MERGE_QUEUE_LEDGER_PATH", str(Path.home() / ".stas" / "merge_queue.json"))
CI_POLL_INTERVAL = int(os.getenv("MERGE_QUEUE_CI_POLL_INTERVAL", "30"))
CI_POLL_MAX_RETRIES = int(os.getenv("MERGE_QUEUE_CI_MAX_RETRIES", "20"))
DEFAULT_MERGE_STRATEGY = os.getenv("MERGE_QUEUE_STRATEGY", "squash")


@dataclass
class QueueEntry:
    repo_name: str
    pr_number: int
    issue_id: str
    status: str = "queued"
    merge_strategy: str = DEFAULT_MERGE_STRATEGY
    pr_url: str = ""
    error: str = ""
    enqueued_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> QueueEntry:
        return cls(**data)


class _FileLedger:
    def __init__(self, path: str = DEFAULT_LEDGER_PATH) -> None:
        self._path = path
        self._entries: dict[str, QueueEntry] = {}
        self._order: list[str] = []
        self._load()

    def all(self) -> list[QueueEntry]:
        return [self._entries[k] for k in self._order]

    def get(self, key: str) -> QueueEntry | None:
        return self._entries.get(key)

    def put(self, entry: QueueEntry) -> None:
        key = self._key(entry.repo_name, entry.pr_number)
        if key not in self._entries:
            self._order.append(key)
        self._entries[key] = entry
        self._save()

    def remove(self, repo_name: str, pr_number: int) -> None:
        key = self._key(repo_name, pr_number)
        self._entries.pop(key, None)
        self._order = [k for k in self._order if k != key]
        self._save()

    def next_pending(self) -> QueueEntry | None:
        for key in self._order:
            entry = self._entries[key]
            if entry.status in ("queued", "ci_passed", "ready"):
                return entry
        return None

    def entries_by_status(self, status: str) -> list[QueueEntry]:
        return [e for e in self.all() if e.status == status]

    @staticmethod
    def _key(repo_name: str, pr_number: int) -> str:
        return f"{repo_name}#{pr_number}"

    def _load(self) -> None:
        try:
            path = Path(self._path)
            if path.exists() and path.stat().st_size > 0:
                data = json.loads(path.read_text())
                self._order = data.get("order", [])
                self._entries = {k: QueueEntry.from_dict(v) for k, v in data.get("entries", {}).items()}
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to load merge queue ledger -- %s", exc)

    def _save(self) -> None:
        try:
            path = Path(self._path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"order": self._order, "entries": {k: e.to_dict() for k, e in self._entries.items()}}, indent=2, default=str))
        except OSError as exc:
            logger.error("Failed to save merge queue ledger -- %s", exc)


def _get_combined_ci_status(client: GitHubClient, repo_name: str, ref: str) -> dict:
    combined = client._request("GET", f"/repos/{repo_name}/commits/{ref}/status")
    return {"state": combined.get("state", "pending"), "statuses": combined.get("statuses", [])}


def _get_check_runs(client: GitHubClient, repo_name: str, ref: str) -> dict:
    try:
        result = client._request("GET", f"/repos/{repo_name}/commits/{ref}/check-runs")
        return {"conclusion": _aggregate_check_conclusion(result), "check_runs": result.get("check_runs", [])}
    except Exception as exc:
        logger.warning("Failed to fetch check runs -- %s", exc)
        return {"conclusion": None, "check_runs": []}


def _aggregate_check_conclusion(api_response: dict) -> str | None:
    runs = api_response.get("check_runs", [])
    if not runs:
        return None
    has_pending = False
    has_failure = False
    for run in runs:
        c = run.get("conclusion")
        s = run.get("status")
        if c == "failure" or c == "cancelled":
            has_failure = True
        elif s in ("queued", "in_progress") or c is None:
            has_pending = True
    if has_failure:
        return "failure"
    if has_pending:
        return "pending"
    return "success"


def _ci_passes(ci_status: dict, check_runs: dict) -> bool:
    if ci_status.get("state") == "failure" or check_runs.get("conclusion") == "failure":
        return False
    if ci_status.get("state") == "pending" or check_runs.get("conclusion") == "pending":
        return False
    return True


def _ci_is_pending(ci_status: dict, check_runs: dict) -> bool:
    return ci_status.get("state") == "pending" or check_runs.get("conclusion") == "pending"


def _detect_conflicts_via_api(client: GitHubClient, repo_name: str, pr_number: int) -> bool:
    for _ in range(5):
        info = client.check_mergeable(repo_name, pr_number)
        m = info.get("mergeable")
        if m is not None:
            return not m
        time.sleep(2)
    return False


def _detect_conflicts_local(workspace_path: str) -> list[str]:
    try:
        subprocess.run(["git", "fetch", "origin", "main"], cwd=workspace_path, capture_output=True, text=True, timeout=30)
    except Exception as exc:
        logger.warning("git fetch failed -- %s", exc)
        return []
    try:
        result = subprocess.run(["git", "merge-tree", "HEAD", "FETCH_HEAD"], cwd=workspace_path, capture_output=True, text=True, timeout=30)
        conflicted = []
        for line in result.stdout.splitlines():
            if line.startswith("changed in both") or "added by both" in line:
                match = re.search(r'(?:changed in both|added by both)\s*:\s*(\S+)', line)
                if match:
                    conflicted.append(match.group(1))
        return conflicted
    except Exception as exc:
        logger.warning("merge-tree failed -- %s", exc)
        return []


def _attempt_resolve_local(workspace_path: str) -> dict:
    try:
        subprocess.run(["git", "merge", "--no-commit", "--no-ff", "origin/main"], cwd=workspace_path, capture_output=True, text=True, timeout=30)
    except Exception:
        pass
    result = subprocess.run(["git", "diff", "--name-only", "--diff-filter=U"], cwd=workspace_path, capture_output=True, text=True, timeout=15)
    files = result.stdout.strip().split("\n") if result.stdout.strip() else []
    resolved = []
    failed = []
    for f in files:
        try:
            subprocess.run(["git", "checkout", "--ours", f], cwd=workspace_path, capture_output=True, timeout=15)
            subprocess.run(["git", "add", f], cwd=workspace_path, capture_output=True, timeout=15)
            resolved.append(f)
        except Exception as exc:
            failed.append({"file": f, "error": str(exc)})
    subprocess.run(["git", "merge", "--abort"], cwd=workspace_path, capture_output=True, timeout=10)
    if failed:
        return {"status": "partial", "resolved": resolved, "failed": failed}
    return {"status": "resolved", "resolved": resolved, "failed": []}


def _merge_via_api(client: GitHubClient, repo_name: str, pr_number: int, strategy: MergeStrategy) -> MergeResult:
    try:
        result = client._request("PUT", f"/repos/{repo_name}/pulls/{pr_number}/merge",
                                 json_body={"merge_method": strategy.value, "commit_title": f"Merge PR #{pr_number}"})
        if result.get("merged", False):
            return MergeResult(status="merged", merge_sha=result.get("sha", ""), pr_url=result.get("html_url", ""))
        return MergeResult(status="failed", error=result.get("message", "API merge rejected"))
    except Exception as exc:
        return MergeResult(status="failed", error=str(exc))


def _merge_via_git(workspace_path: str, pr_number: int, strategy: MergeStrategy) -> MergeResult:
    try:
        if strategy == MergeStrategy.squash:
            cmd = ["git", "merge", "--squash", f"refs/pull/{pr_number}/head"]
        elif strategy == MergeStrategy.rebase:
            cmd = ["git", "rebase", f"refs/pull/{pr_number}/head"]
        else:
            cmd = ["git", "merge", "--no-ff", f"refs/pull/{pr_number}/head"]
        res = subprocess.run(cmd, cwd=workspace_path, capture_output=True, text=True, timeout=60)
        if res.returncode != 0:
            return MergeResult(status="failed", error=res.stderr[:500])
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=workspace_path, capture_output=True, text=True, timeout=10).stdout.strip()
        subprocess.run(["git", "push", "origin", "main"], cwd=workspace_path, capture_output=True, timeout=30)
        return MergeResult(status="merged", merge_sha=sha)
    except subprocess.TimeoutExpired:
        return MergeResult(status="failed", error="Merge operation timed out")
    except Exception as exc:
        return MergeResult(status="failed", error=str(exc))


class MergeQueue:
    def __init__(self, ledger_path: str | None = None,
                 github_client_factory: Callable[[], GitHubClient] | None = None) -> None:
        self._ledger = _FileLedger(path=ledger_path or DEFAULT_LEDGER_PATH)
        self._gh_factory = github_client_factory or (lambda: GitHubClient())

    def enqueue(self, repo_name: str, pr_number: int, issue_id: str, pr_url: str = "",
                merge_strategy: str = DEFAULT_MERGE_STRATEGY) -> QueueEntry:
        entry = QueueEntry(repo_name=repo_name, pr_number=pr_number, issue_id=issue_id,
                           pr_url=pr_url, merge_strategy=merge_strategy, status="queued")
        self._ledger.put(entry)
        return entry

    def dequeue(self, repo_name: str, pr_number: int) -> None:
        self._ledger.remove(repo_name, pr_number)

    def get_entry(self, repo_name: str, pr_number: int) -> QueueEntry | None:
        return self._ledger.get(f"{repo_name}#{pr_number}")

    def list_queue(self) -> list[QueueEntry]:
        return self._ledger.all()

    def entries_by_status(self, status: str) -> list[QueueEntry]:
        return self._ledger.entries_by_status(status)

    def _set_status(self, repo_name: str, pr_number: int, status: str, error: str = "") -> QueueEntry | None:
        entry = self.get_entry(repo_name, pr_number)
        if entry is None:
            return None
        entry.status = status
        entry.error = error
        entry.updated_at = time.time()
        self._ledger.put(entry)
        return entry

    def check_ci(self, repo_name: str, pr_number: int) -> str:
        client = self._gh_factory()
        pr_info = client._request("GET", f"/repos/{repo_name}/pulls/{pr_number}")
        head_sha = pr_info.get("head", {}).get("sha", "")
        if not head_sha:
            self._set_status(repo_name, pr_number, "ci_failed", "No head SHA found")
            return "failed"
        ci = _get_combined_ci_status(client, repo_name, head_sha)
        cr = _get_check_runs(client, repo_name, head_sha)
        if _ci_passes(ci, cr):
            self._set_status(repo_name, pr_number, "ci_passed")
            return "passed"
        if _ci_is_pending(ci, cr):
            self._set_status(repo_name, pr_number, "ci_pending")
            return "pending"
        self._set_status(repo_name, pr_number, "ci_failed", "CI checks failed")
        return "failed"

    def poll_ci_with_timeout(self, repo_name: str, pr_number: int,
                             max_retries: int = CI_POLL_MAX_RETRIES, interval: int = CI_POLL_INTERVAL) -> str:
        for _ in range(max_retries):
            r = self.check_ci(repo_name, pr_number)
            if r in ("passed", "failed"):
                return r
            time.sleep(interval)
        self._set_status(repo_name, pr_number, "ci_failed", "CI polling timed out")
        return "timeout"

    def detect_conflicts(self, repo_name: str, pr_number: int, workspace_path: str | None = None) -> bool:
        if workspace_path:
            has = len(_detect_conflicts_local(workspace_path)) > 0
        else:
            has = _detect_conflicts_via_api(self._gh_factory(), repo_name, pr_number)
        if has:
            self.label_conflict(repo_name, pr_number)
            self._set_status(repo_name, pr_number, "conflict", "Merge conflicts detected")
        return has

    def resolve_conflicts(self, repo_name: str, pr_number: int, workspace_path: str) -> dict:
        if self.get_entry(repo_name, pr_number) is None:
            return {"status": "not_found", "resolved": [], "failed": []}
        result = _attempt_resolve_local(workspace_path)
        if result["status"] == "resolved":
            self._set_status(repo_name, pr_number, "ready")
        else:
            self._set_status(repo_name, pr_number, "conflict", f"Partial resolution: {result['failed']}")
            self.label_conflict(repo_name, pr_number)
        return result

    def label_conflict(self, repo_name: str, pr_number: int) -> None:
        try:
            c = self._gh_factory()
            c._request("POST", f"/repos/{repo_name}/issues/{pr_number}/labels", json_body={"labels": [CONFLICT_LABEL]})
        except Exception as exc:
            logger.warning("Failed to label PR #%d (%s) -- %s", pr_number, repo_name, exc)

    def label_merge_queue(self, repo_name: str, pr_number: int) -> None:
        try:
            c = self._gh_factory()
            c._request("POST", f"/repos/{repo_name}/issues/{pr_number}/labels", json_body={"labels": [MERGE_QUEUE_LABEL]})
        except Exception as exc:
            logger.warning("Failed to label PR #%d (%s) -- %s", pr_number, repo_name, exc)

    def try_github_merge_queue(self, repo_name: str) -> bool:
        try:
            r = self._gh_factory()._request("GET", f"/repos/{repo_name}/branches/main/protection")
            return bool(r.get("required_merge_queue"))
        except Exception:
            return False

    def process_next(self, workspace_path: str | None = None) -> dict[str, Any]:
        entry = self._ledger.next_pending()
        if entry is None:
            return {"status": "no_pending", "entry": None}
        rn, pn = entry.repo_name, entry.pr_number
        ci = self.poll_ci_with_timeout(rn, pn)
        if ci == "failed":
            self._set_status(rn, pn, "ci_failed", "CI checks failed after polling")
            return {"status": "ci_failed", "entry": self.get_entry(rn, pn)}
        if ci == "timeout":
            return {"status": "ci_timeout", "entry": self.get_entry(rn, pn)}
        has = self.detect_conflicts(rn, pn, workspace_path=workspace_path)
        if has:
            if workspace_path:
                res = self.resolve_conflicts(rn, pn, workspace_path)
                if res["status"] != "resolved":
                    return {"status": "conflict_unresolved", "entry": self.get_entry(rn, pn), "resolution": res}
            else:
                return {"status": "conflict", "entry": self.get_entry(rn, pn)}
        strat = MergeStrategy(entry.merge_strategy)
        mr = _merge_via_git(workspace_path, pn, strat) if workspace_path else _merge_via_api(self._gh_factory(), rn, pn, strat)
        if mr.status == "merged":
            self._set_status(rn, pn, "merged")
            self.dequeue(rn, pn)
            return {"status": "merged", "merge_sha": mr.merge_sha, "entry": entry}
        self._set_status(rn, pn, "failed", mr.error)
        return {"status": "merge_failed", "error": mr.error, "entry": self.get_entry(rn, pn)}

    def process_all(self, workspace_path: str | None = None) -> list[dict[str, Any]]:
        results = []
        while True:
            r = self.process_next(workspace_path=workspace_path)
            results.append(r)
            if r["status"] in ("no_pending", "ci_failed", "ci_timeout", "conflict"):
                break
        return results
