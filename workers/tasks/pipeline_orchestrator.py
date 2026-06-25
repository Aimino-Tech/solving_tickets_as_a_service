"""
Pipeline orchestration Celery tasks.
"""
import logging
from typing import Any
from celery import Task, shared_task
from workers.orchestrator.engine import get_engine

logger = logging.getLogger(__name__)

@shared_task(bind=True, max_retries=None, default_retry_delay=10, name="workers.tasks.pipeline_orchestrator.orchestrate_pipeline", autoretry_for=(Exception,))
def orchestrate_pipeline(self: Task, issue_id: str, pipeline_name: str, ctx: dict[str, Any] | None = None, attempt: int = 0) -> dict[str, Any]:
    ctx = dict(ctx or {})
    ctx.setdefault("issue_id", issue_id)
    ctx["attempt"] = attempt
    engine = get_engine()
    max_attempts = 3
    if attempt >= max_attempts:
        return {"pipeline_id": ctx.get("pipeline_id", ""), "issue_id": issue_id, "status": "failed", "reason": "max_attempts_exceeded", "attempt": attempt}
    if attempt > 0:
        fb = ctx.get("_rework_feedback", {}).get("failures", [])
        if fb: ctx["agent_feedback"] = f"Previous attempt {attempt} failed: {'; '.join(fb)}"
    pipeline_id = engine.start_pipeline(issue_id, pipeline_name, ctx)
    return {"pipeline_id": pipeline_id, "issue_id": issue_id, "status": "started", "attempt": attempt + 1, "pipeline_name": pipeline_name}
