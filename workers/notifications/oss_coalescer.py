"""
OSS status-event coalescer.

Buffers completed pipeline-stage status events for OSS (self-hosted)
deployments and flushes them as a batch after a configurable idle window.
This prevents a burst of rapid stage transitions on a single GitHub issue
from flooding the issue with individual comments.

Thread-safe via ``threading.Lock``.  Process-local — each Celery worker
process maintains its own coalescer instance, which is fine because the
pipeline stages within a single chain execute sequentially in the same
worker process.

Usage::

    from workers.notifications.oss_coalescer import OssStageCoalescer

    coalescer = OssStageCoalescer(flush_callback=my_handler)
    coalescer.add_event("owner/repo", "42", "triage", "completed", "Triage passed")

    # After 3 seconds of inactivity, ``my_handler`` is called with the
    # buffered events.  You can also call ``coalescer.flush()`` manually.

Differs from ``StageCoalescer`` (``workers.notifications.coalescer``) in
two ways:

    1. Tracks a ``repo`` field alongside ``issue_id`` so events carry
       GitHub repository context needed for OSS comment posting.
    2. Uses a shorter default window and a configurable maximum batch
       size to keep GitHub API calls within rate limits.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_DEFAULT_WINDOW_SECONDS = float(
    os.getenv("STAS_OSS_STATUS_COALESCE_SECONDS", "3"),
)
_DEFAULT_MAX_BATCH = int(
    os.getenv("STAS_OSS_STATUS_MAX_BATCH", "10"),
)

OSS_EVENT_KEYS = frozenset({"repo", "issue_id", "stage", "status", "message"})


def _validate_oss_event(event: dict[str, Any]) -> None:
    """Ensure required keys are present in an OSS stage event."""
    missing = OSS_EVENT_KEYS - set(event)
    if missing:
        raise ValueError(
            f"OSS stage event missing required keys: {', '.join(sorted(missing))}",
        )


# ---------------------------------------------------------------------------
# OssStageCoalescer
# ---------------------------------------------------------------------------


class OssStageCoalescer:
    """Buffer OSS completed-stage events and flush them as a batch.

    Parameters
    ----------
    window_seconds:
        Idle time (in seconds) to wait before flushing.  The timer resets
        every time a new event is added.  Default 3.0.
    max_batch:
        Maximum number of events to accumulate before forcing a flush.
        Default 10.
    flush_callback:
        Optional callable invoked with the list of flushed events when the
        window expires or the batch is full.  Called from the timer thread.
    """

    def __init__(
        self,
        window_seconds: float = _DEFAULT_WINDOW_SECONDS,
        max_batch: int = _DEFAULT_MAX_BATCH,
        flush_callback: Callable[[list[dict[str, Any]]], None] | None = None,
    ) -> None:
        self._window = window_seconds
        self._max_batch = max_batch
        self._events: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._flush_callback = flush_callback

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_event(
        self,
        repo: str,
        issue_id: str,
        stage: str,
        status: str,
        message: str,
    ) -> None:
        """Buffer an OSS completed-stage event.

        Resets the flush timer.  If the buffer reaches *max_batch* the
        flush happens immediately.
        """
        event: dict[str, Any] = {
            "repo": repo,
            "issue_id": issue_id,
            "stage": stage,
            "status": status,
            "message": message,
            "timestamp": time.time(),
        }
        _validate_oss_event(event)

        with self._lock:
            self._events.append(event)
            if len(self._events) >= self._max_batch:
                self._cancel_timer()
                # Flush inline since we are already in the calling thread
                events = list(self._events)
                self._events.clear()
                self._dispatch_flush(events)
            else:
                self._reset_timer()

        logger.debug(
            "OssStageCoalescer buffered event — stage=%s repo=%s issue=%s  (buffered=%d)",
            stage, repo, issue_id, len(self._events),
        )

    def flush(self) -> list[dict[str, Any]]:
        """Immediately flush all buffered events and return them.

        The *flush_callback* is invoked from the current thread.
        """
        with self._lock:
            events = list(self._events)
            self._events.clear()
            self._cancel_timer()

        if events:
            logger.info("OssStageCoalescer flushing %d events", len(events))
            self._dispatch_flush(events)

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
        self._cancel_timer()
        self._timer = threading.Timer(self._window, self.flush)
        self._timer.daemon = True
        self._timer.start()

    def _cancel_timer(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def _dispatch_flush(self, events: list[dict[str, Any]]) -> None:
        """Invoke the flush callback, if configured."""
        if self._flush_callback is not None:
            try:
                self._flush_callback(events)
            except Exception:
                logger.exception("OssStageCoalescer flush callback raised")
