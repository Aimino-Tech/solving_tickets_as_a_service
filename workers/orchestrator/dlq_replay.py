"""
DLQ Auto-Replay - reads messages from the ``syntaro.dlx.retry`` exchange and
re-routes them back to their original queue with an incremented ``retry_count``.

Design
------
    1. The DLQ retry consumer listens on ``syntaro.dlx.retry``.
    2. Each consumed message carries its original exchange, routing key, and
       body in the ``death`` header (set by RabbitMQ when dead-lettering).
    3. We increment ``retry_count`` (stored in the message headers) and publish
       back to the original exchange with the original routing key.
    4. After ``MAX_RETRIES``, the message is forwarded to ``syntaro.dlx.failed``
       for permanent dead-lettering / manual inspection.

Configuration (env vars)
------------------------
    ``DLQ_MAX_RETRIES`` (default: 3) - max auto-replay attempts per message.
    ``DLQ_RETRY_BACKOFF_BASE_S`` (default: 10) - base delay in seconds for retry
        backoff (actual delay = base * retry_count).
    ``DLQ_REPLAY_BATCH_SIZE`` (default: 50) - max messages to replay per cycle.

Redis Keys
----------
    ``syntaro:dlq:retry_count:{message_id}`` - integer, current retry count for a msg.
    ``syntaro:dlq:failed_ids`` - SET of permanently-failed message IDs (for audit).
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

from kombu import Connection, Exchange, Queue, Message
from kombu.mixins import ConsumerMixin

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MAX_RETRIES = int(os.getenv("DLQ_MAX_RETRIES", "3"))
_RETRY_BACKOFF_BASE_S = int(os.getenv("DLQ_RETRY_BACKOFF_BASE_S", "10"))
_REPLAY_BATCH_SIZE = int(os.getenv("DLQ_REPLAY_BATCH_SIZE", "50"))
_REDIS_RETRY_PREFIX = "syntaro:dlq:retry_count:"
_REDIS_FAILED_KEY = "syntaro:dlq:failed_ids"

# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod

        url = os.getenv(
            "REDIS_URL",
            os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
        )
        _REDIS_CLIENT = _redis_mod.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("DLQ replay - Redis unavailable: %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Retry tracking
# ---------------------------------------------------------------------------


def _message_id(headers: dict[str, Any], body: Any) -> str:
    """Derive a stable message ID from headers and body."""
    msg_id = headers.get("id", "")
    if not msg_id:
        body_str = json.dumps(body, sort_keys=True) if isinstance(body, (dict, list)) else str(body)
        msg_id = str(hash(body_str))
    return msg_id


def get_retry_count(headers: dict[str, Any], body: Any) -> int:
    """Get the current retry count for a message.

    Checks the message headers first (``retry_count``), then falls back to Redis.
    """
    retry = headers.get("retry_count", 0)
    if isinstance(retry, (int, float)) and retry > 0:
        return int(retry)

    client = _get_redis()
    if client:
        mid = _message_id(headers, body)
        try:
            val = client.get(_REDIS_RETRY_PREFIX + mid)
            if val:
                return int(val)
        except (ValueError, TypeError, Exception):
            pass

    return 0


def set_retry_count(headers: dict[str, Any], body: Any, count: int) -> None:
    """Persist the retry count for a message (in both headers and Redis)."""
    headers["retry_count"] = count

    client = _get_redis()
    if client:
        mid = _message_id(headers, body)
        try:
            client.set(_REDIS_RETRY_PREFIX + mid, str(count), ex=86400)
        except Exception as exc:
            logger.debug("Failed to store retry count for %s - %s", mid, exc)


def mark_permanently_failed(headers: dict[str, Any], body: Any) -> None:
    """Record a message ID as permanently failed (added to audit set)."""
    client = _get_redis()
    if client:
        mid = _message_id(headers, body)
        try:
            client.sadd(_REDIS_FAILED_KEY, mid)
            client.expire(_REDIS_FAILED_KEY, 604800)
        except Exception as exc:
            logger.debug("Failed to mark msg %s as permanently failed - %s", mid, exc)


# ---------------------------------------------------------------------------
# Replay logic
# ---------------------------------------------------------------------------


def compute_delay(retry_count: int) -> int:
    """Compute the backoff delay for a retry attempt.

    Uses exponential backoff: ``base * 2^(retry_count - 1)``.
    """
    return _RETRY_BACKOFF_BASE_S * (2 ** (retry_count - 1))


def should_replay(headers: dict[str, Any], body: Any) -> tuple[bool, str]:
    """Determine whether a message should be replayed or permanently dead-lettered.

    Returns:
        ``(True, "")`` if the message should be replayed.
        ``(False, reason)`` if it should be permanently failed.
    """
    retry_count = get_retry_count(headers, body)
    if retry_count >= _MAX_RETRIES:
        return False, "retry_count=%d >= max_retries=%d" % (retry_count, _MAX_RETRIES)
    return True, ""


def replay_message(body: Any, original_headers: dict[str, Any], channel: Any) -> bool:
    """Replay a message back to its original exchange/routing key.

    Args:
        body: The decoded message body.
        original_headers: The message headers (including RabbitMQ ``death`` headers).
        channel: An AMQP channel for republishing.

    Returns:
        ``True`` if the message was successfully replayed, ``False`` if permanently failed.
    """
    death_headers = original_headers.get("death", [])
    original_exchange = ""
    original_routing_key = ""

    # Extract original exchange/routing key from death headers (set by RabbitMQ)
    if death_headers and isinstance(death_headers, list):
        last_death = death_headers[-1] if death_headers else {}
        original_exchange = last_death.get("exchange", "")
        original_routing_key = last_death.get("routing_key", "")

    if not original_exchange:
        x_death = original_headers.get("x-death", [{}])
        if isinstance(x_death, list) and x_death:
            last = x_death[-1]
            original_exchange = last.get("exchange", "")
            rks = last.get("routing-keys", [])
            original_routing_key = rks[0] if rks else ""

    if not original_exchange:
        logger.error("Cannot replay message - no original exchange in death headers")
        return False

    retry_count = get_retry_count(original_headers, body)
    should, reason = should_replay(original_headers, body)

    if not should:
        logger.warning(
            json.dumps({
                "event": "dlq.replay.max_retries_exceeded",
                "exchange": original_exchange,
                "routing_key": original_routing_key,
                "retry_count": retry_count,
                "reason": reason,
            })
        )
        _publish_failed(body, original_headers, original_exchange, original_routing_key, channel, reason)
        mark_permanently_failed(original_headers, body)
        return False

    # Increment retry count
    new_retry_count = retry_count + 1
    set_retry_count(original_headers, body, new_retry_count)

    # Build new headers with retry info
    new_headers = dict(original_headers.get("application_headers", {}))
    new_headers["retry_count"] = new_retry_count
    new_headers["retried_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    new_headers["original_exchange"] = original_exchange
    new_headers["original_routing_key"] = original_routing_key

    delay = compute_delay(new_retry_count)

    try:
        from kombu import Exchange as KExchange

        exchange = KExchange(original_exchange, type="topic", durable=True)
        exchange(channel).declare()

        properties = {
            "headers": new_headers,
            "delivery_mode": 2,
            "priority": original_headers.get("priority", 0),
        }

        body_bytes = json.dumps(body).encode("utf-8") if isinstance(body, (dict, list)) else (
            body.encode("utf-8") if isinstance(body, str) else body
        )

        published = channel.basic_publish(
            exchange=original_exchange,
            routing_key=original_routing_key or "",
            body=body_bytes,
            properties=properties,
            mandatory=False,
        )

        if published:
            logger.info(
                json.dumps({
                    "event": "dlq.replay.success",
                    "exchange": original_exchange,
                    "routing_key": original_routing_key,
                    "retry_count": new_retry_count,
                    "delay_s": delay,
                })
            )
        else:
            logger.error(
                json.dumps({
                    "event": "dlq.replay.publish_failed",
                    "exchange": original_exchange,
                    "routing_key": original_routing_key,
                })
            )

        return published

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "dlq.replay.error",
                "exchange": original_exchange,
                "routing_key": original_routing_key,
                "error": str(exc),
            })
        )
        return False


def _publish_failed(
    body: Any,
    original_headers: dict[str, Any],
    exchange: str,
    routing_key: str,
    channel: Any,
    reason: str,
) -> None:
    """Publish a permanently-failed message to the ``syntaro.dlx.failed`` queue."""
    try:
        failed_headers = {
            "original_exchange": exchange,
            "original_routing_key": routing_key,
            "fail_reason": reason,
            "failed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "retry_count": get_retry_count(original_headers, body),
        }

        body_bytes = json.dumps(body).encode("utf-8") if isinstance(body, (dict, list)) else (
            body.encode("utf-8") if isinstance(body, str) else body
        )

        channel.basic_publish(
            exchange="syntaro.dlx",
            routing_key="dlq.failed",
            body=body_bytes,
            properties={
                "headers": failed_headers,
                "delivery_mode": 2,
            },
        )
        logger.warning(
            json.dumps({
                "event": "dlq.replay.permanent_failure",
                "exchange": exchange,
                "routing_key": routing_key,
                "reason": reason,
            })
        )
    except Exception as exc:
        logger.error("Failed to publish permanent failure message - %s", exc)


# ---------------------------------------------------------------------------
# Consumer
# ---------------------------------------------------------------------------


class DLQRetryConsumer(ConsumerMixin):
    """Kombu consumer that reads from ``syntaro.dlx.retry`` and replays messages.

    Usage::

        from workers.orchestrator.dlq_replay import DLQRetryConsumer
        consumer = DLQRetryConsumer(connection)
        consumer.run()
    """

    def __init__(self, connection: Connection) -> None:
        self.connection = connection
        self.queue = Queue(
            "syntaro.dlx.retry",
            Exchange("syntaro.dlx", type="direct", durable=True),
            routing_key="dlq.retry",
            durable=True,
        )

    def get_consumers(self, Consumer: Any, channel: Any) -> list[Any]:
        return [
            Consumer(
                [self.queue],
                callbacks=[self.on_message],
                accept=["json"],
                prefetch_count=_REPLAY_BATCH_SIZE,
            )
        ]

    def on_message(self, body: Any, message: Message) -> None:
        """Process a single DLQ retry message."""
        try:
            headers = message.headers or {}
            logger.debug(
                "DLQ retry message received - headers=%s body_preview=%s",
                {k: v for k, v in headers.items() if k != "auth"},
                str(body)[:200],
            )

            success = replay_message(body, headers, self.connection.channel())
            if success:
                message.ack()
            else:
                message.ack()
                logger.warning(
                    "Message permanently dead-lettered - body_preview=%s",
                    str(body)[:200],
                )
        except Exception as exc:
            logger.error("Error processing DLQ retry message - %s", exc)
            message.reject(requeue=True)


def start_dlq_retry_consumer(broker_url: str) -> DLQRetryConsumer:
    """Create and return a DLQRetryConsumer instance.

    Call ``consumer.run()`` to start consuming. Runs in the current thread.

    For background execution, wrap in a thread::

        import threading
        t = threading.Thread(
            target=lambda: start_dlq_retry_consumer(broker_url).run(),
            daemon=True,
        )
        t.start()
    """
    from kombu import Connection

    conn = Connection(broker_url)
    consumer = DLQRetryConsumer(conn)
    return consumer
