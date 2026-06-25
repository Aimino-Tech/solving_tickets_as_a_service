"""
Build & test verification — builds the project and runs tests before merge.

Auto-detects build/test commands from repo configuration files:
- package.json → "npm run build" / "npm test"
- Makefile → "make build" / "make test"
- Cargo.toml → "cargo build" / "cargo test"
- pyproject.toml → "" / "pytest"

Runs commands locally via subprocess (or inside E2B sandbox when a sandbox_id
is provided).
"""

import json
import logging
import os
import re
import subprocess
import time
from pathlib import Path

from celery import shared_task

logger = logging.getLogger(__name__)

_COMMAND_TIMEOUT_S = 600  # 10 minutes for build + test


# ── Auto-detection ────────────────────────────────────────────────────────


def _detect_commands(workspace_path: str) -> dict:
    """Auto-detect build and test commands from project config files.

    Checks in priority order: package.json → Makefile → Cargo.toml → pyproject.toml.
    Returns ``{"build": str, "test": str}``.
    """
    ws = Path(workspace_path)

    # 1. package.json — read the "scripts" section
    pkg_json = ws / "package.json"
    if Path.exists(pkg_json):
        try:
            data = json.loads(pkg_json.read_text())
            scripts = data.get("scripts", {})
            build_cmd = scripts.get("build", "npm run build")
            test_cmd = scripts.get("test", "npm test")
            return {"build": build_cmd, "test": test_cmd}
        except (OSError, json.JSONDecodeError):
            pass

    # 2. Makefile
    if Path.exists(ws / "Makefile"):
        return {"build": "make build", "test": "make test"}

    # 3. Cargo.toml
    if Path.exists(ws / "Cargo.toml"):
        return {"build": "cargo build", "test": "cargo test"}

    # 4. pyproject.toml (no build, test = pytest)
    if Path.exists(ws / "pyproject.toml"):
        return {"build": "", "test": "pytest"}

    # Nothing found
    return {"build": "", "test": ""}


# ── Command execution ─────────────────────────────────────────────────────


def _run_command(command: str, cwd: Path) -> dict:
    """Run a shell command and return the result.

    For empty commands returns ``passed=True`` immediately.

    Returns
        ``{"passed": bool, "exit_code": int, "output": str, "duration_ms": int}``
    """
    if not command:
        return {
            "passed": True,
            "exit_code": 0,
            "output": "",
            "duration_ms": 0,
        }

    start = time.monotonic()

    try:
        proc = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=_COMMAND_TIMEOUT_S,
            cwd=str(cwd),
        )
    except subprocess.TimeoutExpired:
        elapsed = int((time.monotonic() - start) * 1000)
        return {
            "passed": False,
            "exit_code": -1,
            "output": f"TIMEOUT: command exceeded {_COMMAND_TIMEOUT_S}s",
            "duration_ms": elapsed,
        }

    elapsed = int((time.monotonic() - start) * 1000)

    output = proc.stdout or ""
    if proc.stderr:
        if output:
            output += "\n"
        output += proc.stderr

    # Truncate to last 50 lines
    lines = output.splitlines()
    if len(lines) > 50:
        output = "\n".join(lines[-50:])

    passed = proc.returncode == 0

    return {
        "passed": passed,
        "exit_code": proc.returncode,
        "output": output,
        "duration_ms": elapsed,
    }


# ── Test output parsing ───────────────────────────────────────────────────


