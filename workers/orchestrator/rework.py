"""
Rework loop support --- re-dispatches the agent with feedback context.

When a pipeline step fails (e.g. verification fails, self-audit finds missing
items, anti-mockup scan flags issues), the ``rework_loop`` task can be called
to re-dispatch the agent with accumulated feedback, up to a maximum of 3
attempts.

Design:
    - Rework attempts are tracked in Redis under
      ``pipeline:{pipeline_id}:rework_count``.
    - Feedback from failed steps is accumulated into a ``feedback_context``
      dict that is passed to the agent on the next attempt.
    - After exhausting ``MAX_REWORK_ATTEMPTS``, the pipeline is marked as
      ``failed`` with a descriptive error.
"""

import json
import logging
import os
import time
from typing import Any, Optional

from celery import shared_task

from workers.orchestrator.engine import _pipeline_state_key, _get_redis
from workers.tasks.agent import dispatch_opencode

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_REWORK_ATTEMPTS = int(os.getenv("PIPELINE_MAX_REWORK_ATTEMPTS", "3"))
_REWORK_COUNT_KEY_TEMPLATE = "pipeline:{pipeline_id}:rework_count"


# ---------------------------------------------------------------------------
# Rework Loop Task
# ---------------------------------------------------------------------------


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
        pipeline_id: The UUID of the pipeline being reworked.
        issue_id: The issue identifier (e.g. GitHub issue number).
        ctx: The original context dict from ``start_pipeline``.
        feedback: Feedback from the failed step(s).  Expected keys:
            - ``failures`` (list of str): human-readable failure descriptions.
            - ``step_results`` (dict): raw results from the failed step.
            - ``verification_output`` (str, optional): test output.
            - ``anti_mockup_findings`` (list, optional): findings flagged.

    Returns:
        A dict with the result of the re-dispatch attempt.
    """
    client = _get_redis()
    attempt = 1

    # -- Read / increment rework count --------------------------------
    if client:
        rework_key = _REWORK_COUNT_KEY_TEMPLATE.format(pipeline_id=pipeline_id)
        try:
            raw = client.get(rework_key)
            attempt = (int(raw) if raw else 0) + 1
            client.set(rework_key, str(attempt))
            client.expire(rework_key, 86400)  # 24h TTL
        except (ValueError, TypeError, Exception) as exc:
            logger.warning("Failed to read rework count --- %s", exc)

    # -- Check max attempts -------------------------------------------
    if attempt > MAX_REWORK_ATTEMPTS:
        error_msg = (
            f"Pipeline {pipeline_id} exceeded max rework attempts "
            f"({MAX_REWORK_ATTEMPTS}).  Last feedback: {feedback}"
        )
        logger.error(
            json.dumps({
                "event": "pipeline.rework.exhausted",
                "pipeline_id": pipeline_id,
                "issue_id": issue_id,
                "attempt": attempt,
                "max_attempts": MAX_REWORK_ATTEMPTS,
            })
        )

        # Mark pipeline as failed
        if client:
            try:
                raw = client.get(_pipeline_state_key(pipeline_id))
                if raw:
                    state = json.loads(raw)
                    state["status"] = "failed"
                    state["error"] = f"Exceeded {MAX_REWORK_ATTEMPTS} rework attempts"
                    state["rework_attempts"] = attempt
                    state["updated_at"] = time.time()
                    client.set(_pipeline_state_key(pipeline_id), json.dumps(state))
            except Exception as exc:
                logger.warning("Failed to update pipeline state after rework exhaustion --- %s", exc)

        return {
            "status": "failed",
            "pipeline_id": pipeline_id,
            "issue_id": issue_id,
            "attempt": attempt,
            "max_attempts": MAX_REWORK_ATTEMPTS,
            "error": error_msg,
        }

    # -- Build enhanced context with feedback -------------------------
    feedback_context = dict(ctx)
    feedback_context["_rework_attempt"] = attempt
    feedback_context["_rework_feedback"] = feedback
    feedback_context["_is_rework"] = True

    # Accumulate previous failures into the context
    previous_failures = ctx.get("_accumulated_failures", [])
    feedback_failures = feedback.get("failures", [])
    feedback_context["_accumulated_failures"] = previous_failures + feedback_failures

    # -- Update pipeline state ----------------------------------------
    if client:
        try:
            raw = client.get(_pipeline_state_key(pipeline_id))
            if raw:
                state = json.loads(raw)
                state["current_stage"] = f"rework_attempt_{attempt}"
                state["attempt"] = attempt
                state["status"] = "running"
                state["updated_at"] = time.time()
                client.set(_pipeline_state_key(pipeline_id), json.dumps(state))
        except Exception as exc:
            logger.warning("Failed to update pipeline state for rework --- %s", exc)

    logger.info(
        json.dumps({
            "event": "pipeline.rework.started",
            "pipeline_id": pipeline_id,
            "issue_id": issue_id,
            "attempt": attempt,
            "max_attempts": MAX_REWORK_ATTEMPTS,
            "failures": feedback.get("failures", []),
        })
    )

    # -- Re-dispatch agent --------------------------------------------
    try:
        issue_context = {
            "issue_id": issue_id,
            "issue_url": ctx.get("issue_url", ""),
            "triage_result": ctx.get("triage_result", {}),
            "_is_rework": True,
            "_rework_attempt": attempt,
            "_rework_feedback": feedback,
            "_accumulated_failures": feedback_context["_accumulated_failures"],
        }
        result = dispatch_opencode.run(issue_context)
        result["_rework_attempt"] = attempt
        result["_is_rework"] = True
        return result

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "pipeline.rework.agent_failed",
                "pipeline_id": pipeline_id,
                "issue_id": issue_id,
                "attempt": attempt,
                "error": str(exc),
            })
        )
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Helper: should rework?
# ---------------------------------------------------------------------------


def should_rework(step_result: dict) -> bool:
    """Determine if a step result warrants a rework attempt.

    Args:
        step_result: The result dict from a pipeline step.

    Returns:
        True if the result indicates a failure that could benefit from rework.
    """
    # Check for explicit failure signals
    if step_result.get("status") in ("failed", "error"):
        return True

    if step_result.get("passed") is False:
        return True

    if step_result.get("decision") == "rework":
        return True

    if step_result.get("failures"):
        return True

    # Verification failure
    if step_result.get("passed") is False and "output" in step_result:
        return True

    return False


# ---------------------------------------------------------------------------
# Helper: extract feedback from step result
# ---------------------------------------------------------------------------


def extract_feedback(step_name: str, step_result: dict) -> dict[str, Any]:
    """Extract structured feedback from a failed step result.

    Args:
        step_name: Human-readable name of the step that failed.
        step_result: The result dict from the pipeline step.

    Returns:
        A feedback dict suitable for passing to ``rework_loop``.
    """
    failures: list[str] = []

    # Collect failure reasons
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

    feedback: dict[str, Any] = {
        "failures": failures,
        "step_name": step_name,
        "step_results": step_result,
    }

    # Pass through useful diagnostic info
    if "output" in step_result:
        feedback["verification_output"] = step_result["output"][:2000]

    if "anti_mockup_findings" in step_result:
        feedback["anti_mockup_findings"] = step_result["anti_mockup_findings"]

    return feedback
