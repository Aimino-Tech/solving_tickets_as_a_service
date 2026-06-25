from kombu import Exchange, Queue

import os

<<<<<<< HEAD
# \u2500\u2500 Retry Configuration \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
=======
# ── Retry Configuration ─────────────────────────────────────────
>>>>>>> origin/main
TASK_DEFAULT_RETRY_DELAY = int(os.getenv("CELERY_RETRY_DELAY_SECONDS", "60"))
TASK_TRIAGE_RETRY_DELAY = int(os.getenv("CELERY_TRIAGE_RETRY_DELAY_SECONDS", "30"))
TASK_AGENT_RETRY_DELAY = int(os.getenv("CELERY_AGENT_RETRY_DELAY_SECONDS", "60"))
TASK_SANDBOX_RETRY_DELAY = int(os.getenv("CELERY_SANDBOX_RETRY_DELAY_SECONDS", "30"))
TASK_PR_RETRY_DELAY = int(os.getenv("CELERY_PR_RETRY_DELAY_SECONDS", "30"))
TASK_NOTIFICATION_RETRY_DELAY = int(os.getenv("CELERY_NOTIFICATION_RETRY_DELAY_SECONDS", "10"))
TASK_VERIFICATION_RETRY_DELAY = int(os.getenv("CELERY_VERIFICATION_RETRY_DELAY_SECONDS", "30"))
<<<<<<< HEAD

# \u2500\u2500 Beat Schedule (Periodic Tasks) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
=======
TASK_VISUAL_VERIFICATION_RETRY_DELAY = int(os.getenv("CELERY_VISUAL_VERIFICATION_RETRY_DELAY_SECONDS", "60"))

# ── Beat Schedule (Periodic Tasks) ───────────────────────────────
>>>>>>> origin/main
from celery.schedules import crontab

beat_schedule = {
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

<<<<<<< HEAD
# \u2500\u2500 Unified Exchange Topology \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
=======
# ── Unified Exchange Topology ───────────────────────────────────
>>>>>>> origin/main
# All layers (TypeScript + Celery) use the same exchange names,
# queue names, and routing keys.

stas_agents = Exchange("stas.agents", type="topic", durable=True)
stas_issues = Exchange("stas.issues", type="topic", durable=True)
stas_queue = Exchange("stas.queue", type="topic", durable=True)
stas_events = Exchange("stas.events", type="fanout", durable=True)
stas_dlx = Exchange("stas.dlx", type="direct", durable=True)
<<<<<<< HEAD
stas_triage = Exchange("stas.triage", type="direct", durable=True)
=======
stas_verification = Exchange("stas.verification", type="direct", durable=True)
>>>>>>> origin/main

task_default_queue = "stas.agents.dispatch"
task_default_exchange = "stas.agents"
task_default_routing_key = "agent.runner"

task_queues = [
<<<<<<< HEAD
    # \u2500\u2500 stas.triage exchange \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    Queue("stas.triage", stas_triage, routing_key="triage.resolve"),
    # \u2500\u2500 stas.agents exchange \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
=======
    # ── stas.agents exchange ──────────────────────────────────
>>>>>>> origin/main
    Queue("stas.agents.dispatch", stas_agents, routing_key="agent.runner"),
    Queue("stas.agents.verification", stas_agents, routing_key="agent.verify"),
    Queue("stas.agents.sandbox", stas_agents, routing_key="agent.sandbox"),
    Queue("stas.agents.self_audit", stas_agents, routing_key="agent.self_audit"),
<<<<<<< HEAD
    # \u2500\u2500 stas.issues exchange \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    Queue("stas.issues.triage", stas_issues, routing_key="triage.#"),
    Queue("stas.issues.health", stas_issues, routing_key="health.#"),
    # \u2500\u2500 stas.queue exchange \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    Queue("stas.queue.pr", stas_queue, routing_key="pr.create"),
    Queue("stas.queue.notifications", stas_queue, routing_key="queue.notify"),
    # \u2500\u2500 stas.events exchange (fanout) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    Queue("stas.events.event_bus", stas_events),
    # \u2500\u2500 stas.dlx exchange \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
=======
    # ── stas.issues exchange ──────────────────────────────────
    Queue("stas.issues.triage", stas_issues, routing_key="triage.#"),
    Queue("stas.issues.health", stas_issues, routing_key="health.#"),
    # ── stas.queue exchange ───────────────────────────────────
    Queue("stas.queue.pr", stas_queue, routing_key="pr.create"),
    Queue("stas.queue.notifications", stas_queue, routing_key="queue.notify"),
    # ── stas.verification exchange ────────────────────────────
    Queue("stas.verification", stas_verification, routing_key="visual.verify"),
    # ── stas.events exchange (fanout) ─────────────────────────
    Queue("stas.events.event_bus", stas_events),
    # ── stas.dlx exchange ─────────────────────────────────────
>>>>>>> origin/main
    Queue("stas.dlx.retry", stas_dlx, routing_key="dlq.retry"),
    Queue("stas.dlx.failed", stas_dlx, routing_key="dlq.failed"),
]

task_routes = {
<<<<<<< HEAD
    "workers.tasks.dependency_resolver.*": {"queue": "stas.triage"},
=======
>>>>>>> origin/main
    "workers.tasks.triage.*": {"queue": "stas.issues.triage"},
    "workers.tasks.agent.*": {"queue": "stas.agents.dispatch"},
    "workers.tasks.sandbox.*": {"queue": "stas.agents.sandbox"},
    "workers.tasks.verification.*": {"queue": "stas.agents.verification"},
    "workers.tasks.pr_creation.*": {"queue": "stas.queue.pr"},
    "workers.tasks.notifications.*": {"queue": "stas.queue.notifications"},
    "workers.tasks.self_audit.*": {"queue": "stas.agents.self_audit"},
<<<<<<< HEAD
=======
    "workers.tasks.visual_verification.*": {"queue": "stas.verification"},
>>>>>>> origin/main
}
