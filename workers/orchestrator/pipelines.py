"""
Pipeline definitions for Celery canvas workflows.

Provides ``build_canvas``, ``get_pipeline``, and ``get_task_name``
functions used by the orchestrator dispatch engine.

Pipeline configs are dicts defining step sequences. Each step becomes
a Celery signature. The ``build_canvas`` function assembles them into
a ``chain`` ready for ``.delay()``.

Multi-tenant (AIM-2017):
    When ``ctx`` contains ``tenant_id``, all steps are routed to the per-tenant
    queue (``stas.agents.tenant.{tenant_id}``) by default.  Steps that explicitly
    set a ``queue`` in their config are left unchanged.
"""

import logging
from typing import Any

from celery import chain
from celery import signature as celery_sig

from workers.billing.tenant_isolation import TenantIsolationManager

logger = logging.getLogger(__name__)


def get_task_name(task_cfg: dict) -> str:
    return task_cfg.get("task", "")


def _build_sig(task_cfg: dict, ctx: dict) -> Any:
    task_name = get_task_name(task_cfg)
    merged_kwargs = dict(ctx)
    merged_kwargs.update(task_cfg.get("kwargs", {}))
    opts = {
        "immutable": task_cfg.get("immutable", True),
    }
    if task_cfg.get("queue"):
        opts["queue"] = task_cfg["queue"]
    elif ctx.get("tenant_id"):
        opts["queue"] = TenantIsolationManager.queue_name(ctx["tenant_id"])
    if task_cfg.get("countdown"):
        opts["countdown"] = task_cfg["countdown"]
    args = task_cfg.get("args", [])
    return celery_sig(task_name, args=args, kwargs=merged_kwargs, **opts)


def build_canvas(pipeline_cfg: dict, ctx: dict) -> chain:
    steps: list[dict] = pipeline_cfg.get("steps", [])
    if not steps:
        raise ValueError(f"Pipeline '{pipeline_cfg.get('name', '?')}' has no steps")

    sigs = [_build_sig(s, ctx) for s in steps]
    return chain(*sigs)


_PIPELINES: dict[str, dict] = {
    "stas:fix": {
        "name": "stas:fix",
        "label": "Fix Issue",
        "description": "Triage, workspace, agent, verify, audit, anti-mockup, sanitize, PR, notifications, review, cleanup",
        "max_attempts": 3,
        "concurrency_limit": 3,
        "steps": [
            {"task": "workers.tasks.triage.triage_issue"},
            {"task": "workers.orchestrator.workspace.create_workspace"},
            {"task": "workers.tasks.agent.dispatch_opencode"},
            {"task": "workers.tasks.verification.run_verification"},
            {"task": "workers.tasks.self_audit.run_self_audit"},
            {"task": "workers.quality.anti_mockup_scan.anti_mockup_scan"},
            {"task": "workers.gates.sanitizer.sanitize_agent_output"},
            {"task": "workers.tasks.pr_creation.create_pull_request"},
            {"task": "workers.tasks.notifications.dispatch_webhook_event",
             "kwargs": {"event_type": "fix_completed"}},
            {"task": "workers.tasks.self_audit.review_decision"},
            {"task": "workers.tasks.notifications.dispatch_webhook_event",
             "kwargs": {"event_type": "review_needed"}},
            {"task": "workers.orchestrator.workspace.cleanup_workspace"},
        ],
    },
    "stas:feature": {
        "name": "stas:feature",
        "label": "Feature Request",
        "description": "Same as fix but with feature-oriented agent prompt",
        "max_attempts": 3,
        "concurrency_limit": 3,
        "steps": [
            {"task": "workers.tasks.triage.triage_issue"},
            {"task": "workers.orchestrator.workspace.create_workspace"},
            {"task": "workers.tasks.agent.dispatch_opencode"},
            {"task": "workers.tasks.verification.run_verification"},
            {"task": "workers.tasks.self_audit.run_self_audit"},
            {"task": "workers.quality.anti_mockup_scan.anti_mockup_scan"},
            {"task": "workers.gates.sanitizer.sanitize_agent_output"},
            {"task": "workers.tasks.pr_creation.create_pull_request"},
            {"task": "workers.tasks.notifications.dispatch_webhook_event",
             "kwargs": {"event_type": "fix_completed"}},
            {"task": "workers.tasks.self_audit.review_decision"},
            {"task": "workers.tasks.notifications.dispatch_webhook_event",
             "kwargs": {"event_type": "review_needed"}},
            {"task": "workers.orchestrator.workspace.cleanup_workspace"},
        ],
    },
    "stas:research": {
        "name": "stas:research",
        "label": "Research / Investigation",
        "description": "Triage, workspace, agent (research), audit, cleanup — no PR",
        "max_attempts": 2,
        "concurrency_limit": 2,
        "steps": [
            {"task": "workers.tasks.triage.triage_issue"},
            {"task": "workers.orchestrator.workspace.create_workspace"},
            {"task": "workers.tasks.agent.dispatch_opencode"},
            {"task": "workers.tasks.self_audit.run_self_audit"},
            {"task": "workers.tasks.notifications.dispatch_webhook_event",
             "kwargs": {"event_type": "fix_completed"}},
            {"task": "workers.orchestrator.workspace.cleanup_workspace"},
        ],
    },
}


def get_pipeline(name: str) -> dict | None:
    return _PIPELINES.get(name)

STAGE_TASKS: dict[str, str] = {
    "triage": "workers.tasks.triage.triage_issue",
    "workspace": "workers.orchestrator.workspace.create_workspace",
    "agent": "workers.tasks.agent.dispatch_opencode",
    "verification": "workers.tasks.verification.run_verification",
    "self_audit": "workers.tasks.self_audit.run_self_audit",
    "anti_mockup": "workers.quality.anti_mockup_scan.anti_mockup_scan",
    "malicious_code_gate": "workers.gates.malicious_code_gate.malicious_code_gate",
    "sanitize": "workers.gates.sanitizer.sanitize_agent_output",
    "pr_creation": "workers.tasks.pr_creation.create_pull_request",
    "notification": "workers.tasks.notifications.dispatch_webhook_event",
    "review": "workers.tasks.self_audit.review_decision",
    "cleanup": "workers.orchestrator.workspace.cleanup_workspace",
}


def get_stage_task(stage: str) -> str:
    return STAGE_TASKS.get(stage, stage)

PIPELINES = _PIPELINES
