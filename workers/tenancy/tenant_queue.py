import logging
from typing import Any

from kombu import Exchange, Queue

logger = logging.getLogger(__name__)

STAS_TENANT_EXCHANGE = Exchange("stas.tenants", type="topic", durable=True)


class TenantQueueManager:
    def __init__(self) -> None:
        self._queues: dict[str, Queue] = {}

    def get_queue_name(self, tenant_id: str) -> str:
        return f"stas.tenant.{tenant_id}.dispatch"

    def get_queue(self, tenant_id: str) -> Queue:
        if tenant_id not in self._queues:
            q = Queue(
                self.get_queue_name(tenant_id),
                STAS_TENANT_EXCHANGE,
                routing_key=f"tenant.{tenant_id}.#",
                durable=True,
                queue_arguments={
                    "x-max-priority": 10,
                    "x-prefetch-count": 1,
                },
            )
            self._queues[tenant_id] = q
            logger.info("Created tenant queue: %s", q.name)
        return self._queues[tenant_id]

    def get_task_route(self, tenant_id: str) -> dict[str, Any]:
        return {
            "queue": self.get_queue_name(tenant_id),
            "exchange": STAS_TENANT_EXCHANGE.name,
            "routing_key": f"tenant.{tenant_id}.agent",
        }

    def get_all_queue_names(self) -> list[str]:
        return [q.name for q in self._queues.values()]

    def remove_queue(self, tenant_id: str) -> None:
        if tenant_id in self._queues:
            del self._queues[tenant_id]
            logger.info("Removed tenant queue: %s", self.get_queue_name(tenant_id))