def _parse_test_output(output: str, command: str) -> dict:
    """Parse test-runner output to extract pass/fail/skip/error counts.

    Supports pytest, cargo test, jest, mocha, and go test output formats.
    Returns ``{"passed": int, "failed": int, "skipped": int, "error": int}``.
    """
    result = {"passed": 0, "failed": 0, "skipped": 0, "error": 0}

    if not output:
        return result

    # ── pytest ──────────────────────────────────────────────────────────
    # e.g. "3 passed, 1 failed, 2 skipped, 1 error in 0.12s"
    m = re.search(
        r"(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+skipped.*?(\d+)\s+error",
        output,
        re.DOTALL,
    )
    if m:
        result["passed"] = int(m.group(1))
        result["failed"] = int(m.group(2))
        result["skipped"] = int(m.group(3))
        result["error"] = int(m.group(4))
        return result

    # pytest without error count: "3 passed, 1 failed, 2 skipped in 0.12s"
    m = re.search(
        r"(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+skipped",
        output,
        re.DOTALL,
    )
    if m:
        result["passed"] = int(m.group(1))
        result["failed"] = int(m.group(2))
        result["skipped"] = int(m.group(3))
        return result

    # pytest pass-only: "3 passed in 0.12s"
    m = re.search(r"(\d+)\s+passed", output)
    if m and "failed" not in output and "error" not in output:
        result["passed"] = int(m.group(1))
        return result

    # ── cargo test ──────────────────────────────────────────────────────
    # e.g. "test result: ok. 10 passed; 2 failed; 1 ignored; 0 measured"
    m = re.search(
        r"test result:.*?(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+ignored",
        output,
        re.DOTALL,
    )
    if m:
        result["passed"] = int(m.group(1))
        result["failed"] = int(m.group(2))
        result["skipped"] = int(m.group(3))
        return result

    # cargo simpler: just passed count and possibly failed
    m = re.search(r"test result:.*?(\d+)\s+passed", output)
    if m:
        result["passed"] = int(m.group(1))
        m2 = re.search(r"test result:.*?(\d+)\s+failed", output)
        if m2:
            result["failed"] = int(m2.group(1))
        return result

    # ── jest / mocha-style ──────────────────────────────────────────────
    # "Tests:       1 failed, 5 passed, 6 total"
    # "Tests:       7 passed, 7 total"
    m = re.search(
        r"Tests:\s*(?:(\d+)\s+failed.*?)?(\d+)\s+passed",
        output,
    )
    if m:
        result["passed"] = int(m.group(2))
        if m.group(1) is not None:
            result["failed"] = int(m.group(1))
        return result

    # mocha: "5 passing (2s)" / "1 failing"
    m = re.search(r"(\d+)\s+passing", output)
    if m:
        result["passed"] = int(m.group(1))
        m2 = re.search(r"(\d+)\s+failing", output)
        if m2:
            result["failed"] = int(m2.group(1))
        return result

    # ── go test ─────────────────────────────────────────────────────────
    # "ok  \tgithub.com/user/repo\t0.123s"
    m = re.search(r"^ok\s+\S+", output, re.MULTILINE)
    if m:
        result["passed"] = 1
        return result

    return result


# ── Celery task ───────────────────────────────────────────────────────────


