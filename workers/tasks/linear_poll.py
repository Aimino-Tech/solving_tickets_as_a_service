import logging
from typing import Any

from celery import Task

from workers.celery_app import app
from workers.linear.client import get_issues_by_state, post_comment
from workers.tracker.routing import classify_pipeline, PipelineType
from workers.tracker.state_machine import next_state

logger = logging.getLogger(__name__)

_is_tracked: set[str] = set()


def is_already_tracked(issue_id: str) -> bool:
    return issue_id in _is_tracked


def mark_tracked(issue_id: str) -> None:
    _is_tracked.add(issue_id)


@app.task(bind=True, queue="stas.issues.triage", max_retries=3, default_retry_delay=30)
def poll_active_issues(self: Task) -> dict[str, Any]:
    logger.info("Polling Linear for active issues")
    issues = get_issues_by_state()
    dispatched = 0

    for issue in issues:
        issue_id = issue["id"]
        if is_already_tracked(issue_id):
            continue
        mark_tracked(issue_id)

        labels = issue.get("labels", {}).get("nodes", [])
        pipeline: PipelineType = classify_pipeline(labels)

        logger.info(
            "Dispatching issue %s — pipeline=%s title=%s",
            issue["identifier"], pipeline, issue["title"],
        )

        triage.delay(
            issue_id=issue_id,
            identifier=issue["identifier"],
            pipeline=pipeline,
            title=issue["title"],
        )
        dispatched += 1

    return {"dispatched": dispatched, "total_found": len(issues)}


@app.task(bind=True, queue="stas.agents.dispatch")
def triage(self: Task, issue_id: str, identifier: str, pipeline: str, title: str) -> dict[str, Any]:
    post_comment(issue_id, f"🔄 **STAS**: Working on it — pipeline `{pipeline}`")
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
    post_comment(issue_id, f"**STAS**: {message}")
    return {"issue_id": issue_id, "stage": stage, "sent": True}


@app.task(bind=True, queue="stas.agents.self_audit")
def transition_state(self: Task, issue_id: str, current_state: str) -> dict[str, Any]:
    target = next_state(current_state)
    if target:
        from workers.linear.client import transition_issue
        transition_issue(issue_id, target)
        logger.info("Transitioned %s from %s to %s", issue_id, current_state, target)
        return {"issue_id": issue_id, "from": current_state, "to": target}
    return {"issue_id": issue_id, "from": current_state, "to": None}
