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

# Disable pidbox remote control (RabbitMQ 4.x removed transient_nonexcl_queues)
app.conf.worker_enable_remote_control = False

# ── Graceful Shutdown / Task Resilience ─────────────────────────
app.conf.task_acks_late = True
app.conf.task_reject_on_worker_lost = True
app.conf.worker_cancel_long_running_tasks_on_connection_loss = True

app.autodiscover_tasks(["workers.tasks", "workers.consumers", "workers.gates", "workers.quality", "workers.analytics.ingestion", "workers.analytics.rollups"])

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


@app.task(name="workers.celery_app.ping")
def ping():
    """Simple liveness check."""
    return {"status": "pong"}


# ── Emergency Stop Middleware ───────────────────────────────────────
# Connects Celery signal handlers for the global kill switch.
# Agent tasks are rejected when emergency_stop is active.
try:
    from workers.emergency.middleware import connect_emergency_middleware

    connect_emergency_middleware()
    logger.info("Emergency stop middleware connected")
except Exception as exc:
    logger.warning("Failed to connect emergency stop middleware — %s", exc)


# ── Injection Guard ────────────────────────────────────────────────
# Self-registers via @signals.task_prerun.connect at import time.
try:
    from workers.gates import injection_middleware  # noqa: F401

    injection_middleware.connect_injection_middleware()
except Exception as exc:
    logger.warning("Failed to connect injection middleware — %s", exc)

# ── Merge Queue Middleware ──────────────────────────────────────────
# Auto-enqueues PRs into the merge queue after successful creation.
try:
    from workers.merge_queue.middleware import connect_merge_queue_middleware

    connect_merge_queue_middleware()
    logger.info("Merge queue middleware connected")
except Exception as exc:
    logger.warning("Failed to connect merge queue middleware -- %s", exc)

# ── Compliance Audit Middleware ────────────────────────────────────
# Self-registers Celery signal handlers at import time to append
# audit events (task.start / task.success / task.failure) to the
# SHA-256 chained compliance trail.
try:
    from workers.audit import middleware  # noqa: F401

    logger.info("Compliance audit middleware connected")
except Exception as exc:
    logger.warning("Failed to connect compliance audit middleware -- %s", exc)

# ── Runaway Agent Protection ───────────────────────────────────────
# Self-registers via @signals.task_prerun.connect at import time.
# Enforces per-agent timeout, token/cost limits, and max retries.
try:
    from workers.runaway import middleware  # noqa: F401

    middleware.connect_runaway_middleware()
    logger.info("Runaway agent middleware connected")
except Exception as exc:
    logger.warning("Failed to connect runaway middleware -- %s", exc)


# ── Dedup Middleware (Duplicate Job Prevention) ─────────────────────
# Self-registers Celery signal handlers at import time to prevent
# duplicate task execution for the same issue across workers.
try:
    from workers.dispatch import dedup_middleware  # noqa: F401

    dedup_middleware.connect_dedup_middleware()
    logger.info("Dedup middleware connected")
except Exception as exc:
    logger.warning("Failed to connect dedup middleware -- %s", exc)


# ── Worker Scaling (KEDA / Celery autoscale) ───────────────────────
# Configures pod-level scaling via KEDA ScaledObject (in k8s/) or falls
# back to Celery's native --autoscale when KEDA is not deployed.
try:
    from workers.scaling import configure_scaling

    configure_scaling(app)
    logger.info("Worker scaling configured")
except Exception as exc:
    logger.warning("Failed to configure worker scaling -- %s", exc)


# ── Graceful Shutdown Handler ──────────────────────────────────────
# Installs SIGTERM handling and task drain via Celery signals.
# Must be installed after the app is fully configured.
try:
    from workers.shutdown import GracefulShutdownHandler

    GracefulShutdownHandler().install(app)
    logger.info("GracefulShutdownHandler installed — task drain active on SIGTERM")
except Exception as exc:
    logger.warning("Failed to install GracefulShutdownHandler — %s", exc)


@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    logger.info(
        "Celery app configured — broker=%s backend=%s concurrency=%d metrics=%s",
        broker_url,
        result_backend,
        concurrency,
        f"enabled:{METRICS_PORT}" if ENABLE_METRICS else "disabled",
    )
