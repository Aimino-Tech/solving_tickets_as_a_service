import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

QUEUE_DEPTH_THRESHOLD = int(os.getenv("STAS_QUEUE_DEPTH_THRESHOLD", "100"))
QUEUE_CHECK_INTERVAL = int(os.getenv("STAS_QUEUE_CHECK_INTERVAL_SECONDS", "60"))


class QueueDrainMonitor:
    def __init__(self, redis_client: Any | None = None):
        self._redis = redis_client

    def get_queue_depth(self, queue_name: str = "stas.agents.dispatch") -> int:
        from celery import current_app
        try:
            conn = current_app.connection()
            channel = conn.channel()
            _, _, message_count = channel.queue_declare(queue=queue_name, passive=True, durable=True)
            conn.release()
            return message_count or 0
        except Exception as exc:
            logger.warning("Failed to get queue depth for %s: %s", queue_name, exc)
            return 0

    def is_drain_needed(self, queue_name: str = "stas.agents.dispatch") -> bool:
        depth = self.get_queue_depth(queue_name)
        return depth > QUEUE_DEPTH_THRESHOLD

    def check_worker_coverage(self) -> dict[str, Any]:
        from celery import current_app
        try:
            i = current_app.control.inspect()
            stats = i.stats() or {}
            active = i.active() or {}
            reserved = i.reserved() or {}

            worker_count = len(stats)
            active_tasks = sum(len(tasks) for tasks in active.values())
            reserved_tasks = sum(len(tasks) for tasks in reserved.values())

            status: dict[str, Any] = {
                "worker_count": worker_count,
                "active_tasks": active_tasks,
                "reserved_tasks": reserved_tasks,
                "under_provisioned": False,
                "drain_recommended": False,
            }

            queue_depth = self.get_queue_depth()
            status["queue_depth"] = queue_depth

            if queue_depth > QUEUE_DEPTH_THRESHOLD and worker_count == 0:
                status["under_provisioned"] = True
                status["drain_recommended"] = True
                logger.warning("Queue depth %d > %d with zero workers — drain recommended", queue_depth, QUEUE_DEPTH_THRESHOLD)

            return status
        except Exception as exc:
            logger.warning("Failed to check worker coverage: %s", exc)
            return {"error": str(exc)}

    def get_all_queue_depths(self) -> dict[str, int]:
        queues = [
            "stas.agents.dispatch",
            "stas.agents.verification",
            "stas.agents.sandbox",
            "stas.issues.triage",
            "stas.queue.pr",
            "stas.dlx.retry",
        ]
        depths: dict[str, int] = {}
        for q in queues:
            depths[q] = self.get_queue_depth(q)
        return depths
