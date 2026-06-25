"""
TenantIsolationManager — per-tenant resource isolation for multi-tenant deployments.

Provides:
    - Per-tenant RabbitMQ queue management (``tenant_{id}`` binding key, prefetch=1)
    - Celery ``queue=`` parameter resolution per tenant
    - Per-tenant max_concurrent_agents ceiling
    - Per-tenant workspace root isolation (``/workspaces/{tenant_id}/{issue_key}/``)
    - Redis per-tenant rate limit counters

Usage::

    manager = get_tenant_manager()
    queue_name = manager.queue_for_tenant("tenant-abc")
    can_run = manager.check_concurrency("tenant-abc")
    workspace = manager.workspace_root("tenant-abc", "ISSUE-42")

Configuration (env vars):
    TENANT_CONCURRENCY_FREE (default: 2)
    TENANT_CONCURRENCY_PRO (default: 10)
    TENANT_CONCURRENCY_ENTERPRISE (default: 50)
    TENANT_RATE_LIMIT_WINDOW_S (default: 60)
    TENANT_RATE_LIMIT_MAX_REQUESTS (default: 100)
    WORKSPACE_ROOT (default: /workspaces)
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants & configuration
# ---------------------------------------------------------------------------

_BROKER_URL = os.getenv(
    "CELERY_BROKER_URL",
    os.getenv("BROKER_URL", "amqp://guest:guest@localhost:5672/stas"),
)

_WORKSPACE_ROOT = os.getenv("WORKSPACE_ROOT", "/workspaces")

_TENANT_CONCURRENCY_FREE = int(os.getenv("TENANT_CONCURRENCY_FREE", "2"))
_TENANT_CONCURRENCY_PRO = int(os.getenv("TENANT_CONCURRENCY_PRO", "10"))
_TENANT_CONCURRENCY_ENTERPRISE = int(os.getenv("TENANT_CONCURRENCY_ENTERPRISE", "50"))

_RATE_LIMIT_WINDOW_S = int(os.getenv("TENANT_RATE_LIMIT_WINDOW_S", "60"))
_RATE_LIMIT_MAX_REQUESTS = int(os.getenv("TENANT_RATE_LIMIT_MAX_REQUESTS", "100"))

# RabbitMQ exchange used for tenant queues — matches the project convention
_TENANT_EXCHANGE_NAME = "stas"
_TENANT_BINDING_KEY_PREFIX = "tenant_"

# Redis key prefixes
_REDIS_AGENT_SLOTS_PREFIX = "stas:tenant:agents:"
_REDIS_RATE_LIMIT_PREFIX = "stas:tenant:ratelimit:"

# ---------------------------------------------------------------------------
# Redis client (lazy)
# ---------------------------------------------------------------------------

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
        logger.warning("Tenant isolation Redis unavailable — %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Tier -> concurrency ceiling mapping
# ---------------------------------------------------------------------------

_TIER_CONCURRENCY: dict[str, int] = {
    "free": _TENANT_CONCURRENCY_FREE,
    "pro": _TENANT_CONCURRENCY_PRO,
    "enterprise": _TENANT_CONCURRENCY_ENTERPRISE,
}

_TIER_NAMES = frozenset(_TIER_CONCURRENCY)


def _resolve_tier(tier: str | None) -> str:
    """Coerce *tier* to one of ``free``, ``pro``, ``enterprise``."""
    if tier and tier.lower() in _TIER_NAMES:
        return tier.lower()
    return "free"


# ---------------------------------------------------------------------------
# TenantIsolationManager
# ---------------------------------------------------------------------------


class TenantIsolationManager:
    """Manages per-tenant resource isolation.

    Thread-safe when used with a shared Redis connection.  Each tenant gets:

    * A dedicated RabbitMQ queue bound with ``tenant_{tenant_id}`` routing key.
    * A concurrency ceiling based on their billing tier.
    * An isolated workspace root at ``/workspaces/{tenant_id}/``.
    * Independent rate-limit counters in Redis.
    """

    # ------------------------------------------------------------------
    # Queue management
    # ------------------------------------------------------------------

    @staticmethod
    def queue_name(tenant_id: str) -> str:
        """Return the Celery queue name for *tenant_id*.

        The queue name follows the project convention::

            stas.agents.tenant.{tenant_id}
        """
        sanitized = tenant_id.replace("-", "_").replace(".", "_")[:64]
        return f"stas.agents.tenant.{sanitized}"

    @staticmethod
    def binding_key(tenant_id: str) -> str:
        """Return the RabbitMQ binding key for *tenant_id*.

        Format: ``tenant_{tenant_id}``
        """
        return f"{_TENANT_BINDING_KEY_PREFIX}{tenant_id}"

    def declare_tenant_queue(self, tenant_id: str) -> None:
        """Declare the per-tenant RabbitMQ queue with ``prefetch=1``.

        Uses the shared ``stas`` exchange.  The queue is durable, auto-deleted
        when the last consumer goes away, and receives messages routed by its
        tenant-specific binding key.
        """
        try:
            import kombu
            from kombu import Exchange, Queue

            conn = kombu.Connection(_BROKER_URL)
            conn.connect()
            channel = conn.channel()

            exchange = Exchange(_TENANT_EXCHANGE_NAME, type="direct", durable=True)
            exchange.declare(channel=channel)

            q = Queue(
                name=self.queue_name(tenant_id),
                exchange=exchange,
                routing_key=self.binding_key(tenant_id),
                durable=True,
                auto_delete=True,
                channel=channel,
            )
            q.declare(channel=channel)

            # Set prefetch to 1 so RabbitMQ does not send more than one
            # message at a time to a consumer on this queue.
            channel.basic_qos(prefetch_count=1, prefetch_size=0, global_=False)

            conn.release()
            logger.info(
                "Declared tenant queue tenant=%s queue=%s",
                tenant_id,
                self.queue_name(tenant_id),
            )
        except Exception as exc:
            logger.error(
                "Failed to declare tenant queue tenant=%s — %s",
                tenant_id,
                exc,
            )

    @staticmethod
    def celery_queue_option(tenant_id: str) -> dict[str, str]:
        """Return ``{"queue": ...}`` for Celery task routing.

        Pass this as ``**opts`` to ``.apply_async()`` or a Celery signature::

            my_task.apply_async(kwargs={...}, **manager.celery_queue_option(tid))
        """
        return {"queue": TenantIsolationManager.queue_name(tenant_id)}

    # ------------------------------------------------------------------
    # Per-tenant concurrency ceiling
    # ------------------------------------------------------------------

    @staticmethod
    def max_concurrent_agents(tier: str | None = None) -> int:
        """Return the max concurrent agents allowed for *tier*."""
        return _TIER_CONCURRENCY.get(_resolve_tier(tier), _TENANT_CONCURRENCY_FREE)

    def check_concurrency(
        self,
        tenant_id: str,
        tier: str | None = None,
    ) -> bool:
        """Check whether *tenant_id* has capacity under its concurrency ceiling.

        Returns ``True`` if the tenant can dispatch another agent.
        Uses a Redis SET per tenant to track active agent slots.
        """
        client = _get_redis()
        if not client:
            return True  # degrade gracefully

        try:
            limit = self.max_concurrent_agents(tier)
            key = _REDIS_AGENT_SLOTS_PREFIX + tenant_id
            active = client.scard(key) or 0
            if active >= limit:
                logger.info(
                    "Tenant concurrency limit reached tenant=%s active=%d limit=%d",
                    tenant_id,
                    active,
                    limit,
                )
                return False
            return True
        except Exception as exc:
            logger.error(
                "Tenant concurrency check failed tenant=%s — %s",
                tenant_id,
                exc,
            )
            return True

    def acquire_agent_slot(self, tenant_id: str, job_id: str) -> bool:
        """Acquire a concurrency slot for *tenant_id*.

        Returns ``True`` if a slot was acquired (or Redis is unavailable).
        Call ``release_agent_slot`` after the job completes.
        """
        client = _get_redis()
        if not client:
            return True

        try:
            tier = self._get_tenant_tier(tenant_id)
            limit = self.max_concurrent_agents(tier)
            key = _REDIS_AGENT_SLOTS_PREFIX + tenant_id
            member = f"job:{job_id}"

            active = client.scard(key) or 0
            if active >= limit:
                logger.info(
                    "Slot denied tenant=%s job=%s active=%d limit=%d",
                    tenant_id, job_id, active, limit,
                )
                return False

            client.sadd(key, member)
            client.expire(key, 3600)  # 1h safety TTL
            logger.info(
                "Slot acquired tenant=%s job=%s active=%d",
                tenant_id, job_id, active + 1,
            )
            return True
        except Exception as exc:
            logger.error("Slot acquire failed tenant=%s — %s", tenant_id, exc)
            return True

    def release_agent_slot(self, tenant_id: str, job_id: str) -> None:
        """Release a previously acquired concurrency slot."""
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_AGENT_SLOTS_PREFIX + tenant_id
            member = f"job:{job_id}"
            client.srem(key, member)
        except Exception as exc:
            logger.error("Slot release failed tenant=%s — %s", tenant_id, exc)

    def active_agent_count(self, tenant_id: str) -> int:
        """Return the number of active agent slots for *tenant_id*."""
        client = _get_redis()
        if not client:
            return 0
        try:
            key = _REDIS_AGENT_SLOTS_PREFIX + tenant_id
            return client.scard(key) or 0
        except Exception:
            return 0

    # ------------------------------------------------------------------
    # Workspace root isolation
    # ------------------------------------------------------------------

    @staticmethod
    def workspace_root(tenant_id: str, issue_key: str) -> str:
        """Return the isolated workspace path for *tenant_id* and *issue_key*.

        Format: ``/workspaces/{tenant_id}/{issue_key}/``

        Args:
            tenant_id: Tenant identifier (e.g. ``"tenant-abc"``).
            issue_key: Issue key (e.g. ``"AIM-42"`` or ``"gh-42"``).

        Returns:
            Absolute workspace path.
        """
        sanitized_tenant = tenant_id.replace("-", "_").replace(".", "_")[:64]
        sanitized_issue = issue_key.replace("/", "_").replace(" ", "_")[:64]
        return os.path.join(_WORKSPACE_ROOT, sanitized_tenant, sanitized_issue)

    # ------------------------------------------------------------------
    # Per-tenant rate limit counters
    # ------------------------------------------------------------------

    def check_rate_limit(
        self,
        tenant_id: str,
        max_requests: int | None = None,
        window_s: int | None = None,
    ) -> bool:
        """Check whether *tenant_id* has exceeded its rate limit.

        Uses a Redis sorted set with timestamps as scores to track request
        timestamps within a sliding window.

        Returns:
            ``True`` if the request is allowed, ``False`` if rate-limited.
        """
        client = _get_redis()
        if not client:
            return True

        window = window_s or _RATE_LIMIT_WINDOW_S
        limit = max_requests or _RATE_LIMIT_MAX_REQUESTS
        now = time.time()
        cutoff = now - window
        key = _REDIS_RATE_LIMIT_PREFIX + tenant_id

        try:
            # Remove entries outside the window
            client.zremrangebyscore(key, "-inf", cutoff)
            # Count entries in window
            count = client.zcard(key) or 0
            if count >= limit:
                logger.info(
                    "Rate limit exceeded tenant=%s count=%d limit=%d window=%ds",
                    tenant_id, count, limit, window,
                )
                return False
            # Record this request
            client.zadd(key, {str(now): now})
            client.expire(key, window + 60)
            return True
        except Exception as exc:
            logger.error(
                "Rate limit check failed tenant=%s — %s",
                tenant_id,
                exc,
            )
            return True

    def rate_limit_remaining(
        self,
        tenant_id: str,
        max_requests: int | None = None,
        window_s: int | None = None,
    ) -> int:
        """Return the number of remaining requests for *tenant_id*."""
        client = _get_redis()
        if not client:
            return max_requests or _RATE_LIMIT_MAX_REQUESTS

        window = window_s or _RATE_LIMIT_WINDOW_S
        limit = max_requests or _RATE_LIMIT_MAX_REQUESTS
        now = time.time()
        cutoff = now - window
        key = _REDIS_RATE_LIMIT_PREFIX + tenant_id

        try:
            client.zremrangebyscore(key, "-inf", cutoff)
            count = client.zcard(key) or 0
            remaining = max(0, limit - count)
            return remaining
        except Exception:
            return limit

    def reset_rate_limit(self, tenant_id: str) -> None:
        """Clear all rate-limit counters for *tenant_id*."""
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_RATE_LIMIT_PREFIX + tenant_id
            client.delete(key)
        except Exception as exc:
            logger.error("Rate limit reset failed tenant=%s — %s", tenant_id, exc)

    # ------------------------------------------------------------------
    # Tier helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _get_tenant_tier(tenant_id: str) -> str:
        """Look up the billing tier for *tenant_id*.

        Override this method to integrate with a real billing DB.
        Default implementation reads from ``TENANT_{ID}_TIER`` env var or
        returns ``"free"``.
        """
        env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
        return os.getenv(env_var, "free").lower()

    # ------------------------------------------------------------------
    # Diagnostics / summary
    # ------------------------------------------------------------------

    def tenant_summary(self, tenant_id: str) -> dict[str, Any]:
        """Return a diagnostic summary for *tenant_id*.

        Includes queue name, active agent count, concurrency ceiling,
        workspace root, and rate limit remaining.
        """
        tier = self._get_tenant_tier(tenant_id)
        return {
            "tenant_id": tenant_id,
            "tier": tier,
            "queue": self.queue_name(tenant_id),
            "binding_key": self.binding_key(tenant_id),
            "active_agents": self.active_agent_count(tenant_id),
            "max_concurrent_agents": self.max_concurrent_agents(tier),
            "workspace_root": self.workspace_root(tenant_id, ""),
            "rate_limit_remaining": self.rate_limit_remaining(tenant_id),
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_manager: Optional[TenantIsolationManager] = None


def get_tenant_manager() -> TenantIsolationManager:
    """Return a shared ``TenantIsolationManager`` singleton."""
    global _manager
    if _manager is None:
        _manager = TenantIsolationManager()
    return _manager
