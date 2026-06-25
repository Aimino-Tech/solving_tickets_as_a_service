import logging
import os

from celery import current_app
from celery import shared_task

from workers.orchestrator.concurrency import AgentConcurrencyLimiter
from workers.orchestrator.pipelines import build_canvas, get_pipeline

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=None,
    default_retry_delay=10,
    name="workers.orchestrator.orchestrate.orchestrate_pipeline",
    autoretry_for=(Exception,),
)
def orchestrate_pipeline(
    self,
    issue_id: str,
    pipeline_name: str,
    ctx: dict | None = None,
    attempt: int = 0,
) -> dict:
    logger.info("Pipeline orchestration -- issue=%s pipeline=%s attempt=%d", issue_id, pipeline_name, attempt)
    if ctx is None:
        ctx = {}

    pipeline_cfg = get_pipeline(pipeline_name)
    if not pipeline_cfg:
        raise ValueError(f"Unknown pipeline: {pipeline_name}")

    max_attempts = pipeline_cfg.get("max_attempts", 3)
    if attempt >= max_attempts:
        logger.error("Rework limit exceeded -- issue=%s attempts=%d", issue_id, attempt)
        return {
            "status": "failed",
            "error": f"Rework limit exceeded ({max_attempts} attempts)",
            "issue_id": issue_id,
            "pipeline": pipeline_name,
            "attempt": attempt,
        }

    limiter = AgentConcurrencyLimiter(max_concurrent=pipeline_cfg.get("concurrency_limit", 3))

    if not limiter.acquire(issue_id):
        logger.info("Concurrency limit reached, re-queuing %s", issue_id)
        orchestrate_pipeline.apply_async(
            args=[issue_id, pipeline_name, ctx, attempt],
            countdown=15,
        )
        return {"status": "queued", "reason": "concurrency_limit", "issue_id": issue_id}

    try:
        canvas = build_canvas(pipeline_cfg, ctx or {})
        result = canvas.delay()
        pipeline_id = ctx.get("pipeline_id", issue_id)
        logger.info("Pipeline dispatched -- issue=%s pipeline_id=%s async_result=%s", issue_id, pipeline_id, result.id)
        return {
            "status": "running",
            "pipeline_id": pipeline_id,
            "async_result_id": result.id,
            "issue_id": issue_id,
        }
    except Exception as exc:
        logger.error("Pipeline dispatch failed -- %s", exc, exc_info=True)
        return {"status": "failed", "error": str(exc), "issue_id": issue_id}
    finally:
        limiter.release(issue_id)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    name="workers.orchestrator.orchestrate.rework_pipeline",
    autoretry_for=(Exception,),
)
def rework_pipeline(
    self,
    issue_id: str,
    pipeline_name: str,
    ctx: dict | None = None,
    attempt: int = 0,
    findings: list | None = None,
) -> dict:
    logger.info("Rework pipeline -- issue=%s attempt=%d findings=%d", issue_id, attempt, len(findings or []))
    rework_ctx = dict(ctx or {})
    rework_ctx["agent_feedback"] = findings or []
    rework_ctx["rework_attempt"] = attempt

    return orchestrate_pipeline.delay(
        issue_id=issue_id,
        pipeline_name=pipeline_name,
        ctx=rework_ctx,
        attempt=attempt + 1,
    )
