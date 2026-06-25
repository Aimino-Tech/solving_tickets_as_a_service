"""
Webhook Notification System — Slack, Teams, Email integration.

Provides a ``dispatch_to_webhooks`` function that routes events to configured
notifiers, plus individual notifier modules under ``notifiers/``.

Also provides real-time Linear status comments for pipeline stage transitions
via ``status_comments.post_stage_comment`` (coalesced through ``coalescer``).
"""

from workers.notifications.webhooks import dispatch_to_webhooks

from workers.notifications import status_comments  # noqa: F401
from workers.notifications import coalescer  # noqa: F401

__all__ = [
    "dispatch_to_webhooks",
    "status_comments",
    "coalescer",
]
