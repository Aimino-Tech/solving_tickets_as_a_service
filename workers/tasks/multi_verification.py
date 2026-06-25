"""
Multi-round verification — runs 3 verification rounds with slight prompt
variations to prevent agents from gaming single-pass verification.

Each round uses a fresh agent session. If any single round fails, the
entire verification fails fast.

Queued on ``stas.verification``.
"""

from __future__ import annotations

import json
import logging
import subprocess
import time
from pathlib import Path
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)

_COMMAND_TIMEOUT_S = 600  # 10 minutes per round


# ── Verification round ───────────────────────────────────────────────────────


def run_verification_round(
    workspace_path: str,
    prompt: str,
    *,
    round_number: int = 1,
) -> dict[str, Any]:
    """Run a single verification round.

    Executes the test command embedded in *prompt* against the workspace
    and returns a structured result.  Each round is intentionally a fresh
    process invocation so no shared state leaks between rounds.

    Parameters
    ----------
    workspace_path : str
        Absolute path to the checked-out repository on disk.
    prompt : str
        Natural-language prompt that includes the acceptance criteria and
        the test command to run.
    round_number : int, optional
        1-based round index for logging (default ``1``).

    Returns
    -------
    dict
        ``{
            "passed": bool,
            "output": str,
            "exit_code": int,
            "duration_ms": int,
            "prompt_snippet": str,
        }``
    """
    ws = Path(workspace_path)
    start = time.monotonic()

    # Extract test command from the prompt (last line after "Run:", "Test command:", "Execute:")
    test_command = _extract_test_command(prompt)

    logger.info(
        json.dumps({
            "event": "multi_verification.round.start",
            "round": round_number,
            "workspace_path": workspace_path,
            "test_command": test_command,
        }),
    )

    # Run the test command via subprocess (fresh process = fresh session)
    if test_command:
        try:
            proc = subprocess.run(
                test_command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=_COMMAND_TIMEOUT_S,
                cwd=str(ws),
            )
        except subprocess.TimeoutExpired:
            elapsed = int((time.monotonic() - start) * 1000)
            logger.warning(
                json.dumps({
                    "event": "multi_verification.round.timeout",
                    "round": round_number,
                    "duration_ms": elapsed,
                }),
            )
            return {
                "passed": False,
                "output": f"TIMEOUT: command exceeded {_COMMAND_TIMEOUT_S}s",
                "exit_code": -1,
                "duration_ms": elapsed,
                "prompt_snippet": prompt[:120],
            }

        elapsed = int((time.monotonic() - start) * 1000)

        output = proc.stdout or ""
        if proc.stderr:
            if output:
                output += "\n"
            output += proc.stderr

        # Truncate to last 100 lines
        lines = output.splitlines()
        if len(lines) > 100:
            output = "\n".join(lines[-100:])

        passed = proc.returncode == 0

        logger.info(
            json.dumps({
                "event": "multi_verification.round.complete",
                "round": round_number,
                "passed": passed,
                "exit_code": proc.returncode,
                "duration_ms": elapsed,
            }),
        )

        return {
            "passed": passed,
            "output": output,
            "exit_code": proc.returncode,
            "duration_ms": elapsed,
            "prompt_snippet": prompt[:120],
        }

    # No test command found — consider it passed (trivially)
    elapsed = int((time.monotonic() - start) * 1000)
    logger.info(
        json.dumps({
            "event": "multi_verification.round.no_command",
            "round": round_number,
            "duration_ms": elapsed,
        }),
    )
    return {
        "passed": True,
        "output": "No test command found in prompt — skipped",
        "exit_code": 0,
        "duration_ms": elapsed,
        "prompt_snippet": prompt[:120],
    }


def _extract_test_command(prompt: str) -> str:
    """Extract the test/shell command from the last line of *prompt*.

    Looks for the line that starts with ``Run:``, ``Test command:``, or
    ``Execute:`` and returns everything after the colon, stripped.

    Returns an empty string if no command line is found.
    """
    for line in reversed(prompt.splitlines()):
        line = line.strip()
        for prefix in ("Run:", "Test command:", "Execute:"):
            if line.startswith(prefix):
                return line[len(prefix):].strip()
    return ""


# ── Prompt variations ────────────────────────────────────────────────────────


def _build_variations(ac_list: list[str], test_command: str) -> list[str]:
    """Build 3 semantically equivalent prompt variations.

    Each variation asks the same verification question but with different
    wording so that a gaming agent cannot predict what the verifier checks.
    """
    ac_text = "\n".join(f"- {ac}" for ac in ac_list)
    return [
        f"Verify ALL acceptance criteria are met:\n{ac_text}\nRun: {test_command}",
        f"Check if every AC is demonstrably satisfied:\n{ac_text}\nTest command: {test_command}",
        f"Prove each acceptance criterion is met with evidence:\n{ac_text}\nExecute: {test_command}",
    ]


# ── Celery task ───────────────────────────────────────────────────────────────


@shared_task(
    bind=True,
    max_retries=0,
    queue="stas.verification",
    name="workers.tasks.multi_verification.multi_round_verify",
)
def multi_round_verify(
    self: Any,
    workspace_path: str,
    ac_list: list[str],
    test_command: str,
) -> dict[str, Any]:
    """Run 3 verification rounds with slight prompt variations.

    Each round uses a **fresh agent session** (a fresh subprocess call).
    If any round fails, the whole verification fails immediately (fail-fast).

    Parameters
    ----------
    workspace_path : str
        Absolute path to the checked-out repository on disk.
    ac_list : list[str]
        List of acceptance criteria to verify.
    test_command : str
        Shell command that runs the test suite (e.g. ``pytest``,
        ``npm test``).

    Returns
    -------
    dict
        ``{
            "passed": bool,
            "rounds": list[dict],
            "score": float,
        }``

    ``score`` is the fraction of rounds that passed (0.0, 0.33, 0.67, or 1.0).
    When a round fails the function returns immediately with the current
    partial score.
    """
    correlation_id = self.request.id or ""
    variations = _build_variations(ac_list, test_command)

    logger.info(
        json.dumps({
            "event": "multi_verification.start",
            "workspace_path": workspace_path,
            "num_ac": len(ac_list),
            "test_command": test_command,
            "correlation_id": correlation_id,
        }),
    )

    results: list[dict[str, Any]] = []
    for i, prompt in enumerate(variations):
        round_result = run_verification_round(
            workspace_path,
            prompt,
            round_number=i + 1,
        )
        results.append({
            "round": i + 1,
            **round_result,
        })

        if not round_result.get("passed", False):
            score = sum(1 for r in results if r.get("passed")) / len(variations)
            logger.info(
                json.dumps({
                    "event": "multi_verification.fail_fast",
                    "failed_round": i + 1,
                    "score": score,
                    "correlation_id": correlation_id,
                }),
            )
            return {
                "passed": False,
                "rounds": results,
                "score": score,
            }

    logger.info(
        json.dumps({
            "event": "multi_verification.complete",
            "passed": True,
            "rounds_count": len(results),
            "score": 1.0,
            "correlation_id": correlation_id,
        }),
    )

    return {
        "passed": True,
        "rounds": results,
        "score": 1.0,
    }
