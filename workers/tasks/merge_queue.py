"""
Celery tasks for the merge queue.

Provides three tasks:

- process_merge_queue -- processes the queue in order
- resolve_conflicts -- attempts auto-resolve on a conflicted PR
- label_conflict_pr -- labels a PR as conflict and moves to rework queue
"""

from __future__ import annotations

import logging

from celery import shared_task

from workers.merge_queue.queue import MergeQueue

logger = logging.getLogger(__name__)

_QUEUE: MergeQueue | None = None


def _get_queue() -> MergeQueue:
    global _QUEUE
    if _QUEUE is None:
        _QUEUE = MergeQueue()
    return _QUEUE


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
    repo_name: str = "",
    pr_number: int = 0,
    pr_url: str = "",
    workspace_path: str = "",
    merge_strategy: str = "squash",
) -> dict:
    """Process the next eligible PR in the merge queue."""
    queue = _get_queue()

    if repo_name and pr_number:
        existing = queue.get_entry(repo_name, pr_number)
        if existing is None:
            queue.enqueue(
                repo_name=repo_name,
                pr_number=pr_number,
                issue_id=issue_id,
                pr_url=pr_url,
                merge_strategy=merge_strategy,
            )

    result = queue.process_next(workspace_path=workspace_path or None)

    status = result.get("status", "unknown")
    entry = result.get("entry")

    if status == "no_pending":
        logger.info("No pending entries in merge queue")
    elif status == "merged":
        logger.info("Merge complete -- issue=%s sha=%s", issue_id, result.get("merge_sha", ""))
    elif status == "conflict":
        logger.warning("Merge conflict -- issue=%s pr=#%d", issue_id, pr_number)
        if workspace_path:
            resolve_conflicts.delay(
                issue_id=issue_id,
                repo_name=repo_name or (entry.repo_name if entry else ""),
                pr_number=pr_number or (entry.pr_number if entry else 0),
                workspace_path=workspace_path,
            )

    return {
        "status": status,
        "issue_id": issue_id,
        "repo_name": repo_name or (entry.repo_name if entry else repo_name),
        "pr_number": pr_number or (entry.pr_number if entry else pr_number),
        "details": result,
    }


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
    repo_name: str,
    pr_number: int,
    workspace_path: str,
) -> dict:
    """Attempt to auto-resolve merge conflicts for a PR."""
    queue = _get_queue()

    if not workspace_path:
        return {"status": "no_workspace", "issue_id": issue_id, "resolved": [], "failed": []}

    result = queue.resolve_conflicts(repo_name, pr_number, workspace_path)

    if result["status"] == "resolved":
        process_merge_queue.delay(
            issue_id=issue_id,
            repo_name=repo_name,
            pr_number=pr_number,
            workspace_path=workspace_path,
        )
        return {"status": "resolved", "issue_id": issue_id, "resolved_files": result["resolved"], "action": "retry_merge"}

    if result["failed"]:
        queue.label_conflict(repo_name, pr_number)

    return {
        "status": result.get("status", "failed"),
        "issue_id": issue_id,
        "resolved_files": result.get("resolved", []),
        "failed": result.get("failed", []),
        "action": "human_review",
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.merge_queue.label_conflict_pr",
    autoretry_for=(Exception,),
)
def label_conflict_pr(
    self,
    issue_id: str,
    repo_name: str,
    pr_number: int,
) -> dict:
    """Label a PR as conflict and set its queue status to conflict."""
    queue = _get_queue()
    queue.label_conflict(repo_name, pr_number)
    entry = queue.get_entry(repo_name, pr_number)
    if entry is not None:
        queue._set_status(repo_name, pr_number, "conflict", "Human intervention required -- auto-resolve failed")
    return {
        "status": "labeled",
        "issue_id": issue_id,
        "repo_name": repo_name,
        "pr_number": pr_number,
        "label": "conflict",
        "action": "human_review",
    }
