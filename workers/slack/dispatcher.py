"""
Slack dispatcher — routes pipeline events to Slack channels.

Subscribes to pipeline events and sends formatted progress updates
back to the originating Slack channel/thread.

Connects to the PipelineEngine event system to listen for:
  - pipeline.started
  - stage.started
  - stage.completed
  - pipeline.completed
  - pipeline.failed
  - pipeline.cancelled
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from workers.slack.publisher import (
    post_message,
    send_pipeline_completed,
    send_pipeline_progress,
)

logger = logging.getLogger(__name__)


class SlackEventDispatcher:
    """Dispatches pipeline events to configured Slack channels.

    Maintains a mapping of ``pipeline_id -> Slack channel/thread`` so
    progress updates can be sent back to the right conversation.
    """

    def __init__(self) -> None:
        self._channels: dict[str, dict[str, str]] = {}
        self._redis = None

    def register_channel(
        self,
        pipeline_id: str,
        channel: str,
        thread_ts: str | None = None,
    ) -> None:
        self._channels[pipeline_id] = {
            "channel": channel,
            "thread_ts": thread_ts or "",
        }
        logger.info(
            "Registered Slack channel for pipeline %s: #%s (thread=%s)",
            pipeline_id, channel, thread_ts or "main",
        )

    def on_pipeline_event(self, event_type: str, payload: dict[str, Any]) -> None:
        pipeline_id = payload.get("pipeline_id", "")
        channel_info = self._channels.get(pipeline_id)
        if not channel_info:
            return
        channel = channel_info["channel"]
        thread_ts = channel_info.get("thread_ts") or None

        if event_type == "pipeline.started":
            send_pipeline_progress(
                channel, thread_ts or "",
                pipeline_id, "started", "Starting pipeline", 0.0,
            )
        elif event_type == "stage.started":
            stage = payload.get("stage", "unknown")
            send_pipeline_progress(
                channel, thread_ts or "",
                pipeline_id, "in_progress", stage, 0.3,
            )
        elif event_type == "stage.completed":
            stage = payload.get("stage", "unknown")
            send_pipeline_progress(
                channel, thread_ts or "",
                pipeline_id, "in_progress", stage, 0.6,
            )
        elif event_type == "pipeline.completed":
            pr_url = payload.get("pr_url", "")
            send_pipeline_completed(channel, thread_ts or "", pipeline_id, pr_url, "completed")
        elif event_type == "pipeline.failed":
            send_pipeline_completed(channel, thread_ts or "", pipeline_id, status="failed")
        elif event_type == "pipeline.cancelled":
            send_pipeline_completed(channel, thread_ts or "", pipeline_id, status="cancelled")


_dispatcher: SlackEventDispatcher | None = None


def get_dispatcher() -> SlackEventDispatcher:
    global _dispatcher
    if _dispatcher is None:
        _dispatcher = SlackEventDispatcher()
    return _dispatcher


def notify_slack_progress(
    run_id: str,
    status: str,
    stage: str = "",
    progress: float = 0.0,
    pr_url: str | None = None,
    channel: str = "",
    thread_ts: str = "",
) -> None:
    dispatcher = get_dispatcher()
    if channel:
        dispatcher.register_channel(run_id, channel, thread_ts)
    dispatcher.on_pipeline_event("pipeline.started" if status == "started"
                                  else "pipeline.completed" if status in ("completed", "failed", "cancelled")
                                  else "stage.completed",
                                  {"pipeline_id": run_id, "stage": stage, "pr_url": pr_url})
