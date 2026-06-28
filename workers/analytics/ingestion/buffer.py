from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Optional

from workers.analytics.ingestion.tasks import ingest_batch

logger = logging.getLogger(__name__)

_FLUSH_INTERVAL_S = int(os.getenv("ANALYTICS_FLUSH_INTERVAL_S", "5"))
_BATCH_SIZE = int(os.getenv("ANALYTICS_BATCH_SIZE", "1000"))
_QUEUE_MAX_SIZE = int(os.getenv("ANALYTICS_QUEUE_MAX_SIZE", "10000"))


class EventBuffer:
    """In-memory event buffer that periodically flushes to Celery.

    Accumulates events and publishes them as a batch Celery task.
    Flushes on two triggers:
      1. Every ``_FLUSH_INTERVAL_S`` seconds (default: 5)
      2. When the buffer reaches ``_BATCH_SIZE`` events (default: 1000)

    This is the replacement for the previous RQ-based event buffer.
    Events survive process restart because Celery tasks are persisted
    in RabbitMQ before the worker acknowledges them.

    Usage::

        buffer = EventBuffer()
        buffer.start()
        buffer.add({"event_type": "page_view", "user_id": "u1", ...})
        # ... on shutdown:
        buffer.flush()
        buffer.stop()
    """

    def __init__(
        self,
        flush_interval_s: int = _FLUSH_INTERVAL_S,
        batch_size: int = _BATCH_SIZE,
        max_size: int = _QUEUE_MAX_SIZE,
    ) -> None:
        self._flush_interval_s = flush_interval_s
        self._batch_size = batch_size
        self._max_size = max_size
        self._buffer: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
        self._running = False

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._schedule_flush()
        logger.info(
            "EventBuffer started — flush_interval=%ds batch_size=%d max_size=%d",
            self._flush_interval_s,
            self._batch_size,
            self._max_size,
        )

    def stop(self) -> None:
        self._running = False
        if self._timer:
            self._timer.cancel()
            self._timer = None
        logger.info("EventBuffer stopped")

    def add(self, event: dict[str, Any]) -> None:
        with self._lock:
            if len(self._buffer) >= self._max_size:
                logger.warning("EventBuffer at max capacity — dropping event")
                return
            self._buffer.append(event)
            if len(self._buffer) >= self._batch_size:
                self._flush_locked()

    def flush(self) -> None:
        with self._lock:
            self._flush_locked()

    def _schedule_flush(self) -> None:
        if not self._running:
            return
        self._timer = threading.Timer(self._flush_interval_s, self._timer_tick)
        self._timer.daemon = True
        self._timer.start()

    def _timer_tick(self) -> None:
        try:
            self.flush()
        except Exception as exc:
            logger.error("EventBuffer timer flush failed — %s", exc)
        finally:
            self._schedule_flush()

    def _flush_locked(self) -> None:
        if not self._buffer:
            return
        batch = list(self._buffer)
        self._buffer.clear()
        try:
            ingest_batch.delay(batch)
            logger.debug("Flushed %d events to Celery", len(batch))
        except Exception as exc:
            logger.error("Failed to send batch to Celery — %s", exc)
            with self._lock:
                self._buffer.extend(batch)
                if len(self._buffer) > self._max_size:
                    self._buffer = self._buffer[-self._max_size:]

    def __len__(self) -> int:
        with self._lock:
            return len(self._buffer)
