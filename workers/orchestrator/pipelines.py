"""
Pipeline definitions using Celery canvas primitives (chain, chord, group).
"""
from typing import Any, Callable
from celery import chain, chord
from celery.canvas import Signature

TASK_NAMES: dict[str, str] = {
    "triage": "workers.tasks.triage.triage_issue",
    "agent": "workers.tasks.agent.dispatch_opencode",
    "verify": "workers.tasks.verification.run_verification",
    "self_audit": "workers.tasks.self_audit.run_self_audit",
    "review": "workers.tasks.self_audit.review_decision",
    "pr": "workers.tasks.pr_creation.create_pull_request",
}

def _sig(name: str, *args: Any, **kwargs: Any) -> Signature:
    from celery import current_app as _app
    return _app.signature(name, args=args, kwargs=kwargs)

def build_fix_pipeline(issue_data: dict, ctx: dict[str, Any]) -> chain:
    return chain(
        _sig(TASK_NAMES["triage"], issue_data),
        chord(
            [_sig(TASK_NAMES["agent"], ctx)],
            chain(_sig(TASK_NAMES["verify"]), _sig(TASK_NAMES["self_audit"]), _sig(TASK_NAMES["review"]), _sig(TASK_NAMES["pr"])),
        ),
    )

def build_feature_pipeline(issue_data: dict, ctx: dict[str, Any]) -> chain:
    return build_fix_pipeline(issue_data, ctx)

def build_research_pipeline(issue_data: dict, ctx: dict[str, Any]) -> chain:
    return chain(_sig(TASK_NAMES["agent"], ctx))

PipelineBuilder = Callable[[dict, dict[str, Any]], chain]
PIPELINES: dict[str, PipelineBuilder] = {
    "stas:fix": build_fix_pipeline, "stas:feature": build_feature_pipeline, "stas:research": build_research_pipeline,
}

def get_pipeline(name: str) -> PipelineBuilder:
    b = PIPELINES.get(name)
    if b is None: raise ValueError(f"Unknown pipeline: {name!r}")
    return b

def get_stage_task(stage: str) -> str:
    return TASK_NAMES.get(stage, stage)
