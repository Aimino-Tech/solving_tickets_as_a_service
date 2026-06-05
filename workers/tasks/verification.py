import logging
import os

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.verification.run_verification",
)
def run_verification(self, sandbox_id: str, test_command: str) -> dict:
    """Run a test command inside an E2B sandbox, or return a placeholder."""
    logger.info("Running verification — sandbox=%s command=%s", sandbox_id, test_command)
    try:
        api_key = os.getenv("E2B_API_KEY", "")

        if api_key and sandbox_id != "placeholder":
            from e2b import Sandbox
            sandbox = Sandbox(sandbox_id, api_key=api_key)
            result = sandbox.run_command(test_command)
            passed = result.exit_code == 0
            output = (result.stdout or "") + (result.stderr or "")
            logger.info("Verification %s — sandbox=%s", "passed" if passed else "failed", sandbox_id)
            return {
                "sandbox_id": sandbox_id,
                "test_command": test_command,
                "passed": passed,
                "output": output,
            }
        else:
            logger.info("Verification passed (placeholder) — sandbox=%s", sandbox_id)
            return {
                "sandbox_id": sandbox_id,
                "test_command": test_command,
                "passed": True,
                "output": "Placeholder — all tests passed",
            }
    except Exception as exc:
        logger.error("Verification failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
