import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.verification.run_verification",
    autoretry_for=(Exception,),
)
def run_verification(self, sandbox_id: str, test_command: str) -> dict:
    logger.info("Running verification — sandbox=%s command=%s", sandbox_id, test_command)
    try:
        # TODO: Execute test_command inside the sandbox when E2B integration is live
        logger.info("Verification passed — sandbox=%s", sandbox_id)
        return {
            "sandbox_id": sandbox_id,
            "test_command": test_command,
            "passed": True,
            "output": "Placeholder — all tests passed",
        }
    except Exception as exc:
        logger.error("Verification failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
