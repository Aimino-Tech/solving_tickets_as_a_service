"""
AgentConcurrencyLimiter --- limits concurrent agent executions via Redis.
"""
import json, logging, os, time
from typing import Any, Optional
logger = logging.getLogger(__name__)
_MAX_CONCURRENT = int(os.getenv("AGENT_MAX_CONCURRENT", "3"))
_SLOT_TIMEOUT_S = int(os.getenv("AGENT_CONCURRENCY_TIMEOUT_S", "600"))
_REDIS_KEY = "stas:agent:active_slots"
_REDIS_SLOT_PREFIX = "stas:agent:slot:"
_REDIS_CLIENT: Optional[Any] = None

def _get_redis() -> Optional[Any]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None: return _REDIS_CLIENT
    try:
        import redis as _rm
        url = os.getenv("REDIS_URL", os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"))
        _REDIS_CLIENT = _rm.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("AgentConcurrencyLimiter Redis unavailable --- %s", exc)
        _REDIS_CLIENT = None; return None

class AgentConcurrencyLimiter:
    def __init__(self, max_concurrent: int = _MAX_CONCURRENT) -> None:
        self.max_concurrent = max_concurrent
    def acquire(self, issue_id: str) -> bool:
        client = _get_redis()
        if not client: return True
        try:
            self._prune_stale_slots(client)
            current = client.scard(_REDIS_KEY)
            if current is not None and current >= self.max_concurrent: return False
            member = _REDIS_SLOT_PREFIX + issue_id
            if client.sadd(_REDIS_KEY, member):
                mk = f"{member}:meta"
                client.hset(mk, mapping={"issue_id": issue_id, "acquired_at": str(time.time()), "ttl": str(_SLOT_TIMEOUT_S)})
                client.expire(mk, _SLOT_TIMEOUT_S + 60)
                return True
            return True
        except Exception: return True
    def release(self, issue_id: str) -> None:
        client = _get_redis()
        if not client: return
        try:
            member = _REDIS_SLOT_PREFIX + issue_id
            client.srem(_REDIS_KEY, member); client.delete(f"{member}:meta")
        except Exception: pass
    def active_count(self) -> int:
        client = _get_redis()
        if not client: return 0
        try: return client.scard(_REDIS_KEY) or 0
        except Exception: return 0
    def is_acquired(self, issue_id: str) -> bool:
        client = _get_redis()
        if not client: return False
        try: return bool(client.sismember(_REDIS_KEY, _REDIS_SLOT_PREFIX + issue_id))
        except Exception: return False
    def _prune_stale_slots(self, client: Any) -> None:
        try:
            for m in client.smembers(_REDIS_KEY) or set():
                mk = f"{m}:meta"; r = client.hget(mk, "acquired_at")
                if r:
                    try:
                        if time.time() - float(r) > _SLOT_TIMEOUT_S: client.srem(_REDIS_KEY, m); client.delete(mk)
                    except (ValueError, TypeError): client.srem(_REDIS_KEY, m); client.delete(mk)
        except Exception: pass

_limiter: Optional[AgentConcurrencyLimiter] = None
def get_limiter() -> AgentConcurrencyLimiter:
    global _limiter
    if _limiter is None: _limiter = AgentConcurrencyLimiter()
    return _limiter
