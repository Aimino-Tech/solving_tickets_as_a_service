import logging
import os
import subprocess
from typing import Any

from celery import shared_task

from workers.sandbox.env_sanitizer import SanitizedEnvironment

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.env_sanitization.sanitize_environment",
    autoretry_for=(Exception,),
)
def sanitize_environment(self, task_id: str, command: list[str] | None = None, allowlist: list[str] | None = None) -> dict[str, Any]:
    allowlist_set = set(allowlist or [])
    clean_env = SanitizedEnvironment.build(allowlist_set)

    logger.info("Sanitized environment for task=%s — %d vars passed, blocklist stripped", task_id, len(clean_env))

    if command:
        try:
            result = subprocess.run(
                command,
                env=clean_env,
                capture_output=True,
                text=True,
                timeout=60,
            )
            return {
                "task_id": task_id,
                "env_passed": list(clean_env.keys()),
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        except subprocess.TimeoutExpired:
            logger.warning("Command timed out for task=%s", task_id)
            return {"task_id": task_id, "error": "timeout"}
        except Exception as exc:
            logger.error("Command failed for task=%s — %s", task_id, exc)
            raise self.retry(exc=exc)

    return {
        "task_id": task_id,
        "env_passed": list(clean_env.keys()),
        "count": len(clean_env),
    }
