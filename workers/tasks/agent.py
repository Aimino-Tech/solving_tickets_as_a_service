import logging
import os

import httpx

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    name="workers.tasks.agent.dispatch_opencode",
)
def dispatch_opencode(self, issue_context: dict) -> dict:
    """Dispatch an issue to the OpenCode agent for investigation and fix."""
    logger.info("Dispatching OpenCode — issue=%s", issue_context.get("issue_number", "unknown"))
    opencode_url = os.getenv("OPENCODE_URL", "http://localhost:4096")
    try:
        with httpx.Client(timeout=600) as client:
            resp = client.post(
                f"{opencode_url}/run",
                json={
                    "issue": issue_context,
                    "model": os.getenv("OPENCODE_MODEL", "anthropic/claude-sonnet-4-20250514"),
                    "max_iterations": int(os.getenv("MAX_AGENT_ITERATIONS", "40")),
                },
            )
            resp.raise_for_status()
            result = resp.json()
            logger.info("OpenCode dispatch complete — status=%s", result.get("status", "unknown"))
            # The result may contain a pr_url if the agent created one directly
            pr_url = result.get("pr_url") or result.get("pull_request", {}).get("html_url")
            errors = result.get("errors") or (["Agent returned error status"] if result.get("status") == "error" else [])
            return {
                "issue_context": issue_context,
                "result": result,
                "pr_url": pr_url,
                "errors": errors,
            }
    except httpx.RequestError as exc:
        logger.error("OpenCode dispatch failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
