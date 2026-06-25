import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

MAX_RETRIES = int(os.getenv("STAS_MAX_RETRIES", "3"))
BACKOFF_BASE = int(os.getenv("STAS_RETRY_BACKOFF_BASE", "1"))


def compute_backoff(attempt: int) -> float:
    return min(BACKOFF_BASE * (4 ** (attempt - 1)), 60.0)


class AutoRetryHandler:
    def __init__(self, redis_client: Any | None = None):
        self._redis = redis_client

    def _retry_key(self, task_id: str) -> str:
        return f"stas:retry:{task_id}"

    def get_retry_count(self, task_id: str) -> int:
        if self._redis:
            try:
                val = self._redis.get(self._retry_key(task_id))
                return int(val) if val else 0
            except Exception:
                pass
        return 0

    def increment_retry(self, task_id: str, ttl: int = 3600) -> int:
        count = self.get_retry_count(task_id) + 1
        if self._redis:
            try:
                self._redis.setex(self._retry_key(task_id), ttl, count)
            except Exception as exc:
                logger.warning("Failed to increment retry for %s: %s", task_id, exc)
        return count

    def should_retry(self, task_id: str) -> tuple[bool, float]:
        count = self.get_retry_count(task_id)
        if count >= MAX_RETRIES:
            return False, 0.0
        delay = compute_backoff(count + 1)
        return True, delay

    def should_send_to_dlq(self, task_id: str) -> bool:
        count = self.get_retry_count(task_id)
        return count >= MAX_RETRIES

    def send_to_dlq(self, task_id: str, task_name: str, error: str) -> None:
        logger.warning("Sending task %s (%s) to DLQ after %d retries: %s", task_id, task_name, MAX_RETRIES, error)
        from celery import current_app
        try:
            current_app.send_task(
                "workers.tasks.healing.dlq_handler",
                args=[task_id, task_name, error, self.get_retry_count(task_id)],
                queue="stas.dlx.retry",
            )
        except Exception as exc:
            logger.error("Failed to send task %s to DLQ: %s", task_id, exc)

    def clear_retry_count(self, task_id: str) -> None:
        if self._redis:
            try:
                self._redis.delete(self._retry_key(task_id))
            except Exception:
                pass
