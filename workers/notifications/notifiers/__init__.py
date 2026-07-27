"""Notifier implementations for Slack, Teams, Email, and Discord."""

from workers.notifications.notifiers.discord import notify_discord

__all__ = [
    "notify_discord",
]
