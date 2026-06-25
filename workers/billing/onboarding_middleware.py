"""Onboarding middleware -- gates task dispatch against incomplete onboarding."""

from __future__ import annotations

import logging
from typing import Any

from celery import Task, signals
from workers.billing.onboarding import get_onboarding_machine

logger = logging.getLogger(__name__)


class OnboardingIncomplete(Exception):
    def __init__(self, tenant_id: str, current_state: str) -> None:
        self.tenant_id = tenant_id
        self.current_state = current_state
        super().__init__(
            f"Tenant {tenant_id!r} has not completed onboarding "
            f"(state={current_state!r}). Tasks are blocked until onboarding is finished."
        )


_completed_cache: dict[str, bool] = {}
_MAX_CACHE_SIZE = 10_000


def _check_onboarding(tenant_id: str, task: Task, task_id: str) -> None:
    if _completed_cache.get(tenant_id):
        return
    machine = get_onboarding_machine()
    state = machine.get_state(tenant_id)
    if state is None or not state.completed:
        current = state.state if state else "not_started"
        logger.warning("Blocking task task=%s task_id=%s tenant=%s onboarding_state=%s", task.name, task_id, tenant_id, current)
        raise OnboardingIncomplete(tenant_id, current)
    if len(_completed_cache) < _MAX_CACHE_SIZE:
        _completed_cache[tenant_id] = True


@signals.task_prerun.connect
def _on_task_prerun(task_id: str, task: Task, **kwargs: Any) -> None:
    request = getattr(task, "request", None)
    if request is None:
        return
    args = request.args if hasattr(request, "args") else ()
    task_kwargs = request.kwargs if hasattr(request, "kwargs") else {}
    tenant_id: str | None = (
        task_kwargs.get("tenant_id")
        or task_kwargs.get("tenantId")
        or (args[0] if args and isinstance(args[0], str) else None)
    )
    if tenant_id is None:
        return
    _check_onboarding(tenant_id, task, task_id)


_cache = _completed_cache


def invalidate_cache(tenant_id: str | None = None) -> None:
    if tenant_id is not None:
        _cache.pop(tenant_id, None)
    else:
        _cache.clear()


def connect_onboarding_middleware() -> None:
    logger.info("Onboarding middleware connected -- task dispatch gated by onboarding completion")
