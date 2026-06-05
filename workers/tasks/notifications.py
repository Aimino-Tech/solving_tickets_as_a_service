import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    name="workers.tasks.notifications.send_notification",
)
def send_notification(self, channel: str, message: str) -> dict:
    logger.info("Sending notification — channel=%s message_len=%d", channel, len(message))
    try:
        # TODO: Integrate with Slack/Discord/email when the channel is configured
        logger.info("Notification sent — channel=%s", channel)
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
    logger.info("Processing webhook — event=%s", event_type)
    try:
        # TODO: Route webhook events to appropriate handlers
        logger.info("Webhook processed — event=%s", event_type)
        return {"event_type": event_type, "status": "processed", "payload": payload}
    except Exception as exc:
        logger.error("Webhook processing failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
