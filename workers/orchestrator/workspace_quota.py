"""
Workspace Quota Manager (AIM-2013).

Operational layer that wraps DiskQuota and WorkspaceIsolation
with Redis-backed counters, LRU eviction, and a periodic cleanup task
for enforcing per-tenant workspace quotas.
"""

from __future__ import annotations

import logging
import os
import shutil
import time
from typing import Any, Optional

from celery import current_app

from workers.orchestrator.quota import (
    DiskQuota,
    WorkspaceIsolation,
    get_disk_quota,
    get_workspace_isolation,
    resolve_tier,
    quota_for_tier,
)

logger = logging.getLogger(__name__)

_LRU_CLEANUP_INTERVAL_S = int(os.getenv("LRU_CLEANUP_INTERVAL_S", "300"))
_LRU_MAX_WORKSPACES_FREE = int(os.getenv("LRU_MAX_WORKSPACES_FREE", "5"))
_LRU_MAX_WORKSPACES_SOLO = int(os.getenv("LRU_MAX_WORKSPACES_SOLO", "20"))
_LRU_MAX_WORKSPACES_TEAM = int(os.getenv("LRU_MAX_WORKSPACES_TEAM", "50"))
_LRU_MAX_WORKSPACES_ENTERPRISE = int(os.getenv("LRU_MAX_WORKSPACES_ENTERPRISE", "100"))

_TIER_LRU_MAX: dict[str, int] = {
    "free": _LRU_MAX_WORKSPACES_FREE,
    "solo": _LRU_MAX_WORKSPACES_SOLO,
    "team": _LRU_MAX_WORKSPACES_TEAM,
    "enterprise": _LRU_MAX_WORKSPACES_ENTERPRISE,
}

_REDIS_LRU_PREFIX = "syntaro:quota:lru:"
_REDIS_WORKSPACE_ACCESS_KEY = lambda tenant: f"{_REDIS_LRU_PREFIX}{tenant}:access"

_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod
        url = os.getenv(
            "REDIS_URL",
            os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
        )
        _REDIS_CLIENT = _redis_mod.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Quota manager Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None


def _lru_max_for_tier(tier: str) -> int:
    return _TIER_LRU_MAX.get(tier, _LRU_MAX_WORKSPACES_FREE)


