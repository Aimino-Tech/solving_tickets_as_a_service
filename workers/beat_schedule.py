"""
Celery Beat Schedule Configuration — all periodic task definitions.

This module defines the CELERYBEAT_SCHEDULE dict used by the Celery Beat
scheduler. It consolidates all periodic tasks (both existing and new) in a
single location for easy auditing and management.

Schedules defined here are loaded as defaults. When ``django-celery-beat``
is configured, schedules are stored in the database and can be managed
dynamically through the Django admin UI.

To use this with the DatabaseScheduler:
    celery -A workers.celery_app beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler
"""

from celery.schedules import crontab


def get_beat_schedule() -> dict:
    """Return the complete Celery Beat schedule dictionary.

    All periodic tasks with their schedules, task paths, and arguments.
    """
    return {
        # ── Existing Tasks ──────────────────────────────────────────
        "queue-health-check": {
            "task": "workers.tasks.periodic.queue_health_check",
            "schedule": crontab(minute="*/5"),
            "args": (),
            "options": {"expires": 120, "queue": "stas.agents.default"},
        },
        "dlq-cleanup": {
            "task": "workers.tasks.periodic.dlq_cleanup",
            "schedule": crontab(hour=2, minute=0),
            "args": (),
            "options": {"expires": 300, "queue": "stas.agents.default"},
        },
        "metrics-push": {
            "task": "workers.tasks.periodic.push_metrics",
            "schedule": crontab(minute="*"),
            "args": (),
            "options": {"expires": 30, "queue": "stas.agents.default"},
        },
        "worker-liveness-report": {
            "task": "workers.tasks.periodic.report_liveness",
            "schedule": crontab(minute="*/1"),
            "args": (),
            "options": {"expires": 30, "queue": "stas.agents.default"},
        },
        "sandbox-gc-every-10-minutes": {
            "task": "workers.tasks.sandbox_gc.sandbox_gc",
            "schedule": 600.0,
            "args": (),
            "options": {"expires": 120, "queue": "stas.agents.default"},
        },
        # ── Background Agent Tasks ──────────────────────────────────
        "data-backup-daily": {
            "task": "workers.tasks.background.data_backup",
            "schedule": crontab(hour=3, minute=0),
            "args": (),
            "options": {"expires": 3600, "queue": "stas.agents.default"},
        },
        "prune-sessions-daily": {
            "task": "workers.tasks.background.prune_sessions",
            "schedule": crontab(hour=4, minute=0),
            "args": (),
            "options": {"expires": 1800, "queue": "stas.agents.default"},
        },
        "heartbeat-check": {
            "task": "workers.tasks.background.heartbeat_check",
            "schedule": crontab(minute="*"),
            "args": (),
            "options": {"expires": 30, "queue": "stas.agents.default"},
        },
        "sync-resources": {
            "task": "workers.tasks.background.sync_resources",
            "schedule": crontab(minute="*/30"),
            "args": (),
            "options": {"expires": 120, "queue": "stas.agents.default"},
        },
    }


beat_schedule = get_beat_schedule()
