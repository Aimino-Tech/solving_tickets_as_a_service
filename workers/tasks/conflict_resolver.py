"""Conflict resolver — auto-resolves simple merge conflicts, escalates complex ones."""

import logging
import subprocess

from celery import shared_task

logger = logging.getLogger(__name__)


class ConflictResolver:
    def detect_conflicts(self, workspace_path: str) -> list[str]:
        result = subprocess.run(["git", "diff", "--name-only", "--diff-filter=U"], cwd=workspace_path, capture_output=True, text=True)
        if result.returncode != 0:
            return []
        return [f.strip() for f in result.stdout.split("\n") if f.strip()]

    def auto_resolve(self, workspace_path: str, conflict_files: list[str]) -> dict[str, list[str]]:
        resolved = []
        unresolved = []
        for file_path in conflict_files:
            try:
                subprocess.run(["git", "checkout", "--ours", file_path], cwd=workspace_path, check=True, capture_output=True)
                subprocess.run(["git", "add", file_path], cwd=workspace_path, check=True, capture_output=True)
                resolved.append(file_path)
            except subprocess.CalledProcessError:
                unresolved.append(file_path)
        return {"resolved": resolved, "unresolved": unresolved}

    def get_conflict_summary(self, workspace_path: str) -> str:
        result = subprocess.run(["git", "status", "--porcelain"], cwd=workspace_path, capture_output=True, text=True)
        return result.stdout


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.conflict_resolver.resolve_conflicts",
    queue="stas.queue.conflict",
)
def resolve_conflicts(self, issue_id: str, pr_url: str, workspace_path: str) -> dict:
    logger.info("Resolving conflicts for %s (PR: %s)", issue_id, pr_url)
    try:
        resolver = ConflictResolver()
        conflict_files = resolver.detect_conflicts(workspace_path)
        if not conflict_files:
            return {"status": "no_conflicts", "action": "proceed"}
        result = resolver.auto_resolve(workspace_path, conflict_files)
        if result["unresolved"]:
            conflict_summary = resolver.get_conflict_summary(workspace_path)
            from workers.tasks.human_escalation import escalate_to_human
            escalate_to_human.delay(
                issue_id=issue_id,
                review_result={
                    "verdict": "changes_requested",
                    "severity": "high",
                    "findings": [{"category": "merge_conflict", "severity": "high", "file": f, "line": 0, "description": f"Unresolvable merge conflict in {f}"} for f in result["unresolved"]],
                    "score": 0.0,
                },
                workspace_path=workspace_path,
                extra_context={"pr_url": pr_url, "conflict_summary": conflict_summary, "type": "merge_conflict"},
            )
            return {"status": "partial", "resolved": result["resolved"], "unresolved": result["unresolved"], "action": "escalated"}
        return {"status": "resolved", "resolved": result["resolved"], "unresolved": [], "action": "proceed"}
    except Exception as exc:
        logger.error("Conflict resolution failed: %s", exc, exc_info=True)
        raise self.retry(exc=exc)
