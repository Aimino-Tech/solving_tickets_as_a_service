import os
import logging

from celery import Celery

logger = logging.getLogger(__name__)

app = Celery("stas")

app.config_from_object("workers.celeryconfig")

broker_url = os.getenv("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672/stas")
result_backend = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")
concurrency = int(os.getenv("WORKER_CONCURRENCY", "4"))

app.conf.update(
    broker_url=broker_url,
    result_backend=result_backend,
    worker_concurrency=concurrency,
)

app.autodiscover_tasks(["workers.tasks", "workers.consumers"])

# ── Initialize Metrics (Prometheus) ────────────────────────────────
METRICS_PORT = int(os.getenv("CELERY_METRICS_PORT", "9090"))
ENABLE_METRICS = os.getenv("CELERY_ENABLE_METRICS", "true").lower() == "true"

if ENABLE_METRICS:
    try:
        from workers.metrics import start_metrics_server, connect_celery_signals

        start_metrics_server(port=METRICS_PORT)
        connect_celery_signals(app)
        logger.info("Metrics server started on :%d/metrics", METRICS_PORT)
    except Exception as exc:
        logger.warning("Failed to start metrics — %s", exc)


@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    logger.info(
        "Celery app configured — broker=%s backend=%s concurrency=%d metrics=%s",
        broker_url,
        result_backend,
        concurrency,
        f"enabled:{METRICS_PORT}" if ENABLE_METRICS else "disabled",
    )