class QuotaManager:
    def __init__(
        self,
        disk_quota: DiskQuota | None = None,
        isolation: WorkspaceIsolation | None = None,
    ) -> None:
        self._disk_quota = disk_quota or get_disk_quota()
        self._isolation = isolation or get_workspace_isolation()

    def can_create_workspace(
        self,
        tenant_id: str,
        tier: str | None = None,
        estimated_bytes: int | None = None,
    ) -> bool:
        if not self._disk_quota.check_quota(tenant_id, tier, estimated_bytes):
            return False

        effective_tier = resolve_tier(tenant_id, tier)
        max_workspaces = _lru_max_for_tier(effective_tier)
        current_count = len(self._isolation.list_tenant_workspaces(tenant_id))
        if current_count >= max_workspaces:
            logger.info(
                "Workspace count limit reached tenant=%s tier=%s count=%d limit=%d",
                tenant_id, effective_tier, current_count, max_workspaces,
            )
            return False

        return True

    def prepare_workspace(self, tenant_id: str, issue_key: str) -> str:
        ws_path = self._isolation.workspace_root(tenant_id, issue_key)
        os.makedirs(ws_path, exist_ok=True)
        self._record_access(tenant_id, ws_path)
        return ws_path

    def record_workspace_usage(self, tenant_id: str, workspace_path: str) -> None:
        if not os.path.isdir(workspace_path):
            return
        try:
            size = DiskQuota._dir_size(workspace_path)
            self._disk_quota.record_usage(tenant_id, workspace_path, size)
        except Exception as exc:
            logger.error("Failed to record workspace usage tenant=%s -- %s", tenant_id, exc)

    def release_workspace(self, tenant_id: str, workspace_path: str) -> None:
        self._disk_quota.release_usage(tenant_id, workspace_path)
        self._remove_lru_entry(tenant_id, workspace_path)

    def get_usage_summary(self, tenant_id: str, tier: str | None = None) -> dict[str, Any]:
        effective_tier = resolve_tier(tenant_id, tier)
        quota = quota_for_tier(effective_tier)
        used = self._disk_quota.get_tenant_usage(tenant_id)
        remaining = -1 if quota < 0 else max(0, quota - used)
        workspace_count = len(self._isolation.list_tenant_workspaces(tenant_id))
        max_workspaces = _lru_max_for_tier(effective_tier)

        return {
            "tenant_id": tenant_id,
            "tier": effective_tier,
            "quota_bytes": quota,
            "used_bytes": used,
            "remaining_bytes": remaining,
            "workspace_count": workspace_count,
            "max_workspaces": max_workspaces,
            "unlimited": quota < 0,
        }

    def _record_access(self, tenant_id: str, workspace_path: str) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            now = time.time()
            key = _REDIS_WORKSPACE_ACCESS_KEY(tenant_id)
            client.zadd(key, {workspace_path: now})
            client.expire(key, 86400 * 7)
        except Exception as exc:
            logger.error("Failed to record LRU access tenant=%s -- %s", tenant_id, exc)

    def _remove_lru_entry(self, tenant_id: str, workspace_path: str) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_WORKSPACE_ACCESS_KEY(tenant_id)
            client.zrem(key, workspace_path)
        except Exception as exc:
            logger.error("Failed to remove LRU entry tenant=%s -- %s", tenant_id, exc)

    def evict_lru_workspaces(
        self,
        tenant_id: str,
        tier: str | None = None,
        dry_run: bool = False,
    ) -> list[str]:
        client = _get_redis()
        if not client:
            return []

        effective_tier = resolve_tier(tenant_id, tier)
        max_workspaces = _lru_max_for_tier(effective_tier)
        key = _REDIS_WORKSPACE_ACCESS_KEY(tenant_id)

        try:
            count = client.zcard(key) or 0
            if count <= max_workspaces:
                return []

            excess = count - max_workspaces
            candidates = client.zrange(key, 0, excess - 1)

            if dry_run:
                return list(candidates)

            evicted: list[str] = []
            for ws_path in candidates:
                try:
                    if os.path.isdir(ws_path):
                        shutil.rmtree(ws_path)
                    client.zrem(key, ws_path)
                    self._disk_quota.release_usage(tenant_id, ws_path)
                    evicted.append(ws_path)
                except Exception as exc:
                    logger.error(
                        "LRU eviction failed tenant=%s path=%s -- %s",
                        tenant_id, ws_path, exc,
                    )
            return evicted
        except Exception as exc:
            logger.error("LRU eviction error tenant=%s -- %s", tenant_id, exc)
            return []

    def evict_all_for_tenant(self, tenant_id: str) -> int:
        client = _get_redis()
        if not client:
            return 0

        key = _REDIS_WORKSPACE_ACCESS_KEY(tenant_id)
        try:
            paths = client.zrange(key, 0, -1)
            count = 0
            for ws_path in paths:
                try:
                    if os.path.isdir(ws_path):
                        shutil.rmtree(ws_path)
                    client.zrem(key, ws_path)
                    self._disk_quota.release_usage(tenant_id, ws_path)
                    count += 1
                except Exception as exc:
                    logger.error(
                        "Full tenant eviction failed tenant=%s path=%s -- %s",
                        tenant_id, ws_path, exc,
                    )
            return count
        except Exception as exc:
            logger.error("Full tenant eviction error tenant=%s -- %s", tenant_id, exc)
            return 0


class PeriodicCleanupTask:
    def __init__(self, manager: QuotaManager | None = None) -> None:
        self._manager = manager or get_quota_manager()
        self._last_cleanup: float = 0.0

    def run(self, force: bool = False) -> dict[str, int]:
        if not force:
            elapsed = time.time() - self._last_cleanup
            if elapsed < _LRU_CLEANUP_INTERVAL_S:
                return {}

        client = _get_redis()
        if not client:
            return {}

        results: dict[str, int] = {}
        cursor = "0"
        try:
            while cursor is not None:
                cursor, keys = client.scan(
                    cursor=cursor, match="syntaro:quota:*:usage", count=100,
                )
                for key in keys:
                    prefix = "syntaro:quota:"
                    suffix = ":usage"
                    inner = key[len(prefix):]
                    tenant_id = inner[:-len(suffix)] if inner.endswith(suffix) else inner
                    if not tenant_id:
                        continue
                    evicted = self._manager.evict_lru_workspaces(tenant_id)
                    if evicted:
                        results[tenant_id] = len(evicted)
                cursor = int(cursor) if cursor else None
        except Exception as exc:
            logger.error("Periodic cleanup scan error -- %s", exc)

        self._last_cleanup = time.time()
        return results


@current_app.task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.orchestrator.workspace_quota.periodic_cleanup_task",
    autoretry_for=(Exception,),
)
def periodic_cleanup_task(self) -> dict[str, int]:
    cleanup = PeriodicCleanupTask()
    return cleanup.run()


_quota_manager: Optional[QuotaManager] = None
_periodic_cleanup: Optional[PeriodicCleanupTask] = None


def get_quota_manager() -> QuotaManager:
    global _quota_manager
    if _quota_manager is None:
        _quota_manager = QuotaManager()
    return _quota_manager


def get_periodic_cleanup() -> PeriodicCleanupTask:
    global _periodic_cleanup
    if _periodic_cleanup is None:
        _periodic_cleanup = PeriodicCleanupTask()
    return _periodic_cleanup
