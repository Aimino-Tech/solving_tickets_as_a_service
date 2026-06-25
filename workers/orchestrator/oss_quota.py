"""
OSS Workspace Quota & Isolation (AIM-2042).

Provides disk quota enforcement per workspace, workspace isolation per tenant,
and LRU-based cleanup of old workspaces for the OSS self-hosted tier.

Classes
-------
    OssDiskQuota
        Per-tenant/tier disk quota enforcement backed by Redis.
    WorkspaceIsolation
        Ensures workspaces are isolated per tenant under /workspaces/{tenant}/.
    OssLruCleanup
        LRU-based eviction of old workspaces when disk usage exceeds quota.
"""

from __future__ import annotations

import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default configuration (env vars)
# ---------------------------------------------------------------------------

_WORKSPACE_ROOT = os.getenv("WORKSPACE_ROOT", "/workspaces")

# Per-tier disk quotas (in bytes)
_QUOTA_FREE_BYTES = int(os.getenv("OSS_QUOTA_FREE_BYTES", str(512 * 1024 * 1024)))      # 512 MB
_QUOTA_PRO_BYTES = int(os.getenv("OSS_QUOTA_PRO_BYTES", str(2 * 1024 * 1024 * 1024)))    # 2 GB
_QUOTA_ENTERPRISE_BYTES = int(os.getenv("OSS_QUOTA_ENTERPRISE_BYTES", str(10 * 1024 * 1024 * 1024)))  # 10 GB
_QUOTA_UNLIMITED_BYTES = int(os.getenv("OSS_QUOTA_UNLIMITED_BYTES", str(-1)))  # -1 means unlimited

_QUOTA_PER_WORKSPACE_BYTES = int(os.getenv("OSS_QUOTA_PER_WORKSPACE_BYTES", str(256 * 1024 * 1024)))  # 256 MB per workspace

_LRU_CLEANUP_INTERVAL_S = int(os.getenv("OSS_LRU_CLEANUP_INTERVAL_S", "300"))  # 5 min
_LRU_MAX_WORKSPACES_FREE = int(os.getenv("OSS_LRU_MAX_WORKSPACES_FREE", "5"))
_LRU_MAX_WORKSPACES_PRO = int(os.getenv("OSS_LRU_MAX_WORKSPACES_PRO", "20"))
_LRU_MAX_WORKSPACES_ENTERPRISE = int(os.getenv("OSS_LRU_MAX_WORKSPACES_ENTERPRISE", "100"))

_TIER_QUOTA: dict[str, int] = {
    "free": _QUOTA_FREE_BYTES,
    "pro": _QUOTA_PRO_BYTES,
    "enterprise": _QUOTA_ENTERPRISE_BYTES,
}

_TIER_LRU_MAX: dict[str, int] = {
    "free": _LRU_MAX_WORKSPACES_FREE,
    "pro": _LRU_MAX_WORKSPACES_PRO,
    "enterprise": _LRU_MAX_WORKSPACES_ENTERPRISE,
}

# Redis key prefixes
_REDIS_QUOTA_PREFIX = "stas:oss:quota:"
_REDIS_LRU_PREFIX = "stas:oss:lru:"
_REDIS_USAGE_KEY = lambda tenant: f"{_REDIS_QUOTA_PREFIX}{tenant}:usage"
_REDIS_WORKSPACE_ACCESS_KEY = lambda tenant: f"{_REDIS_LRU_PREFIX}{tenant}:access"

_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
    """Lazy-initialised Redis client (same pattern as tenant_limiter)."""
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
        logger.warning("OSS quota Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Tier resolution helpers
# ---------------------------------------------------------------------------

_TIER_NAMES = frozenset(_TIER_QUOTA)


def _resolve_tier(tenant_id: str, tier: str | None = None) -> str:
    """Resolve the effective tier for a tenant.

    Priority: explicit *tier* argument -> ``TENANT_{id}_TIER`` env var -> ``"free"``.
    """
    if tier and tier.lower() in _TIER_NAMES:
        return tier.lower()
    env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
    return os.getenv(env_var, "free").lower()


def _quota_for_tier(tier: str) -> int:
    """Return the total disk quota (bytes) for a tier, or -1 if unlimited."""
    if tier == "enterprise":
        return _QUOTA_UNLIMITED_BYTES  # -1 == unlimited
    return _TIER_QUOTA.get(tier, _QUOTA_FREE_BYTES)


def _lru_max_for_tier(tier: str) -> int:
    """Return the max workspace count for a tier."""
    return _TIER_LRU_MAX.get(tier, _LRU_MAX_WORKSPACES_FREE)


def _sanitize(name: str) -> str:
    """Sanitize a tenant/workspace name for filesystem safety."""
    import re
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)[:64]


