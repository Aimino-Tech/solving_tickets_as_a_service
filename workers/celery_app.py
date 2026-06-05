import os
import logging

import sentry_sdk
from celery import Celery
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

logger = logging.getLogger(__name__)

# ── Sentry initialization (must be before Celery app creation) ──────────
SENTRY_DSN = os.getenv("SENTRY_DSN")
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=os.getenv("SENTRY_ENVIRONMENT", "development"),
        release=os.getenv("SENTRY_RELEASE", "stas-workers@0.1.0"),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        integrations=[
            CeleryIntegration(monitor_beat_tasks=True),
            LoggingIntegration(
                level=logging.INFO,  # Capture info and above as breadcrumbs
                event_level=logging.ERROR,  # Send errors as Sentry events
            ),
        ],
    )
    logger.info("Sentry initialized for Celery workers — environment=%s", os.getenv("SENTRY_ENVIRONMENT", "development"))
else:
    logger.info("Sentry not configured for Celery workers (SENTRY_DSN not set)")

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

app.autodiscover_tasks(["workers.tasks"])


@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    logger.info("Celery app configured — broker=%s backend=%s concurrency=%d", broker_url, result_backend, concurrency)
