from __future__ import annotations

import logging

from celery import shared_task

from workers.budget import BudgetTracker, BudgetEnforcer

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.budget.track_usage",
)
def track_usage(
    self,
    tenant_id: str,
    task_id: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> dict:
    tracker = BudgetTracker()
    result = tracker.track_usage(tenant_id, task_id, model, input_tokens, output_tokens)
    logger.info(
        "Usage tracked for %s: tokens=%d cost=%.4f",
        tenant_id,
        result["total_tokens"],
        result["cost"],
    )
    return result


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.budget.check_budget",
)
def check_budget(self, tenant_id: str) -> dict:
    enforcer = BudgetEnforcer()
    return enforcer.check_budget(tenant_id)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.budget.enforce_pre_dispatch",
)
def enforce_pre_dispatch(self, tenant_id: str) -> dict:
    enforcer = BudgetEnforcer()
    return enforcer.enforce_pre_dispatch(tenant_id)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.budget.reset_billing_cycle",
)
def reset_billing_cycle(self, tenant_id: str) -> dict:
    tracker = BudgetTracker()
    tracker.reset_billing_cycle(tenant_id)
    return {"tenant_id": tenant_id, "reset": True}