# ---------------------------------------------------------------------------
# OssDiskQuota
# ---------------------------------------------------------------------------

class OssDiskQuota:
    """Per-tenant disk quota enforcement backed by Redis.

    Tracks workspace disk usage per tenant and rejects new workspace
    creation when the tenant would exceed their tier's quota.
    """

    def __init__(self, per_workspace_bytes: int = _QUOTA_PER_WORKSPACE_BYTES) -> None:
        self.per_workspace_bytes = per_workspace_bytes

    # ------------------------------------------------------------------
    # Quota checks
    # ------------------------------------------------------------------

    def check_quota(
        self,
        tenant_id: str,
        tier: str | None = None,
        estimated_bytes: int | None = None,
    ) -> bool:
        """Return ``True`` if the tenant has quota remaining.

        If *estimated_bytes* is provided, the check accounts for the
        anticipated new workspace size.  Returns ``True`` (allow) when
        Redis is unavailable (graceful degradation).
        """
        client = _get_redis()
        if not client:
            return True

        effective_tier = _resolve_tier(tenant_id, tier)
        quota = _quota_for_tier(effective_tier)

        # Unlimited tier
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
            logger.debug(
                "Disk quota OK tenant=%s tier=%s current=%d quota=%d remaining=%d",
                tenant_id, effective_tier, current, quota, remaining,
            )
            return True
        except Exception as exc:
            logger.error("Quota check error tenant=%s -- %s", tenant_id, exc)
            return True

    def check_per_workspace_quota(self, workspace_path: str) -> bool:
        """Check that a specific workspace path does not exceed the per-workspace limit.

        Returns ``True`` if the workspace is within limits or if the path
        does not exist yet.
        """
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

    # ------------------------------------------------------------------
    # Usage tracking
    # ------------------------------------------------------------------

    def record_usage(self, tenant_id: str, workspace_path: str, size_bytes: int) -> None:
        """Record disk usage for a tenant workspace.

        Adds *size_bytes* to the tenant's cumulative usage and records
        the workspace for LRU tracking.
        """
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_USAGE_KEY(tenant_id)
            client.hincrby(key, workspace_path, size_bytes)
            client.expire(key, 86400 * 7)  # 7-day TTL
            logger.debug(
                "Recorded usage tenant=%s path=%s bytes=%d",
                tenant_id, workspace_path, size_bytes,
            )
        except Exception as exc:
            logger.error("Failed to record usage tenant=%s -- %s", tenant_id, exc)

    def release_usage(self, tenant_id: str, workspace_path: str) -> None:
        """Remove a workspace's usage from the tenant's tally (after cleanup)."""
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_USAGE_KEY(tenant_id)
            client.hdel(key, workspace_path)
            logger.debug("Released usage tenant=%s path=%s", tenant_id, workspace_path)
        except Exception as exc:
            logger.error("Failed to release usage tenant=%s -- %s", tenant_id, exc)

    def get_tenant_usage(self, tenant_id: str) -> int:
        """Return total bytes currently tracked for a tenant."""
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
        """Return the total quota (bytes) for a tenant's tier."""
        return _quota_for_tier(_resolve_tier(tenant_id, tier))

    def get_tenant_remaining(self, tenant_id: str, tier: str | None = None) -> int:
        """Return remaining quota bytes for a tenant."""
        effective_tier = _resolve_tier(tenant_id, tier)
        quota = _quota_for_tier(effective_tier)
        if quota < 0:
            return -1  # unlimited
        used = self.get_tenant_usage(tenant_id)
        return max(0, quota - used)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _dir_size(path: str) -> int:
        """Recursively sum file sizes under *path*."""
        total = 0
        for entry in os.scandir(path):
            if entry.is_file(follow_symlinks=False):
                total += entry.stat().st_size
            elif entry.is_dir(follow_symlinks=False):
                total += OssDiskQuota._dir_size(entry.path)
        return total

    def _get_usage(self, client: Any, tenant_id: str) -> int:
        """Read the current cumulative usage for a tenant from Redis."""
        try:
            key = _REDIS_USAGE_KEY(tenant_id)
            values = client.hvals(key)
            return sum(int(v) for v in values if v)
        except Exception:
            return 0


