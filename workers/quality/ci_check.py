"""
CI Check — Orchestrated code quality checks via Celery.

Runs 3 tools in sequence and returns structured results:
  - biome  — JS/TS lint & formatting
  - tsc    — TypeScript type checking (--noEmit)
  - ruff   — Python linting

Each tool runs as a separate subprocess. Results are aggregated into a
CiCheckResult with per-tool pass/fail, duration, and diagnostics.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

TIMEOUT_BIOME_S = int(os.environ.get("CI_CHECK_TIMEOUT_BIOME", "120"))
TIMEOUT_TSC_S = int(os.environ.get("CI_CHECK_TIMEOUT_TSC", "180"))
TIMEOUT_RUFF_S = int(os.environ.get("CI_CHECK_TIMEOUT_RUFF", "120"))


# ── Result Types ───────────────────────────────────────────────────────────────


@dataclass
class ToolResult:
    """Result from a single tool run."""

    tool: str
    passed: bool
    duration_ms: float = 0.0
    errors: list[str] = field(default_factory=list)
    output: str = ""
    details: str = ""


@dataclass
class CiCheckResult:
    """Aggregated result from all CI checks."""

    passed: bool
    results: list[ToolResult] = field(default_factory=list)
    total_duration_ms: float = 0.0


# ── Helpers ────────────────────────────────────────────────────────────────────


def _find_npx() -> str | None:
    """Find npx in PATH or node_modules/.bin."""
    for candidate in ["npx", f"{PROJECT_ROOT}/node_modules/.bin/npx"]:
        try:
            result = subprocess.run(
                [candidate, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                return candidate
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue
    return None


def _run_cmd(
    cmd: list[str],
    timeout_s: int,
    cwd: str | None = None,
) -> subprocess.CompletedProcess:
    """Run a command and return the CompletedProcess."""
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout_s,
        cwd=cwd or str(PROJECT_ROOT),
    )


def _run_biome(npx: str, changed_files: list[str] | None = None) -> ToolResult:
    """Run biome check on JS/TS files."""
    start = time.time()
    tool = "biome"

    try:
        if changed_files:
            ts_files = [f for f in changed_files if Path(f).suffix in {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}]
        else:
            ts_files = []

        if ts_files:
            cmd = [npx, "biome", "check"] + ts_files
        else:
            cmd = [npx, "biome", "check", "--changed", "--since", os.environ.get("BASE_BRANCH", "origin/main")]

        result = _run_cmd(cmd, TIMEOUT_BIOME_S)
        output = (result.stdout + result.stderr).strip()
        passed = result.returncode == 0

        errors: list[str] = []
        if not passed:
            for line in output.split("\n"):
                if "error" in line.lower() and ":" in line:
                    errors.append(line.strip())

        return ToolResult(
            tool=tool,
            passed=passed,
            duration_ms=(time.time() - start) * 1000,
            errors=errors[:20],
            output=output[:2000],
            details=f"biome check {'passed' if passed else 'failed'} ({len(errors)} error(s))",
        )
    except subprocess.TimeoutExpired:
        return ToolResult(
            tool=tool,
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"biome timed out after {TIMEOUT_BIOME_S}s",
        )
    except FileNotFoundError as e:
        return ToolResult(
            tool=tool,
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"biome not found: {e}",
        )


def _run_tsc(npx: str) -> ToolResult:
    """Run tsc --noEmit for TypeScript type checking."""
    start = time.time()
    tool = "tsc"

    try:
        result = _run_cmd([npx, "tsc", "--noEmit"], TIMEOUT_TSC_S)
        output = (result.stdout + result.stderr).strip()
        passed = result.returncode == 0

        errors: list[str] = []
        if not passed:
            for line in output.split("\n"):
                if "error TS" in line or "error " in line.lower():
                    errors.append(line.strip())

        return ToolResult(
            tool=tool,
            passed=passed,
            duration_ms=(time.time() - start) * 1000,
            errors=errors[:30],
            output=output[:3000],
            details=f"tsc --noEmit {'passed' if passed else 'failed'} ({len(errors)} error(s))",
        )
    except subprocess.TimeoutExpired:
        return ToolResult(
            tool=tool,
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"tsc timed out after {TIMEOUT_TSC_S}s",
        )
    except FileNotFoundError as e:
        return ToolResult(
            tool=tool,
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"tsc not found: {e}",
        )


def _find_ruff() -> str | None:
    """Find ruff executable."""
    for candidate in ["ruff", "workers/.venv/bin/ruff"]:
        try:
            result = subprocess.run(
                [candidate, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                return candidate
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue
    # Try python -m ruff
    try:
        result = subprocess.run(
            [sys.executable, "-m", "ruff", "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return f"{sys.executable} -m ruff"
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None


def _run_ruff(ruff_cmd: str, changed_files: list[str] | None = None) -> ToolResult:
    """Run ruff check on Python files."""
    start = time.time()
    tool = "ruff"

    try:
        py_files: list[str] = []
        if changed_files:
            py_files = [f for f in changed_files if f.endswith(".py")]

        if py_files:
            cmd = ruff_cmd.split() + ["check"] + py_files
        else:
            cmd = ruff_cmd.split() + ["check", "workers/"]

        result = _run_cmd(cmd, TIMEOUT_RUFF_S)
        output = (result.stdout + result.stderr).strip()
        passed = result.returncode == 0

        errors: list[str] = []
        if not passed:
            for line in output.split("\n"):
                if line.strip() and any(c in line for c in ("E", "F", "W", "C")):
                    errors.append(line.strip())

        return ToolResult(
            tool=tool,
            passed=passed,
            duration_ms=(time.time() - start) * 1000,
            errors=errors[:20],
            output=output[:2000],
            details=f"ruff check {'passed' if passed else 'failed'} ({len(errors)} error(s))",
        )
    except subprocess.TimeoutExpired:
        return ToolResult(
            tool=tool,
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"ruff timed out after {TIMEOUT_RUFF_S}s",
        )
    except FileNotFoundError as e:
        return ToolResult(
            tool=tool,
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"ruff not found: {e}",
        )


# ── Orchestrator ───────────────────────────────────────────────────────────────


def run_all_checks(
    changed_files: list[str] | None = None,
    *,
    skip_biome: bool = False,
    skip_tsc: bool = False,
    skip_ruff: bool = False,
) -> CiCheckResult:
    """
    Run all 3 CI checks: biome, tsc, ruff.

    Args:
        changed_files: If provided, only check these files (per-tool filtering applied).
        skip_biome: Skip biome check.
        skip_tsc: Skip tsc check.
        skip_ruff: Skip ruff check.

    Returns:
        CiCheckResult with per-tool results.
    """
    start = time.time()
    results: list[ToolResult] = []

    npx = _find_npx()
    ruff_cmd = _find_ruff()

    # ── biome ──
    if not skip_biome:
        if npx:
            results.append(_run_biome(npx, changed_files))
        else:
            results.append(ToolResult(tool="biome", passed=False, details="npx not found — cannot run biome"))

    # ── tsc ──
    if not skip_tsc:
        if npx:
            results.append(_run_tsc(npx))
        else:
            results.append(ToolResult(tool="tsc", passed=False, details="npx not found — cannot run tsc"))

    # ── ruff ──
    if not skip_ruff:
        if ruff_cmd:
            results.append(_run_ruff(ruff_cmd, changed_files))
        else:
            results.append(ToolResult(tool="ruff", passed=False, details="ruff not found — install with 'pip install ruff'"))

    all_passed = all(r.passed for r in results)
    return CiCheckResult(
        passed=all_passed,
        results=results,
        total_duration_ms=(time.time() - start) * 1000,
    )


# ── Celery Task ────────────────────────────────────────────────────────────────


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.quality.ci_check.check_ci",
    autoretry_for=(Exception,),
)
def check_ci(
    self,
    changed_files: list[str] | None = None,
    *,
    skip_biome: bool = False,
    skip_tsc: bool = False,
    skip_ruff: bool = False,
) -> dict[str, Any]:
    """
    Celery task — run all 3 CI checks and return structured results.

    Args:
        changed_files: Optional list of changed file paths to scope checks.
        skip_biome: Skip biome check.
        skip_tsc: Skip tsc check.
        skip_ruff: Skip ruff check.

    Returns:
        Dict with 'passed' (bool), 'results' (list), 'total_duration_ms' (float).
    """
    logger.info(
        "CI check starting — changed_files=%s skip=[biome=%s tsc=%s ruff=%s]",
        len(changed_files) if changed_files else 0,
        skip_biome,
        skip_tsc,
        skip_ruff,
    )
    try:
        result = run_all_checks(
            changed_files=changed_files,
            skip_biome=skip_biome,
            skip_tsc=skip_tsc,
            skip_ruff=skip_ruff,
        )

        output = _result_to_dict(result)
        logger.info(
            "CI check completed — passed=%s total_duration_ms=%.0f",
            output["passed"],
            output["total_duration_ms"],
        )
        return output
    except Exception as exc:
        logger.error("CI check failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)


def _result_to_dict(result: CiCheckResult) -> dict[str, Any]:
    """Convert CiCheckResult to a JSON-serializable dict."""
    return {
        "passed": result.passed,
        "total_duration_ms": round(result.total_duration_ms, 2),
        "results": [
            {
                "tool": r.tool,
                "passed": r.passed,
                "duration_ms": round(r.duration_ms, 2),
                "errors": r.errors[:10],
                "details": r.details,
            }
            for r in result.results
        ],
    }
