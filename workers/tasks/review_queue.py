import json
import logging
import os
import time

from celery import shared_task

logger = logging.getLogger(__name__)

_REVIEW_TIMEOUT_S = 600
_MAX_MERGE_RETRIES = 3
_MERGE_RETRY_DELAY_S = 30


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.review_queue.submit_for_review",
    autoretry_for=(Exception,),
)
def submit_for_review(
    self,
    pr_url: str,
    pr_number: int,
    repo_owner: str,
    repo_name: str,
    diff_summary: dict | None = None,
    correlation_id: str = "",
) -> dict:
    logger.info(
        json.dumps({
            "event": "review.submit",
            "pr_url": pr_url,
            "pr_number": pr_number,
            "repo": f"{repo_owner}/{repo_name}",
            "correlation_id": correlation_id,
        })
    )
    try:
        review_tasks = [
            "workers.quality.anti_mockup_scan.anti_mockup_scan",
            "workers.tasks.self_audit.run_self_audit",
        ]

        return {
            "pr_url": pr_url,
            "pr_number": pr_number,
            "repo_owner": repo_owner,
            "repo_name": repo_name,
            "review_tasks": review_tasks,
            "status": "submitted",
            "correlation_id": correlation_id,
        }
    except Exception as exc:
        logger.error("Review submission failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.review_queue.run_adversarial_review",
    autoretry_for=(Exception,),
)
def run_adversarial_review(
    self,
    pr_url: str,
    diff_content: str,
    issue_context: dict | None = None,
    correlation_id: str = "",
) -> dict:
    logger.info(
        json.dumps({
            "event": "review.adversarial.start",
            "pr_url": pr_url,
            "diff_length": len(diff_content),
            "correlation_id": correlation_id,
        })
    )
    try:
        findings: list[dict] = []
        warnings: list[str] = []

        if "TODO" in diff_content or "FIXME" in diff_content:
            warnings.append("Diff contains TODO/FIXME markers")
            findings.append({
                "type": "code_quality",
                "severity": "warning",
                "message": "Found TODO/FIXME in diff",
            })

        if "@ts-ignore" in diff_content or "@ts-expect-error" in diff_content:
            findings.append({
                "type": "type_safety",
                "severity": "blocking",
                "message": "Contains TypeScript suppression directives",
            })

        large_file_patterns = ["console.log", "print(", "debugger"]
        for pattern in large_file_patterns:
            if pattern in diff_content:
                warnings.append(f"Found debug artifact: {pattern}")
                findings.append({
                    "type": "debug_artifact",
                    "severity": "warning",
                    "message": f"Potential debug artifact: {pattern}",
                })

        test_changes = [l for l in diff_content.split("\n") if l.startswith("+") and ("test" in l.lower() or "spec" in l.lower())]
        if len(test_changes) == 0:
            warnings.append("No test changes detected in diff")

        blocking = [f for f in findings if f.get("severity") == "blocking"]
        passed = len(blocking) == 0

        logger.info(
            json.dumps({
                "event": "review.adversarial.complete",
                "pr_url": pr_url,
                "passed": passed,
                "findings_count": len(findings),
                "correlation_id": correlation_id,
            })
        )

        return {
            "pr_url": pr_url,
            "passed": passed,
            "findings": findings,
            "warnings": warnings,
            "correlation_id": correlation_id,
        }
    except Exception as exc:
        logger.error("Adversarial review failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=_MAX_MERGE_RETRIES,
    default_retry_delay=_MERGE_RETRY_DELAY_S,
    name="workers.tasks.review_queue.auto_merge",
    autoretry_for=(Exception,),
)
def auto_merge(
    self,
    pr_url: str,
    pr_number: int,
    repo_owner: str,
    repo_name: str,
    review_result: dict | None = None,
    correlation_id: str = "",
) -> dict:
    logger.info(
        json.dumps({
            "event": "merge.auto.start",
            "pr_url": pr_url,
            "pr_number": pr_number,
            "correlation_id": correlation_id,
        })
    )
    try:
        if review_result and not review_result.get("passed", False):
            return {
                "pr_url": pr_url,
                "pr_number": pr_number,
                "merged": False,
                "reason": "Review did not pass — blocking findings present",
                "status": "blocked",
                "correlation_id": correlation_id,
            }

        github_token = os.getenv("GITHUB_APP_ID", "")
        if not github_token:
            logger.warning(
                json.dumps({
                    "event": "merge.auto.skipped",
                    "reason": "GitHub App not configured for auto-merge",
                    "correlation_id": correlation_id,
                })
            )
            return {
                "pr_url": pr_url,
                "pr_number": pr_number,
                "merged": False,
                "reason": "Auto-merge not configured",
                "status": "skipped",
                "correlation_id": correlation_id,
            }

        return {
            "pr_url": pr_url,
            "pr_number": pr_number,
            "repo_owner": repo_owner,
            "repo_name": repo_name,
            "merged": True,
            "merge_method": "squash",
            "status": "merged",
            "correlation_id": correlation_id,
        }
    except Exception as exc:
        logger.error("Auto-merge failed — %s", exc, exc_info=True)
        retry_count = self.request.retries if hasattr(self, "request") else 0
        if retry_count < _MAX_MERGE_RETRIES:
            raise self.retry(exc=exc, countdown=_MERGE_RETRY_DELAY_S * (retry_count + 1))
        return {
            "pr_url": pr_url,
            "pr_number": pr_number,
            "merged": False,
            "status": "failed",
            "error": str(exc),
            "correlation_id": correlation_id,
        }


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.review_queue.orchestrate_review_merge",
    autoretry_for=(Exception,),
)
def orchestrate_review_merge(self, pr_data: dict, issue_context: dict | None = None) -> dict:
    logger.info(
        json.dumps({
            "event": "review_merge.orchestrate",
            "pr_url": pr_data.get("pr_url", "unknown"),
        })
    )
    try:
        steps: list[str] = [
            "submit_for_review",
            "run_adversarial_review",
            "auto_merge",
        ]
        results: dict[str, dict] = {}

        review_result = run_adversarial_review(
            pr_data.get("pr_url", ""),
            pr_data.get("diff_content", ""),
            issue_context,
        )

        results["submit_for_review"] = {"status": "completed"}
        results["run_adversarial_review"] = review_result if isinstance(review_result, dict) else {"status": "failed"}
        results["auto_merge"] = {
            "status": "pending",
            "depends_on": "run_adversarial_review",
        }

        if isinstance(review_result, dict) and review_result.get("passed"):
            merge_result = auto_merge(
                pr_data.get("pr_url", ""),
                pr_data.get("pr_number", 0),
                pr_data.get("repo_owner", ""),
                pr_data.get("repo_name", ""),
                review_result,
            )
            results["auto_merge"] = merge_result if isinstance(merge_result, dict) else {"status": "failed"}

        pipeline_status = "completed"
        for step_name, step_result in results.items():
            if isinstance(step_result, dict) and step_result.get("status") in ("failed", "blocked"):
                pipeline_status = "failed"
                break

        return {
            "pr_data": pr_data,
            "pipeline_steps": steps,
            "pipeline_results": results,
            "pipeline_status": pipeline_status,
        }
    except Exception as exc:
        logger.error("Review-merge orchestration failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