# ---------------------------------------------------------------------------
# WorkspaceIsolation
# ---------------------------------------------------------------------------

class WorkspaceIsolation:
    """Ensures workspaces are properly isolated per tenant.

    Each tenant gets a dedicated subdirectory under the workspace root:
    ``/workspaces/{sanitized_tenant}/{issue_key}/``
    """

    @staticmethod
    def workspace_root(tenant_id: str, issue_key: str) -> str:
        """Return the isolated workspace path for a tenant + issue."""
        sanitized_tenant = _sanitize(tenant_id)
        sanitized_issue = issue_key.replace("/", "_").replace(" ", "_")[:64]
        path = os.path.join(_WORKSPACE_ROOT, sanitized_tenant, sanitized_issue)
        logger.debug("Resolved workspace root tenant=%s issue=%s path=%s", tenant_id, issue_key, path)
        return path

    @staticmethod
    def ensure_isolation(workspace_path: str, tenant_id: str) -> bool:
        """Verify that *workspace_path* is within the tenant's isolated subtree.

        Returns ``True`` if the path is valid, ``False`` if it appears to
        escape the tenant's sandbox (path traversal).
        """
        root = os.path.normpath(os.path.join(_WORKSPACE_ROOT, _sanitize(tenant_id)))
        resolved = os.path.normpath(workspace_path)
        if not resolved.startswith(root + os.sep) and resolved != root:
            logger.error(
                "Workspace isolation violation path=%s tenant=%s expected_prefix=%s",
                workspace_path, tenant_id, root,
            )
            return False
        return True

    @staticmethod
    def list_tenant_workspaces(tenant_id: str) -> list[str]:
        """List all workspace paths currently belonging to *tenant_id*."""
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
        """Return all tenant root directories under the workspace root."""
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


# ---------------------------------------------------------------------------
# OssLruCleanup
# ---------------------------------------------------------------------------

