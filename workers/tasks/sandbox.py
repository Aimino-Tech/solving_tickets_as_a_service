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

    api_key = os.getenv("E2B_API_KEY", "")
    sandbox_svc_url = os.getenv("SANDBOX_SVC_URL", "")

    if not api_key and not sandbox_svc_url:
        raise RuntimeError(
            "Sandbox service required for fix execution. "
            "Set E2B_API_KEY or SANDBOX_SVC_URL to use Plan A (full Docker), "
            "or skip sandbox tasks in Plan B (containerless development)."
        )

    try:
        template_id = os.getenv("E2B_TEMPLATE_ID", "stas-default")
        timeout_ms = int(os.getenv("E2B_SANDBOX_TIMEOUT_MS", "300000"))

        if api_key:
            from e2b import Sandbox
            sandbox = Sandbox(template=template_id, api_key=api_key)
            sandbox_id = sandbox.id
            logger.info("Sandbox booted — id=%s", sandbox_id)
            return {"sandbox_id": sandbox_id, "repo_url": repo_url, "branch": branch}

        if sandbox_svc_url:
            import httpx
            with httpx.Client(base_url=sandbox_svc_url, timeout=30) as client:
                resp = client.post("/sandbox/acquire", json={"repo_url": repo_url, "branch": branch})
                resp.raise_for_status()
                result = resp.json()
                logger.info("Sandbox acquired via sandbox-svc — id=%s", result.get("containerId"))
                return result

        raise RuntimeError("No sandbox backend configured")
    except Exception as exc:
        logger.error("Sandbox boot failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
