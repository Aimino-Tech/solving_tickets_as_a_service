import logging
import os

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.sandbox.boot_sandbox",
    autoretry_for=(Exception,),
)
def boot_sandbox(self, repo_url: str, branch: str) -> dict:
    logger.info("Booting sandbox — repo=%s branch=%s", repo_url, branch)
    try:
        api_key = os.getenv("E2B_API_KEY", "")
        template_id = os.getenv("E2B_TEMPLATE_ID", "stas-default")
        timeout_ms = int(os.getenv("E2B_SANDBOX_TIMEOUT_MS", "300000"))

        if api_key:
            from e2b import Sandbox
            sandbox = Sandbox(template=template_id, api_key=api_key)
            sandbox_id = sandbox.id
            logger.info("Sandbox booted — id=%s", sandbox_id)
            return {"sandbox_id": sandbox_id, "repo_url": repo_url, "branch": branch}
        else:
            logger.warning("No E2B_API_KEY set — returning placeholder sandbox")
            return {"sandbox_id": "placeholder", "repo_url": repo_url, "branch": branch}
    except Exception as exc:
        logger.error("Sandbox boot failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
