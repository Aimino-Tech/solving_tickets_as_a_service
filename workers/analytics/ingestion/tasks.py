import json
import logging
import os
import time

from celery import shared_task

logger = logging.getLogger(__name__)

EVENT_SCHEMA_KEYS = {"event_type", "user_id", "properties", "timestamp", "session_id"}


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    name="workers.analytics.ingestion.ingest_event",
)
def ingest_event(self, event: dict) -> dict:
    missing = EVENT_SCHEMA_KEYS - set(event.keys())
    if missing:
        raise ValueError(f"Event missing required keys: {missing}")

    try:
        writer_result = write_to_clickhouse([event])
        logger.debug("Event ingested — type=%s user_id=%s", event.get("event_type"), event.get("user_id"))
        return {
            "status": "ingested",
            "event_type": event.get("event_type"),
            "rows_written": writer_result,
            "timestamp": time.time(),
        }
    except Exception as exc:
        logger.error("Event ingestion failed — %s", exc)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    name="workers.analytics.ingestion.ingest_batch",
)
def ingest_batch(self, events: list[dict]) -> dict:
    if not events:
        return {"status": "empty", "count": 0}

    valid = [e for e in events if EVENT_SCHEMA_KEYS.issubset(e.keys())]
    if not valid:
        raise ValueError("No valid events in batch")

    try:
        rows_written = write_to_clickhouse(valid)
        logger.info("Batch ingested — total=%d written=%d", len(events), rows_written)
        return {
            "status": "ingested",
            "total": len(events),
            "rows_written": rows_written,
            "timestamp": time.time(),
        }
    except Exception as exc:
        logger.error("Batch ingestion failed — total=%d error=%s", len(events), exc)
        raise self.retry(exc=exc)


def write_to_clickhouse(events: list[dict]) -> int:
    clickhouse_url = os.getenv(
        "CLICKHOUSE_URL",
        os.getenv("ANALYTICS_CLICKHOUSE_URL", "http://localhost:8123"),
    )
    clickhouse_db = os.getenv("CLICKHOUSE_DB", "analytics")
    clickhouse_table = os.getenv("CLICKHOUSE_EVENTS_TABLE", "events")

    import httpx

    rows = []
    for event in events:
        rows.append({
            "event_type": event["event_type"],
            "user_id": event["user_id"],
            "properties": json.dumps(event.get("properties", {})),
            "timestamp": event.get("timestamp", time.time()),
            "session_id": event.get("session_id", ""),
            "ingested_at": time.time(),
        })

    payload = "\n".join(json.dumps(r) for r in rows)
    resp = httpx.post(
        f"{clickhouse_url}/?query=INSERT+INTO+{clickhouse_db}.{clickhouse_table}+FORMAT+JSONEachRow",
        content=payload,
        timeout=30,
    )
    resp.raise_for_status()
    return len(rows)
