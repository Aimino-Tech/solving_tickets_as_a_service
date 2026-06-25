import json
import logging
import os
import re
import subprocess

from celery import shared_task

from workers.review.models import MergeResult, MergeStrategy

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    name="workers.tasks.merge_queue.process_merge_queue",
    autoretry_for=(Exception,),
)
def process_merge_queue(
    self,
    issue_id: str,
    workspace_path: str,
    pr_url: str,
    merge_strategy: str = "squash",
) -> dict:
    logger.info("Processing merge queue -- issue=%s pr=%s strategy=%s", issue_id, pr_url, merge_strategy)

    pr_number = _extract_pr_number(pr_url)
    if not pr_number:
        return {"status": "error", "error": f"Could not extract PR number from {pr_url}"}

    if _has_conflicts(workspace_path):
        logger.info("Merge conflicts detected -- issue=%s", issue_id)
        resolve_conflicts.delay(issue_id, workspace_path, pr_url)
        return {"status": "conflict", "action": "resolve_conflicts", "issue_id": issue_id}

    strategy = MergeStrategy(merge_strategy)
    result = _merge_pr(workspace_path, pr_number, strategy)

    if result.status == "merged":
        _delete_branch(workspace_path)
        logger.info("Merge complete -- issue=%s sha=%s", issue_id, result.merge_sha)

    return result.model_dump()


def _extract_pr_number(pr_url: str) -> int | None:
    match = re.search(r'/pull/(\d+)', pr_url)
    if match:
        return int(match.group(1))
    return None


def _has_conflicts(workspace_path: str) -> bool:
    try:
        result = subprocess.run(
            ["git", "merge", "--no-commit", "--no-ff", "FETCH_HEAD"],
            cwd=workspace_path,
            capture_output=True, text=True, timeout=30,
        )
        subprocess.run(["git", "merge", "--abort"], cwd=workspace_path, capture_output=True, timeout=10)
        return result.returncode != 0
    except Exception:
        return False


def _merge_pr(workspace_path: str, pr_number: int, strategy: MergeStrategy) -> MergeResult:
    try:
        if strategy == MergeStrategy.squash:
            cmd = ["git", "merge", "--squash", f"refs/pull/{pr_number}/head"]
        elif strategy == MergeStrategy.rebase:
            cmd = ["git", "rebase", f"refs/pull/{pr_number}/head"]
        else:
            cmd = ["git", "merge", "--no-ff", f"refs/pull/{pr_number}/head"]

        result = subprocess.run(
            cmd, cwd=workspace_path, capture_output=True, text=True, timeout=60,
        )

        if result.returncode != 0:
            return MergeResult(status="failed", error=result.stderr[:500])

        sha_result = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=workspace_path, capture_output=True, text=True, timeout=10,
        )
        sha = sha_result.stdout.strip()

        subprocess.run(
            ["git", "push", "origin", "main"], cwd=workspace_path, capture_output=True, timeout=30,
        )

        return MergeResult(status="merged", merge_sha=sha)
    except subprocess.TimeoutExpired:
        return MergeResult(status="failed", error="Merge operation timed out")
    except Exception as exc:
        return MergeResult(status="failed", error=str(exc))


def _delete_branch(workspace_path: str):
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=workspace_path, capture_output=True, text=True, timeout=10,
        )
        branch = result.stdout.strip()
        subprocess.run(
            ["git", "push", "origin", "--delete", branch],
            cwd=workspace_path, capture_output=True, timeout=30,
        )
    except Exception as exc:
        logger.warning("Failed to delete branch: %s", exc)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=15,
    name="workers.tasks.merge_queue.resolve_conflicts",
    autoretry_for=(Exception,),
)
def resolve_conflicts(
    self,
    issue_id: str,
    workspace_path: str,
    pr_url: str,
) -> dict:
    logger.info("Resolving conflicts -- issue=%s", issue_id)

    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "--diff-filter=U"],
            cwd=workspace_path, capture_output=True, text=True, timeout=15,
        )
        conflict_files = result.stdout.strip().split("\n") if result.stdout.strip() else []

        resolved = []
        failed = []
        for f in conflict_files:
            try:
                subprocess.run(
                    ["git", "checkout", "--ours", f],
                    cwd=workspace_path, capture_output=True, timeout=15,
                )
                subprocess.run(
                    ["git", "add", f],
                    cwd=workspace_path, capture_output=True, timeout=15,
                )
                resolved.append(f)
            except Exception as exc:
                failed.append({"file": f, "error": str(exc)})

        if failed:
            return {
                "status": "partial",
                "resolved": resolved,
                "failed": failed,
                "action": "human_review",
                "issue_id": issue_id,
            }

        return {
            "status": "resolved",
            "resolved_files": resolved,
            "action": "retry_merge",
            "issue_id": issue_id,
        }

    except Exception as exc:
        logger.error("Conflict resolution failed -- %s", exc, exc_info=True)
        raise self.retry(exc=exc)
