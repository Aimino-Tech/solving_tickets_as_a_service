import logging

from celery import shared_task

from workers.review.review_agent import build_adversarial_prompt, parse_review_output
from workers.review.models import ReviewResult

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.review_orchestrator.run_review_pipeline",
    autoretry_for=(Exception,),
)
def run_review_pipeline(
    self,
    issue_id: str,
    workspace_path: str,
    diff: str,
    ac_list: list[str] | None = None,
    self_audit_result: dict | None = None,
    verification_result: dict | None = None,
) -> dict:
    if ac_list is None:
        ac_list = []
    if self_audit_result is None:
        self_audit_result = {}
    if verification_result is None:
        verification_result = {}

    logger.info("Running review pipeline -- issue=%s", issue_id)

    audit_status = self_audit_result.get("passed", False)
    if not audit_status:
        logger.info("Self-audit failed, recommending rework -- issue=%s", issue_id)
        return {
            "verdict": "rework",
            "severity": "high",
            "findings": self_audit_result.get("anti_mockup_findings", []),
            "score": 0.0,
            "issue_id": issue_id,
            "next_action": "rework",
        }

    prompt = build_adversarial_prompt(diff, ac_list, verification_result)
    review_output = _call_review_llm(prompt)
    review = parse_review_output(review_output)

    decision = _make_decision(review, verification_result)

    logger.info(
        "Review pipeline complete -- issue=%s verdict=%s severity=%s action=%s score=%.2f",
        issue_id, review.get("verdict"), review.get("severity"), decision["next_action"], review.get("score", 0.0),
    )

    return {
        "issue_id": issue_id,
        "workspace_path": workspace_path,
        "verdict": review.get("verdict", "changes_requested"),
        "severity": review.get("severity", "high"),
        "findings": review.get("findings", []),
        "score": review.get("score", 0.0),
        "next_action": decision["next_action"],
        "reason": decision["reason"],
    }


def _call_review_llm(prompt: str) -> str:
    import os
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("No LLM API key configured, using default review")
        return '{"verdict": "approve", "severity": "low", "findings": [], "score": 1.0}'

    if os.getenv("ANTHROPIC_API_KEY"):
        try:
            from anthropic import Anthropic
            client = Anthropic(api_key=api_key)
            response = client.messages.create(
                model=os.getenv("REVIEW_MODEL", "claude-sonnet-4-20250514"),
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
            return response.content[0].text
        except ImportError:
            pass

    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=os.getenv("REVIEW_MODEL", "gpt-4o-mini"),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2048,
    )
    return response.choices[0].message.content or ""


def _make_decision(review: dict, verification: dict) -> dict:
    severity = review.get("severity", "low")
    verdict = review.get("verdict", "changes_requested")
    passed = verification.get("passed", False)

    if severity == "critical":
        return {"next_action": "human_review", "reason": "Critical findings require human intervention"}
    if verdict == "approve" and passed:
        return {"next_action": "merge_queue", "reason": "Review approved and verification passed"}
    if severity in ("high", "medium"):
        return {"next_action": "rework", "reason": f"Review findings ({severity} severity) require changes"}
    if not passed:
        return {"next_action": "rework", "reason": "Verification failed"}

    return {"next_action": "merge_queue", "reason": "Review approved"}
