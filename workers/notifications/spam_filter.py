"""
Comment spam filter -- deduplicates and coalesces rapid comment updates.
"""
from __future__ import annotations
import logging
import threading
import time
from typing import Any, Callable
logger = logging.getLogger(__name__)

class FilterResult:
    def __init__(self, action: str, reason: str = "", pending_count: int = 0) -> None:
        self.action = action
        self.reason = reason
        self.pending_count = pending_count
    def __repr__(self) -> str:
        return f"FilterResult(action={self.action!r}, reason={self.reason!r})"

class CommentSpamFilter:
    def __init__(self, coalesce_window_seconds: float = 10.0, dedup_window_seconds: float = 30.0, flush_callback: Callable[[list[dict[str, Any]]], None] | None = None) -> None:
        self._coalesce_window = coalesce_window_seconds
        self._dedup_window = dedup_window_seconds
        self._flush_callback = flush_callback
        self._events: list[dict[str, Any]] = []
        self._last_seen: dict[str, tuple[str, str, str, float]] = {}
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None

    def filter(self, issue_id: str, stage: str, status: str, message: str) -> FilterResult:
        now = time.time()
        with self._lock:
            last = self._last_seen.get(issue_id)
            if last is not None:
                last_stage, last_status, last_message, last_ts = last
                if last_stage == stage and last_status == status and last_message == message and (now - last_ts) < self._dedup_window:
                    return FilterResult(action="skip", reason=f"Duplicate (stage={stage}, status={status}) within dedup window", pending_count=len(self._events))
            self._last_seen[issue_id] = (stage, status, message, now)
            has_pending = any(e["issue_id"] == issue_id for e in self._events)
            if has_pending:
                self._events.append({"issue_id": issue_id, "stage": stage, "status": status, "message": message, "timestamp": now})
                self._reset_timer()
                return FilterResult(action="coalesce", reason="Coalesced with pending events", pending_count=len(self._events))
            if self._events:
                last_ts = self._events[-1]["timestamp"]
                if (now - last_ts) < self._coalesce_window:
                    self._events.append({"issue_id": issue_id, "stage": stage, "status": status, "message": message, "timestamp": now})
                    self._reset_timer()
                    return FilterResult(action="coalesce", reason="Within coalesce window", pending_count=len(self._events))
        return FilterResult(action="accept", reason="Passed spam filter")

    def flush(self) -> list[dict[str, Any]]:
        with self._lock:
            events = list(self._events)
            self._events.clear()
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
        if events and self._flush_callback is not None:
            try:
                self._flush_callback(events)
            except Exception:
                logger.exception("CommentSpamFilter flush callback raised")
        return events

    @property
    def pending_count(self) -> int:
        with self._lock:
            return len(self._events)
    def reset_issue(self, issue_id: str) -> None:
        with self._lock:
            self._last_seen.pop(issue_id, None)
    def _reset_timer(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
        self._timer = threading.Timer(self._coalesce_window, self.flush)
        self._timer.daemon = True
        self._timer.start()
