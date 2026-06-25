"""
Boot an E2B sandbox for code execution.

Uses the ``e2b`` SDK. Falls back to a placeholder when E2B_API_KEY is not set.
"""

import logging
import os

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.sandbox.boot_sandbox",
)
def boot_sandbox(self, repo_url: str, branch: str) -> dict:
    """
    Provision an E2B sandbox for the given repo.

    Returns the sandbox metadata (id, url, etc.) so downstream tasks can
    run code inside it.

    When E2B_API_KEY is unset, returns a placeholder sandbox_id and logs
    a warning — useful for development where the sandbox step can be skipped.
    """
    logger.info("Booting sandbox — repo=%s branch=%s", repo_url, branch)

    try:
        api_key = os.getenv("E2B_API_KEY", "")
        template_id = os.getenv("E2B_TEMPLATE_ID", "default")
        timeout_ms = int(os.getenv("E2B_SANDBOX_TIMEOUT_MS", "300000"))

        if not api_key:
            logger.warning(
                "E2B_API_KEY is not set — returning placeholder sandbox. "
                "Set E2B_API_KEY in .env to use real sandboxes."
            )
            return {
                "sandbox_id": "placeholder",
                "template_id": template_id,
                "repo_url": repo_url,
                "branch": branch,
                "status": "placeholder",
            }

        from e2b import Sandbox

        sandbox = Sandbox(
            template=template_id,
            api_key=api_key,
            timeout_ms=timeout_ms,
        )

        logger.info(
            "Sandbox booted — id=%s template=%s timeout=%dms",
            sandbox.id,
            template_id,
            timeout_ms,
        )

        return {
            "sandbox_id": sandbox.id,
            "template_id": template_id,
            "repo_url": repo_url,
            "branch": branch,
            "status": "running",
        }

    except ImportError:
        logger.error(
            "e2b package not installed. Install it with: pip install e2b"
        )
        raise self.retry(exc=ImportError("e2b package not installed"))

    except Exception as exc:
        logger.error("Sandbox boot failed — %s", exc, exc_info=True)

        # Check for common E2B errors and give helpful messages
        err_str = str(exc)
        if "template" in err_str.lower() and "not found" in err_str.lower():
            logger.error(
                "E2B template '%s' not found. "
                "Create it at https://e2b.dev/dashboard or set E2B_TEMPLATE_ID.",
                os.getenv("E2B_TEMPLATE_ID", "default"),
            )
        elif "api_key" in err_str.lower() or "unauthorized" in err_str.lower():
            logger.error(
                "E2B authentication failed. Check your E2B_API_KEY."
            )
        elif "timeout" in err_str.lower():
            logger.error(
                "E2B sandbox provisioning timed out. Try increasing "
                "E2B_SANDBOX_TIMEOUT_MS (currently %s).",
                os.getenv("E2B_SANDBOX_TIMEOUT_MS", "300000"),
            )

        raise self.retry(exc=exc)
