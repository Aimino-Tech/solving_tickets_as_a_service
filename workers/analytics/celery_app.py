import os
import logging

from celery import Celery

logger = logging.getLogger(__name__)

app = Celery("analytics")

app.conf.update(
    broker_url=os.getenv("ANALYTICS_BROKER_URL", os.getenv("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672/analytics")),
    result_backend=os.getenv("ANALYTICS_RESULT_BACKEND", os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")),
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_soft_time_limit=60,
    task_hard_time_limit=120,
    worker_prefetch_multiplier=1,
    worker_enable_remote_control=False,
    broker_connection_retry_on_startup=True,
)

app.autodiscover_tasks(["workers.analytics.ingestion", "workers.analytics.rollups"])


@app.task(name="workers.analytics.celery_app.ping")
def ping():
    return {"status": "pong"}
