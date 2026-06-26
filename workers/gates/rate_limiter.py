"""
Per-tenant rate limiter using a Redis-backed token bucket algorithm.

Tracks API usage per tenant using a token bucket with automatic refill.
Supports configurable capacity and refill rate per plan tier.

Usage::

    limiter = TenantRateLimiter()
    if limiter.consume("tenant-42"):
        ... process request ...
    else:
        ... return 429 Too Many Requests ...
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Environment defaults
# ---------------------------------------------------------------------------

_DEFAULT_CAPACITY = int(os.getenv("RATE_LIMITER_DEFAULT_CAPACITY", "60"))
_DEFAULT_REFILL_RATE = float(os.getenv("RATE_LIMITER_DEFAULT_REFILL_RATE", "1.0"))

_TIER_CAPACITY: dict[str, int] = {
    "free": int(os.getenv("RATE_LIMITER_CAPACITY_FREE", "10")),
    "pro": int(os.getenv("RATE_LIMITER_CAPACITY_PRO", "60")),
    "enterprise": int(os.getenv("RATE_LIMITER_CAPACITY_ENTERPRISE", "300")),
}

_TIER_REFILL_RATE: dict[str, float] = {
    "free": float(os.getenv("RATE_LIMITER_REFILL_FREE", "0.5")),
    "pro": float(os.getenv("RATE_LIMITER_REFILL_PRO", "1.0")),
    "enterprise": float(os.getenv("RATE_LIMITER_REFILL_ENTERPRISE", "5.0")),
}

_REDIS_PREFIX = "stas:rate_limiter:"
_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
    """Return a shared Redis client or ``None`` if unavailable."""
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
        logger.warning("Rate limiter Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


class RateLimitResult:
    """Result of a rate limit check.

    Attributes:
        allowed: Whether the request is allowed.
        remaining: Number of tokens remaining in the bucket.
        capacity: Maximum bucket capacity.
        reset_after_seconds: Seconds until the bucket fully refills.
    """

    def __init__(
        self,
        allowed: bool,
        remaining: float,
        capacity: int,
        reset_after_seconds: float,
    ) -> None:
        self.allowed = allowed
        self.remaining = remaining
        self.capacity = capacity
        self.reset_after_seconds = reset_after_seconds

    def __repr__(self) -> str:
        return (
            f"RateLimitResult(allowed={self.allowed}, remaining={self.remaining:.1f}, "
            f"capacity={self.capacity}, reset_in={self.reset_after_seconds:.0f}s)"
        )


# ---------------------------------------------------------------------------
# Token bucket rate limiter
# ---------------------------------------------------------------------------


class TenantRateLimiter:
    """Redis-backed token bucket rate limiter per tenant.

    Each tenant has a token bucket identified by
    ``stas:rate_limiter:<tenant_id>`` with keys for current token count
    and last refill timestamp.

    **Configuration** (environment variables):

    * ``RATE_LIMITER_DEFAULT_CAPACITY`` -- default max tokens (default: 60)
    * ``RATE_LIMITER_DEFAULT_REFILL_RATE`` -- tokens per second (default: 1.0)
    * ``RATE_LIMITER_CAPACITY_FREE`` -- free tier capacity (default: 10)
    * ``RATE_LIMITER_CAPACITY_PRO`` -- pro tier capacity (default: 60)
    * ``RATE_LIMITER_CAPACITY_ENTERPRISE`` -- enterprise capacity (default: 300)
    * ``RATE_LIMITER_REFILL_FREE`` -- free tier refill rate (default: 0.5)
    * ``RATE_LIMITER_REFILL_PRO`` -- pro tier refill rate (default: 1.0)
    * ``RATE_LIMITER_REFILL_ENTERPRISE`` -- enterprise refill rate (default: 5.0)
    """

    def __init__(
        self,
        default_capacity: int = _DEFAULT_CAPACITY,
        default_refill_rate: float = _DEFAULT_REFILL_RATE,
    ) -> None:
        self._default_capacity = default_capacity
        self._default_refill_rate = default_refill_rate

    # -- Tier resolution ---------------------------------------------------

    def _resolve_tier(self, tenant_id: str, tier: str | None) -> str:
        if tier and tier.lower() in _TIER_CAPACITY:
            return tier.lower()
        env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
        return os.getenv(env_var, "free").lower()

    def _capacity_for_tier(self, tier: str) -> int:
        return _TIER_CAPACITY.get(tier, self._default_capacity)

    def _refill_rate_for_tier(self, tier: str) -> float:
        return _TIER_REFILL_RATE.get(tier, self._default_refill_rate)

    # -- Redis key helpers -------------------------------------------------

    @staticmethod
    def _tokens_key(tenant_id: str) -> str:
        return f"{_REDIS_PREFIX}{tenant_id}:tokens"

    @staticmethod
    def _timestamp_key(tenant_id: str) -> str:
        return f"{_REDIS_PREFIX}{tenant_id}:ts"

    # -- Bucket state ------------------------------------------------------

    def _get_bucket_state(
        self, tenant_id: str, tier: str | None = None
    ) -> tuple[float, float]:
        """Return ``(current_tokens, last_timestamp)`` from Redis or defaults."""
        client = _get_redis()
        effective_tier = self._resolve_tier(tenant_id, tier)
        if not client:
            return float(self._capacity_for_tier(effective_tier)), time.time()
        try:
            tokens_raw = client.get(self._tokens_key(tenant_id))
            ts_raw = client.get(self._timestamp_key(tenant_id))
            tokens = (
                float(tokens_raw)
                if tokens_raw is not None
                else float(self._capacity_for_tier(effective_tier))
            )
            ts = float(ts_raw) if ts_raw is not None else time.time()
            return tokens, ts
        except Exception:
            return float(self._capacity_for_tier(effective_tier)), time.time()

    def _write_bucket_state(
        self, tenant_id: str, tokens: float, ts: float
    ) -> None:
        """Persist bucket state to Redis with 24-hour TTL."""
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
            logger.error(
                "Failed to write bucket state for %s -- %s", tenant_id, exc
            )

    def _refill(
        self, tenant_id: str, tier: str | None = None
    ) -> tuple[float, float]:
        """Refill tokens based on elapsed time, return ``(tokens, now)``."""
        tokens, ts = self._get_bucket_state(tenant_id, tier)
        now = time.time()
        elapsed = now - ts
        effective_tier = self._resolve_tier(tenant_id, tier)
        capacity = float(self._capacity_for_tier(effective_tier))
        if elapsed > 0:
            new_tokens = min(
                capacity,
                tokens + elapsed * self._refill_rate_for_tier(effective_tier),
            )
            self._write_bucket_state(tenant_id, new_tokens, now)
            return new_tokens, now
        return tokens, now

    # -- Public API --------------------------------------------------------

    def consume(
        self,
        tenant_id: str,
        tokens: int = 1,
        tier: str | None = None,
    ) -> bool:
        """Try to consume *tokens* from the tenant's bucket.

        Args:
            tenant_id: Unique tenant identifier.
            tokens: Number of tokens to consume (default: 1).
            tier: Plan tier (``"free"``, ``"pro"``, ``"enterprise"``).
                  Auto-resolved from env if omitted.

        Returns:
            ``True`` if tokens were available and consumed.
            ``False`` if the bucket was empty (rate limited).
            ``True`` on Redis failure (degraded fallback).
        """
        client = _get_redis()
        if not client:
            return True  # graceful degradation
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
                "Rate limited tenant=%s tokens=%.1f requested=%d",
                tenant_id,
                current_tokens,
                tokens,
            )
            return False
        except Exception as exc:
            logger.error(
                "Rate limiter consume error tenant=%s -- %s", tenant_id, exc
            )
            return True

    def check(
        self,
        tenant_id: str,
        tokens: int = 1,
        tier: str | None = None,
    ) -> RateLimitResult:
        """Check if *tokens* can be consumed **without** consuming them.

        Returns a ``RateLimitResult`` with the current bucket state.
        """
        current_tokens, _ = self._refill(tenant_id, tier)
        effective_tier = self._resolve_tier(tenant_id, tier)
        capacity = self._capacity_for_tier(effective_tier)
        refill_rate = self._refill_rate_for_tier(effective_tier)
        reset_after = (
            (capacity - current_tokens) / refill_rate if refill_rate > 0 else 0.0
        )
        return RateLimitResult(
            allowed=current_tokens >= tokens,
            remaining=current_tokens,
            capacity=capacity,
            reset_after_seconds=max(0.0, reset_after),
        )

    def remaining(self, tenant_id: str, tier: str | None = None) -> float:
        """Return the number of tokens remaining in the tenant's bucket."""
        tokens, _ = self._refill(tenant_id, tier)
        return tokens

    def reset(self, tenant_id: str) -> None:
        """Reset (delete) the tenant's bucket in Redis."""
        client = _get_redis()
        if not client:
            return
        try:
            client.delete(self._tokens_key(tenant_id))
            client.delete(self._timestamp_key(tenant_id))
        except Exception as exc:
            logger.error(
                "Failed to reset rate limiter for %s -- %s", tenant_id, exc
            )


# ---------------------------------------------------------------------------
# Module-level convenience instance
# ---------------------------------------------------------------------------

_limiter: Optional[TenantRateLimiter] = None


def get_rate_limiter() -> TenantRateLimiter:
    """Return a shared ``TenantRateLimiter`` singleton."""
    global _limiter
    if _limiter is None:
        _limiter = TenantRateLimiter()
    return _limiter
