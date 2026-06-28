import json
import logging
import os
import time

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    name="workers.analytics.rollups.rollup_hourly",
)
def rollup_hourly(self) -> dict:
    clickhouse_url = os.getenv("CLICKHOUSE_URL", os.getenv("ANALYTICS_CLICKHOUSE_URL", "http://localhost:8123"))
    clickhouse_db = os.getenv("CLICKHOUSE_DB", "analytics")

    import httpx

    query = f"""
    INSERT INTO {clickhouse_db}.events_hourly
    SELECT
        toStartOfHour(timestamp) AS hour,
        event_type,
        user_id,
        count() AS event_count,
        countDistinct(session_id) AS session_count
    FROM {clickhouse_db}.events
    WHERE timestamp >= now() - INTERVAL 2 HOUR
    GROUP BY hour, event_type, user_id
    ORDER BY hour DESC
    """

    try:
        resp = httpx.post(f"{clickhouse_url}/?query={query}", timeout=60)
        resp.raise_for_status()
        logger.info("Hourly rollup complete")
        return {"status": "completed", "type": "hourly", "timestamp": time.time()}
    except Exception as exc:
        logger.error("Hourly rollup failed — %s", exc)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=120,
    autoretry_for=(Exception,),
    name="workers.analytics.rollups.rollup_daily",
)
def rollup_daily(self) -> dict:
    clickhouse_url = os.getenv("CLICKHOUSE_URL", os.getenv("ANALYTICS_CLICKHOUSE_URL", "http://localhost:8123"))
    clickhouse_db = os.getenv("CLICKHOUSE_DB", "analytics")

    import httpx

    query = f"""
    INSERT INTO {clickhouse_db}.events_daily
    SELECT
        toDate(timestamp) AS day,
        event_type,
        user_id,
        count() AS event_count,
        countDistinct(session_id) AS session_count
    FROM {clickhouse_db}.events
    WHERE timestamp >= now() - INTERVAL 2 DAY
    GROUP BY day, event_type, user_id
    ORDER BY day DESC
    """

    try:
        resp = httpx.post(f"{clickhouse_url}/?query={query}", timeout=120)
        resp.raise_for_status()
        logger.info("Daily rollup complete")
        return {"status": "completed", "type": "daily", "timestamp": time.time()}
    except Exception as exc:
        logger.error("Daily rollup failed — %s", exc)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=300,
    autoretry_for=(Exception,),
    name="workers.analytics.rollups.rollup_monthly",
)
def rollup_monthly(self) -> dict:
    clickhouse_url = os.getenv("CLICKHOUSE_URL", os.getenv("ANALYTICS_CLICKHOUSE_URL", "http://localhost:8123"))
    clickhouse_db = os.getenv("CLICKHOUSE_DB", "analytics")

    import httpx

    query = f"""
    INSERT INTO {clickhouse_db}.events_monthly
    SELECT
        toStartOfMonth(timestamp) AS month,
        event_type,
        user_id,
        count() AS event_count,
        countDistinct(session_id) AS session_count
    FROM {clickhouse_db}.events
    WHERE timestamp >= now() - INTERVAL 2 MONTH
    GROUP BY month, event_type, user_id
    ORDER BY month DESC
    """

    try:
        resp = httpx.post(f"{clickhouse_url}/?query={query}", timeout=300)
        resp.raise_for_status()
        logger.info("Monthly rollup complete")
        return {"status": "completed", "type": "monthly", "timestamp": time.time()}
    except Exception as exc:
        logger.error("Monthly rollup failed — %s", exc)
        raise self.retry(exc=exc)
