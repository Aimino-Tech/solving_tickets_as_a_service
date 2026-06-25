"""
Per-tenant rate and concurrency limiters (AIM-2017).

Provides:
    - ``TenantTokenBucket`` — Redis-backed token bucket for per-tenant API rate
      limiting.  Refills tokens at a configurable rate.
    - ``TenantConcurrencyLimiter`` — Per-tenant concurrent agent slot limiter
      with tier-based ceilings (free=2, pro=10, enterprise=50).

Integration with the existing ``AgentConcurrencyLimiter``:
    - ``AgentConcurrencyLimiter`` (``concurrency.py``) guards total system-wide
      concurrency.
    - ``TenantConcurrencyLimiter`` is checked **before** dispatching a task
      to ensure the tenant has not exceeded its own ceiling.

Usage::

    limiter = get_tenant_token_bucket()
    if limiter.consume("tenant-abc", tokens=1):
        # dispatch
    else:
        # rate limited

    tcl = get_tenant_concurrency_limiter()
    if tcl.acquire("tenant-abc", "job-42"):
        try:
            ...
        finally:
            tcl.release("tenant-abc", "job-42")

Configuration (env vars):
    TENANT_CONCURRENCY_FREE (default: 2)
    TENANT_CONCURRENCY_PRO (default: 10)
    TENANT_CONCURRENCY_ENTERPRISE (default: 50)
    TOKEN_BUCKET_DEFAULT_CAPACITY (default: 60)
    TOKEN_BUCKET_DEFAULT_REFILL_RATE (default: 1.0)  — tokens per second
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_TENANT_CONCURRENCY_FREE = int(os.getenv("TENANT_CONCURRENCY_FREE", "2"))
_TENANT_CONCURRENCY_PRO = int(os.getenv("TENANT_CONCURRENCY_PRO", "10"))
_TENANT_CONCURRENCY_ENTERPRISE = int(os.getenv("TENANT_CONCURRENCY_ENTERPRISE", "50"))

_TIER_CONCURRENCY: dict[str, int] = {
    "free": _TENANT_CONCURRENCY_FREE,
    "pro": _TENANT_CONCURRENCY_PRO,
    "enterprise": _TENANT_CONCURRENCY_ENTERPRISE,
}

_TOKEN_BUCKET_DEFAULT_CAPACITY = int(os.getenv("TOKEN_BUCKET_DEFAULT_CAPACITY", "60"))
_TOKEN_BUCKET_DEFAULT_REFILL_RATE = float(
    os.getenv("TOKEN_BUCKET_DEFAULT_REFILL_RATE", "1.0")
)

# Redis key prefixes
_REDIS_BUCKET_PREFIX = "stas:token_bucket:"
_REDIS_CONCURRENCY_PREFIX = "stas:tenant_concurrency:"
_REDIS_TIER_KEY = "stas:tenant_tier"

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
        logger.warning("Tenant limiter Redis unavailable — %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# TenantTokenBucket
# ---------------------------------------------------------------------------


class TenantTokenBucket:
    """Redis-backed token bucket rate limiter, keyed by tenant ID.

    Each tenant has a logical bucket with:
        - ``capacity`` — maximum tokens the bucket can hold (burst limit).
        - ``refill_rate`` — tokens added per second.

    Thread-safe across workers because state lives in Redis.

    Usage::

        bucket = TenantTokenBucket(capacity=60, refill_rate=1.0)
        if bucket.consume("tenant-abc"):
            ...  # within rate limit
        else:
            ...  # rate limited

    For tiered limits::

        bucket = TenantTokenBucket()
        bucket.consume("tenant-abc", tier="free")
    """

    def __init__(
        self,
        capacity: int = _TOKEN_BUCKET_DEFAULT_CAPACITY,
        refill_rate: float = _TOKEN_BUCKET_DEFAULT_REFILL_RATE,
    ) -> None:
        self.capacity = capacity
        self.refill_rate = refill_rate

    # ------------------------------------------------------------------
    # Tier helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_tier(tenant_id: str, tier: str | None) -> str:
        """Resolve the effective tier for *tenant_id*."""
        if tier and tier.lower() in _TIER_CONCURRENCY:
            return tier.lower()
        # Fall back to env-var-per-tenant or "free"
        env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
        return os.getenv(env_var, "free").lower()

    def _capacity_for_tier(self, tier: str) -> int:
        """Return the bucket capacity for the given billing *tier*."""
        if tier == "pro":
            return 300
        if tier == "enterprise":
            return 1000
        return self.capacity

    # ------------------------------------------------------------------
    # Token bucket operations
    # ------------------------------------------------------------------

    def _bucket_key(self, tenant_id: str) -> str:
        return f"{_REDIS_BUCKET_PREFIX}{tenant_id}"

    def _tokens_key(self, tenant_id: str) -> str:
        return f"{_REDIS_BUCKET_PREFIX}{tenant_id}:tokens"

    def _timestamp_key(self, tenant_id: str) -> str:
        return f"{_REDIS_BUCKET_PREFIX}{tenant_id}:ts"

    def _get_bucket_state(self, tenant_id: str, tier: str | None = None) -> tuple[float, float]:
        """Read current token count and last refill timestamp from Redis.

        Returns ``(tokens, last_refill_ts)``.
        """
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
            logger.error("Failed to write bucket state for %s — %s", tenant_id, exc)

    def _refill(self, tenant_id: str, tier: str | None = None) -> tuple[float, float]:
        """Refill tokens based on elapsed time since last refill.

        Returns ``(tokens, now)`` after refill.
        """
        tokens, ts = self._get_bucket_state(tenant_id, tier)
        now = time.time()
        elapsed = now - ts
        capacity = float(self._capacity_for_tier(self._resolve_tier(tenant_id, tier)))

        if elapsed > 0:
            new_tokens = min(capacity, tokens + elapsed * self.refill_rate)
            self._write_bucket_state(tenant_id, new_tokens, now)
            return new_tokens, now

        return tokens, now

    def consume(
        self,
        tenant_id: str,
        tokens: int = 1,
        tier: str | None = None,
    ) -> bool:
        """Try to consume *tokens* from *tenant_id*'s bucket.

        Returns:
            ``True`` if tokens were consumed (request allowed).
            ``False`` if the bucket is empty (rate limited).
        """
        client = _get_redis()
        if not client:
            return True  # degrade gracefully

        try:
            current_tokens, _ = self._refill(tenant_id, tier)

            if current_tokens >= tokens:
                remaining = current_tokens - tokens
                self._write_bucket_state(tenant_id, remaining, time.time())
                logger.debug(
                    "Token consumed tenant=%s remaining=%.1f",
                    tenant_id,
                    remaining,
                )
                return True

            logger.info(
                "Token bucket empty tenant=%s tokens=%.1f requested=%d",
                tenant_id,
                current_tokens,
                tokens,
            )
            return False
        except Exception as exc:
            logger.error(
                "Token bucket consume error tenant=%s — %s",
                tenant_id,
                exc,
            )
            return True

    def remaining(self, tenant_id: str, tier: str | None = None) -> float:
        """Return the number of tokens remaining for *tenant_id*."""
        tokens, _ = self._refill(tenant_id, tier)
        return tokens

    def reset(self, tenant_id: str) -> None:
        """Reset the token bucket for *tenant_id* to full capacity."""
        client = _get_redis()
        if not client:
            return
        try:
            client.delete(self._tokens_key(tenant_id))
            client.delete(self._timestamp_key(tenant_id))
        except Exception as exc:
            logger.error("Failed to reset bucket for %s — %s", tenant_id, exc)


# ---------------------------------------------------------------------------
# TenantConcurrencyLimiter
# ---------------------------------------------------------------------------


class TenantConcurrencyLimiter:
    """Per-tenant concurrent agent slot limiter.

    Differs from ``AgentConcurrencyLimiter`` (which guards total system-wide
    concurrency) by limiting each **tenant** independently based on their
    billing tier.

    Usage::

        limiter = get_tenant_concurrency_limiter()
        if limiter.acquire("tenant-abc", "job-42"):
            try:
                ...
            finally:
                limiter.release("tenant-abc", "job-42")
    """

    def acquire(
        self,
        tenant_id: str,
        job_id: str,
        tier: str | None = None,
    ) -> bool:
        """Try to acquire a concurrency slot for *tenant_id*.

        Returns ``True`` if the slot was acquired (or Redis is unavailable).
        """
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
            logger.error(
                "Tenant concurrency acquire error tenant=%s — %s",
                tenant_id,
                exc,
            )
            return True

    def release(self, tenant_id: str, job_id: str) -> None:
        """Release a previously acquired concurrency slot."""
        client = _get_redis()
        if not client:
            return
        try:
            key = _REDIS_CONCURRENCY_PREFIX + tenant_id
            member = f"job:{job_id}"
            client.srem(key, member)
        except Exception as exc:
            logger.error(
                "Tenant concurrency release error tenant=%s — %s",
                tenant_id,
                exc,
            )

    def active_count(self, tenant_id: str) -> int:
        """Return the number of active slots for *tenant_id*."""
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


# ---------------------------------------------------------------------------
# Singletons
# ---------------------------------------------------------------------------

_token_bucket: Optional[TenantTokenBucket] = None
_concurrency_limiter: Optional[TenantConcurrencyLimiter] = None


def get_tenant_token_bucket() -> TenantTokenBucket:
    """Return a shared ``TenantTokenBucket`` singleton."""
    global _token_bucket
    if _token_bucket is None:
        _token_bucket = TenantTokenBucket()
    return _token_bucket


def get_tenant_concurrency_limiter() -> TenantConcurrencyLimiter:
    """Return a shared ``TenantConcurrencyLimiter`` singleton."""
    global _concurrency_limiter
    if _concurrency_limiter is None:
        _concurrency_limiter = TenantConcurrencyLimiter()
    return _concurrency_limiter
