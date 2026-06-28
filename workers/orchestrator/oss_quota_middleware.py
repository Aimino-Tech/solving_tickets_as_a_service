"""
OSS Quota enforcement middleware (AIM-2042).

Celery signal handlers that enforce disk quota and workspace isolation
*before* workspace creation tasks execute.  Tasks that would exceed the
tenant's quota are rejected (``Ignore``) instead of executing.

Connects to ``task_prerun`` for the workspace creation task.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import signals
from celery.exceptions import Ignore

from workers.orchestrator.oss_quota import get_disk_quota, get_lru_cleanup

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Task routing
# ---------------------------------------------------------------------------

_WORKSPACE_CREATION_TASKS: set[str] = {
    "workers.orchestrator.workspace.create_workspace",
}

# Tasks that are always allowed (housekeeping, health checks, etc.)
_ALLOWED_TASKS: set[str] = {
    "workers.celery_app.ping",
    "workers.tasks.periodic.queue_health_check",
    "workers.tasks.periodic.dlq_cleanup",
    "workers.tasks.periodic.push_metrics",
    "workers.tasks.periodic.report_liveness",
    "workers.tasks.sandbox_gc.sandbox_gc",
}

# ---------------------------------------------------------------------------
# Quota cache (reduce Redis round-trips for repeated checks)
# ---------------------------------------------------------------------------

_quota_cache: dict[str, bool] = {}
_MAX_CACHE_SIZE = 10_000


def _is_workspace_creation(task_name: str) -> bool:
    """Return ``True`` if *task_name* is a workspace creation task."""
    if task_name in _ALLOWED_TASKS:
        return False
    return task_name in _WORKSPACE_CREATION_TASKS


def _extract_tenant(kwargs: dict[str, Any]) -> str | None:
    """Extract the tenant_id from task kwargs."""
    tenant_id = kwargs.get("tenant_id") or kwargs.get("tenantId")
    if tenant_id:
        return str(tenant_id)
    # Fallback: check for issue_context dict
    ctx = kwargs.get("issue_context") or {}
    if isinstance(ctx, dict):
        return ctx.get("tenant_id") or ctx.get("tenantId")
    return None


def _extract_tier(kwargs: dict[str, Any]) -> str | None:
    """Extract the tenant tier from task kwargs."""
    tier = kwargs.get("tenant_tier") or kwargs.get("tier")
    if tier:
        return str(tier)
    ctx = kwargs.get("issue_context") or {}
    if isinstance(ctx, dict):
        return ctx.get("tenant_tier") or ctx.get("tier")
    return None


# ---------------------------------------------------------------------------
# Signal handler
# ---------------------------------------------------------------------------


@signals.task_prerun.connect
def _check_quota_before_workspace_creation(
    task_id: str,
    task: Any,
    args: tuple,
    kwargs: dict,
    **signal_kwargs: Any,
) -> None:
    """Reject workspace creation tasks when the tenant has exceeded disk quota.

    Connected automatically via ``@signals.task_prerun.connect``.
    Simply importing this module activates it.
    """
    task_name = getattr(task, "name", None)
    if not task_name:
        return

    if not _is_workspace_creation(task_name):
        return

    tenant_id = _extract_tenant(kwargs)
    if not tenant_id:
        # No tenant context — allow (legacy / non-OSS mode)
        return

    # Check cache
    cache_key = f"{tenant_id}:{task_name}"
    cached = _quota_cache.get(cache_key)
    if cached is False:
        logger.info(
            "Quota cache blocked task=%s tenant=%s task_id=%s",
            task_name, tenant_id, task_id,
        )
        raise Ignore()

    tier = _extract_tier(kwargs)
    disk_quota = get_disk_quota()

    if not disk_quota.check_quota(tenant_id, tier):
        logger.warning(
            "OSS quota blocked workspace creation task=%s tenant=%s tier=%s task_id=%s",
            task_name, tenant_id, tier or "unknown", task_id,
        )

        # Cache the block
        if len(_quota_cache) < _MAX_CACHE_SIZE:
            _quota_cache[cache_key] = False

        # Attempt LRU eviction to free space
        lru = get_lru_cleanup()
        evicted = lru.evict_lru(tenant_id, tier)
        if evicted:
            logger.info(
                "LRU eviction freed %d workspaces for tenant=%s, retry may succeed",
                len(evicted), tenant_id,
            )

        raise Ignore()

    # Cache the allowance
    if len(_quota_cache) < _MAX_CACHE_SIZE:
        _quota_cache[cache_key] = True

    logger.debug(
        "OSS quota OK task=%s tenant=%s task_id=%s",
        task_name, tenant_id, task_id,
    )


# ---------------------------------------------------------------------------
# Connection acknowledgment
# ---------------------------------------------------------------------------


def connect_oss_quota_middleware() -> None:
    """Acknowledge OSS quota middleware connection (call at startup)."""
    logger.info("OSS quota middleware connected — workspace creation gated by disk quota")
