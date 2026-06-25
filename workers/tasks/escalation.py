from __future__ import annotations

import json
import logging
from typing import Any

from celery import shared_task

from workers.escalation import SlackEscalator, LinearIncidentCreator, PagerDutyEscalator, EscalationTracker

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.escalation.handle_retry_exceeded",
)
def handle_retry_exceeded(
    self,
    issue_key: str,
    repo: str = "",
    issue_number: int = 0,
    error: str = "",
    trace: str = "",
) -> dict[str, Any]:
    tracker = EscalationTracker()
    tracker.record_retry(issue_key, 0, error, repo, issue_number)

    if tracker.is_silenced(issue_key):
        return {"escalated": False, "reason": "silenced"}

    retry_info = tracker.record_retry(issue_key, 0, error, repo, issue_number)
    retry_count = retry_info["total_retries"]

    result: dict[str, Any] = {
        "issue_key": issue_key,
        "retry_count": retry_count,
        "slack": False,
        "linear_incident": "",
        "pagerduty": False,
    }

    slack = SlackEscalator()
    if slack.is_configured():
        result["slack"] = slack.page_oncall(
            issue_key=issue_key,
            reason=f"Max retries exceeded: {error}",
            retry_count=retry_count,
            repo=repo,
            issue_number=issue_number,
            trace=trace,
        )

    tracker.log_escalation_event("retry_exceeded", issue_key, {
        "repo": repo,
        "issue_number": issue_number,
        "error": error,
        "retry_count": retry_count,
    })

    return result


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.escalation.handle_infrastructure_failure",
)
def handle_infrastructure_failure(
    self,
    service: str,
    error: str,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "service": service,
        "error": error,
        "slack": False,
        "linear_incident": "",
    }

    slack = SlackEscalator()
    if slack.is_configured():
        result["slack"] = slack.alert_infrastructure_failure(service, error, context)

    linear = LinearIncidentCreator()
    if linear.is_configured():
        result["linear_incident"] = linear.create_incident(service, error, "critical", context)

    tracker = EscalationTracker()
    tracker.log_escalation_event("infrastructure_failure", service, {
        "error": error,
        "context": context,
    })

    return result


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.escalation.handle_pipeline_failure",
)
def handle_pipeline_failure(
    self,
    issue_key: str,
    stage: str,
    error: str,
    repo: str = "",
    issue_number: int = 0,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "issue_key": issue_key,
        "stage": stage,
        "slack": False,
        "pagerduty": False,
    }

    tracker = EscalationTracker()
    retry_info = tracker.record_retry(issue_key, 0, error, repo, issue_number)
    retry_count = retry_info["total_retries"]

    if retry_count >= 3:
        pd = PagerDutyEscalator()
        if pd.is_configured():
            result["pagerduty"] = pd.fire_alert(
                issue_key=issue_key,
                reason=f"Pipeline failure at {stage}: {error}",
                retry_count=retry_count,
                repo=repo,
                issue_number=issue_number,
            )

        slack = SlackEscalator()
        if slack.is_configured():
            result["slack"] = slack.page_oncall(
                issue_key=issue_key,
                reason=f"Pipeline failure at {stage} (retry #{retry_count}): {error}",
                retry_count=retry_count,
                repo=repo,
                issue_number=issue_number,
            )

    tracker.log_escalation_event("pipeline_failure", issue_key, {
        "stage": stage,
        "error": error,
        "retry_count": retry_count,
    })

    return result
