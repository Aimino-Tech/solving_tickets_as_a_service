"""
Run test verification inside an E2B sandbox or locally.

When a ``sandbox_id`` is provided and E2B_API_KEY is set, connects to the
sandbox and executes the test command there.  Otherwise falls back to running
the command locally via subprocess.
"""

import json
import logging
import os
import subprocess

from celery import shared_task

logger = logging.getLogger(__name__)

_COMMAND_TIMEOUT_S = 300


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.verification.run_verification",
    autoretry_for=(Exception,),
)
def run_verification(
    self,
    sandbox_id: str,
    test_command: str,
    correlation_id: str = "",
) -> dict:
    logger.info(
        json.dumps({
            "event": "verification.start",
            "sandbox_id": sandbox_id,
            "test_command": test_command,
            "correlation_id": correlation_id,
        })
    )

    try:
        api_key = os.getenv("E2B_API_KEY", "")

        if sandbox_id and api_key:
            result = _run_in_sandbox(sandbox_id, api_key, test_command, correlation_id)
        else:
            result = _run_locally(test_command, correlation_id)

        logger.info(
            json.dumps({
                "event": "verification.complete",
                "sandbox_id": sandbox_id,
                "passed": result["passed"],
                "output_length": len(result.get("output", "")),
                "correlation_id": correlation_id,
            })
        )

        return {
            "sandbox_id": sandbox_id,
            "test_command": test_command,
            "passed": result["passed"],
            "output": result["output"],
        }

    except subprocess.TimeoutExpired:
        logger.error(
            json.dumps({
                "event": "verification.timeout",
                "timeout_s": _COMMAND_TIMEOUT_S,
                "correlation_id": correlation_id,
            })
        )
        return {
            "sandbox_id": sandbox_id,
            "test_command": test_command,
            "passed": False,
            "output": f"TIMEOUT: command exceeded {_COMMAND_TIMEOUT_S}s",
        }

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "verification.error",
                "error": str(exc),
                "correlation_id": correlation_id,
            }),
            exc_info=True,
        )
        raise self.retry(exc=exc)


def _run_in_sandbox(
    sandbox_id: str,
    api_key: str,
    test_command: str,
    correlation_id: str,
) -> dict:
    """Run *test_command* inside the existing E2B sandbox."""
    from e2b import Sandbox

    sandbox = Sandbox.connect(
        sandbox_id=sandbox_id,
        api_key=api_key,
        timeout=_COMMAND_TIMEOUT_S,
    )

    logger.info(
        json.dumps({
            "event": "verification.sandbox_connected",
            "sandbox_id": sandbox_id,
            "correlation_id": correlation_id,
        })
    )

    cmd_result = sandbox.commands.run(
        test_command,
        timeout=_COMMAND_TIMEOUT_S,
    )

    output = cmd_result.stdout or ""
    if cmd_result.stderr:
        if output:
            output += "\n"
        output += cmd_result.stderr

    passed = cmd_result.exit_code == 0

    logger.info(
        json.dumps({
            "event": "verification.sandbox_result",
            "sandbox_id": sandbox_id,
            "exit_code": cmd_result.exit_code,
            "error": cmd_result.error,
            "correlation_id": correlation_id,
        })
    )

    return {"passed": passed, "output": output}


def _run_locally(
    test_command: str,
    correlation_id: str,
) -> dict:
    """Fallback: run *test_command* as a local subprocess."""
    logger.info(
        json.dumps({
            "event": "verification.local_fallback",
            "reason": "no sandbox_id or E2B_API_KEY not set",
            "correlation_id": correlation_id,
        })
    )

    proc = subprocess.run(
        test_command,
        shell=True,
        capture_output=True,
        text=True,
        timeout=_COMMAND_TIMEOUT_S,
    )

    output = proc.stdout or ""
    if proc.stderr:
        if output:
            output += "\n"
        output += proc.stderr

    passed = proc.returncode == 0

    logger.info(
        json.dumps({
            "event": "verification.local_result",
            "exit_code": proc.returncode,
            "correlation_id": correlation_id,
        })
    )

    return {"passed": passed, "output": output}
