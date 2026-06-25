"""
Redis-based issue claim mechanism for parallel worker deduplication.

Works like a distributed mutex: the first worker to ``claim()`` an issue
gets exclusive rights to process it.  Subsequent workers see ``False``
and should back off (the Celery task_prerun middleware raises ``Ignore``).

Key format: ``stas:claim:{issue_id}``
Value: ``worker_id`` (identifies who holds the claim)
Default TTL: 300 seconds (configurable via ``CLAIM_TTL`` env var).
"""

from __future__ import annotations

import logging
import os
from typing import Any

from celery import signals
from celery.exceptions import Ignore

logger = logging.getLogger(__name__)

DEFAULT_CLAIM_TTL = int(os.getenv("CLAIM_TTL", "300"))
_REDIS_KEY_TPL = "stas:claim:{issue_id}"

# ── Task routing ───────────────────────────────────────────────────────
# Same agent-dispatch task set used by pause_middleware and runaway guard.

_ALLOWED_TASKS: set[str] = {
    "workers.celery_app.ping",
    "workers.tasks.periodic.queue_health_check",
    "workers.tasks.periodic.dlq_cleanup",
    "workers.tasks.periodic.push_metrics",
    "workers.tasks.periodic.report_liveness",
    "workers.tasks.sandbox_gc.sandbox_gc",
    "workers.billing.usage.sync_usage_to_stripe",
}

_CLAIM_PREFIXES: tuple[str, ...] = (
    "workers.tasks.triage.",
    "workers.tasks.agent.",
    "workers.tasks.sandbox.",
    "workers.tasks.verification.",
    "workers.tasks.pr_creation.",
    "workers.tasks.notifications.",
    "workers.tasks.linear_poll.",
    "workers.tasks.pipeline_orchestrator.",
    "workers.tasks.merge_queue.",
    "workers.tasks.build_verify.",
    "workers.tasks.ci_polling.",
    "workers.tasks.dependency_resolver.",
    "workers.tasks.human_escalation.",
    "workers.tasks.multi_verification.",
    "workers.tasks.review_orchestrator.",
    "workers.tasks.visual_verification.",
    "workers.tasks.ticket_expander.",
    "workers.tasks.anti_liar.",
    "workers.tasks.auto_qa.",
    "workers.tasks.adversarial_review.",
    "workers.tasks.self_audit.",
    "workers.orchestrator.",
    "workers.quality.",
    "workers.merge_queue.",
)


def _is_claimable_task(task_name: str) -> bool:
    if task_name in _ALLOWED_TASKS:
        return False
    return any(task_name.startswith(prefix) for prefix in _CLAIM_PREFIXES)


def _extract_issue_id(task: Any, args: tuple, kwargs: dict) -> str | None:
    issue_id = kwargs.get("issue_id")
    if issue_id:
        return str(issue_id)

    ctx = kwargs.get("issue_context", {})
    if isinstance(ctx, dict):
        url = ctx.get("issue_url")
        if url:
            return str(url)
        num = ctx.get("issue_number")
        if num is not None:
            return str(num)

    if args and isinstance(args[0], dict):
        url = args[0].get("issue_url")
        if url:
            return str(url)
        num = args[0].get("issue_number")
        if num is not None:
            return str(num)

    ident = kwargs.get("identifier")
    if ident:
        return str(ident)

    pid = kwargs.get("pipeline_id") or kwargs.get("run_id")
    if pid:
        return str(pid)

    return None


class ClaimManager:
    """Redis-backed distributed claim manager."""

    def __init__(self) -> None:
        self._client: Any = None

    def _get_client(self) -> Any:
        if self._client is None:
            import redis as _redis_mod

            url = os.getenv(
                "REDIS_URL",
                os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
            )
            self._client = _redis_mod.from_url(
                url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        return self._client

    def claim(self, issue_id: str, worker_id: str, ttl: int = DEFAULT_CLAIM_TTL) -> bool:
        key = _REDIS_KEY_TPL.format(issue_id=issue_id)
        try:
            client = self._get_client()
            acquired = client.set(key, worker_id, nx=True, ex=ttl)
            if acquired:
                logger.debug("Claim acquired issue=%s worker=%s ttl=%d", issue_id, worker_id, ttl)
            else:
                logger.debug("Claim already held issue=%s (by another worker)", issue_id)
            return bool(acquired)
        except Exception as exc:
            logger.error("Claim acquire failed issue=%s worker=%s error=%s", issue_id, worker_id, exc)
            return True

    def release(self, issue_id: str) -> None:
        key = _REDIS_KEY_TPL.format(issue_id=issue_id)
        try:
            self._get_client().delete(key)
            logger.debug("Released claim issue=%s", issue_id)
        except Exception as exc:
            logger.warning("Claim release failed issue=%s error=%s", issue_id, exc)

    def get_claim(self, issue_id: str) -> str | None:
        key = _REDIS_KEY_TPL.format(issue_id=issue_id)
        try:
            return self._get_client().get(key)
        except Exception as exc:
            logger.error("Claim get failed issue=%s error=%s", issue_id, exc)
            return None

    def is_claimed(self, issue_id: str) -> bool:
        return self.get_claim(issue_id) is not None


_manager: ClaimManager | None = None


def get_claim_manager() -> ClaimManager:
    global _manager
    if _manager is None:
        _manager = ClaimManager()
    return _manager


_CM: ClaimManager | None = None


def claim(issue_id: str, worker_id: str = "default", ttl: int = DEFAULT_CLAIM_TTL) -> bool:
    global _CM
    if _CM is None:
        _CM = get_claim_manager()
    return _CM.claim(issue_id, worker_id, ttl)


@signals.task_prerun.connect
def _check_claim_before_task(
    task_id: str,
    task: Any,
    args: tuple,
    kwargs: dict,
    **signal_kwargs: Any,
) -> None:
    task_name = getattr(task, "name", None)
    if not task_name:
        return

    if not _is_claimable_task(task_name):
        return

    issue_id = _extract_issue_id(task, args, kwargs)
    if not issue_id:
        return

    mgr = get_claim_manager()
    worker_id = os.getenv("HOSTNAME", task_id)
    if not mgr.claim(issue_id, worker_id):
        logger.info(
            "Claim blocked duplicate task=%s issue=%s worker=%s task_id=%s",
            task_name,
            issue_id,
            worker_id,
            task_id,
        )
        raise Ignore()


@signals.task_postrun.connect
def _release_claim_after_task(
    task_id: str,
    task: Any,
    args: tuple,
    kwargs: dict,
    state: str,
    **signal_kwargs: Any,
) -> None:
    task_name = getattr(task, "name", None)
    if not task_name:
        return

    if not _is_claimable_task(task_name):
        return

    if state not in ("SUCCESS", "IGNORED"):
        return

    issue_id = _extract_issue_id(task, args, kwargs)
    if not issue_id:
        return

    get_claim_manager().release(issue_id)


def connect_claim_middleware() -> None:
    logger.info("Claim middleware connected")