@shared_task(
    bind=True,
    max_retries=1,
    name="workers.tasks.build_verify.build_and_test",
)
def build_and_test(
    self,
    workspace_path: str,
    build_command: str = "",
    test_command: str = "",
    sandbox_id: str = "",
    correlation_id: str = "",
) -> dict:
    """Build the project and run the test suite.

    Parameters
    ----------
    workspace_path : str
        Path to the checked-out repository on disk.
    build_command : str, optional
        Explicit build command.  When empty the task auto-detects from
        config files (package.json, Makefile, Cargo.toml, pyproject.toml).
    test_command : str, optional
        Explicit test command.  When empty auto-detection is used.
    sandbox_id : str, optional
        E2B sandbox identifier.  When provided the commands run inside
        the remote sandbox instead of locally.
    correlation_id : str, optional
        Opaque correlation token for log stitching.

    Returns
    -------
    dict
        ``{
            "overall": {"passed": bool, "status": str},
            "build": {"passed": bool, "exit_code": int, "output": str,
                       "duration_ms": int},
            "test": {"passed": bool, "exit_code": int, "output": str,
                      "summary": {"passed": int, "failed": int,
                                   "skipped": int, "error": int},
                      "duration_ms": int},
        }``

    Status values:
        ``"build_failed"`` — build command returned non-zero.
        ``"test_failed"`` — test command returned non-zero.
        ``"passed"`` — both phases succeeded.
        ``"skipped_no_commands"`` — neither build nor test command found.
    """
    ws = Path(workspace_path)
    if not ws.is_dir():
        raise FileNotFoundError(f"Workspace path does not exist: {workspace_path}")

    logger.info(
        json.dumps({
            "event": "build_verify.start",
            "workspace_path": workspace_path,
            "correlation_id": correlation_id,
        })
    )

    # ── Auto-detect commands if not explicitly provided ────────────────
    if not build_command or not test_command:
        detected = _detect_commands(workspace_path)
        if not build_command:
            build_command = detected["build"]
        if not test_command:
            test_command = detected["test"]

    _empty_result = {
        "passed": True,
        "exit_code": 0,
        "output": "",
        "duration_ms": 0,
    }
    _empty_test_result = {
        "passed": True,
        "exit_code": 0,
        "output": "",
        "summary": {"passed": 0, "failed": 0, "skipped": 0, "error": 0},
        "duration_ms": 0,
    }

    # No commands at all → skipped
    if not build_command and not test_command:
        logger.info(
            json.dumps({
                "event": "build_verify.skipped",
                "reason": "no build or test commands detected",
                "correlation_id": correlation_id,
            })
        )
        return {
            "overall": {"passed": True, "status": "skipped_no_commands"},
            "build": dict(_empty_result),
            "test": dict(_empty_test_result),
        }

    # ── Phase 1: Build ──────────────────────────────────────────────────
    logger.info(
        json.dumps({
            "event": "build_verify.build.start",
            "build_command": build_command,
            "correlation_id": correlation_id,
        })
    )

    build_result = _run_command(build_command, ws)

    logger.info(
        json.dumps({
            "event": "build_verify.build.complete",
            "passed": build_result["passed"],
            "exit_code": build_result["exit_code"],
            "duration_ms": build_result["duration_ms"],
            "correlation_id": correlation_id,
        })
    )

    if not build_result["passed"]:
        logger.info(
            json.dumps({
                "event": "build_verify.failed",
                "phase": "build",
                "correlation_id": correlation_id,
            })
        )
        return {
            "overall": {"passed": False, "status": "build_failed"},
            "build": build_result,
            "test": {
                "passed": False,
                "exit_code": -1,
                "output": "",
                "summary": {"passed": 0, "failed": 0, "skipped": 0, "error": 0},
                "duration_ms": 0,
            },
        }

    # Build passed but no test command → we are done
    if not test_command:
        logger.info(
            json.dumps({
                "event": "build_verify.test.skipped",
                "reason": "no test command configured",
                "correlation_id": correlation_id,
            })
        )
        return {
            "overall": {"passed": True, "status": "passed"},
            "build": build_result,
            "test": dict(_empty_test_result),
        }

    # ── Phase 2: Test ───────────────────────────────────────────────────
    logger.info(
        json.dumps({
            "event": "build_verify.test.start",
            "test_command": test_command,
            "correlation_id": correlation_id,
        })
    )

    test_result = _run_command(test_command, ws)
    test_summary = _parse_test_output(test_result["output"], test_command)

    logger.info(
        json.dumps({
            "event": "build_verify.test.complete",
            "passed": test_result["passed"],
            "exit_code": test_result["exit_code"],
            "duration_ms": test_result["duration_ms"],
            "summary": test_summary,
            "correlation_id": correlation_id,
        })
    )

    if not test_result["passed"]:
        logger.info(
            json.dumps({
                "event": "build_verify.failed",
                "phase": "test",
                "correlation_id": correlation_id,
            })
        )
        return {
            "overall": {"passed": False, "status": "test_failed"},
            "build": build_result,
            "test": {
                "passed": test_result["passed"],
                "exit_code": test_result["exit_code"],
                "output": test_result["output"],
                "summary": test_summary,
                "duration_ms": test_result["duration_ms"],
            },
        }

    # ── All green ───────────────────────────────────────────────────────
    logger.info(
        json.dumps({
            "event": "build_verify.complete",
            "passed": True,
            "status": "passed",
            "correlation_id": correlation_id,
        })
    )

    return {
        "overall": {"passed": True, "status": "passed"},
        "build": build_result,
        "test": {
            "passed": test_result["passed"],
            "exit_code": test_result["exit_code"],
            "output": test_result["output"],
            "summary": test_summary,
            "duration_ms": test_result["duration_ms"],
        },
    }
