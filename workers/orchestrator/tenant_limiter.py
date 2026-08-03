"""Per-tenant rate and concurrency limiters (AIM-2017)."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

_TENANT_CONCURRENCY_FREE = int(os.getenv("TENANT_CONCURRENCY_FREE", "2"))
_TENANT_CONCURRENCY_PRO = int(os.getenv("TENANT_CONCURRENCY_PRO", "10"))
_TENANT_CONCURRENCY_ENTERPRISE = int(os.getenv("TENANT_CONCURRENCY_ENTERPRISE", "50"))

_TIER_CONCURRENCY: dict[str, int] = {
    "free": _TENANT_CONCURRENCY_FREE,
    "pro": _TENANT_CONCURRENCY_PRO,
    "enterprise": _TENANT_CONCURRENCY_ENTERPRISE,
}

_TOKEN_BUCKET_DEFAULT_CAPACITY = int(os.getenv("TOKEN_BUCKET_DEFAULT_CAPACITY", "60"))
_TOKEN_BUCKET_DEFAULT_REFILL_RATE = float(os.getenv("TOKEN_BUCKET_DEFAULT_REFILL_RATE", "1.0"))

_REDIS_BUCKET_PREFIX = "syntaro:token_bucket:"
_REDIS_CONCURRENCY_PREFIX = "syntaro:tenant_concurrency:"

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
        logger.warning("Tenant limiter Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None


class TenantTokenBucket:
    def __init__(
        self,
        capacity: int = _TOKEN_BUCKET_DEFAULT_CAPACITY,
        refill_rate: float = _TOKEN_BUCKET_DEFAULT_REFILL_RATE,
    ) -> None:
        self.capacity = capacity
        self.refill_rate = refill_rate

    def _resolve_tier(self, tenant_id: str, tier: str | None) -> str:
        if tier and tier.lower() in _TIER_CONCURRENCY:
            return tier.lower()
        env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
        return os.getenv(env_var, "free").lower()

    def _capacity_for_tier(self, tier: str) -> int:
        if tier == "pro":
            return 300
        if tier == "enterprise":
            return 1000
        return self.capacity

    def _tokens_key(self, tenant_id: str) -> str:
        return f"{_REDIS_BUCKET_PREFIX}{tenant_id}:tokens"

    def _timestamp_key(self, tenant_id: str) -> str:
        return f"{_REDIS_BUCKET_PREFIX}{tenant_id}:ts"

    def _get_bucket_state(self, tenant_id: str, tier: str | None = None) -> tuple[float, float]:
        client = _get_redis()
        if not client:
            return float(self._capacity_for_tier(self._resolve_tier(tenant_id, tier))), time.time()
        try:
            tokens_raw = client.get(self._tokens_key(tenant_id))
            ts_raw = client.get(self._timestamp_key(tenant_id))
            tokens = float(tokens_raw) if tokens_raw is not None else float(
                self._capacity_for_tier(self._resolve_tier(tenant_id, tier))
            )
            ts = float(ts_raw) if ts_raw is not None else time.time()
            return tokens, ts
        except Exception:
            return float(self._capacity_for_tier(self._resolve_tier(tenant_id, tier))), time.time()

    def _write_bucket_state(self, tenant_id: str, tokens: float, ts: float) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            pipe = client.pipeline()
            pipe.set(self._tokens_key(tenant_id), str(tokens))
            pipe.set(self._timestamp_key(tenant_id), str(ts))
            pipe.expire(self._tokens_key(tenant_id), 86400)
            pipe.expire(self._timestamp_key(tenant_id), 86400)
            pipe.execute()
        except Exception as exc:
            logger.error("Failed to write bucket state for %s -- %s", tenant_id, exc)

    def _refill(self, tenant_id: str, tier: str | None = None) -> tuple[float, float]:
        tokens, ts = self._get_bucket_state(tenant_id, tier)
        now = time.time()
        elapsed = now - ts
        capacity = float(self._capacity_for_tier(self._resolve_tier(tenant_id, tier)))
        if elapsed > 0:
            new_tokens = min(capacity, tokens + elapsed * self.refill_rate)
            self._write_bucket_state(tenant_id, new_tokens, now)
            return new_tokens, now
        return tokens, now

    def consume(self, tenant_id: str, tokens: int = 1, tier: str | None = None) -> bool:
        client = _get_redis()
        if not client:
            return True
        try:
            current_tokens, _ = self._refill(tenant_id, tier)
            if current_tokens >= tokens:
                remaining = current_tokens - tokens
                self._write_bucket_state(tenant_id, remaining, time.time())
                logger.debug("Token consumed tenant=%s remaining=%.1f", tenant_id, remaining)
                return True
            logger.info("Token bucket empty tenant=%s tokens=%.1f requested=%d", tenant_id, current_tokens, tokens)
            return False
        except Exception as exc:
            logger.error("Token bucket consume error tenant=%s -- %s", tenant_id, exc)
            return True

    def remaining(self, tenant_id: str, tier: str | None = None) -> float:
        tokens, _ = self._refill(tenant_id, tier)
        return tokens

    def reset(self, tenant_id: str) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            client.delete(self._tokens_key(tenant_id))
            client.delete(self._timestamp_key(tenant_id))
        except Exception as exc:
            logger.error("Failed to reset bucket for %s -- %s", tenant_id, exc)


class TenantConcurrencyLimiter:
    def acquire(self, tenant_id: str, job_id: str, tier: str | None = None) -> bool:
        client = _get_redis()
        if not client:
            return True
        try:
            effective_tier = self._resolve_tier(tenant_id, tier)
            limit = _TIER_CONCURRENCY.get(effective_tier, _TENANT_CONCURRENCY_FREE)
            key = _REDIS_CONCURRENCY_PREFIX + tenant_id
            member = f"job:{job_id}"
            active = client.scard(key) or 0
            if active >= limit:
                logger.info(
                    "Tenant concurrency limit hit tenant=%s job=%s active=%d limit=%d",
                    tenant_id, job_id, active, limit,
                )
                return False
            client.sadd(key, member)
            client.expire(key, 3600)
            logger.info(
                "Tenant concurrency slot acquired tenant=%s job=%s active=%d",
                tenant_id, job_id, active + 1,
            )
            return True
        except Exception as exc:
            logger.error("Tenant concurrency acquire error tenant=%s -- %s", tenant_id, exc)
            return True

    def release(self, tenant_id: str, job_id: str) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_CONCURRENCY_PREFIX + tenant_id
            client.srem(key, f"job:{job_id}")
        except Exception as exc:
            logger.error("Tenant concurrency release error tenant=%s -- %s", tenant_id, exc)

    def active_count(self, tenant_id: str) -> int:
        client = _get_redis()
        if not client:
            return 0
        try:
            key = _REDIS_CONCURRENCY_PREFIX + tenant_id
            return client.scard(key) or 0
        except Exception:
            return 0

    @staticmethod
    def _resolve_tier(tenant_id: str, tier: str | None) -> str:
        if tier and tier.lower() in _TIER_CONCURRENCY:
            return tier.lower()
        env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
        return os.getenv(env_var, "free").lower()


_token_bucket: Optional[TenantTokenBucket] = None
_concurrency_limiter: Optional[TenantConcurrencyLimiter] = None


def get_tenant_token_bucket() -> TenantTokenBucket:
    global _token_bucket
    if _token_bucket is None:
        _token_bucket = TenantTokenBucket()
    return _token_bucket


def get_tenant_concurrency_limiter() -> TenantConcurrencyLimiter:
    global _concurrency_limiter
    if _concurrency_limiter is None:
        _concurrency_limiter = TenantConcurrencyLimiter()
    return _concurrency_limiter
