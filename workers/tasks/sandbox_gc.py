import logging
import os

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    autoretry_for=(Exception,),
    name="workers.tasks.sandbox_gc.sandbox_gc",
)
def sandbox_gc(self) -> dict:
    """
    Periodic task (every 10 min) to sweep stale sandbox containers.
    Calls the Node.js admin API to trigger the GC.
    """
    import httpx

    gc_url = os.getenv("SYNTARO_GC_SWEEP_URL", "http://localhost:3000/admin/gc/sweep")
    admin_key = os.getenv("ADMIN_API_KEY", "")
    logger.info("Running sandbox GC sweep — url=%s", gc_url)

    try:
        headers = {}
        if admin_key:
            headers["Authorization"] = f"Bearer {admin_key}"

        resp = httpx.post(gc_url, json={}, headers=headers, timeout=30)
        resp.raise_for_status()
        result = resp.json()

        logger.info(
            "Sandbox GC sweep complete — cleaned=%d",
            result.get("cleaned", 0),
        )

        return {
            "cleaned": result.get("cleaned", 0),
            "timestamp": result.get("timestamp", ""),
        }
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            logger.warning("GC sweep endpoint not available (404) — skipping")
            return {"cleaned": 0, "skip": True}
        logger.error("GC sweep failed — %s", exc)
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("GC sweep request failed — %s", exc)
        raise self.retry(exc=exc)
