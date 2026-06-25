"""
Rework loop support — re-dispatches agents with feedback context.

When a pipeline step fails, the rework loop can re-dispatch the agent
with accumulated feedback. Tracks attempts in Redis to enforce a
maximum retry limit (default: 3 attempts).
"""

import json
import logging
import os
import time
from typing import Any, Optional

from celery import shared_task

from workers.tasks.agent import dispatch_opencode

logger = logging.getLogger(__name__)

MAX_REWORK_ATTEMPTS = int(os.getenv("PIPELINE_MAX_REWORK_ATTEMPTS", "3"))
_REWORK_KEY_TPL = "pipeline:{pipeline_id}:rework_count"


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=15,
    name="workers.orchestrator.rework.rework_loop",
    autoretry_for=(Exception,),
)
def rework_loop(
    self,
    pipeline_id: str,
    issue_id: str,
    ctx: dict[str, Any],
    feedback: dict[str, Any],
) -> dict:
    """Re-dispatch the agent with accumulated feedback.

    Args:
        pipeline_id: UUID of the pipeline.
        issue_id: Issue identifier.
        ctx: Original context dict.
        feedback: Feedback dict with ``failures``, ``step_results``, etc.

    Returns:
        Result dict with status and rework metadata.
    """
    client = _get_redis()
    attempt = 1

    if client:
        rework_key = _REWORK_KEY_TPL.format(pipeline_id=pipeline_id)
        try:
            raw = client.get(rework_key)
            attempt = (int(raw) if raw else 0) + 1
            client.set(rework_key, str(attempt))
            client.expire(rework_key, 86400)
        except Exception as exc:
            logger.warning("Failed to read/write rework count --- %s", exc)

    if attempt > MAX_REWORK_ATTEMPTS:
        error_msg = f"Pipeline {pipeline_id} exceeded max rework attempts ({MAX_REWORK_ATTEMPTS})"
        logger.error(json.dumps({"event": "rework.exhausted", "pipeline_id": pipeline_id, "issue_id": issue_id, "attempt": attempt, "max": MAX_REWORK_ATTEMPTS}))
        if client:
            _set_state(client, pipeline_id, {"status": "failed", "error": error_msg, "rework_attempts": attempt})
        return {"status": "failed", "pipeline_id": pipeline_id, "issue_id": issue_id, "attempt": attempt, "error": error_msg}

    feedback_ctx = dict(ctx)
    feedback_ctx["_rework_attempt"] = attempt
    feedback_ctx["_rework_feedback"] = feedback
    feedback_ctx["_is_rework"] = True
    prev_failures = ctx.get("_accumulated_failures", [])
    feedback_ctx["_accumulated_failures"] = prev_failures + feedback.get("failures", [])

    if client:
        _set_state(client, pipeline_id, {"current_stage": f"rework_attempt_{attempt}", "attempt": attempt, "status": "running"})

    logger.info(json.dumps({"event": "rework.started", "pipeline_id": pipeline_id, "issue_id": issue_id, "attempt": attempt, "failures": feedback.get("failures", [])}))

    try:
        issue_context = {
            "issue_id": issue_id,
            "issue_url": ctx.get("issue_url", ""),
            "triage_result": ctx.get("triage_result", {}),
            "_is_rework": True,
            "_rework_attempt": attempt,
            "_rework_feedback": feedback,
            "_accumulated_failures": feedback_ctx["_accumulated_failures"],
        }
        result = dispatch_opencode.run(issue_context)
        result["_rework_attempt"] = attempt
        result["_is_rework"] = True
        return result
    except Exception as exc:
        logger.error(json.dumps({"event": "rework.agent_failed", "pipeline_id": pipeline_id, "issue_id": issue_id, "error": str(exc)}))
        raise self.retry(exc=exc)


def should_rework(step_result: dict) -> bool:
    """Determine if a step result warrants rework."""
    if step_result.get("status") in ("failed", "error"):
        return True
    if step_result.get("passed") is False:
        return True
    if step_result.get("decision") == "rework":
        return True
    if step_result.get("failures"):
        return True
    return False


def extract_feedback(step_name: str, step_result: dict) -> dict[str, Any]:
    """Extract structured feedback from a failed step."""
    failures: list[str] = []
    if step_result.get("failures"):
        failures.extend(step_result["failures"])
    if step_result.get("error"):
        failures.append(step_result["error"])
    if step_result.get("decision") == "rework":
        failures.append(f"Step '{step_name}' returned decision=rework")
    if step_result.get("passed") is False:
        failures.append(f"Step '{step_name}' reported passed=False")
    if not failures:
        failures.append(f"Step '{step_name}' failed with unknown reason")

    feedback: dict[str, Any] = {"failures": failures, "step_name": step_name, "step_results": step_result}
    if "output" in step_result:
        feedback["verification_output"] = step_result["output"][:2000]
    if "anti_mockup_findings" in step_result:
        feedback["anti_mockup_findings"] = step_result["anti_mockup_findings"]
    return feedback


def _get_redis() -> Optional[Any]:
    try:
        import redis as _redis_mod
        url = os.getenv("REDIS_URL", os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"))
        return _redis_mod.from_url(url, decode_responses=True)
    except Exception:
        return None


def _set_state(client: Any, pipeline_id: str, updates: dict) -> None:
    try:
        raw = client.get(f"pipeline:{pipeline_id}:state")
        if raw:
            state = json.loads(raw)
            state.update(updates)
            state["updated_at"] = time.time()
            client.set(f"pipeline:{pipeline_id}:state", json.dumps(state))
    except Exception:
        pass
