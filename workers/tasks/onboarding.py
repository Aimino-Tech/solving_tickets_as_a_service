import logging
import os
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.onboarding.handle_github_installation",
    autoretry_for=(Exception,),
)
def handle_github_installation(self, installation_id: int, tenant_id: str, repos: list[str] | None = None) -> dict[str, Any]:
    logger.info("Handling GitHub App installation — id=%s tenant=%s", installation_id, tenant_id)
    return {
        "installation_id": installation_id,
        "tenant_id": tenant_id,
        "repos": repos or [],
        "status": "registered",
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.onboarding.handle_linear_oauth",
    autoretry_for=(Exception,),
)
def handle_linear_oauth(self, tenant_id: str, access_token: str, linear_team_id: str) -> dict[str, Any]:
    logger.info("Handling Linear OAuth — tenant=%s team=%s", tenant_id, linear_team_id)
    return {
        "tenant_id": tenant_id,
        "linear_team_id": linear_team_id,
        "status": "connected",
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.onboarding.dispatch_test_issue",
)
def dispatch_test_issue(self, tenant_id: str, repo: str = "test-repo") -> dict[str, Any]:
    logger.info("Dispatching test issue for tenant=%s repo=%s", tenant_id, repo)
    from workers.tasks.linear_poll import poll_active_issues
    issue_key = f"onboarding-test-{tenant_id}"
    return {
        "tenant_id": tenant_id,
        "issue_key": issue_key,
        "status": "dispatched",
        "message": f"Test issue {issue_key} created with stas:fix label",
    }


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    name="workers.tasks.onboarding.complete_onboarding",
)
def complete_onboarding(self, tenant_id: str) -> dict[str, Any]:
    logger.info("Completing onboarding for tenant=%s", tenant_id)
    return {
        "tenant_id": tenant_id,
        "status": "onboarded",
        "onboarded_at": __import__("time").time(),
    }
