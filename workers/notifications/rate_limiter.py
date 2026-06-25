"""
Per-issue comment rate limiter.

Redis-based sliding window counter. Tracks how many comments have been posted
for a given issue within a configurable time window (default 1 hour).
Supports configurable limits per plan tier.
"""
from __future__ import annotations
import logging
import os
import time
from typing import Any, Optional
logger = logging.getLogger(__name__)

COMMENT_RATE_LIMIT_ENABLED = os.getenv("COMMENT_RATE_LIMIT_ENABLED", "true").lower() in ("true", "1", "yes")
COMMENT_RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("COMMENT_RATE_LIMIT_WINDOW_SECONDS", "3600"))
COMMENT_RATE_LIMIT_FREE = int(os.getenv("COMMENT_RATE_LIMIT_FREE", "5"))
COMMENT_RATE_LIMIT_PRO = int(os.getenv("COMMENT_RATE_LIMIT_PRO", "20"))
COMMENT_RATE_LIMIT_ENTERPRISE = int(os.getenv("COMMENT_RATE_LIMIT_ENTERPRISE", "50"))

_TIER_LIMITS: dict[str, int] = {
    "free": COMMENT_RATE_LIMIT_FREE,
    "pro": COMMENT_RATE_LIMIT_PRO,
    "enterprise": COMMENT_RATE_LIMIT_ENTERPRISE,
}
_REDIS_PREFIX = "stas:comment_rate:"
_REDIS_CLIENT: Optional[Any] = None

def _get_redis() -> Optional[Any]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod
        url = os.getenv("REDIS_URL", os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"))
        _REDIS_CLIENT = _redis_mod.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Comment rate limiter Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None

class RateLimitResult:
    def __init__(self, allowed: bool, current: int, limit: int, reset_after_seconds: float) -> None:
        self.allowed = allowed
        self.current = current
        self.limit = limit
        self.remaining = max(0, limit - current)
        self.reset_after_seconds = reset_after_seconds
    def __repr__(self) -> str:
        return (f"RateLimitResult(allowed={self.allowed}, current={self.current}, "
                f"limit={self.limit}, remaining={self.remaining}, reset_in={self.reset_after_seconds:.0f}s)")

class CommentRateLimiter:
    def __init__(self, window_seconds: int = COMMENT_RATE_LIMIT_WINDOW_SECONDS) -> None:
        self._window_seconds = window_seconds

    def check_and_increment(self, issue_id: str, tier: str = "free", *, dry_run: bool = False) -> RateLimitResult:
        limit = _TIER_LIMITS.get(tier.lower(), COMMENT_RATE_LIMIT_FREE)
        now = time.time()
        window_start = now - self._window_seconds
        client = _get_redis()
        if not client:
            return RateLimitResult(allowed=True, current=0, limit=limit, reset_after_seconds=0.0)
        key = _REDIS_PREFIX + issue_id
        try:
            client.zremrangebyscore(key, 0, window_start)
            current = client.zcard(key) or 0
            if current >= limit:
                oldest = client.zrange(key, 0, 0, withscores=True)
                reset_after = max(0.0, (oldest[0][1] + self._window_seconds) - now) if oldest else 0.0
                return RateLimitResult(allowed=False, current=current, limit=limit, reset_after_seconds=reset_after)
            if not dry_run:
                client.zadd(key, {str(now): now})
                client.expire(key, self._window_seconds)
            return RateLimitResult(allowed=True, current=current + (0 if dry_run else 1), limit=limit, reset_after_seconds=self._window_seconds - (now - window_start))
        except Exception as exc:
            logger.error("Comment rate limiter error issue=%s -- %s", issue_id, exc)
            return RateLimitResult(allowed=True, current=0, limit=limit, reset_after_seconds=0.0)

    def check(self, issue_id: str, tier: str = "free") -> RateLimitResult:
        return self.check_and_increment(issue_id, tier, dry_run=True)
    def remaining(self, issue_id: str, tier: str = "free") -> int:
        return self.check(issue_id, tier).remaining
    def reset(self, issue_id: str) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            client.delete(_REDIS_PREFIX + issue_id)
        except Exception as exc:
            logger.error("Failed to reset rate counter for issue=%s -- %s", issue_id, exc)
    @property
    def window_seconds(self) -> int:
        return self._window_seconds

_limiter: Optional[CommentRateLimiter] = None
def get_comment_rate_limiter() -> CommentRateLimiter:
    global _limiter
    if _limiter is None:
        _limiter = CommentRateLimiter()
    return _limiter
