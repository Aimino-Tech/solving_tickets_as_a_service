"""
Celery Beat periodic task — monthly budget reset for all tenants.

Resets per-tenant budget counters (tokens_used, cost_incurred → 0) at the
rollover of each billing period. The default schedule is midnight UTC on
the 1st of every month, configurable via the beat_schedule entry.

── Design ─────────────────────────────────────────────────────────────────────
- Scans all budget records in Redis via the tracker's ``get_all_budgets()``.
- Resets each tenant's counters to zero and updates ``period_start``.
- Logs a summary of reset, failed, and total processed tenants.
- Failures are isolated — one tenant's reset failure does not block others.
────────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from celery import shared_task

from workers.budget.tracker import get_all_budgets, reset_budget

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=120,
    autoretry_for=(Exception,),
    name="workers.tasks.budget_billing_cycle.monthly_budget_reset",
)
def monthly_budget_reset(self: Any) -> dict[str, Any]:
    """
    Celery Beat periodic task — reset all tenant budgets for the new month.

    Scheduled via ``celeryconfig.py`` beat_schedule (default: midnight UTC
    on the 1st of each month via ``crontab(hour=0, minute=0, day_of_month=1)``).

    Iterates all budget records in Redis, resets counters to zero, and updates
    ``period_start`` to the current timestamp.

    Returns a summary dict with counts of total, reset, and failed tenants.
    """
    logger.info("Starting monthly budget reset for all tenants")

    budgets = get_all_budgets()
    total = len(budgets)
    reset_count = 0
    failed = 0
    errors: list[str] = []

    for budget in budgets:
        try:
            ok = reset_budget(budget.tenant_id)
            if ok:
                reset_count += 1
            else:
                failed += 1
                errors.append(budget.tenant_id)
        except Exception as exc:
            logger.error(
                "Budget reset failed for tenant=%s — %s",
                budget.tenant_id,
                exc,
            )
            failed += 1
            errors.append(budget.tenant_id)

    now = datetime.now(timezone.utc).isoformat()
    summary = {
        "total": total,
        "reset": reset_count,
        "failed": failed,
        "errors": errors[:20],
        "timestamp": now,
    }

    level = logger.error if failed > 0 else logger.info
    level("Monthly budget reset complete — %s", json.dumps(summary))

    return summary
