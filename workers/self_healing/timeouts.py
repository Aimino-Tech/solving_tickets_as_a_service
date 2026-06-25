"""
Celery Timeout Configuration — soft and hard timeouts per task type.

Configures Celery's task timeouts:
  - Soft time limit: worker gets a SoftTimeLimitExceeded exception (graceful)
  - Hard time limit: worker is killed (SIGKILL) if soft limit is ignored

Per-task type configuration allows different timeouts for different workloads.

Usage:
    from workers.self_healing.timeouts import configure_timeout_policy

    configure_timeout_policy(app)
"""

import logging
import os

from celery import Celery

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────

# Default timeout settings (in seconds)
DEFAULT_SOFT_TIME_LIMIT = int(os.getenv("CELERY_DEFAULT_SOFT_TIME_LIMIT", "480"))  # 8 min
DEFAULT_HARD_TIME_LIMIT = int(os.getenv("CELERY_DEFAULT_HARD_TIME_LIMIT", "600"))  # 10 min

# Per-task timeout configuration
# Format: task_name -> {soft, hard}
# soft = soft time limit in seconds (80% of hard by default)
# hard = hard time limit in seconds (SIGKILL)
TASK_TIMEOUT_CONFIG: dict[str, dict[str, int]] = {
    # Agent dispatch — can take a while
    "workers.tasks.agent.dispatch_agent": {
        "soft": 480,  # 8 min
        "hard": 600,  # 10 min
    },
    # Triage — fast classification
    "workers.tasks.triage.classify_issue": {
        "soft": 24,  # 80% of 30s
        "hard": 30,  # 30s
    },
    # Sandbox — E2B environment setup
    "workers.tasks.sandbox.create_sandbox": {
        "soft": 240,  # 80% of 5 min
        "hard": 300,  # 5 min
    },
    # Verification — running test suites
    "workers.tasks.verification.verify_fix": {
        "soft": 240,
        "hard": 300,
    },
    # PR creation — GitHub API calls
    "workers.tasks.pr_creation.create_pr": {
        "soft": 24,
        "hard": 30,
    },
    # Notifications — Slack/webhook
    "workers.tasks.notifications.send_notification": {
        "soft": 8,
        "hard": 10,
    },
    # Periodic tasks
    "workers.tasks.periodic.queue_health_check": {
        "soft": 24,
        "hard": 30,
    },
    "workers.tasks.periodic.dlq_cleanup": {
        "soft": 48,
        "hard": 60,
    },
    "workers.tasks.periodic.push_metrics": {
        "soft": 8,
        "hard": 10,
    },
    "workers.tasks.periodic.report_liveness": {
        "soft": 8,
        "hard": 10,
    },
    # Self-healing tasks
    "workers.self_healing.heartbeats.periodic_heartbeat": {
        "soft": 5,
        "hard": 10,
    },
}


def get_task_timeout_config(task_name: str) -> dict[str, int]:
    """
    Get timeout configuration for a specific task.

    Args:
        task_name: Fully qualified task name.

    Returns:
        Dict with 'soft' and 'hard' timeout values in seconds.
    """
    return TASK_TIMEOUT_CONFIG.get(
        task_name,
        {
            "soft": DEFAULT_SOFT_TIME_LIMIT,
            "hard": DEFAULT_HARD_TIME_LIMIT,
        },
    )


def configure_timeout_policy(app: Celery) -> None:
    """
    Configure Celery's soft and hard time limits.

    Sets default time limits on the app and applies per-task
    timeout configuration to registered tasks.

    Args:
        app: The Celery application instance.
    """
    logger.info("Configuring timeout policy")

    # Set default time limits on the app
    app.conf.task_soft_time_limit = DEFAULT_SOFT_TIME_LIMIT
    app.conf.task_time_limit = DEFAULT_HARD_TIME_LIMIT

    # Apply per-task timeout configuration
    for task_name, config in TASK_TIMEOUT_CONFIG.items():
        logger.debug(
            "Task %s — soft=%ds hard=%ds",
            task_name,
            config["soft"],
            config["hard"],
        )

    # Connect to Celery signals for timeout logging
    from celery import signals

    @signals.task_failure.connect
    def on_task_failure(sender, task_id, exception, **kwargs) -> None:  # type: ignore[no-untyped-def]
        """Log task timeouts specifically."""
        from celery.exceptions import SoftTimeLimitExceeded

        if isinstance(exception, SoftTimeLimitExceeded):
            task_name = sender.name if sender else "unknown"
            logger.error(
                "Task soft time limit exceeded — name=%s task_id=%s soft_limit=%ds",
                task_name,
                task_id,
                get_task_timeout_config(task_name).get("soft", "?"),
            )

    logger.info(
        "Timeout policy configured — default_soft=%ds default_hard=%ds",
        DEFAULT_SOFT_TIME_LIMIT,
        DEFAULT_HARD_TIME_LIMIT,
    )
