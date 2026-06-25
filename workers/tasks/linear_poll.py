"""
Linear poll task -- Celery beat task that polls Linear for active issues and
dispatches them to the triage queue.

Uses Redis (_get_redis) for cross-worker deduplication so that the same
issue is not dispatched multiple times across Celery workers.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import Task

from workers.celery_app import app
from workers.linear.client import get_client
from workers.tracker.routing import classify_pipeline, PipelineType

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Redis-backed deduplication
# ---------------------------------------------------------------------------

TRACKED_SET_KEY = "stas:tracked_issues"


def _get_redis():
    """
    Return a Redis client instance, or None if Redis is not configured.

    Falls back to None so that the poll task can degrade gracefully
    when no Redis is available (single-worker mode uses an in-memory set).
    """
    try:
        import redis as redis_module

        from workers.config import settings

        if settings.redis_url:
            return redis_module.from_url(settings.redis_url)
        return None
    except Exception:
        logger.warning("Redis not available -- using in-memory dedup fallback")
        return None


def is_already_tracked(issue_id: str) -> bool:
    """Check if *issue_id* has already been dispatched (via Redis or in-memory)."""
    r = _get_redis()
    if r is not None:
        try:
            return bool(r.sismember(TRACKED_SET_KEY, issue_id))
        except Exception:
            logger.exception("Redis sismember failed -- falling back to in-memory")
            return issue_id in _is_tracked
    return issue_id in _is_tracked


def mark_tracked(issue_id: str) -> None:
    """Mark *issue_id* as tracked (in Redis and in-memory)."""
    _is_tracked.add(issue_id)
    r = _get_redis()
    if r is not None:
        try:
            r.sadd(TRACKED_SET_KEY, issue_id)
        except Exception:
            logger.exception("Redis sadd failed")


# In-memory fallback set (used when Redis is unavailable)
_is_tracked: set[str] = set()


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


@app.task(bind=True, queue="stas.issues.triage", max_retries=3, default_retry_delay=30)
def poll_active_issues(self: Task) -> dict[str, Any]:
    """Poll Linear for active issues and dispatch them to the triage queue."""
    logger.info("Polling Linear for active issues")
    client = get_client()
    issues = client.get_issues_by_state(states=["Todo", "In Progress"])
    dispatched = 0
    skipped = 0

    for issue in issues:
        issue_id = issue["id"]
        if is_already_tracked(issue_id):
            skipped += 1
            continue
        mark_tracked(issue_id)

        labels = issue.get("labels", {}).get("nodes", [])
        pipeline: PipelineType = classify_pipeline(labels)

        logger.info(
            "Dispatching issue %s -- pipeline=%s title=%s",
            issue.get("identifier", issue_id), pipeline, issue.get("title", ""),
        )

        triage.delay(
            issue_id=issue_id,
            identifier=issue.get("identifier", ""),
            pipeline=pipeline,
            title=issue.get("title", ""),
        )
        dispatched += 1

    return {
        "status": "completed",
        "dispatched": dispatched,
        "skipped": skipped,
        "total_found": len(issues),
    }


@app.task(bind=True, queue="stas.agents.dispatch")
def triage(self: Task, issue_id: str, identifier: str, pipeline: str, title: str) -> dict[str, Any]:
    """Process a dispatched issue -- comment on the Linear issue and mark triage complete."""
    client = get_client()
    client.post_comment(issue_id, f"**STAS**: Working on it -- pipeline {pipeline}")
    return {
        "issue_id": issue_id,
        "identifier": identifier,
        "pipeline": pipeline,
        "status": "triage_complete",
    }


@app.task(bind=True, queue="stas.queue.notifications")
def notify_progress(
    self: Task,
    issue_id: str,
    stage: str,
    message: str,
) -> dict[str, Any]:
    """Post a progress comment to a Linear issue."""
    client = get_client()
    client.post_comment(issue_id, f"**STAS**: {message}")
    return {"issue_id": issue_id, "stage": stage, "sent": True}


@app.task(bind=True, queue="stas.agents.self_audit")
def transition_state(self: Task, issue_id: str, current_state: str) -> dict[str, Any]:
    """Transition a Linear issue to its next pipeline state."""
    from workers.tracker.state_machine import next_state

    target = next_state(current_state)
    if target:
        client = get_client()
        client.transition_issue(issue_id, target)
        logger.info("Transitioned %s from %s to %s", issue_id, current_state, target)
        return {"issue_id": issue_id, "from": current_state, "to": target}
    return {"issue_id": issue_id, "from": current_state, "to": None}
