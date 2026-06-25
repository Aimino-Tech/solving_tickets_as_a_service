"""
Boot an E2B sandbox for code execution.

Uses the ``e2b`` SDK. Falls back to a placeholder when E2B_API_KEY is not set.
"""

import json
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
def boot_sandbox(self, repo_url: str, branch: str, correlation_id: str = "") -> dict:
    """
    Provision an E2B sandbox for the given repo.

    Returns the sandbox metadata (id, url, etc.) so downstream tasks can
    run code inside it.

    When E2B_API_KEY is unset, returns a placeholder sandbox_id and logs
    a warning — useful for development where the sandbox step can be skipped.
    """
    logger.info(
        json.dumps({
            "event": "sandbox.boot.start",
            "repo_url": repo_url,
            "branch": branch,
            "correlation_id": correlation_id,
        })
    )

    try:
        api_key = os.getenv("E2B_API_KEY", "")
        template_id = os.getenv("E2B_TEMPLATE_ID", "default")
        timeout_s = int(os.getenv("E2B_SANDBOX_TIMEOUT_MS", "300000")) // 1000

        if not api_key:
            logger.warning(
                json.dumps({
                    "event": "sandbox.boot.skipped",
                    "reason": "E2B_API_KEY not set",
                    "correlation_id": correlation_id,
                })
            )
            return {
                "sandbox_id": "placeholder",
                "template_id": template_id,
                "repo_url": repo_url,
                "branch": branch,
                "status": "placeholder",
            }

        from e2b import Sandbox

        sandbox = Sandbox.create(
            template=template_id,
            timeout=timeout_s,
            api_key=api_key,
        )

        logger.info(
            json.dumps({
                "event": "sandbox.boot.complete",
                "sandbox_id": sandbox.sandbox_id,
                "template_id": template_id,
                "timeout_s": timeout_s,
                "correlation_id": correlation_id,
            })
        )

        return {
            "sandbox_id": sandbox.sandbox_id,
            "template_id": template_id,
            "repo_url": repo_url,
            "branch": branch,
            "status": "running",
        }

    except ImportError:
        logger.error(
            json.dumps({
                "event": "sandbox.boot.error",
                "error": "e2b package not installed",
                "correlation_id": correlation_id,
            })
        )
        raise self.retry(exc=ImportError("e2b package not installed"))

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "sandbox.boot.error",
                "error": str(exc),
                "correlation_id": correlation_id,
            }),
            exc_info=True,
        )

        err_str = str(exc)
        if "template" in err_str.lower() and "not found" in err_str.lower():
            logger.error(
                json.dumps({
                    "event": "sandbox.boot.template_not_found",
                    "template_id": os.getenv("E2B_TEMPLATE_ID", "default"),
                    "correlation_id": correlation_id,
                })
            )
        elif "api_key" in err_str.lower() or "unauthorized" in err_str.lower():
            logger.error(
                json.dumps({
                    "event": "sandbox.boot.auth_failed",
                    "correlation_id": correlation_id,
                })
            )
        elif "timeout" in err_str.lower():
            logger.error(
                json.dumps({
                    "event": "sandbox.boot.timeout",
                    "timeout_s": timeout_s,
                    "correlation_id": correlation_id,
                })
            )

        raise self.retry(exc=exc)
