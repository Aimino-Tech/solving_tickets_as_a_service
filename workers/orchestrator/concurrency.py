import logging
import os

import redis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("CELERY_BROKER_URL", os.getenv("REDIS_URL", "redis://localhost:6379/0"))


class AgentConcurrencyLimiter:
    def __init__(self, redis_client: redis.Redis | None = None, max_concurrent: int = 3):
        self.redis = redis_client or redis.from_url(REDIS_URL, decode_responses=True)
        self.max = max_concurrent

    def acquire(self, issue_id: str) -> bool:
        key = "agents:running"
        pipe = self.redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, 3600)
        count, _ = pipe.execute()
        if count > self.max:
            self.redis.decr(key)
            logger.info("Concurrency limit reached (%d/%d), rejecting %s", count - 1, self.max, issue_id)
            return False
        logger.info("Acquired concurrency slot (%d/%d) for %s", count, self.max, issue_id)
        return True

    def release(self, issue_id: str):
        self.redis.decr("agents:running")
        logger.info("Released concurrency slot for %s", issue_id)

    def running_count(self) -> int:
        val = self.redis.get("agents:running")
        return int(val) if val else 0
