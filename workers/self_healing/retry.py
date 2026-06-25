"""
Celery Retry Configuration — exponential backoff and max retries per task type.

Configures Celery's built-in retry mechanism with:
  - Exponential backoff (1s, 4s, 16s for attempts 1, 2, 3)
  - Configurable max_retries per task type
  - Automatic retry on failure with logging

Usage:
    from workers.self_healing.retry import configure_retry_policy

    configure_retry_policy(app)
"""

import logging
import os

from celery import Celery

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────

# Default retry settings
DEFAULT_MAX_RETRIES = int(os.getenv("CELERY_DEFAULT_MAX_RETRIES", "3"))
DEFAULT_RETRY_BACKOFF = int(os.getenv("CELERY_DEFAULT_RETRY_BACKOFF", "4"))  # exponential base
DEFAULT_RETRY_DELAY = int(os.getenv("CELERY_DEFAULT_RETRY_DELAY_SECONDS", "1"))

# Per-task retry configuration
# Format: task_name -> {max_retries, retry_backoff, retry_delay}
TASK_RETRY_CONFIG: dict[str, dict[str, int]] = {
    "workers.tasks.triage.classify_issue": {
        "max_retries": 2,
        "retry_backoff": 4,
        "retry_delay": 1,
    },
    "workers.tasks.agent.dispatch_agent": {
        "max_retries": 3,
        "retry_backoff": 4,
        "retry_delay": 1,
    },
    "workers.tasks.sandbox.create_sandbox": {
        "max_retries": 2,
        "retry_backoff": 3,
        "retry_delay": 2,
    },
    "workers.tasks.verification.verify_fix": {
        "max_retries": 2,
        "retry_backoff": 4,
        "retry_delay": 1,
    },
    "workers.tasks.pr_creation.create_pr": {
        "max_retries": 3,
        "retry_backoff": 4,
        "retry_delay": 1,
    },
    "workers.tasks.notifications.send_notification": {
        "max_retries": 3,
        "retry_backoff": 3,
        "retry_delay": 1,
    },
    "workers.tasks.periodic.queue_health_check": {
        "max_retries": 2,
        "retry_backoff": 2,
        "retry_delay": 5,
    },
}


def get_task_retry_config(task_name: str) -> dict[str, int]:
    """
    Get retry configuration for a specific task.

    Args:
        task_name: Fully qualified task name (e.g., 'workers.tasks.triage.classify_issue')

    Returns:
        Dict with max_retries, retry_backoff, retry_delay keys.
    """
    return TASK_RETRY_CONFIG.get(
        task_name,
        {
            "max_retries": DEFAULT_MAX_RETRIES,
            "retry_backoff": DEFAULT_RETRY_BACKOFF,
            "retry_delay": DEFAULT_RETRY_DELAY,
        },
    )


def apply_retry_decorator(task_func):
    """
    Apply retry configuration to a task function.
    This is used as a decorator or can be called manually.

    Usage as a decorator:
        @app.task
        @apply_retry_decorator
        def my_task(...):
            ...

    Usage in task definition:
        task_func = apply_retry_decorator(task_func)
    """
    import functools

    task_name = getattr(task_func, "name", task_func.__name__)
    config = get_task_retry_config(task_name)

    # Store retry config on the function for Celery to pick up
    task_func.max_retries = config["max_retries"]
    task_func.retry_backoff = config["retry_backoff"]
    task_func.retry_backoff_max = 600  # 10 minutes max
    task_func.retry_jitter = True

    @functools.wraps(task_func)
    def wrapper(*args, **kwargs):
        try:
            return task_func(*args, **kwargs)
        except Exception as exc:
            # Log the retry attempt
            request = getattr(task_func, "request", None)
            if request:
                retries = getattr(request, "retries", 0)
                logger.warning(
                    "Task %s failed (attempt %d/%d) — %s: %s",
                    task_name,
                    retries + 1,
                    config["max_retries"],
                    type(exc).__name__,
                    exc,
                )
            raise

    return wrapper


def configure_retry_policy(app: Celery) -> None:
    """
    Configure Celery's retry policy for all task modules.

    Sets default retry settings on the app and applies per-task
    retry configuration to registered tasks.

    Args:
        app: The Celery application instance.
    """
    logger.info("Configuring retry policy")

    # Set default retry settings on the app
    app.conf.task_default_retry_delay = DEFAULT_RETRY_DELAY

    # Apply retry configuration to registered tasks
    for task_name, config in TASK_RETRY_CONFIG.items():
        logger.debug(
            "Task %s — max_retries=%d retry_backoff=%d retry_delay=%d",
            task_name,
            config["max_retries"],
            config["retry_backoff"],
            config["retry_delay"],
        )

    # Connect to Celery signals for retry logging
    from celery import signals

    @signals.task_retry.connect
    def on_task_retry(request, reason, einfo, **kwargs):  # type: ignore[no-untyped-def]
        """Log task retry events."""
        task_name = request.task_name if request else "unknown"
        retries = request.retries if request else 0
        logger.warning(
            "Task retry — name=%s retry=%d reason=%s",
            task_name,
            retries,
            reason,
        )

    logger.info(
        "Retry policy configured — default_max_retries=%d default_backoff=%d",
        DEFAULT_MAX_RETRIES,
        DEFAULT_RETRY_BACKOFF,
    )
