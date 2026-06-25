import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_REDIS_URL = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")


class TokenBucketRateLimiter:
    def __init__(self, redis_client: Any | None = None):
        self._redis = redis_client

    def _get_key(self, tenant_id: str) -> str:
        return f"stas:ratelimit:{tenant_id}:bucket"

    def check_and_consume(self, tenant_id: str, max_tokens: int = 10, refill_seconds: float = 1.0, cost: int = 1) -> bool:
        if self._redis is None:
            return True
        key = self._get_key(tenant_id)
        now = time.time()
        try:
            data = self._redis.get(key)
            if data is None:
                self._redis.setex(key, int(refill_seconds * 2), max_tokens - cost)
                return True
            tokens = float(data)
            if tokens >= cost:
                self._redis.decrby(key, cost)
                return True
            return False
        except Exception as exc:
            logger.warning("Rate limit check failed for tenant=%s — %s", tenant_id, exc)
            return True

    def get_remaining(self, tenant_id: str, max_tokens: int = 10) -> float:
        if self._redis is None:
            return float(max_tokens)
        key = self._get_key(tenant_id)
        try:
            val = self._redis.get(key)
            if val is None:
                return float(max_tokens)
            return float(val)
        except Exception:
            return float(max_tokens)

    def reset(self, tenant_id: str) -> bool:
        if self._redis is None:
            return False
        key = self._get_key(tenant_id)
        try:
            self._redis.delete(key)
            return True
        except Exception:
            return False


class TenantRateLimiter:
    def __init__(self, redis_client: Any | None = None):
        self._bucket = TokenBucketRateLimiter(redis_client)

    def check_dispatch_allowed(self, tenant_id: str, tier: str = "free") -> tuple[bool, str]:
        limits = {"free": 50, "pro": 500, "enterprise": 10000}
        max_issues = limits.get(tier, 50)
        remaining = self._bucket.get_remaining(tenant_id, max_issues)
        if remaining <= 0:
            return False, f"Tenant {tenant_id} has exceeded {tier} tier limit of {max_issues} issues/month"

        if remaining <= max_issues * 0.2:
            return True, f"Tenant {tenant_id} has used {max_issues - int(remaining)} of {max_issues} issues — upgrade recommended"

        return True, ""

    def record_usage(self, tenant_id: str, tier: str = "free") -> None:
        limits = {"free": 50, "pro": 500, "enterprise": 10000}
        max_tokens = limits.get(tier, 50)
        self._bucket.check_and_consume(tenant_id, max_tokens, 86400.0)

    def get_usage(self, tenant_id: str, tier: str = "free") -> dict[str, Any]:
        limits = {"free": 50, "pro": 500, "enterprise": 10000}
        max_tokens = limits.get(tier, 50)
        remaining = self._bucket.get_remaining(tenant_id, max_tokens)
        used = max_tokens - int(remaining)
        return {
            "tenant_id": tenant_id,
            "tier": tier,
            "max_issues": max_tokens,
            "used": max(used, 0),
            "remaining": max(int(remaining), 0),
        }
