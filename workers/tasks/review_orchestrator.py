"""Review orchestrator — runs self-audit, adversarial review, and decides next action."""

import json
import logging
import os

from celery import shared_task

logger = logging.getLogger(__name__)

REVIEW_STATES_KEY = "stas:review:processed"
REDIS_URL = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")


def _get_redis():
    try:
        import redis as redis_mod
        return redis_mod.from_url(REDIS_URL)
    except ImportError:
        return None


def _is_already_processed(issue_id: str) -> bool:
    r = _get_redis()
    if r:
        return r.sismember(REVIEW_STATES_KEY, issue_id)
    return False


def _mark_processed(issue_id: str) -> None:
    r = _get_redis()
    if r:
        r.sadd(REVIEW_STATES_KEY, issue_id)
        r.expire(REVIEW_STATES_KEY, 86400)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.review_orchestrator.run_review_pipeline",
    queue="stas.queue.review",
)
def run_review_pipeline(
    self,
    issue_id: str,
    workspace_path: str,
    self_audit_result: dict | None = None,
    verification_result: dict | None = None,
    diff: str | None = None,
    ac_list: list[str] | None = None,
) -> dict:
    logger.info("Starting review pipeline for %s", issue_id)
    if _is_already_processed(issue_id):
        logger.info("Review already processed for %s, skipping", issue_id)
        return {"status": "skipped", "reason": "already_processed"}
    try:
        from workers.review.review_agent import run_adversarial_review
        from workers.tasks.merge_queue import process_merge_queue

        review = run_adversarial_review(
            issue_id=issue_id,
            workspace_path=workspace_path,
            self_audit_result=self_audit_result,
            verification_result=verification_result,
            diff=diff,
            ac_list=ac_list,
        )
        logger.info(json.dumps({
            "event": "review.complete",
            "issue_id": issue_id,
            "verdict": review["verdict"],
            "severity": review["severity"],
            "findings_count": len(review.get("findings", [])),
        }))
        verification_passed = verification_result.get("passed", False) if verification_result else True

        if review["verdict"] == "approve" and verification_passed:
            logger.info("Review approved for %s — queueing merge", issue_id)
            process_merge_queue.delay(issue_id=issue_id, workspace_path=workspace_path, pr_url=verification_result.get("pr_url", "") if verification_result else "")
            _mark_processed(issue_id)
            return {"status": "approved", "action": "merge_queue", "review": review}
        elif review["severity"] == "critical":
            from workers.tasks.human_escalation import escalate_to_human
            escalate_to_human.delay(issue_id=issue_id, review_result=review, workspace_path=workspace_path)
            _mark_processed(issue_id)
            return {"status": "escalated", "action": "human_review", "review": review}
        else:
            logger.info("Review requested changes for %s — dispatching rework", issue_id)
            return {"status": "changes_requested", "action": "rework", "review": review}
    except Exception as exc:
        logger.error("Review pipeline failed for %s: %s", issue_id, exc, exc_info=True)
        raise self.retry(exc=exc)
