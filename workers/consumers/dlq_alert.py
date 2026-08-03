"""
Dead Letter Queue Consumer — Alerting & Monitoring

Listens to DLQ queues and triggers alerts when messages are dead-lettered.
Sends Slack notifications and logs warnings for operational visibility.

Usage:
    celery -A workers.celery_app worker -Q syntaro.issues.fix.dlq -c 1 -n dlq_alert@%%h
"""

import json
import logging
import os

import httpx

from celery import Celery

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
DLQ_ALERT_SLACK_CHANNEL = os.getenv("DLQ_ALERT_SLACK_CHANNEL", "#syntaro-alerts")
DLQ_ALERT_THROTTLE_SECONDS = int(os.getenv("DLQ_ALERT_THROTTLE_SECONDS", "300"))

# ── Throttle tracking ──────────────────────────────────────────────────────

_last_alert_time: float = 0

# ── Alerting ────────────────────────────────────────────────────────────────


def send_slack_alert(message: str, fields: dict | None = None) -> None:
    """Send an alert to the configured Slack channel."""
    global _last_alert_time
    import time

    now = time.time()
    if now - _last_alert_time < DLQ_ALERT_THROTTLE_SECONDS:
        logger.debug("Alert throttled — %0.1fs since last alert", now - _last_alert_time)
        return

    _last_alert_time = now

    if not SLACK_WEBHOOK_URL:
        logger.warning("No SLACK_WEBHOOK_URL configured — cannot send DLQ alert")
        return

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "⚠️  DLQ Alert — Message Dead-Lettered"},
        },
        {"type": "section", "text": {"type": "mrkdwn", "text": message}},
    ]

    if fields:
        fields_md = "\n".join(f"*{k}:* {v}" for k, v in fields.items())
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": fields_md}})

    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"SYNTARO DLQ Consumer | <{os.getenv('FLOWER_URL', 'http://localhost:5555')}|Flower Dashboard>",
                }
            ],
        }
    )

    try:
        resp = httpx.post(
            SLACK_WEBHOOK_URL,
            json={"channel": DLQ_ALERT_SLACK_CHANNEL, "blocks": blocks},
            timeout=10,
        )
        resp.raise_for_status()
        logger.info("DLQ alert sent to Slack — channel=%s", DLQ_ALERT_SLACK_CHANNEL)
    except Exception as exc:
        logger.error("Failed to send DLQ alert — %s", exc)


def log_dlq_alert(queue: str, message_body: str, headers: dict | None = None) -> None:
    """Log a DLQ alert and send notification."""
    body_preview = message_body[:500] if message_body else "(empty)"

    logger.error(
        {
            "event": "dlq_message",
            "queue": queue,
            "body_preview": body_preview,
            "headers": headers or {},
        },
        "DLQ message detected — queue=%s body_preview=%s",
        queue,
        body_preview,
    )

    send_slack_alert(
        f"Message dead-lettered on *`{queue}`*",
        fields={
            "Queue": f"`{queue}`",
            "Body Preview": f"```{body_preview[:200]}```" if body_preview else "_(empty)_",
            "Action": "Investigate and replay via `/api/v1/admin/dlq/replay`",
        },
    )


# ── Consumer Setup ──────────────────────────────────────────────────────────

DLQ_QUEUES = [
    "syntaro.issues.fix.dlq",
    "syntaro.agents.triage.dlq",
    "syntaro.agents.opencode.dlq",
    "syntaro.agents.sandbox.dlq",
    "syntaro.agents.verification.dlq",
    "syntaro.events.notifications.dlq",
    "syntaro.events.audit.dlq",
]


def start_dlq_consumer(app: Celery) -> None:
    """
    Start consuming from DLQ queues for alerting.
    Call this during Celery worker initialization.
    """
    logger.info("Starting DLQ consumer — monitoring %d DLQ queues", len(DLQ_QUEUES))

    for queue_name in DLQ_QUEUES:
        try:
            app.conf.task_queues.append(
                {
                    "name": queue_name,
                    "exchange": "syntaro.dlx",
                    "routing_key": queue_name.replace(".dlq", ""),
                }
            )
            logger.debug("DLQ consumer registered — queue=%s", queue_name)
        except Exception as exc:
            logger.warning("Failed to register DLQ consumer — queue=%s err=%s", queue_name, exc)

    logger.info("DLQ consumer initialized — %d queues monitored", len(DLQ_QUEUES))
