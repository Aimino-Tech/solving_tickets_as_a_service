"""Celery signal middleware for merge queue processing."""
from __future__ import annotations
import logging
from typing import Any
from celery import signals
from workers.merge_queue.queue import MergeQueue
from workers.tasks import merge_queue as merge_tasks

logger = logging.getLogger(__name__)

_PR_CREATION_TASKS: set[str] = {"workers.tasks.pr_creation.create_pull_request"}
_QUEUE: MergeQueue | None = None


def _get_queue() -> MergeQueue:
    global _QUEUE
    if _QUEUE is None:
        _QUEUE = MergeQueue()
    return _QUEUE


@signals.task_postrun.connect
def _auto_enqueue_on_pr_created(
    task_id: str, task: Any, state: str, retval: Any, **signal_kwargs: Any,
) -> None:
    task_name = getattr(task, "name", None)
    if not task_name or task_name not in _PR_CREATION_TASKS:
        return
    if state != "SUCCESS" or not isinstance(retval, dict):
        return
    if retval.get("status") not in ("created", "opened"):
        return
    repo_info = retval.get("repo_info", {})
    repo_name = f"{repo_info.get('owner', '?')}/{repo_info.get('repo', '?')}"
    pr_number = retval.get("number") or retval.get("pr_number")
    issue_id = retval.get("fix_result", {}).get("issue_id", "")
    pr_url = retval.get("html_url", retval.get("pr_url", ""))
    if not pr_number:
        return
    queue = _get_queue()
    if queue.get_entry(repo_name, pr_number) is not None:
        return
    entry = queue.enqueue(repo_name=repo_name, pr_number=pr_number, issue_id=issue_id or f"PR-{pr_number}", pr_url=pr_url)
    merge_tasks.process_merge_queue.delay(
        issue_id=entry.issue_id, repo_name=entry.repo_name,
        pr_number=entry.pr_number, pr_url=entry.pr_url,
        merge_strategy=entry.merge_strategy,
    )


def connect_merge_queue_middleware() -> None:
    logger.debug("Merge queue middleware connected")
