"""
Verification task — runs the agent's changes against the project's test suite
in a sandboxed Docker environment.
"""

import json
import logging
import os
from typing import Any

from celery import shared_task

from workers.sandbox.runner import SandboxRunner, SandboxError, SandboxTimeoutError
from workers.verification_config import (
    DEFAULT_CPU_LIMIT,
    DEFAULT_MEMORY_LIMIT,
    DEFAULT_TIMEOUT_SECONDS,
    MIN_PASS_RATE,
    MIN_SCORE,
    SANDBOX_NETWORK_DISABLED,
    SANDBOX_READ_ONLY_ROOTFS,
    SCORE_WEIGHT_AC_COVERAGE,
    SCORE_WEIGHT_TEST_PASS_RATE,
    SECCOMP_PROFILE,
    APPARMOR_PROFILE,
)

logger = logging.getLogger(__name__)


def _estimate_ac_coverage(ac_list: list[str], test_output: str) -> float:
    """Estimate what fraction of ACs are covered by tests using keyword matching."""
    if not ac_list:
        return 1.0

    output_lower = test_output.lower()
    matched = 0

    for ac in ac_list:
        stopwords = {
            "the", "this", "that", "with", "from", "have", "been",
            "should", "would", "could", "will", "must", "than",
            "into", "about", "after", "before", "during", "while",
        }
        words = [
            w for w in ac.lower().split()
            if len(w) >= 4 and w not in stopwords
        ]
        if not words:
            matched += 1
            continue

        if any(w in output_lower for w in words):
            matched += 1

    return matched / len(ac_list)


def _compute_score(test_pass_rate: float, ac_coverage: float) -> tuple[float, bool]:
    """Compute the final verification score and overall pass verdict."""
    score = (
        test_pass_rate * SCORE_WEIGHT_TEST_PASS_RATE
        + ac_coverage * SCORE_WEIGHT_AC_COVERAGE
    )
    passed = test_pass_rate >= MIN_PASS_RATE and score >= MIN_SCORE
    return round(score, 4), passed


# ── Celery tasks ────────────────────────────────────────────────────────────


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.verification.run_verification",
    autoretry_for=(SandboxError,),
    acks_late=True,
)
def run_verification(
    self,
    sandbox_id: str = "",
    test_command: str = "",
) -> dict:
    """Legacy verification task. Delegates to verify_agent_output."""
    return verify_agent_output(
        issue_id=sandbox_id,
        workspace_path="",
        test_command=test_command,
        ac_list=[],
    )


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.verification.verify_agent_output",
    autoretry_for=(SandboxError,),
    acks_late=True,
)
def verify_agent_output(
    self,
    issue_id: str,
    workspace_path: str,
    test_command: str = "",
    ac_list: list[str] | None = None,
) -> dict[str, Any]:
    """Verify agent output by running tests in a Docker sandbox.

    Parameters
    ----------
    issue_id
        Issue or ticket identifier for correlation.
    workspace_path
        Path to the cloned repository on disk.
    test_command
        Test command to run. Auto-detected when empty.
    ac_list
        List of acceptance criteria strings.

    Returns
    -------
    dict with keys: issue_id, passed, score, summary, sandbox, evidence, status
    """
    ac_list = ac_list or []
    logger.info(
        "Verifying agent output — issue=%s workspace=%s command=%s ac_count=%d",
        issue_id, workspace_path, test_command or "(auto)", len(ac_list),
    )

    try:
        runner = SandboxRunner(
            timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
            memory_limit=DEFAULT_MEMORY_LIMIT,
            cpu_limit=DEFAULT_CPU_LIMIT,
            seccomp_profile=SECCOMP_PROFILE or None,
            apparmor_profile=APPARMOR_PROFILE or None,
            read_only_rootfs=SANDBOX_READ_ONLY_ROOTFS,
            network_disabled=SANDBOX_NETWORK_DISABLED,
        )

        result = runner.run_tests(
            workspace_path=workspace_path,
            test_command=test_command,
            capture_json=True,
            capture_xml=True,
            container_name=f"stas-verify-{issue_id[:16]}" if issue_id else "",
        )

    except SandboxTimeoutError:
        logger.error("Sandbox timed out for issue %s", issue_id)
        return _build_error_result(
            issue_id=issue_id,
            status="timeout",
            error_message=f"Test execution exceeded {DEFAULT_TIMEOUT_SECONDS}s",
        )
    except SandboxError as exc:
        logger.error("Sandbox error for issue %s: %s", issue_id, exc)
        return _build_error_result(
            issue_id=issue_id,
            status="sandbox_error",
            error_message=str(exc),
        )
    except FileNotFoundError as exc:
        logger.error("Workspace not found for issue %s: %s", issue_id, exc)
        return _build_error_result(
            issue_id=issue_id,
            status="workspace_error",
            error_message=str(exc),
        )

    ac_coverage = _estimate_ac_coverage(ac_list, result.raw_output)
    test_pass_rate = result.summary.pass_rate
    score, passed = _compute_score(test_pass_rate, ac_coverage)

    status = "passed" if passed else "failed"

    logger.info(
        json.dumps({
            "event": "verification.complete",
            "issue_id": issue_id,
            "status": status,
            "score": score,
            "test_pass_rate": test_pass_rate,
            "ac_coverage": ac_coverage,
            "total_tests": result.summary.total,
            "duration_ms": result.duration_ms,
            "timed_out": result.timed_out,
        })
    )

    return {
        "issue_id": issue_id,
        "passed": passed,
        "score": score,
        "summary": {
            "test_pass_rate": test_pass_rate,
            "ac_coverage": ac_coverage,
            "total_tests": result.summary.total,
            "passed_tests": result.summary.passed,
            "failed_tests": result.summary.failed,
            "skipped_tests": result.summary.skipped,
            "error_tests": result.summary.error,
        },
        "sandbox": {
            "exit_code": result.exit_code,
            "timed_out": result.timed_out,
            "duration_ms": result.duration_ms,
        },
        "evidence": {
            "raw_output_preview": result.raw_output[:2000],
            "error_message": result.error_message,
        },
        "status": status,
    }


def _build_error_result(
    issue_id: str,
    status: str,
    error_message: str,
) -> dict[str, Any]:
    """Build a structured error result."""
    return {
        "issue_id": issue_id,
        "passed": False,
        "score": 0.0,
        "summary": {
            "test_pass_rate": 0.0,
            "ac_coverage": 0.0,
            "total_tests": 0,
            "passed_tests": 0,
            "failed_tests": 0,
            "skipped_tests": 0,
            "error_tests": 0,
        },
        "sandbox": {
            "exit_code": -1,
            "timed_out": status == "timeout",
            "duration_ms": 0,
        },
        "evidence": {
            "raw_output_preview": "",
            "error_message": error_message,
        },
        "status": status,
    }
