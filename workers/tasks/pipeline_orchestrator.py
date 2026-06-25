import logging
from typing import Any

from celery import Task

from workers.celery_app import app
from workers.orchestrator.engine import get_engine
from workers.orchestrator.pipelines import get_pipeline

logger = logging.getLogger(__name__)


@app.task(bind=True, queue="stas.queue.orchestrator", max_retries=None)
def orchestrate_pipeline(
    self: Task,
    issue_id: str,
    pipeline_name: str,
    ctx: dict[str, Any] | None = None,
    attempt: int = 0,
) -> dict[str, Any]:
    max_attempts = 3
    ctx = ctx or {}
    ctx["issue_id"] = issue_id
    ctx["attempt"] = attempt

    engine = get_engine()
    pipeline_id = engine.start_pipeline(issue_id, pipeline_name, ctx)

    if attempt > 0:
        ctx["agent_feedback"] = f"Rework attempt {attempt}/{max_attempts}"

    stages = get_pipeline(pipeline_name)
    logger.info(
        "Pipeline %s attempt %d/%d — stages=%s",
        pipeline_id, attempt + 1, max_attempts, stages,
    )

    if attempt >= max_attempts:
        logger.warning("Max attempts reached for issue %s, failing pipeline", issue_id)
        return {
            "pipeline_id": pipeline_id,
            "issue_id": issue_id,
            "status": "failed",
            "reason": "max_attempts_exceeded",
        }

    return {
        "pipeline_id": pipeline_id,
        "issue_id": issue_id,
        "status": "started",
        "attempt": attempt + 1,
    }


@app.task(bind=True, queue="stas.queue.orchestrator")
def pipeline_task(self: Task, **kwargs: Any) -> dict[str, Any]:
    return {"status": "completed", **kwargs}
