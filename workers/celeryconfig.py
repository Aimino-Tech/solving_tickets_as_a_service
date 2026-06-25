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
    "poll-linear-active-issues": {
        "task": "workers.tasks.linear_poll.poll_active_issues",
        "schedule": 30.0,
        "options": {"queue": "stas.issues.triage"},
    },
    "pipeline-cleanup-every-30-minutes": {
        "task": "workers.tasks.pipeline_orchestrator.orchestrate_pipeline",
        "schedule": 1800.0,
        "args": ("", "stas:fix"),
    },
    # ── AIM-2022: Self-Healing Infrastructure ─────────────────────
    "self-healing-heartbeat-check": {
        "task": "workers.tasks.periodic.self_healing_heartbeat_check",
        "schedule": 15.0,  # every 15 seconds
        "args": (),
        "options": {"queue": "stas.issues.health"},
    },
    "self-healing-queue-drain-check": {
        "task": "workers.tasks.periodic.self_healing_queue_drain_check",
        "schedule": 60.0,  # every 60 seconds
        "args": (),
        "options": {"queue": "stas.issues.health"},
    },
    "self-healing-circuit-breaker-check": {
        "task": "workers.tasks.periodic.self_healing_circuit_check",
        "schedule": 30.0,  # every 30 seconds
        "args": (),
        "options": {"queue": "stas.issues.health"},
    },
    "self-healing-dlq-replay": {
        "task": "workers.tasks.periodic.self_healing_dlq_replay",
        "schedule": 120.0,  # every 2 minutes
        "args": (),
        "options": {"queue": "stas.issues.health"},
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

# ── AIM-2022: Per-task-type timeout annotations ──────────────────
task_annotations = {
    "workers.tasks.triage.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_TRIAGE_SOFT", "120")),
        "time_limit": int(os.getenv("TIMEOUT_TRIAGE_HARD", "150")),
    },
    "workers.tasks.agent.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_AGENT_SOFT", "580")),
        "time_limit": int(os.getenv("TIMEOUT_AGENT_HARD", "600")),
    },
    "workers.tasks.sandbox.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_SANDBOX_SOFT", "300")),
        "time_limit": int(os.getenv("TIMEOUT_SANDBOX_HARD", "330")),
    },
    "workers.tasks.verification.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_VERIFY_SOFT", "300")),
        "time_limit": int(os.getenv("TIMEOUT_VERIFY_HARD", "330")),
    },
    "workers.tasks.pr_creation.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_PR_SOFT", "120")),
        "time_limit": int(os.getenv("TIMEOUT_PR_HARD", "150")),
    },
    "workers.tasks.notifications.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_NOTIFY_SOFT", "60")),
        "time_limit": int(os.getenv("TIMEOUT_NOTIFY_HARD", "90")),
    },
    "workers.tasks.periodic.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_PERIODIC_SOFT", "120")),
        "time_limit": int(os.getenv("TIMEOUT_PERIODIC_HARD", "150")),
    },
    "workers.tasks.self_audit.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_SELF_AUDIT_SOFT", "300")),
        "time_limit": int(os.getenv("TIMEOUT_SELF_AUDIT_HARD", "330")),
    },
    "workers.tasks.linear_poll.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_LINEAR_POLL_SOFT", "60")),
        "time_limit": int(os.getenv("TIMEOUT_LINEAR_POLL_HARD", "90")),
    },
    "workers.tasks.ci_polling.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_CI_POLL_SOFT", "120")),
        "time_limit": int(os.getenv("TIMEOUT_CI_POLL_HARD", "150")),
    },
    "workers.tasks.sandbox_gc.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_SANDBOX_GC_SOFT", "120")),
        "time_limit": int(os.getenv("TIMEOUT_SANDBOX_GC_HARD", "150")),
    },
    "workers.orchestrator.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_ORCHESTRATOR_SOFT", "120")),
        "time_limit": int(os.getenv("TIMEOUT_ORCHESTRATOR_HARD", "150")),
    },
    "workers.quality.": {
        "soft_time_limit": int(os.getenv("TIMEOUT_QUALITY_SOFT", "120")),
        "time_limit": int(os.getenv("TIMEOUT_QUALITY_HARD", "150")),
    },
}

# ── Unified Exchange Topology ───────────────────────────────────
# All layers (TypeScript + Celery) use the same exchange names,
# queue names, and routing keys.

stas_agents = Exchange("stas.agents", type="topic", durable=True)
stas_issues = Exchange("stas.issues", type="topic", durable=True)
stas_queue = Exchange("stas.queue", type="topic", durable=True)
stas_events = Exchange("stas.events", type="fanout", durable=True)
stas_dlx = Exchange("stas.dlx", type="direct", durable=True)
stas_quality = Exchange("stas.quality", type="topic", durable=True)

task_default_queue = "stas.agents.dispatch"
task_default_exchange = "stas.agents"
task_default_routing_key = "agent.runner"

task_queues = [
    # ── stas.agents exchange ──────────────────────────────────
    Queue("stas.agents.dispatch", stas_agents, routing_key="agent.runner"),
    Queue("stas.agents.verification", stas_agents, routing_key="agent.verify"),
    Queue("stas.agents.sandbox", stas_agents, routing_key="agent.sandbox"),
    Queue("stas.agents.self_audit", stas_agents, routing_key="agent.self_audit"),
    # ── stas.issues exchange ──────────────────────────────────
    Queue("stas.issues.triage", stas_issues, routing_key="triage.#"),
    Queue("stas.issues.health", stas_issues, routing_key="health.#"),
    # ── stas.queue exchange ───────────────────────────────────
    Queue("stas.queue.pr", stas_queue, routing_key="pr.create"),
    Queue("stas.queue.notifications", stas_queue, routing_key="queue.notify"),
    # ── stas.events exchange (fanout) ─────────────────────────
    Queue("stas.events.event_bus", stas_events),
    # ── stas.dlx exchange ─────────────────────────────────────
    Queue("stas.dlx.retry", stas_dlx, routing_key="dlq.retry"),
    Queue("stas.dlx.failed", stas_dlx, routing_key="dlq.failed"),
    Queue("stas.queue.orchestrator", stas_queue, routing_key="orchestrator.#"),
    Queue("stas.quality.enforce", stas_quality, routing_key="quality.enforce"),
]

task_routes = {
    "workers.tasks.triage.*": {"queue": "stas.issues.triage"},
    "workers.tasks.agent.*": {"queue": "stas.agents.dispatch"},
    "workers.tasks.sandbox.*": {"queue": "stas.agents.sandbox"},
    "workers.tasks.verification.*": {"queue": "stas.agents.verification"},
    "workers.tasks.pr_creation.*": {"queue": "stas.queue.pr"},
    "workers.tasks.notifications.*": {"queue": "stas.queue.notifications"},
    "workers.tasks.self_audit.*": {"queue": "stas.agents.self_audit"},
    "workers.tasks.linear_poll.*": {"queue": "stas.issues.triage"},
    "workers.tasks.pipeline_orchestrator.*": {"queue": "stas.queue.orchestrator"},
    "workers.tasks.anti_liar.*": {"queue": "stas.quality.enforce"},
    "workers.orchestrator.*": {"queue": "stas.queue.orchestrator"},
    # ── AIM-2022: Self-healing tasks ──────────────────────────
    "workers.tasks.periodic.self_healing_*": {"queue": "stas.issues.health"},
}