class OssLruCleanup:
    """LRU-based eviction of old workspaces.

    Tracks workspace access timestamps in Redis and evicts the least
    recently used workspaces when a tenant exceeds their quota or
    workspace count limit.
    """

    def __init__(self) -> None:
        self._last_cleanup: float = 0.0

    # ------------------------------------------------------------------
    # Access tracking
    # ------------------------------------------------------------------

    def record_access(self, tenant_id: str, workspace_path: str) -> None:
        """Record a workspace access (touch) for LRU ordering."""
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

    def remove_workspace(self, tenant_id: str, workspace_path: str) -> None:
        """Remove a workspace from LRU tracking (after eviction)."""
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_WORKSPACE_ACCESS_KEY(tenant_id)
            client.zrem(key, workspace_path)
        except Exception as exc:
            logger.error("Failed to remove LRU entry tenant=%s -- %s", tenant_id, exc)

    # ------------------------------------------------------------------
    # Eviction
    # ------------------------------------------------------------------

    def evict_lru(
        self,
        tenant_id: str,
        tier: str | None = None,
        dry_run: bool = False,
    ) -> list[str]:
        """Evict the least-recently-used workspaces for a tenant.

        Eviction stops once the tenant is within their workspace count
        limit.  Returns the list of evicted workspace paths (empty if
        none were evicted).

        When *dry_run* is ``True``, returns the paths that *would* be
        evicted without actually removing them.
        """
        client = _get_redis()
        if not client:
            return []

        effective_tier = _resolve_tier(tenant_id, tier)
        max_workspaces = _lru_max_for_tier(effective_tier)
        key = _REDIS_WORKSPACE_ACCESS_KEY(tenant_id)

        try:
            count = client.zcard(key) or 0
            if count <= max_workspaces:
                return []

            # Get the oldest entries beyond the limit
            excess = count - max_workspaces
            candidates = client.zrange(key, 0, excess - 1)

            if dry_run:
                logger.info(
                    "LRU dry-run tenant=%s tier=%s would_evict=%d candidates=%s",
                    tenant_id, effective_tier, len(candidates), candidates,
                )
                return list(candidates)

            evicted: list[str] = []
            for ws_path in candidates:
                try:
                    if os.path.isdir(ws_path):
                        shutil.rmtree(ws_path)
                        logger.warning(
                            "LRU evicted workspace tenant=%s path=%s",
                            tenant_id, ws_path,
                        )
                    client.zrem(key, ws_path)
                    evicted.append(ws_path)
                except Exception as exc:
                    logger.error(
                        "LRU eviction failed tenant=%s path=%s -- %s",
                        tenant_id, ws_path, exc,
                    )

            if evicted:
                logger.info(
                    "LRU eviction complete tenant=%s tier=%s evicted=%d",
                    tenant_id, effective_tier, len(evicted),
                )
            return evicted

        except Exception as exc:
            logger.error("LRU eviction error tenant=%s -- %s", tenant_id, exc)
            return []

    def evict_all_for_tenant(self, tenant_id: str) -> int:
        """Evict *all* workspaces for a tenant (e.g. tenant deprovisioning).

        Returns the number of workspaces evicted.
        """
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
                    count += 1
                except Exception as exc:
                    logger.error(
                        "Full tenant eviction failed tenant=%s path=%s -- %s",
                        tenant_id, ws_path, exc,
                    )
            logger.warning(
                "Evicted all workspaces tenant=%s count=%d", tenant_id, count,
            )
            return count
        except Exception as exc:
            logger.error("Full tenant eviction error tenant=%s -- %s", tenant_id, exc)
            return 0

    # ------------------------------------------------------------------
    # Periodic cleanup (meant to be called from a Celery beat task)
    # ------------------------------------------------------------------

    def periodic_cleanup(self, force: bool = False) -> dict[str, int]:
        """Run LRU cleanup for all tenants with tracked usage.

        Respects ``_LRU_CLEANUP_INTERVAL_S`` to avoid running too often
        (unless *force* is ``True``).

        Returns a dict mapping tenant_id -> number of evicted workspaces.
        """
        if not force:
            elapsed = time.time() - self._last_cleanup
            if elapsed < _LRU_CLEANUP_INTERVAL_S:
                return {}

        client = _get_redis()
        if not client:
            return {}

        results: dict[str, int] = {}

        # Scan Redis for tenant usage keys
        cursor = "0"
        try:
            while cursor is not None:
                cursor, keys = client.scan(cursor=cursor, match=f"{_REDIS_QUOTA_PREFIX}*:usage", count=100)
                for key in keys:
                    # Extract tenant_id from the key
                    prefix = _REDIS_QUOTA_PREFIX
                    suffix = ":usage"
                    inner = key[len(prefix):]
                    tenant_id = inner[:-len(suffix)] if inner.endswith(suffix) else inner
                    if not tenant_id:
                        continue
                    evicted = self.evict_lru(tenant_id)
                    if evicted:
                        results[tenant_id] = len(evicted)
                cursor = int(cursor) if cursor else None
        except Exception as exc:
            logger.error("Periodic cleanup scan error -- %s", exc)

        self._last_cleanup = time.time()

        if results:
            logger.info(
                "Periodic LRU cleanup complete tenants=%s total_evicted=%d",
                list(results.keys()), sum(results.values()),
            )
        return results


# ---------------------------------------------------------------------------
# Singleton accessors
# ---------------------------------------------------------------------------

_oss_disk_quota: Optional[OssDiskQuota] = None
_workspace_isolation: Optional[WorkspaceIsolation] = None
_oss_lru_cleanup: Optional[OssLruCleanup] = None


def get_disk_quota() -> OssDiskQuota:
    """Return the singleton ``OssDiskQuota`` instance."""
    global _oss_disk_quota
    if _oss_disk_quota is None:
        _oss_disk_quota = OssDiskQuota()
    return _oss_disk_quota


def get_workspace_isolation() -> WorkspaceIsolation:
    """Return the singleton ``WorkspaceIsolation`` instance."""
    global _workspace_isolation
    if _workspace_isolation is None:
        _workspace_isolation = WorkspaceIsolation()
    return _workspace_isolation


def get_lru_cleanup() -> OssLruCleanup:
    """Return the singleton ``OssLruCleanup`` instance."""
    global _oss_lru_cleanup
    if _oss_lru_cleanup is None:
        _oss_lru_cleanup = OssLruCleanup()
    return _oss_lru_cleanup
