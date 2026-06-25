import os
import logging

from celery import Celery

# ---------------------------------------------------------------------------
# Sentry SDK initialization for Celery workers
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
                    propagate_traces=True,
                ),
            ],
        )
        logging.getLogger(__name__).info(
            "Sentry initialized for Celery - env=%s release=%s",
            SENTRY_ENV,
            SENTRY_RELEASE,
        )
    except ImportError:
        logging.getLogger(__name__).warning(
            "sentry-sdk not installed - Sentry monitoring disabled for Celery"
        )
    except Exception as e:
        logging.getLogger(__name__).warning(
            "Failed to initialize Sentry for Celery: %s", e
        )
else:
    logging.getLogger(__name__).info(
        "SENTRY_DSN not configured - Sentry monitoring disabled for Celery"
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

app.autodiscover_tasks(["workers.tasks", "workers.consumers", "workers.quality"])

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
        logger.warning("Failed to start metrics - %s", exc)

# ── AIM-2022: Self-Healing Infrastructure ─────────────────────────

# Validate timeout configurations (logs warnings)
try:
    from workers.orchestrator.timeouts import validate_timeouts
    timeout_issues = validate_timeouts()
    for issue in timeout_issues:
        logger.warning("Timeout config issue: %s", issue)
except Exception as exc:
    logger.warning("Failed to validate timeouts: %s", exc)

# Start heartbeat monitor (daemon thread)
ENABLE_SELF_HEALING = os.getenv("ENABLE_SELF_HEALING", "true").lower() == "true"
if ENABLE_SELF_HEALING:
    try:
        from workers.orchestrator.heartbeat import start_heartbeat_monitor
        start_heartbeat_monitor()
        logger.info("Self-healing heartbeat monitor started")
    except Exception as exc:
        logger.warning("Failed to start heartbeat monitor: %s", exc)
else:
    logger.info("Self-healing infrastructure disabled (ENABLE_SELF_HEALING=false)")

# ── Task failure signal for circuit breaker ─────────────────────────
if ENABLE_SELF_HEALING:
    try:
        from celery import signals
        from workers.orchestrator.circuit_breaker import record_failure, record_success

        @signals.task_failure.connect
        def on_task_failure_cb(sender, task_id, exception, **kwargs):
            """Record task failure for circuit breaker."""
            if sender and sender.name:
                record_failure(sender.name)

        @signals.task_success.connect
        def on_task_success_cb(sender, result, **kwargs):
            """Record task success for circuit breaker."""
            if sender and sender.name:
                record_success(sender.name)

        logger.info("Circuit breaker signal handlers connected")
    except Exception as exc:
        logger.warning("Failed to connect circuit breaker signals: %s", exc)


@app.task(name="workers.celery_app.ping")
def ping():
    """Simple liveness check."""
    return {"status": "pong"}


@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    logger.info(
        "Celery app configured - broker=%s backend=%s concurrency=%d metrics=%s self_healing=%s",
        broker_url,
        result_backend,
        concurrency,
        "enabled:%d" % METRICS_PORT if ENABLE_METRICS else "disabled",
        "enabled" if ENABLE_SELF_HEALING else "disabled",
    )


# ── Celery event monitor for worker heartbeats (AIM-2022) ──────────
# This is a fallback that starts a background event receiver for Celery
# worker-heartbeat events. The primary mechanism is the heartbeat monitor
# thread, but this provides real-time event-driven detection as well.
if ENABLE_SELF_HEALING:
    try:
        import threading
        from workers.orchestrator.heartbeat import on_worker_heartbeat, on_worker_online, on_worker_offline

        def _start_event_monitor():
            """Listen for Celery worker events in a background thread."""
            try:
                from celery.events import EventReceiver
                with app.connection() as conn:
                    recv = EventReceiver(conn, handlers={
                        "worker-heartbeat": on_worker_heartbeat,
                        "worker-online": on_worker_online,
                        "worker-offline": on_worker_offline,
                    })
                    recv.capture(limit=None, timeout=None, wakeup_after=10)
            except Exception as exc:
                logger.warning("Celery event monitor thread error: %s", exc)

        event_thread = threading.Thread(
            target=_start_event_monitor,
            daemon=True,
            name="celery-event-monitor",
        )
        event_thread.start()
        logger.info("Celery event monitor thread started for worker heartbeats")
    except Exception as exc:
        logger.warning("Failed to start Celery event monitor: %s", exc)
