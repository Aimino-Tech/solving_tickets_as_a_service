"""
Self-Healing Infrastructure — Celery worker extensions.

Provides:
  - Worker heartbeat monitoring via Celery events
  - Automatic retry with exponential backoff
  - Soft and hard timeout enforcement

Usage:
    from workers.self_healing.heartbeats import setup_heartbeat_monitor
    from workers.self_healing.retry import configure_retry_policy
    from workers.self_healing.timeouts import configure_timeout_policy

    setup_heartbeat_monitor(app)
    configure_retry_policy(app)
    configure_timeout_policy(app)
"""

import logging

logger = logging.getLogger(__name__)

__all__ = [
    "setup_heartbeat_monitor",
    "configure_retry_policy",
    "configure_timeout_policy",
]
