import logging
import time
from typing import Any

from celery import shared_task

from workers.healing.heartbeat import WorkerHeartbeatMonitor
from workers.healing.retry import AutoRetryHandler
from workers.healing.circuit_breaker import CircuitBreaker
from workers.healing.queue_drain import QueueDrainMonitor

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.healing.monitor_heartbeats",
    autoretry_for=(Exception,),
)
def monitor_heartbeats(self) -> dict[str, Any]:
    monitor = WorkerHeartbeatMonitor()
    dead = monitor.get_dead_workers()
    revived_count = 0
    for worker_name in dead:
        count = monitor.revive_tasks_from_dead_worker(worker_name)
        revived_count += count
        logger.warning("Dead worker %s — revived %d tasks", worker_name, count)
    return {
        "dead_workers": dead,
        "revived_tasks": revived_count,
        "timestamp": time.time(),
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.healing.retry_with_backoff",
    autoretry_for=(Exception,),
)
def retry_with_backoff(self, task_id: str, task_name: str, error: str) -> dict[str, Any]:
    handler = AutoRetryHandler()
    should, delay = handler.should_retry(task_id)
    if should:
        count = handler.increment_retry(task_id)
        logger.info("Retrying task %s (%s) — attempt %d with %.1fs delay", task_id, task_name, count, delay)
        from celery import current_app
        current_app.send_task(
            task_name,
            kwargs={"task_id": task_id, "retry_count": count},
            countdown=int(delay),
        )
        return {"task_id": task_id, "action": "retry", "attempt": count, "delay": delay}
    else:
        handler.send_to_dlq(task_id, task_name, error)
        return {"task_id": task_id, "action": "dlq", "reason": f"Max retries ({handler.get_retry_count(task_id)}) exceeded"}


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    name="workers.tasks.healing.dlq_handler",
    autoretry_for=(Exception,),
)
def dlq_handler(self, task_id: str, task_name: str, error: str, retry_count: int) -> dict[str, Any]:
    logger.warning("DLQ received task %s (%s) after %d retries: %s", task_id, task_name, retry_count, error)
    return {
        "task_id": task_id,
        "task_name": task_name,
        "error": error,
        "retry_count": retry_count,
        "status": "dead_lettered",
        "timestamp": time.time(),
    }


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.healing.check_queue_depth",
)
def check_queue_depth(self) -> dict[str, Any]:
    monitor = QueueDrainMonitor()
    depths = monitor.get_all_queue_depths()
    coverage = monitor.check_worker_coverage()
    result = {
        "queue_depths": depths,
        "worker_coverage": coverage,
        "total_depth": sum(depths.values()),
        "drain_needed": coverage.get("drain_recommended", False),
    }
    if result["drain_needed"]:
        logger.warning("Queue drain needed — depths=%s", depths)
    return result


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.healing.record_task_failure",
)
def record_task_failure(self, task_type: str) -> dict[str, Any]:
    breaker = CircuitBreaker()
    state = breaker.record_failure(task_type)
    if state.get("state") == "open":
        logger.warning("Circuit breaker opened for %s — pausing %ds", task_type, 60)
    return {"task_type": task_type, "circuit_state": state}


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    name="workers.tasks.healing.record_task_success",
)
def record_task_success(self, task_type: str) -> dict[str, Any]:
    breaker = CircuitBreaker()
    breaker.record_success(task_type)
    return {"task_type": task_type, "circuit_state": "reset"}
