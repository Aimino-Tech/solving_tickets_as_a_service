import json
import logging
import os

import httpx

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    name="workers.tasks.notifications.send_notification",
)
def send_notification(self, channel: str, message: str) -> dict:
    """Send a notification message via Slack webhook or log."""
    logger.info("Sending notification — channel=%s message_len=%d", channel, len(message))
    try:
        webhook_url = os.getenv("SLACK_WEBHOOK_URL", "")

        if webhook_url and channel in ("slack", "all"):
            with httpx.Client() as client:
                resp = client.post(webhook_url, json={"text": message})
                resp.raise_for_status()
            logger.info("Slack notification sent — channel=%s", channel)
            return {"channel": channel, "status": "sent", "message": message}
        else:
            # Log locally if no webhook is configured
            logger.info("Notification logged (no webhook) — channel=%s message=%s", channel, message)
            return {"channel": channel, "status": "sent", "message": message}
    except Exception as exc:
        logger.error("Notification failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    name="workers.tasks.notifications.process_webhook",
)
def process_webhook(self, event_type: str, payload: dict) -> dict:
    """Process an incoming webhook event and route to appropriate handlers."""
    logger.info("Processing webhook — event=%s", event_type)
    try:
        actions = []
        handled = False

        # Route known events
        if event_type == "issues.labeled":
            label = payload.get("label", {}).get("name", "")
            if label == "stas:fix":
                actions.append(f"label:{label}")
                handled = True
                logger.info("Webhook routed to stas:fix pipeline")
        elif event_type == "issues.opened":
            actions.append("issue_opened")
            handled = True
        elif event_type == "pull_request.opened":
            actions.append("pr_opened")
            handled = True
        else:
            actions.append(f"unhandled_event:{event_type}")
            logger.info("Unhandled webhook event type — %s", event_type)

        return {
            "event_type": event_type,
            "status": "processed",
            "handled": handled,
            "actions": actions,
            "payload": payload,
        }
    except Exception as exc:
        logger.error("Webhook processing failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
