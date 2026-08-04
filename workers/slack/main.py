"""
Entry point for the SYNTARO Slack bot.

Usage:
    python -m workers.slack.main
"""

from __future__ import annotations

import logging
import os

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


def main():
    logger = logging.getLogger(__name__)
    logger.info("Starting SYNTARO Slack bot...")

    required_vars = ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"]
    missing = [v for v in required_vars if not os.getenv(v)]
    if missing:
        logger.warning("Missing required env vars: %s", ", ".join(missing))
        logger.warning("Slack bot will not start without these credentials.")
        return

    from workers.slack.bot import start_slack_bot
    start_slack_bot()


if __name__ == "__main__":
    main()
