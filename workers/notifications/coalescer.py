"""
Stage transition coalescer.

Batches completed pipeline-stage status transitions within a configurable
time window (default 5 seconds) into a single Linear comment. This prevents
a burst of rapid stage transitions from flooding the issue with individual
comments.

Thread-safe via ``threading.Lock``.  Process-local — each Celery worker
process maintains its own coalescer instance, which is fine because the
pipeline stages within a single chain execute sequentially in the same
worker process.

Usage::

    from workers.notifications.coalescer import StageCoalescer

    coalescer = StageCoalescer(flush_callback=my_handler)
    coalescer.add_event("issue-42", "triage", "completed", "Triage passed")

    # After 5 seconds of inactivity, ``my_handler`` is called with the
    # buffered events.  You can also call ``coalescer.flush()`` manually.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Coalesced event type
# ---------------------------------------------------------------------------

STAGE_EVENT_KEYS = frozenset({"issue_id", "stage", "status", "message"})


def _validate_event(event: dict[str, Any]) -> None:
    """Ensure required keys are present in a stage event."""
    missing = STAGE_EVENT_KEYS - set(event)
    if missing:
        raise ValueError(
            f"Stage event missing required keys: {', '.join(sorted(missing))}",
        )


# ---------------------------------------------------------------------------
# StageCoalescer
# ---------------------------------------------------------------------------


class StageCoalescer:
    """Buffer completed-stage events and flush them as a batch after a
    configurable idle window.

    Parameters
    ----------
    window_seconds:
        Idle time (in seconds) to wait before flushing.  The timer resets
        every time a new event is added. Default 5.0.
    flush_callback:
        Optional callable invoked with the list of flushed events when the
        window expires.  Called from the timer thread.
    """

    def __init__(
        self,
        window_seconds: float = 5.0,
        flush_callback: Callable[[list[dict[str, Any]]], None] | None = None,
    ) -> None:
        self._window = window_seconds
        self._events: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._flush_callback = flush_callback

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_event(self, issue_id: str, stage: str, status: str, message: str) -> None:
        """Buffer a completed-stage event.

        Resets the flush timer.  When the timer fires, all buffered events
        are passed to *flush_callback* (if configured).
        """
        event = {
            "issue_id": issue_id,
            "stage": stage,
            "status": status,
            "message": message,
            "timestamp": time.time(),
        }
        _validate_event(event)

        with self._lock:
            self._events.append(event)
            self._reset_timer()

        logger.debug(
            "StageCoalescer buffered event — stage=%s issue=%s  (buffered=%d)",
            stage, issue_id, len(self._events),
        )

    def flush(self) -> list[dict[str, Any]]:
        """Immediately flush all buffered events and return them.

        The *flush_callback* is invoked from the current thread.
        """
        with self._lock:
            events = list(self._events)
            self._events.clear()
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

        if events:
            logger.info("StageCoalescer flushing %d events", len(events))
            if self._flush_callback is not None:
                try:
                    self._flush_callback(events)
                except Exception:
                    logger.exception(
                        "StageCoalescer flush callback raised",
                    )

        return events

    @property
    def pending_count(self) -> int:
        """Number of events currently buffered."""
        with self._lock:
            return len(self._events)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _reset_timer(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
        self._timer = threading.Timer(self._window, self.flush)
        self._timer.daemon = True
        self._timer.start()
