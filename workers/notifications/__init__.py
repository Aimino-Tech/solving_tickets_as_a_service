"""
Webhook Notification System — Slack, Teams, Email integration.

Provides a ``dispatch_to_webhooks`` function that routes events to configured
notifiers, plus individual notifier modules under ``notifiers/``.
"""

from workers.notifications.webhooks import dispatch_to_webhooks

__all__ = ["dispatch_to_webhooks"]
