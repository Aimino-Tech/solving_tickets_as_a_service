from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

from workers.linear_client import LinearClient

logger = logging.getLogger(__name__)

STAGE_EMOJIS: dict[str, str] = {
    "triage": "\U0001f4cb",
    "research": "\U0001f50d",
    "agent": "\U0001f916",
    "verify": "\U0001f9ea",
    "self_audit": "\U0001f52c",
    "review": "\U0001f441\ufe0f",
    "pr": "\U0001f504",
}

STAGE_ESTIMATES: dict[str, int] = {
    "triage": 30,
    "research": 60,
    "agent": 120,
    "verify": 45,
    "self_audit": 30,
    "review": 60,
    "pr": 15,
}


def post_stage_start(issue_id: str, stage: str) -> None:
    emoji = STAGE_EMOJIS.get(stage, "\u25b6\ufe0f")
    estimate = STAGE_ESTIMATES.get(stage, 30)
    body = f"{emoji} **{stage.title()}**: Processing... (est. {estimate}s)"
    _do_post(issue_id, body)


def post_stage_complete(issue_id: str, stage: str, detail: str = "") -> None:
    emoji = STAGE_EMOJIS.get(stage, "\u2705")
    body = f"{emoji} **{stage.title()}**: {detail or 'Complete'}"
    _do_post(issue_id, body)


def post_stage_failure(issue_id: str, stage: str, reason: str) -> None:
    body = f"\u274c **{stage.title()} failed**: {_sanitize_reason(reason)}"
    _do_post(issue_id, body)


def post_pipeline_start(issue_id: str) -> None:
    body = "\U0001f680 **Pipeline started**: Investigating issue..."
    _do_post(issue_id, body)


def post_pipeline_error(issue_id: str, stage: str, error: str) -> None:
    body = f"\u274c **Failed at {stage}**: {_sanitize_reason(error)}"
    _do_post(issue_id, body)


def _sanitize_reason(reason: str) -> str:
    sanitized = reason.replace("```", "").replace("\\n", " ")
    if len(sanitized) > 200:
        sanitized = sanitized[:200] + "..."
    return sanitized


def _do_post(issue_id: str, body: str) -> None:
    try:
        client = LinearClient()
        client.post_comment(issue_id, body)
        logger.info("Status comment posted on %s: %s", issue_id, body[:80])
    except Exception as exc:
        logger.warning("Failed to post status comment on %s: %s", issue_id, exc)


class StageCoalescer:
    def __init__(self, window_seconds: int = 5) -> None:
        self._window = window_seconds
        self._pending: dict[str, list[dict[str, Any]]] = {}
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None

    def add_event(self, issue_id: str, stage: str, status: str, detail: str = "") -> None:
        key = f"coalesce:{issue_id}"
        with self._lock:
            if key not in self._pending:
                self._pending[key] = []
                self._schedule_flush()
            self._pending[key].append({
                "stage": stage,
                "status": status,
                "detail": detail,
                "timestamp": time.time(),
            })

    def flush(self, issue_id: str | None = None) -> None:
        with self._lock:
            if issue_id:
                keys = [f"coalesce:{issue_id}"]
            else:
                keys = list(self._pending.keys())

            for key in keys:
                events = self._pending.pop(key, [])
                if not events:
                    continue
                issue_id = key.replace("coalesce:", "")
                self._post_coalesced(issue_id, events)

    def _schedule_flush(self) -> None:
        if self._timer and self._timer.is_alive():
            return
        self._timer = threading.Timer(self._window, self._flush_all)
        self._timer.daemon = True
        self._timer.start()

    def _flush_all(self) -> None:
        self.flush()

    def _post_coalesced(self, issue_id: str, events: list[dict[str, Any]]) -> None:
        if len(events) == 1:
            e = events[0]
            if e["status"] == "started":
                post_stage_start(issue_id, e["stage"])
            elif e["status"] == "completed":
                post_stage_complete(issue_id, e["stage"], e.get("detail", ""))
            else:
                post_stage_failure(issue_id, e["stage"], e.get("detail", "Unknown error"))
            return

        lines: list[str] = []
        for e in events:
            emoji_map = {"started": "\U0001f4cb", "completed": "\u2705", "failed": "\u274c"}
            emoji = emoji_map.get(e["status"], "\u25b6\ufe0f")
            stage_title = e["stage"].title()
            detail = e.get("detail", "")
            if e["status"] == "started":
                est = STAGE_ESTIMATES.get(e["stage"], 30)
                lines.append(f"{emoji} **{stage_title}**: Processing... (est. {est}s)")
            elif e["status"] == "completed":
                lines.append(f"{emoji} **{stage_title}**: {detail or 'Complete'}")
            else:
                lines.append(f"{emoji} **{stage_title}**: {_sanitize_reason(detail)}")

        body = "\n".join(lines)
        _do_post(issue_id, body)


coalescer = StageCoalescer()


def is_enabled() -> bool:
    return os.getenv("STAS_STATUS_COMMENTS_ENABLED", "true").lower() in ("true", "1", "yes")
