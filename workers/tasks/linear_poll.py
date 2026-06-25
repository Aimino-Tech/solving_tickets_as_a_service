"""
Celery tasks for polling Linear issues and dispatching them to pipelines.

Provides:
- ``poll_active_issues`` — Beat task that polls Linear for active issues and
  dispatches them to the triage queue.
- ``triage`` — Handles an individual issue dispatch (comments on Linear,
  returns triage metadata).
- ``notify_progress`` — Posts a progress comment to a Linear issue.
- ``transition_state`` — Moves a Linear issue to its next workflow state via
  the state machine.
"""

import asyncio
import logging
from typing import Any

from celery import Task

from workers.celery_app import app
from workers.linear.client import LinearClient, LinearIssue
from workers.tracker.routing import resolve_pipeline
from workers.tracker.state_machine import resolve_state, get_active_states

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level client singleton
# ---------------------------------------------------------------------------

_client: LinearClient | None = None


def _get_client() -> LinearClient:
    """Return the module-level ``LinearClient`` singleton."""
    global _client
    if _client is None:
        _client = LinearClient()
    return _client


def _run_async(coro):
    """Run an async coroutine synchronously from a sync Celery task."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    # If a loop is already running (e.g. in tests), run in a fresh thread
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


# ---------------------------------------------------------------------------
# In-memory dedup set (single‑worker assumption; swap for Redis in production)
# ---------------------------------------------------------------------------

_is_tracked: set[str] = set()


def is_already_tracked(issue_id: str) -> bool:
    return issue_id in _is_tracked


def mark_tracked(issue_id: str) -> None:
    _is_tracked.add(issue_id)


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


@app.task(
    bind=True,
    queue="stas.issues.triage",
    max_retries=3,
    default_retry_delay=30,
)
def poll_active_issues(self: Task) -> dict[str, Any]:
    """
    Poll Linear for issues in active workflow states and dispatch new ones.

    Called by Celery Beat every 30 seconds (see ``celeryconfig.py``).
    """
    logger.info("Polling Linear for active issues")

    client = _get_client()
    active_states = get_active_states()

    issues: list[LinearIssue] = _run_async(
        client.get_issues_by_state(active_states),
    )
    dispatched = 0

    for issue in issues:
        if is_already_tracked(issue.id):
            continue
        mark_tracked(issue.id)

        pipeline = resolve_pipeline(issue.labels)

        logger.info(
            "Dispatching issue %s — pipeline=%s title=%s",
            issue.id,
            pipeline,
            issue.title,
        )

        triage.delay(
            issue_id=issue.id,
            identifier=issue.id,
            pipeline=pipeline,
            title=issue.title,
        )
        dispatched += 1

    return {"dispatched": dispatched, "total_found": len(issues)}


@app.task(bind=True, queue="stas.agents.dispatch")
def triage(
    self: Task,
    issue_id: str,
    identifier: str,
    pipeline: str,
    title: str,
) -> dict[str, Any]:
    """
    Handle a single issue dispatch: post a comment on Linear and return
    triage metadata.
    """
    logger.info(
        "Triaging issue %s — pipeline=%s title=%s",
        identifier,
        pipeline,
        title,
    )

    client = _get_client()
    _run_async(
        client.post_comment(
            issue_id,
            f"**STAS**: Working on it — pipeline `{pipeline}`",
        ),
    )

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
    client = _get_client()
    _run_async(client.post_comment(issue_id, f"**STAS**: {message}"))
    return {"issue_id": issue_id, "stage": stage, "sent": True}


@app.task(bind=True, queue="stas.agents.self_audit")
def transition_state(
    self: Task,
    issue_id: str,
    current_state: str,
) -> dict[str, Any]:
    """
    Move an issue to its next workflow state via the state machine.

    The target state is determined by ``resolve_state()``.  If no transition
    is defined (e.g. already terminal), the task is a no-op.
    """
    target = resolve_state(current_state)
    if target:
        client = _get_client()
        _run_async(client.transition_issue(issue_id, target))
        logger.info(
            "Transitioned %s from %s to %s",
            issue_id,
            current_state,
            target,
        )
        return {"issue_id": issue_id, "from": current_state, "to": target}

    logger.info(
        "No transition for %s (current=%s) — already terminal or unknown",
        issue_id,
        current_state,
    )
    return {"issue_id": issue_id, "from": current_state, "to": None}
