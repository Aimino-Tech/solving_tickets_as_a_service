import json
import logging
import os
import subprocess

from celery import shared_task

logger = logging.getLogger(__name__)

OPENCODE_BIN = os.getenv("OPENCODE_BIN", "/home/xdn/.opencode/bin/opencode")


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    name="workers.tasks.agent.dispatch_opencode",
    autoretry_for=(Exception,),
)
def dispatch_opencode(self, issue_context: dict) -> dict:
    logger.info("Dispatching OpenCode — issue=%s", issue_context.get("issue_url", "unknown"))

    issue_url = issue_context.get("issue_url", "")
    triage = issue_context.get("triage_result", {})
    category = triage.get("category", "unknown")
    model = os.getenv("OPENCODE_MODEL", "deepseek-v4-flash")

    prompt = (
        f"Investigate and fix the GitHub issue at {issue_url}. "
        f"The issue was classified as a {category}. "
        "Clone the repo, understand the problem, implement a fix, "
        "run the existing tests, and create a pull request."
    )

    try:
        cmd = [OPENCODE_BIN, "run", prompt, "--model", model, "--print-logs"]
        logger.info("Running: %s", " ".join(cmd))

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=int(os.getenv("OPENCODE_TIMEOUT", "600")),
        )

        stdout = result.stdout or ""
        stderr = result.stderr or ""

        if result.returncode != 0:
            logger.error(
                "OpenCode CLI failed (rc=%d): %s",
                result.returncode,
                stderr[:500],
            )
            raise self.retry(exc=RuntimeError(f"OpenCode exited {result.returncode}"))

        logger.info("OpenCode dispatch successful (stdout=%d chars)", len(stdout))
        return {
            "issue_context": issue_context,
            "result": {
                "status": "completed",
                "stdout_preview": stdout[:2000],
                "stderr": stderr[:1000],
            },
        }

    except subprocess.TimeoutExpired:
        logger.error("OpenCode dispatch timed out")
        raise self.retry(exc=TimeoutError("OpenCode timed out"))
    except FileNotFoundError:
        logger.error("OpenCode binary not found at %s", OPENCODE_BIN)
        raise self.retry(exc=FileNotFoundError(f"OpenCode not found at {OPENCODE_BIN}"))
    except Exception as exc:
        logger.error("OpenCode dispatch failed — %s", exc)
        raise self.retry(exc=exc)
