"""TenantIsolationManager — per-tenant resource isolation for multi-tenant deployments."""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

_BROKER_URL = os.getenv(
    "CELERY_BROKER_URL",
    os.getenv("BROKER_URL", "amqp://guest:guest@localhost:5672/syntaro"),
)

_WORKSPACE_ROOT = os.getenv("WORKSPACE_ROOT", "/workspaces")

_TENANT_CONCURRENCY_FREE = int(os.getenv("TENANT_CONCURRENCY_FREE", "2"))
_TENANT_CONCURRENCY_PRO = int(os.getenv("TENANT_CONCURRENCY_PRO", "10"))
_TENANT_CONCURRENCY_ENTERPRISE = int(os.getenv("TENANT_CONCURRENCY_ENTERPRISE", "50"))

_RATE_LIMIT_WINDOW_S = int(os.getenv("TENANT_RATE_LIMIT_WINDOW_S", "60"))
_RATE_LIMIT_MAX_REQUESTS = int(os.getenv("TENANT_RATE_LIMIT_MAX_REQUESTS", "100"))

_TENANT_EXCHANGE_NAME = "syntaro"
_TENANT_BINDING_KEY_PREFIX = "tenant_"

_REDIS_AGENT_SLOTS_PREFIX = "syntaro:tenant:agents:"
_REDIS_RATE_LIMIT_PREFIX = "syntaro:tenant:ratelimit:"

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
        logger.warning("Tenant isolation Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None


_TIER_CONCURRENCY: dict[str, int] = {
    "free": _TENANT_CONCURRENCY_FREE,
    "pro": _TENANT_CONCURRENCY_PRO,
    "enterprise": _TENANT_CONCURRENCY_ENTERPRISE,
}

_TIER_NAMES = frozenset(_TIER_CONCURRENCY)


def _resolve_tier(tier: str | None) -> str:
    if tier and tier.lower() in _TIER_NAMES:
        return tier.lower()
    return "free"


class TenantIsolationManager:
    @staticmethod
    def queue_name(tenant_id: str) -> str:
        sanitized = tenant_id.replace("-", "_").replace(".", "_")[:64]
        return f"syntaro.agents.tenant.{sanitized}"

    @staticmethod
    def binding_key(tenant_id: str) -> str:
        return f"{_TENANT_BINDING_KEY_PREFIX}{tenant_id}"

    def declare_tenant_queue(self, tenant_id: str) -> None:
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

            channel.basic_qos(prefetch_count=1, prefetch_size=0, global_=False)

            conn.release()
            logger.info(
                "Declared tenant queue tenant=%s queue=%s",
                tenant_id,
                self.queue_name(tenant_id),
            )
        except Exception as exc:
            logger.error(
                "Failed to declare tenant queue tenant=%s -- %s",
                tenant_id,
                exc,
            )

    @staticmethod
    def celery_queue_option(tenant_id: str) -> dict[str, str]:
        return {"queue": TenantIsolationManager.queue_name(tenant_id)}

    @staticmethod
    def max_concurrent_agents(tier: str | None = None) -> int:
        return _TIER_CONCURRENCY.get(_resolve_tier(tier), _TENANT_CONCURRENCY_FREE)

    def check_concurrency(self, tenant_id: str, tier: str | None = None) -> bool:
        client = _get_redis()
        if not client:
            return True
        try:
            limit = self.max_concurrent_agents(tier)
            key = _REDIS_AGENT_SLOTS_PREFIX + tenant_id
            active = client.scard(key) or 0
            if active >= limit:
                logger.info(
                    "Tenant concurrency limit reached tenant=%s active=%d limit=%d",
                    tenant_id, active, limit,
                )
                return False
            return True
        except Exception as exc:
            logger.error("Tenant concurrency check failed tenant=%s -- %s", tenant_id, exc)
            return True

    def acquire_agent_slot(self, tenant_id: str, job_id: str) -> bool:
        client = _get_redis()
        if not client:
            return True
        try:
            limit = self.max_concurrent_agents(self._get_tenant_tier(tenant_id))
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
            client.expire(key, 3600)
            return True
        except Exception as exc:
            logger.error("Slot acquire failed tenant=%s -- %s", tenant_id, exc)
            return True

    def release_agent_slot(self, tenant_id: str, job_id: str) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_AGENT_SLOTS_PREFIX + tenant_id
            client.srem(key, f"job:{job_id}")
        except Exception as exc:
            logger.error("Slot release failed tenant=%s -- %s", tenant_id, exc)

    def active_agent_count(self, tenant_id: str) -> int:
        client = _get_redis()
        if not client:
            return 0
        try:
            key = _REDIS_AGENT_SLOTS_PREFIX + tenant_id
            return client.scard(key) or 0
        except Exception:
            return 0

    @staticmethod
    def workspace_root(tenant_id: str, issue_key: str) -> str:
        sanitized_tenant = tenant_id.replace("-", "_").replace(".", "_")[:64]
        sanitized_issue = issue_key.replace("/", "_").replace(" ", "_")[:64]
        return os.path.join(_WORKSPACE_ROOT, sanitized_tenant, sanitized_issue)

    def check_rate_limit(
        self,
        tenant_id: str,
        max_requests: int | None = None,
        window_s: int | None = None,
    ) -> bool:
        client = _get_redis()
        if not client:
            return True
        window = window_s or _RATE_LIMIT_WINDOW_S
        limit = max_requests or _RATE_LIMIT_MAX_REQUESTS
        now = time.time()
        cutoff = now - window
        key = _REDIS_RATE_LIMIT_PREFIX + tenant_id
        try:
            client.zremrangebyscore(key, "-inf", cutoff)
            count = client.zcard(key) or 0
            if count >= limit:
                logger.info(
                    "Rate limit exceeded tenant=%s count=%d limit=%d window=%ds",
                    tenant_id, count, limit, window,
                )
                return False
            client.zadd(key, {str(now): now})
            client.expire(key, window + 60)
            return True
        except Exception as exc:
            logger.error("Rate limit check failed tenant=%s -- %s", tenant_id, exc)
            return True

    def rate_limit_remaining(
        self,
        tenant_id: str,
        max_requests: int | None = None,
        window_s: int | None = None,
    ) -> int:
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
            return max(0, limit - count)
        except Exception:
            return limit

    def reset_rate_limit(self, tenant_id: str) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_RATE_LIMIT_PREFIX + tenant_id
            client.delete(key)
        except Exception as exc:
            logger.error("Rate limit reset failed tenant=%s -- %s", tenant_id, exc)

    @staticmethod
    def _get_tenant_tier(tenant_id: str) -> str:
        env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
        return os.getenv(env_var, "free").lower()

    def tenant_summary(self, tenant_id: str) -> dict[str, Any]:
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


_manager: Optional[TenantIsolationManager] = None


def get_tenant_manager() -> TenantIsolationManager:
    global _manager
    if _manager is None:
        _manager = TenantIsolationManager()
    return _manager
