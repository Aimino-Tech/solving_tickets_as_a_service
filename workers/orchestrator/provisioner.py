from __future__ import annotations

import json
import logging
import os
import time
import uuid
from enum import Enum
from typing import Any, Optional

from kombu import Connection, Exchange, Queue, Message
from kombu.mixins import ConsumerMixin

logger = logging.getLogger(__name__)

_MAX_RETRIES = int(os.getenv("PROVISION_MAX_RETRIES", "3"))
_PROVISION_TIMEOUT_S = int(os.getenv("MAX_PROVISIONING_TIME", "300"))
_KILL_TIMEOUT_S = int(os.getenv("KILL_TIMEOUT", "30"))
_RETRY_BACKOFF_BASE_S = int(os.getenv("PROVISION_RETRY_BACKOFF_S", "30"))


class ProvisioningStatus(str, Enum):
    CREATING = "creating"
    READY = "ready"
    FAILED = "failed"
    CLEANUP = "cleanup"
    CLEANED = "cleaned"


PROVISIONING_STATES: dict[ProvisioningStatus, list[ProvisioningStatus]] = {
    ProvisioningStatus.CREATING: [ProvisioningStatus.READY, ProvisioningStatus.FAILED, ProvisioningStatus.CLEANUP],
    ProvisioningStatus.READY: [],
    ProvisioningStatus.FAILED: [ProvisioningStatus.CLEANUP],
    ProvisioningStatus.CLEANUP: [ProvisioningStatus.CLEANED],
    ProvisioningStatus.CLEANED: [],
}


def validate_transition(current: ProvisioningStatus, next_state: ProvisioningStatus) -> bool:
    allowed = PROVISIONING_STATES.get(current, [])
    return next_state in allowed


