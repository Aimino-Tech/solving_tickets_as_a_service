from kombu import Exchange, Queue


import os

# ── Retry Configuration ─────────────────────────────────────────
TASK_DEFAULT_RETRY_DELAY = int(os.getenv("CELERY_RETRY_DELAY_SECONDS", "60"))
TASK_TRIAGE_RETRY_DELAY = int(os.getenv("CELERY_TRIAGE_RETRY_DELAY_SECONDS", "30"))
TASK_AGENT_RETRY_DELAY = int(os.getenv("CELERY_AGENT_RETRY_DELAY_SECONDS", "60"))
TASK_SANDBOX_RETRY_DELAY = int(os.getenv("CELERY_SANDBOX_RETRY_DELAY_SECONDS", "30"))
TASK_PR_RETRY_DELAY = int(os.getenv("CELERY_PR_RETRY_DELAY_SECONDS", "30"))
TASK_NOTIFICATION_RETRY_DELAY = int(os.getenv("CELERY_NOTIFICATION_RETRY_DELAY_SECONDS", "10"))
TASK_VERIFICATION_RETRY_DELAY = int(os.getenv("CELERY_VERIFICATION_RETRY_DELAY_SECONDS", "30"))

# ── Beat Schedule (Periodic Tasks) ───────────────────────────────
from celery.schedules import crontab

beat_schedule = {
    "linear-poll-active-issues": {
        "task": "workers.tasks.linear_poll.poll_active_issues",
        "schedule": 120.0,  # every 2 minutes
        "args": (),
    },
    "queue-health-check": {
        "task": "workers.tasks.periodic.queue_health_check",
        "schedule": crontab(minute="*/5"),
        "args": (),
    },
    "dlq-cleanup": {
        "task": "workers.tasks.periodic.dlq_cleanup",
        "schedule": crontab(hour=2, minute=0),
        "args": (),
    },
    "metrics-push": {
        "task": "workers.tasks.periodic.push_metrics",
        "schedule": crontab(minute="*"),
        "args": (),
    },
    "worker-liveness-report": {
        "task": "workers.tasks.periodic.report_liveness",
        "schedule": crontab(minute="*/1"),
        "args": (),
    },
    "sandbox-gc-every-10-minutes": {
        "task": "workers.tasks.sandbox_gc.sandbox_gc",
        "schedule": 600.0,
        "args": (),
    },
    "billing-usage-sync-to-stripe": {
        "task": "workers.billing.usage.sync_usage_to_stripe",
        "schedule": crontab(hour=1, minute=0),
        "args": (),
    },
    "kpi-daily-etl": {
        "task": "workers.tasks.kpi_etl.compute_daily_kpi",
        "schedule": crontab(hour=0, minute=5),
        "args": (),
    },
    "e2e-health-check": {
        "task": "workers.health.e2e_check.run_e2e_health_check",
        "schedule": 300.0,
        "args": (),
    },
    "sla-compliance-check": {
        "task": "workers.tasks.periodic.sla_compliance_check",
        "schedule": 300.0,
        "args": (),
    },
}

broker_url = os.getenv("CELERY_BROKER_URL", "pyamqp://guest:guest@localhost:5672//")
result_backend = "redis://localhost:6379/0"

task_serializer = "json"
result_serializer = "json"
accept_content = ["json"]

task_soft_time_limit = 580
task_hard_time_limit = 600

worker_prefetch_multiplier = 1

worker_enable_remote_control = False
broker_connection_retry_on_startup = True

task_default_queue = "stas.agents.triage"

task_queues = [
    Queue("stas.agents.triage", Exchange("stas"), routing_key="stas.agents.triage"),
    Queue("stas.agents.dispatch", Exchange("stas"), routing_key="stas.agents.dispatch"),
    Queue("stas.agents.sandbox", Exchange("stas"), routing_key="stas.agents.sandbox"),
    Queue("stas.agents.verification", Exchange("stas"), routing_key="stas.agents.verification"),
    Queue("stas.agents.pr_creation", Exchange("stas"), routing_key="stas.agents.pr_creation"),
    Queue("stas.agents.notifications", Exchange("stas"), routing_key="stas.agents.notifications"),
    Queue("stas.agents.default", Exchange("stas"), routing_key="stas.agents.default"),
    Queue("stas.issues.triage", Exchange("stas"), routing_key="stas.issues.triage"),
    Queue("stas.issues.fix", Exchange("stas"), routing_key="stas.issues.fix"),
    Queue("stas.agents.self_audit", Exchange("stas"), routing_key="stas.agents.self_audit"),
]

task_routes = {
    "workers.tasks.triage.*": {"queue": "stas.agents.triage"},
    "workers.tasks.agent.*": {"queue": "stas.agents.dispatch"},
    "workers.tasks.sandbox.*": {"queue": "stas.agents.sandbox"},
    "workers.tasks.verification.*": {"queue": "stas.agents.verification"},
    "workers.tasks.pr_creation.*": {"queue": "stas.agents.pr_creation"},
    "workers.tasks.notifications.*": {"queue": "stas.agents.notifications"},
    "workers.billing.*": {"queue": "stas.agents.default"},
    "workers.tasks.linear_poll.*": {"queue": "stas.issues.triage"},
    "workers.gates.*": {"queue": "stas.agents.default"},
    "workers.quality.*": {"queue": "stas.agents.default"},
    "workers.health.*": {"queue": "stas.agents.default"},
}
