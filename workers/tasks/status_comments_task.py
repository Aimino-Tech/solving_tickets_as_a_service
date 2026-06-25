from __future__ import annotations

import logging

from celery import shared_task

from workers.notifications.status_comments import (
    post_stage_start,
    post_stage_complete,
    post_stage_failure,
    coalescer,
    is_enabled,
)

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.status_comments.report_stage",
)
def report_stage(
    self,
    issue_id: str,
    stage: str,
    status: str,
    detail: str = "",
) -> dict:
    if not is_enabled():
        return {"status": "disabled", "issue_id": issue_id}

    if status == "started":
        post_stage_start(issue_id, stage)
    elif status == "completed":
        post_stage_complete(issue_id, stage, detail)
    elif status == "failed":
        post_stage_failure(issue_id, stage, detail)

    return {"status": "posted", "issue_id": issue_id, "stage": stage}


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.status_comments.report_stage_coalesced",
)
def report_stage_coalesced(
    self,
    issue_id: str,
    stage: str,
    status: str,
    detail: str = "",
) -> dict:
    if not is_enabled():
        return {"status": "disabled", "issue_id": issue_id}

    coalescer.add_event(issue_id, stage, status, detail)
    return {"status": "queued", "issue_id": issue_id, "stage": stage}
