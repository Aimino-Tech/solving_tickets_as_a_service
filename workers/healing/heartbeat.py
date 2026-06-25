import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

HEARTBEAT_TIMEOUT = int(os.getenv("STAS_HEARTBEAT_TIMEOUT_SECONDS", "60"))
HEARTBEAT_KEY_PREFIX = "stas:heartbeat:worker:"


class WorkerHeartbeatMonitor:
    def __init__(self, redis_client: Any | None = None):
        self._redis = redis_client

    def record_heartbeat(self, worker_name: str) -> None:
        if self._redis:
            try:
                self._redis.setex(
                    f"{HEARTBEAT_KEY_PREFIX}{worker_name}",
                    HEARTBEAT_TIMEOUT + 10,
                    str(time.time()),
                )
            except Exception as exc:
                logger.warning("Failed to record heartbeat for %s: %s", worker_name, exc)

    def is_worker_alive(self, worker_name: str) -> bool:
        if self._redis:
            try:
                val = self._redis.get(f"{HEARTBEAT_KEY_PREFIX}{worker_name}")
                if val:
                    last_seen = float(val)
                    return (time.time() - last_seen) < HEARTBEAT_TIMEOUT
            except Exception as exc:
                logger.warning("Failed to check heartbeat for %s: %s", worker_name, exc)
        return True

    def get_dead_workers(self) -> list[str]:
        dead: list[str] = []
        if self._redis:
            try:
                pattern = f"{HEARTBEAT_KEY_PREFIX}*"
                cursor = 0
                while True:
                    cursor, keys = self._redis.scan(cursor, match=pattern, count=100)
                    for key in keys:
                        worker_name = key.replace(HEARTBEAT_KEY_PREFIX, "")
                        if not self.is_worker_alive(worker_name):
                            dead.append(worker_name)
                    if cursor == 0:
                        break
            except Exception as exc:
                logger.warning("Failed to scan for dead workers: %s", exc)
        return dead

    def revive_tasks_from_dead_worker(self, worker_name: str) -> int:
        from celery import current_app
        i = current_app.control.inspect()
        try:
            reserved = i.reserved() or {}
            active = i.active() or {}
        except Exception:
            return 0

        task_ids: list[str] = []
        for source in [reserved, active]:
            for worker, tasks in source.items():
                if worker_name in worker:
                    for task in tasks:
                        task_ids.append(task["id"])

        for task_id in task_ids:
            try:
                current_app.control.revoke(task_id, terminate=True)
                logger.warning("Revoked task %s from dead worker %s", task_id, worker_name)
            except Exception as exc:
                logger.warning("Failed to revoke task %s: %s", task_id, exc)

        return len(task_ids)
