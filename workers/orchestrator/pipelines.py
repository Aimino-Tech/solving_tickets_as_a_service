"""
Pipeline definitions for Celery canvas workflows.

Provides ``build_canvas``, ``get_pipeline``, and ``get_task_name``
functions used by the orchestrator dispatch engine (``orchestrate.py``).

Pipeline configs are dicts defining step sequences. Each step becomes
a Celery signature. The ``build_canvas`` function assembles them into
a ``chain`` ready for ``.delay()``.
"""

import logging
from typing import Any

from celery import chain
from celery import signature as celery_sig

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Task name helper
# ---------------------------------------------------------------------------


def get_task_name(task_cfg: dict) -> str:
    """Extract task name from a step config dict."""
    return task_cfg.get("task", "")


# ---------------------------------------------------------------------------
# Signature builder
# ---------------------------------------------------------------------------


def _build_sig(task_cfg: dict, ctx: dict) -> Any:
    """Build a Celery signature from a step config, merging in context kwargs."""
    task_name = get_task_name(task_cfg)
    merged_kwargs = dict(ctx)
    merged_kwargs.update(task_cfg.get("kwargs", {}))
    opts = {
        "immutable": task_cfg.get("immutable", True),
    }
    if task_cfg.get("queue"):
        opts["queue"] = task_cfg["queue"]
    if task_cfg.get("countdown"):
        opts["countdown"] = task_cfg["countdown"]
    # Pass args if specified
    args = task_cfg.get("args", [])
    return celery_sig(task_name, args=args, kwargs=merged_kwargs, **opts)


# ---------------------------------------------------------------------------
# Canvas builder
# ---------------------------------------------------------------------------


def build_canvas(pipeline_cfg: dict, ctx: dict) -> chain:
    """Build a Celery chain from a pipeline config dict.

    Args:
        pipeline_cfg: Pipeline definition dict with a ``steps`` list.
        ctx: Context dict merged into every step's kwargs.

    Returns:
        A ``celery.chain`` that can be called with ``.delay()``.
    """
    steps: list[dict] = pipeline_cfg.get("steps", [])
    if not steps:
        raise ValueError(f"Pipeline '{pipeline_cfg.get('name', '?')}' has no steps")

    sigs = [_build_sig(s, ctx) for s in steps]
    return chain(*sigs)


# ---------------------------------------------------------------------------
# Pipeline registry
# ---------------------------------------------------------------------------

_PIPELINES: dict[str, dict] = {
    "stas:fix": {
        "name": "stas:fix",
        "label": "Fix Issue",
        "description": "Triage, workspace, agent, verify, audit, anti-mockup, PR, review, cleanup",
        "max_attempts": 3,
        "concurrency_limit": 3,
        "steps": [
            {"task": "workers.tasks.triage.triage_issue"},
            {"task": "workers.orchestrator.workspace.create_workspace"},
            {"task": "workers.tasks.agent.dispatch_opencode"},
            {"task": "workers.tasks.verification.run_verification"},
            {"task": "workers.tasks.self_audit.run_self_audit"},
            {"task": "workers.quality.anti_mockup_scan.anti_mockup_scan"},
            {"task": "workers.tasks.pr_creation.create_pull_request"},
            {"task": "workers.tasks.self_audit.review_decision"},
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
            {"task": "workers.tasks.pr_creation.create_pull_request"},
            {"task": "workers.tasks.self_audit.review_decision"},
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
            {"task": "workers.orchestrator.workspace.cleanup_workspace"},
        ],
    },
}


def get_pipeline(name: str) -> dict | None:
    """Return the pipeline config dict for *name*, or ``None``."""
    return _PIPELINES.get(name)
