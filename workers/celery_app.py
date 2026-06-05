import os
import logging

from celery import Celery

# ---------------------------------------------------------------------------
# Sentry SDK initialization for Celery workers
# ---------------------------------------------------------------------------
# Initialize before Celery app creation to ensure task failures are captured.
# SENTRY_DSN is read from environment. If not set, Sentry is disabled.
# ---------------------------------------------------------------------------
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
SENTRY_ENV = os.getenv("SENTRY_ENVIRONMENT", os.getenv("NODE_ENV", "development"))
SENTRY_RELEASE = os.getenv("SENTRY_RELEASE", "stas@unknown")

if SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.celery import CeleryIntegration

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=SENTRY_ENV,
            release=SENTRY_RELEASE,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            integrations=[
                CeleryIntegration(
                    # Capture task exceptions automatically
                    propagate_traces=True,
                ),
            ],
        )
        logging.getLogger(__name__).info(
            "Sentry initialized for Celery — env=%s release=%s",
            SENTRY_ENV,
            SENTRY_RELEASE,
        )
    except ImportError:
        logging.getLogger(__name__).warning(
            "sentry-sdk not installed — Sentry monitoring disabled for Celery"
        )
    except Exception as e:
        logging.getLogger(__name__).warning(
            "Failed to initialize Sentry for Celery: %s", e
        )
else:
    logging.getLogger(__name__).info(
        "SENTRY_DSN not configured — Sentry monitoring disabled for Celery"
    )

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

app.autodiscover_tasks(["workers.tasks"])


@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    logger.info("Celery app configured — broker=%s backend=%s concurrency=%d", broker_url, result_backend, concurrency)
