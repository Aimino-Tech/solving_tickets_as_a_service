import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

TIER_CONCURRENCY_LIMITS = {
    "free": 1,
    "pro": 3,
    "enterprise": 10,
}

DEFAULT_CONCURRENCY = int(os.getenv("STAS_DEFAULT_CONCURRENCY", "3"))


class TenantConcurrencyManager:
    def __init__(self, redis_client: Any | None = None):
        self._redis = redis_client

    def _active_key(self, tenant_id: str) -> str:
        return f"stas:concurrency:{tenant_id}:active"

    def get_max_concurrent(self, tier: str = "free") -> int:
        return TIER_CONCURRENCY_LIMITS.get(tier, 1)

    def acquire(self, tenant_id: str, tier: str = "free") -> bool:
        max_concurrent = self.get_max_concurrent(tier)
        if self._redis is None:
            return True
        try:
            current = self._redis.incr(self._active_key(tenant_id))
            if current > max_concurrent:
                self._redis.decr(self._active_key(tenant_id))
                logger.warning("Tenant %s concurrency limit reached (%d/%d)", tenant_id, current - 1, max_concurrent)
                return False
            self._redis.expire(self._active_key(tenant_id), 3600)
            return True
        except Exception as exc:
            logger.warning("Concurrency check failed for tenant=%s — %s", tenant_id, exc)
            return True

    def release(self, tenant_id: str) -> None:
        if self._redis is None:
            return
        try:
            current = self._redis.decr(self._active_key(tenant_id))
            if current < 0:
                self._redis.delete(self._active_key(tenant_id))
        except Exception as exc:
            logger.warning("Concurrency release failed for tenant=%s — %s", tenant_id, exc)

    def get_active_count(self, tenant_id: str) -> int:
        if self._redis is None:
            return 0
        try:
            val = self._redis.get(self._active_key(tenant_id))
            return int(val) if val else 0
        except Exception:
            return 0

    def get_status(self, tenant_id: str, tier: str = "free") -> dict[str, Any]:
        active = self.get_active_count(tenant_id)
        max_conc = self.get_max_concurrent(tier)
        return {
            "tenant_id": tenant_id,
            "tier": tier,
            "active_agents": active,
            "max_concurrent": max_conc,
            "available": max(0, max_conc - active),
        }
