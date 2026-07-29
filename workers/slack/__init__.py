"""
Slack integration — bidirectional progress updates for STAS fix requests.

Provides:
  - Slack bot with Socket Mode (Bolt SDK)
  - /stas fix slash command handler
  - Threaded progress updates back to Slack channels
  - Button interactions (acknowledge, cancel, retry)

Usage:
    from workers.slack.bot import get_slack_app
    app = get_slack_app()
    app.start()
"""

from workers.slack.bot import get_slack_app, start_slack_bot

__all__ = ["get_slack_app", "start_slack_bot"]