class ProvisioningStore:
    """In-memory store for provisioning state.

    In production, this would be backed by PostgreSQL or Redis.
    For now it provides a simple in-memory view.
    """

    def __init__(self) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}

    def create_job(self, config: dict[str, Any]) -> str:
        job_id = f"prov-{uuid.uuid4().hex[:12]}"
        self._jobs[job_id] = {
            "id": job_id,
            "status": ProvisioningStatus.CREATING.value,
            "config": config,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "retry_count": 0,
            "error": None,
            "worker_info": None,
        }
        return job_id

    def get_job(self, job_id: str) -> Optional[dict[str, Any]]:
        return self._jobs.get(job_id)

    def update_status(
        self,
        job_id: str,
        status: ProvisioningStatus,
        error: Optional[str] = None,
        worker_info: Optional[dict[str, Any]] = None,
    ) -> Optional[dict[str, Any]]:
        job = self._jobs.get(job_id)
        if not job:
            return None
        current = ProvisioningStatus(job["status"])
        if not validate_transition(current, status):
            logger.warning("Invalid state transition: %s → %s", current.value, status.value)
            return None
        job["status"] = status.value
        job["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if error:
            job["error"] = error
        if worker_info:
            job["worker_info"] = worker_info
        return job

    def increment_retry(self, job_id: str) -> Optional[int]:
        job = self._jobs.get(job_id)
        if not job:
            return None
        job["retry_count"] += 1
        return job["retry_count"]

    def list_jobs(self, status: Optional[str] = None, limit: int = 50) -> list[dict[str, Any]]:
        all_jobs = list(self._jobs.values())
        if status:
            all_jobs = [j for j in all_jobs if j["status"] == status]
        return sorted(all_jobs, key=lambda j: j["created_at"], reverse=True)[:limit]


_store = ProvisioningStore()


def get_store() -> ProvisioningStore:
    return _store


def compute_delay(retry_count: int) -> int:
    return _RETRY_BACKOFF_BASE_S * (2 ** (retry_count - 1))


def provision_worker(config: dict[str, Any], job_id: str) -> dict[str, Any]:
    logger.info("Provisioning worker — job_id=%s config=%s", job_id, {k: v for k, v in config.items() if k != "auth"})
    time.sleep(2)
    worker_info = {
        "worker_id": f"worker-{uuid.uuid4().hex[:8]}",
        "endpoint": f"https://worker-{job_id}.example.com",
        "status": "running",
    }
    return worker_info


def cleanup_worker(worker_info: dict[str, Any]) -> None:
    worker_id = worker_info.get("worker_id", "unknown")
    logger.info("Cleaning up worker — worker_id=%s", worker_id)


class ProvisionConsumer(ConsumerMixin):
    def __init__(self, connection: Connection) -> None:
        self.connection = connection
        self.queue = Queue(
            "stas.provision",
            Exchange("stas.provision", type="direct", durable=True),
            routing_key="provision.create",
            durable=True,
        )
        self.cleanup_queue = Queue(
            "stas.provision.cleanup",
            Exchange("stas.provision", type="direct", durable=True),
            routing_key="provision.cleanup",
            durable=True,
        )
        self.dlq = Queue(
            "stas.provision.dlq",
            Exchange("stas.dlx", type="direct", durable=True),
            routing_key="provision.dlq",
            durable=True,
        )

    def get_consumers(self, Consumer: Any, channel: Any) -> list[Any]:
        return [
            Consumer(
                [self.queue],
                callbacks=[self.on_provision_message],
                accept=["json"],
                prefetch_count=1,
            ),
            Consumer(
                [self.cleanup_queue],
                callbacks=[self.on_cleanup_message],
                accept=["json"],
                prefetch_count=5,
            ),
        ]

    def on_provision_message(self, body: Any, message: Message) -> None:
        job_id = body.get("job_id", "unknown")
        config = body.get("config", {})
        retry_count = body.get("retry_count", 0)

        logger.info("Provision message received — job_id=%s retry=%d", job_id, retry_count)

        try:
            worker_info = provision_worker(config, job_id)
            _store.update_status(job_id, ProvisioningStatus.READY, worker_info=worker_info)
            logger.info("Provisioning complete — job_id=%s worker_id=%s", job_id, worker_info.get("worker_id"))
            message.ack()
        except Exception as exc:
            logger.error("Provisioning failed — job_id=%s error=%s", job_id, exc)
            _store.update_status(job_id, ProvisioningStatus.FAILED, error=str(exc))

            if retry_count < _MAX_RETRIES:
                delay = compute_delay(retry_count + 1)
                _store.increment_retry(job_id)
                retry_body = {**body, "retry_count": retry_count + 1}
                try:
                    self.connection.channel().basic_publish(
                        exchange="stas.provision",
                        routing_key="provision.create",
                        body=json.dumps(retry_body).encode("utf-8"),
                        properties={
                            "headers": {"retry_count": retry_count + 1},
                            "delivery_mode": 2,
                        },
                    )
                    logger.info("Scheduled retry — job_id=%s attempt=%d delay=%ds", job_id, retry_count + 1, delay)
                except Exception as publish_err:
                    logger.error("Failed to publish retry — %s", publish_err)
                message.ack()
            else:
                logger.warning("Max retries exceeded — job_id=%s moving to DLQ", job_id)
                _store.update_status(job_id, ProvisioningStatus.FAILED, error=f"Max retries ({_MAX_RETRIES}) exceeded")
                self._publish_to_dlq(body, str(exc))
                self._publish_cleanup(job_id, {})
                message.ack()

    def on_cleanup_message(self, body: Any, message: Message) -> None:
        job_id = body.get("job_id", "unknown")
        worker_info = body.get("worker_info", {})
        logger.info("Cleanup message received — job_id=%s", job_id)
        try:
            cleanup_worker(worker_info)
            _store.update_status(job_id, ProvisioningStatus.CLEANED)
            logger.info("Cleanup complete — job_id=%s", job_id)
        except Exception as exc:
            logger.error("Cleanup failed — job_id=%s error=%s", job_id, exc)
        message.ack()

    def _publish_to_dlq(self, original_body: dict[str, Any], error: str) -> None:
        dlq_body = {
            "original_payload": original_body,
            "error": {"message": error, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
            "retry_count": _MAX_RETRIES,
            "final_failure_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        try:
            self.connection.channel().basic_publish(
                exchange="stas.dlx",
                routing_key="provision.dlq",
                body=json.dumps(dlq_body).encode("utf-8"),
                properties={"delivery_mode": 2},
            )
            logger.info("Published to DLQ — job_id=%s", original_body.get("job_id"))
        except Exception as exc:
            logger.error("Failed to publish to DLQ — %s", exc)

    def _publish_cleanup(self, job_id: str, worker_info: dict[str, Any]) -> None:
        try:
            self.connection.channel().basic_publish(
                exchange="stas.provision",
                routing_key="provision.cleanup",
                body=json.dumps({"job_id": job_id, "worker_info": worker_info}).encode("utf-8"),
                properties={"delivery_mode": 2},
            )
        except Exception as exc:
            logger.error("Failed to publish cleanup — %s", exc)
