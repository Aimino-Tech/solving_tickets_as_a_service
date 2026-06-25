from .kpi_etl import compute_daily_kpi
from .triage import triage_issue
from .agent import dispatch_opencode
from .sandbox import boot_sandbox
from .verification import run_verification, verify_agent_output
from .pr_creation import create_pull_request
from .notifications import send_notification, process_webhook
from .periodic import queue_health_check, dlq_cleanup, push_metrics, report_liveness, sla_compliance_check
from . import linear_poll
from .sandbox_gc import sandbox_gc
from .multi_verification import multi_round_verify
from .merge_queue import process_merge_queue, resolve_conflicts, label_conflict_pr

# Import status-comment signal handlers so they connect at worker start.
# (Import for side effect — the module registers Celery signal handlers.)
from workers.notifications import status_comments  # noqa: F401

__all__ = [
    "compute_daily_kpi",
    "triage_issue",
    "dispatch_opencode",
    "boot_sandbox",
    "run_verification",
    "verify_agent_output",
    "create_pull_request",
    "send_notification",
    "process_webhook",
    "queue_health_check",
    "dlq_cleanup",
    "push_metrics",
    "report_liveness",
    "sla_compliance_check",
    "sandbox_gc",
    "multi_round_verify",
    "process_merge_queue",
    "resolve_conflicts",
    "label_conflict_pr",
]
