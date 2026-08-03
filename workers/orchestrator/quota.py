"""
Workspace Quota & Isolation (AIM-2013).

Per-tenant disk quota enforcement, workspace isolation, and
configurable limits per plan tier.

Classes
-------
    DiskQuota
        Per-tenant/tier disk quota enforcement backed by Redis.
    WorkspaceIsolation
        Ensures workspaces are isolated per tenant under ``/workspaces/{tenant}/``.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

_WORKSPACE_ROOT = os.getenv("WORKSPACE_ROOT", "/workspaces")

_QUOTA_FREE_BYTES = int(os.getenv("QUOTA_FREE_BYTES", str(512 * 1024 * 1024)))
_QUOTA_SOLO_BYTES = int(os.getenv("QUOTA_SOLO_BYTES", str(2 * 1024 * 1024 * 1024)))
_QUOTA_TEAM_BYTES = int(os.getenv("QUOTA_TEAM_BYTES", str(5 * 1024 * 1024 * 1024)))
_QUOTA_ENTERPRISE_BYTES = int(os.getenv("QUOTA_ENTERPRISE_BYTES", str(10 * 1024 * 1024 * 1024)))

_QUOTA_PER_WORKSPACE_BYTES = int(os.getenv("QUOTA_PER_WORKSPACE_BYTES", str(256 * 1024 * 1024)))

_TIER_QUOTA: dict[str, int] = {
    "free": _QUOTA_FREE_BYTES,
    "solo": _QUOTA_SOLO_BYTES,
    "team": _QUOTA_TEAM_BYTES,
    "enterprise": _QUOTA_ENTERPRISE_BYTES,
}

_REDIS_QUOTA_PREFIX = "syntaro:quota:"
_REDIS_USAGE_KEY = lambda tenant: f"{_REDIS_QUOTA_PREFIX}{tenant}:usage"

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
        logger.warning("Quota Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None


_TIER_NAMES = frozenset(_TIER_QUOTA)


def resolve_tier(tenant_id: str, tier: str | None = None) -> str:
    if tier and tier.lower() in _TIER_NAMES:
        return tier.lower()
    env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
    return os.getenv(env_var, "free").lower()


def quota_for_tier(tier: str) -> int:
    return _TIER_QUOTA.get(tier, _QUOTA_FREE_BYTES)


def _sanitize(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)[:64]


class DiskQuota:
    def __init__(self, per_workspace_bytes: int = _QUOTA_PER_WORKSPACE_BYTES) -> None:
        self.per_workspace_bytes = per_workspace_bytes

    def check_quota(
        self,
        tenant_id: str,
        tier: str | None = None,
        estimated_bytes: int | None = None,
    ) -> bool:
        client = _get_redis()
        if not client:
            return True

        effective_tier = resolve_tier(tenant_id, tier)
        quota = quota_for_tier(effective_tier)

        if quota < 0:
            return True

        try:
            current = self._get_usage(client, tenant_id)
            needed = estimated_bytes or self.per_workspace_bytes
            remaining = quota - current
            if remaining < needed:
                logger.info(
                    "Disk quota exceeded tenant=%s tier=%s current=%d quota=%d needed=%d",
                    tenant_id, effective_tier, current, quota, needed,
                )
                return False
            return True
        except Exception as exc:
            logger.error("Quota check error tenant=%s -- %s", tenant_id, exc)
            return True

    def check_per_workspace_quota(self, workspace_path: str) -> bool:
        if not os.path.isdir(workspace_path):
            return True
        try:
            size = self._dir_size(workspace_path)
            if size > self.per_workspace_bytes:
                logger.warning(
                    "Per-workspace quota exceeded path=%s size=%d limit=%d",
                    workspace_path, size, self.per_workspace_bytes,
                )
                return False
            return True
        except Exception as exc:
            logger.error("Per-workspace quota check error path=%s -- %s", workspace_path, exc)
            return True

    def record_usage(self, tenant_id: str, workspace_path: str, size_bytes: int) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_USAGE_KEY(tenant_id)
            client.hincrby(key, workspace_path, size_bytes)
            client.expire(key, 86400 * 7)
        except Exception as exc:
            logger.error("Failed to record usage tenant=%s -- %s", tenant_id, exc)

    def release_usage(self, tenant_id: str, workspace_path: str) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_USAGE_KEY(tenant_id)
            client.hdel(key, workspace_path)
        except Exception as exc:
            logger.error("Failed to release usage tenant=%s -- %s", tenant_id, exc)

    def get_tenant_usage(self, tenant_id: str) -> int:
        client = _get_redis()
        if not client:
            return 0
        try:
            key = _REDIS_USAGE_KEY(tenant_id)
            values = client.hvals(key)
            return sum(int(v) for v in values if v)
        except Exception:
            return 0

    def get_tenant_quota(self, tenant_id: str, tier: str | None = None) -> int:
        return quota_for_tier(resolve_tier(tenant_id, tier))

    def get_tenant_remaining(self, tenant_id: str, tier: str | None = None) -> int:
        effective_tier = resolve_tier(tenant_id, tier)
        quota = quota_for_tier(effective_tier)
        if quota < 0:
            return -1
        used = self.get_tenant_usage(tenant_id)
        return max(0, quota - used)

    @staticmethod
    def _dir_size(path: str) -> int:
        total = 0
        for entry in os.scandir(path):
            if entry.is_file(follow_symlinks=False):
                total += entry.stat().st_size
            elif entry.is_dir(follow_symlinks=False):
                total += DiskQuota._dir_size(entry.path)
        return total

    def _get_usage(self, client: Any, tenant_id: str) -> int:
        try:
            key = _REDIS_USAGE_KEY(tenant_id)
            values = client.hvals(key)
            return sum(int(v) for v in values if v)
        except Exception:
            return 0


class WorkspaceIsolation:
    @staticmethod
    def workspace_root(tenant_id: str, issue_key: str) -> str:
        sanitized_tenant = _sanitize(tenant_id)
        sanitized_issue = issue_key.replace("/", "_").replace(" ", "_")[:64]
        return os.path.join(_WORKSPACE_ROOT, sanitized_tenant, sanitized_issue)

    @staticmethod
    def ensure_isolation(workspace_path: str, tenant_id: str) -> bool:
        root = os.path.normpath(os.path.join(_WORKSPACE_ROOT, _sanitize(tenant_id)))
        resolved = os.path.normpath(workspace_path)
        if not resolved.startswith(root + os.sep) and resolved != root:
            return False
        return True

    @staticmethod
    def list_tenant_workspaces(tenant_id: str) -> list[str]:
        tenant_root = os.path.join(_WORKSPACE_ROOT, _sanitize(tenant_id))
        if not os.path.isdir(tenant_root):
            return []
        try:
            return [
                os.path.join(tenant_root, d)
                for d in os.listdir(tenant_root)
                if os.path.isdir(os.path.join(tenant_root, d))
            ]
        except Exception as exc:
            logger.error("Failed to list tenant workspaces tenant=%s -- %s", tenant_id, exc)
            return []

    @staticmethod
    def all_tenant_roots() -> list[str]:
        if not os.path.isdir(_WORKSPACE_ROOT):
            return []
        try:
            return [
                os.path.join(_WORKSPACE_ROOT, d)
                for d in os.listdir(_WORKSPACE_ROOT)
                if os.path.isdir(os.path.join(_WORKSPACE_ROOT, d))
            ]
        except Exception as exc:
            logger.error("Failed to list tenant roots -- %s", exc)
            return []


_disk_quota: Optional[DiskQuota] = None
_workspace_isolation: Optional[WorkspaceIsolation] = None


def get_disk_quota() -> DiskQuota:
    global _disk_quota
    if _disk_quota is None:
        _disk_quota = DiskQuota()
    return _disk_quota


def get_workspace_isolation() -> WorkspaceIsolation:
    global _workspace_isolation
    if _workspace_isolation is None:
        _workspace_isolation = WorkspaceIsolation()
    return _workspace_isolation
