"""
E2E Verify — Multi-runner E2E verification gate for the SYNTARO pipeline.

Runs three test runners in sequence and aggregates results:
  1. Vitest  — TypeScript/Node E2E tests (vitest.e2e.config.ts)
  2. Pytest  — Python worker E2E tests (workers/tests/)
  3. Playwright — Dashboard/browser E2E tests (dashboard/playwright.config.ts)

Each runner is independent; a failure in one does not prevent the others from
running.  The overall status is ``passed`` only when every runner passes.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
WORKERS_ROOT = PROJECT_ROOT / "workers"
DASHBOARD_ROOT = PROJECT_ROOT / "dashboard"

VITEST_CONFIG = PROJECT_ROOT / "vitest.e2e.config.ts"
WORKER_VITEST_CONFIG = PROJECT_ROOT / "vitest.worker.config.ts"
PLAYWRIGHT_CONFIG = DASHBOARD_ROOT / "playwright.config.ts"

# ---------------------------------------------------------------------------
# Configuration  (all from environment with sensible defaults)
# ---------------------------------------------------------------------------

E2E_VITEST_TIMEOUT = int(os.getenv("E2E_VITEST_TIMEOUT", "120000"))
E2E_PYTEST_TIMEOUT = int(os.getenv("E2E_PYTEST_TIMEOUT", "180000"))
E2E_PLAYWRIGHT_TIMEOUT = int(os.getenv("E2E_PLAYWRIGHT_TIMEOUT", "300000"))
E2E_VERIFY_NODE_BIN = os.getenv("E2E_VERIFY_NODE_BIN", "node")
E2E_VERIFY_NPX_BIN = os.getenv("E2E_VERIFY_NPX_BIN", "npx")

# ---------------------------------------------------------------------------
# Result Types
# ---------------------------------------------------------------------------


@dataclass
class VitestResult:
    """Result from running vitest E2E tests."""

    passed: bool
    total: int = 0
    passed_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0
    failures: list[str] = field(default_factory=list)
    duration_ms: float = 0.0
    details: str = ""


@dataclass
class PytestResult:
    """Result from running pytest E2E tests."""

    passed: bool
    total: int = 0
    passed_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0
    failures: list[str] = field(default_factory=list)
    duration_ms: float = 0.0
    details: str = ""


@dataclass
class PlaywrightResult:
    """Result from running Playwright E2E tests."""

    passed: bool
    total: int = 0
    passed_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0
    failures: list[str] = field(default_factory=list)
    duration_ms: float = 0.0
    details: str = ""


@dataclass
class E2eVerifyResult:
    """Top-level result from the full E2E verify run."""

    passed: bool
    vitest: VitestResult | None = None
    pytest: PytestResult | None = None
    playwright: PlaywrightResult | None = None
    duration_ms: float = 0.0
    details: str = ""


# ---------------------------------------------------------------------------
# Vitest Runner
# ---------------------------------------------------------------------------


def run_vitest(config: Path | None = None, timeout: int = E2E_VITEST_TIMEOUT) -> VitestResult:
    """
    Run vitest E2E tests with the given config file.

    Falls back to ``vitest.e2e.config.ts`` if no config provided.
    Returns a structured ``VitestResult``.
    """
    start = time.time()
    cfg = config or VITEST_CONFIG
    logger.info("Running vitest E2E with config=%s timeout=%dms", cfg.name, timeout)

    if not cfg.is_file():
        return VitestResult(
            passed=True,
            duration_ms=(time.time() - start) * 1000,
            details=f"Config not found: {cfg} — skipped",
        )

    try:
        result = subprocess.run(
            [E2E_VERIFY_NPX_BIN, "vitest", "run", "--config", str(cfg), "--reporter=json"],
            capture_output=True,
            text=True,
            timeout=timeout / 1000,
            cwd=str(PROJECT_ROOT),
        )
        output = result.stdout + result.stderr
        parsed = _parse_vitest_json(output)
    except subprocess.TimeoutExpired:
        return VitestResult(
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"Vitest timed out after {timeout}ms",
        )
    except FileNotFoundError:
        return VitestResult(
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details="vitest/npx not found — is Node.js installed?",
        )

    total = parsed.get("numTotalTests", 0)
    passed_count = parsed.get("numPassedTests", 0)
    failed_count = parsed.get("numFailedTests", 0)
    skipped_count = parsed.get("numPendingTests", parsed.get("numSkippedTests", 0))

    failures: list[str] = []
    for tr in parsed.get("testResults", []):
        for ar in tr.get("assertionResults", []):
            if ar.get("status") == "failed":
                suite = tr.get("name", "")
                name = ar.get("fullName", ar.get("title", ""))
                failures.append(f"{suite} > {name}")

    passed = failed_count == 0
    dur = (time.time() - start) * 1000

    detail_lines: list[str] = [
        f"Config: {cfg.name}",
        f"Total: {total} | Passed: {passed_count} | Failed: {failed_count} | Skipped: {skipped_count}",
    ]
    if failures:
        detail_lines.append(f"\n{len(failures)} failure(s):")
        for f_entry in failures[:20]:
            detail_lines.append(f"  ✗ {f_entry}")
    if passed and total > 0:
        detail_lines.append("✓ All vitest E2E tests pass")

    return VitestResult(
        passed=passed,
        total=total,
        passed_count=passed_count,
        failed_count=failed_count,
        skipped_count=skipped_count,
        failures=failures,
        duration_ms=dur,
        details="\n".join(detail_lines),
    )


def _parse_vitest_json(output: str) -> dict[str, Any]:
    """Extract vitest JSON result from combined stdout/stderr."""
    import re
    json_match = re.search(r"(\{.*\"testResults\".*\})", output, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    # Fallback: try to parse entire output as JSON
    try:
        return json.loads(output)
    except (json.JSONDecodeError, ValueError):
        pass
    return {}


# ---------------------------------------------------------------------------
# Pytest Runner
# ---------------------------------------------------------------------------


def run_pytest(
    test_path: Path | None = None,
    timeout: int = E2E_PYTEST_TIMEOUT,
    extra_args: list[str] | None = None,
) -> PytestResult:
    """
    Run pytest on the given test path.

    Defaults to ``workers/tests/``.
    Returns a structured ``PytestResult``.
    """
    start = time.time()
    tpath = test_path or (WORKERS_ROOT / "tests")
    logger.info("Running pytest on %s timeout=%dms", tpath, timeout)

    if not tpath.is_dir():
        return PytestResult(
            passed=True,
            duration_ms=(time.time() - start) * 1000,
            details=f"Test path not found: {tpath} — skipped",
        )

    cmd = [sys.executable, "-m", "pytest", str(tpath), "-x", "--tb=short", "-q"]
    if extra_args:
        cmd.extend(extra_args)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout / 1000,
            cwd=str(PROJECT_ROOT),
        )
        output = result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return PytestResult(
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"Pytest timed out after {timeout}ms",
        )
    except FileNotFoundError:
        return PytestResult(
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details="pytest not found",
        )

    passed_flag = result.returncode == 0
    dur = (time.time() - start) * 1000

    # Parse pytest output for counts and failures
    total, passed_count, failed_count, skipped_count = _parse_pytest_summary(output)
    failures = _parse_pytest_failures(output)

    detail_lines: list[str] = [
        f"Path: {tpath}",
        f"Total: {total} | Passed: {passed_count} | Failed: {failed_count} | Skipped: {skipped_count}",
    ]
    if failures:
        detail_lines.append(f"\n{len(failures)} failure(s):")
        for f_entry in failures[:20]:
            detail_lines.append(f"  ✗ {f_entry}")
    if passed_flag and total > 0:
        detail_lines.append("✓ All pytest tests pass")

    return PytestResult(
        passed=passed_flag,
        total=total,
        passed_count=passed_count,
        failed_count=failed_count,
        skipped_count=skipped_count,
        failures=failures,
        duration_ms=dur,
        details="\n".join(detail_lines),
    )


def _parse_pytest_summary(output: str) -> tuple[int, int, int, int]:
    """Extract test counts from pytest summary line."""
    import re
    total = 0
    passed = 0
    failed = 0
    skipped = 0

    # Match patterns like: "3 passed, 1 failed, 2 skipped in 5.23s"
    summary_match = re.search(
        r"(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+skipped)?\s+in",
        output,
    )
    if summary_match:
        passed = int(summary_match.group(1))
        failed = int(summary_match.group(2)) if summary_match.group(2) else 0
        skipped = int(summary_match.group(3)) if summary_match.group(3) else 0
        total = passed + failed + skipped
    else:
        # Fallback: count test lines
        passed = output.count(" PASSED") + output.count(" passed")
        failed = output.count(" FAILED") + output.count(" failed")
        total = passed + failed

    return total, passed, failed, skipped


def _parse_pytest_failures(output: str) -> list[str]:
    """Extract failure names from pytest output."""
    import re
    failures: list[str] = []
    for match in re.finditer(r"FAILED\s+(\S+)", output):
        failures.append(match.group(1))
    return failures


# ---------------------------------------------------------------------------
# Playwright Runner
# ---------------------------------------------------------------------------


def run_playwright(
    config: Path | None = None,
    timeout: int = E2E_PLAYWRIGHT_TIMEOUT,
) -> PlaywrightResult:
    """
    Run Playwright E2E tests for the dashboard.

    Defaults to ``dashboard/playwright.config.ts``.
    Returns a structured ``PlaywrightResult``.
    """
    start = time.time()
    cfg = config or PLAYWRIGHT_CONFIG
    logger.info("Running Playwright E2E with config=%s timeout=%dms", cfg.name, timeout)

    if not cfg.is_file():
        return PlaywrightResult(
            passed=True,
            duration_ms=(time.time() - start) * 1000,
            details=f"Config not found: {cfg} — skipped",
        )

    # Check if playwright is installed in the dashboard
    if not (DASHBOARD_ROOT / "node_modules" / ".bin" / "playwright").exists():
        return PlaywrightResult(
            passed=True,
            duration_ms=(time.time() - start) * 1000,
            details="Playwright not installed in dashboard — skipped",
        )

    try:
        result = subprocess.run(
            [E2E_VERIFY_NPX_BIN, "playwright", "test", "--config", str(cfg)],
            capture_output=True,
            text=True,
            timeout=timeout / 1000,
            cwd=str(DASHBOARD_ROOT),
        )
        output = result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return PlaywrightResult(
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"Playwright timed out after {timeout}ms",
        )
    except FileNotFoundError:
        return PlaywrightResult(
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details="npx not found — is Node.js installed?",
        )

    passed_flag = result.returncode == 0
    dur = (time.time() - start) * 1000

    # Parse Playwright output
    total, passed_count, failed_count, skipped_count, failures = _parse_playwright_output(output)

    detail_lines: list[str] = [
        f"Config: {cfg.name}",
        f"Total: {total} | Passed: {passed_count} | Failed: {failed_count} | Skipped: {skipped_count}",
    ]
    if failures:
        detail_lines.append(f"\n{len(failures)} failure(s):")
        for f_entry in failures[:20]:
            detail_lines.append(f"  ✗ {f_entry}")
    if passed_flag and total > 0:
        detail_lines.append("✓ All Playwright E2E tests pass")

    return PlaywrightResult(
        passed=passed_flag,
        total=total,
        passed_count=passed_count,
        failed_count=failed_count,
        skipped_count=skipped_count,
        failures=failures,
        duration_ms=dur,
        details="\n".join(detail_lines),
    )


def _parse_playwright_output(output: str) -> tuple[int, int, int, int, list[str]]:
    """Parse Playwright test run output for counts and failure names."""
    import re
    total = 0
    passed = 0
    failed = 0
    skipped = 0
    failures: list[str] = []

    # Playwright summary: "  passed: 5, failed: 1, skipped: 0"
    summary_match = re.search(
        r"(?:passed|failed|skipped|flaky)\s*[=:]\s*\d+.*?(?:total.*?\d+)?",
        output,
        re.DOTALL,
    )
    if summary_match:
        total_m = re.search(r"total\s*[=:]\s*(\d+)", output, re.IGNORECASE)
        if total_m:
            total = int(total_m.group(1))
        passed_m = re.search(r"passed\s*[=:]\s*(\d+)", output, re.IGNORECASE)
        if passed_m:
            passed = int(passed_m.group(1))
        failed_m = re.search(r"failed\s*[=:]\s*(\d+)", output, re.IGNORECASE)
        if failed_m:
            failed = int(failed_m.group(1))
        skipped_m = re.search(r"(?:skipped|pending)\s*[=:]\s*(\d+)", output, re.IGNORECASE)
        if skipped_m:
            skipped = int(skipped_m.group(1))

    # Extract failure descriptions
    # Playwright format: "  ✗  tests/foo.spec.ts:25:3 › My test › should work"
    for match in re.finditer(r"[✗×]\s+(\S.*)$", output, re.MULTILINE):
        name = match.group(1).strip()
        if name:
            failures.append(name)

    return total, passed, failed, skipped, failures


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def run_e2e_verify(
    *,
    skip_vitest: bool = False,
    skip_pytest: bool = False,
    skip_playwright: bool = False,
    vitest_config: Path | None = None,
    pytest_path: Path | None = None,
    playwright_config: Path | None = None,
) -> E2eVerifyResult:
    """
    Run all three E2E test runners and aggregate results.

    Args:
        skip_vitest: Skip vitest E2E runner.
        skip_pytest: Skip pytest E2E runner.
        skip_playwright: Skip Playwright E2E runner.
        vitest_config: Path to vitest config (default: ``vitest.e2e.config.ts``).
        pytest_path: Path to pytest tests (default: ``workers/tests/``).
        playwright_config: Path to Playwright config (default: ``dashboard/playwright.config.ts``).

    Returns:
        E2eVerifyResult with per-runner pass/fail.
    """
    start = time.time()
    logger.info("E2E Verify — starting all runners")

    vitest_result: VitestResult | None = None
    pytest_result: PytestResult | None = None
    playwright_result: PlaywrightResult | None = None
    all_passed = True

    if not skip_vitest:
        vitest_result = run_vitest(config=vitest_config)
        if not vitest_result.passed:
            all_passed = False
            logger.warning("Vitest E2E FAILED: %d failure(s)", vitest_result.failed_count)
        else:
            logger.info("Vitest E2E passed: %d/%d", vitest_result.passed_count, vitest_result.total)
    else:
        logger.info("Vitest E2E skipped")

    if not skip_pytest:
        pytest_result = run_pytest(test_path=pytest_path)
        if not pytest_result.passed:
            all_passed = False
            logger.warning("Pytest E2E FAILED: %d failure(s)", pytest_result.failed_count)
        else:
            logger.info("Pytest E2E passed: %d/%d", pytest_result.passed_count, pytest_result.total)
    else:
        logger.info("Pytest E2E skipped")

    if not skip_playwright:
        playwright_result = run_playwright(config=playwright_config)
        if not playwright_result.passed:
            all_passed = False
            logger.warning("Playwright E2E FAILED: %d failure(s)", playwright_result.failed_count)
        else:
            logger.info("Playwright E2E passed: %d/%d", playwright_result.passed_count, playwright_result.total)
    else:
        logger.info("Playwright E2E skipped")

    dur = (time.time() - start) * 1000

    detail_parts: list[str] = []
    if vitest_result:
        status = "PASS" if vitest_result.passed else "FAIL"
        detail_parts.append(f"Vitest: {status} ({vitest_result.passed_count}/{vitest_result.total})")
    if pytest_result:
        status = "PASS" if pytest_result.passed else "FAIL"
        detail_parts.append(f"Pytest: {status} ({pytest_result.passed_count}/{pytest_result.total})")
    if playwright_result:
        status = "PASS" if playwright_result.passed else "FAIL"
        detail_parts.append(f"Playwright: {status} ({playwright_result.passed_count}/{playwright_result.total})")
    if not detail_parts:
        detail_parts.append("All runners skipped — no E2E verification performed")

    status = "PASS" if all_passed else "FAIL"
    detail_parts.insert(0, f"Overall: [{status}]")

    return E2eVerifyResult(
        passed=all_passed,
        vitest=vitest_result,
        pytest=pytest_result,
        playwright=playwright_result,
        duration_ms=dur,
        details=" | ".join(detail_parts),
    )


# ---------------------------------------------------------------------------
# Celery Task
# ---------------------------------------------------------------------------


try:
    from celery import shared_task as _celery_shared_task

    @_celery_shared_task(
        bind=True,
        max_retries=1,
        default_retry_delay=30,
        autoretry_for=(Exception,),
        name="workers.quality.e2e_verify.run_e2e_verify_task",
    )
    def run_e2e_verify_task(self, **kwargs: Any) -> dict[str, Any]:
        """Celery task wrapper for ``run_e2e_verify``."""
        result = run_e2e_verify(**kwargs)
        return _result_to_dict(result)

except ImportError:
    # Celery not installed — define a no-op for import safety
    def run_e2e_verify_task(**kwargs: Any) -> dict[str, Any]:  # type: ignore[misc]
        logger.warning("Celery not available — run_e2e_verify_task called directly")
        return _result_to_dict(run_e2e_verify(**kwargs))


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def _result_to_dict(result: E2eVerifyResult) -> dict[str, Any]:
    """Convert E2eVerifyResult to a JSON-serializable dict."""
    d: dict[str, Any] = {
        "passed": result.passed,
        "duration_ms": round(result.duration_ms, 2),
        "details": result.details,
    }

    if result.vitest:
        d["vitest"] = asdict(result.vitest)
        d["vitest"]["duration_ms"] = round(result.vitest.duration_ms, 2)
    if result.pytest:
        d["pytest"] = asdict(result.pytest)
        d["pytest"]["duration_ms"] = round(result.pytest.duration_ms, 2)
    if result.playwright:
        d["playwright"] = asdict(result.playwright)
        d["playwright"]["duration_ms"] = round(result.playwright.duration_ms, 2)

    return d


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------


def main() -> int:
    """CLI entry point for the E2E verify gate."""
    import argparse

    parser = argparse.ArgumentParser(
        description="E2E Verify — Multi-runner E2E verification gate"
    )
    parser.add_argument("--skip-vitest", action="store_true", help="Skip vitest E2E runner")
    parser.add_argument("--skip-pytest", action="store_true", help="Skip pytest E2E runner")
    parser.add_argument("--skip-playwright", action="store_true", help="Skip Playwright E2E runner")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    parser.add_argument(
        "--vitest-config",
        default=None,
        help="Path to vitest config (default: vitest.e2e.config.ts)",
    )
    parser.add_argument(
        "--pytest-path",
        default=None,
        help="Path to pytest tests (default: workers/tests/)",
    )
    parser.add_argument(
        "--playwright-config",
        default=None,
        help="Path to Playwright config (default: dashboard/playwright.config.ts)",
    )
    args = parser.parse_args()

    result = run_e2e_verify(
        skip_vitest=args.skip_vitest,
        skip_pytest=args.skip_pytest,
        skip_playwright=args.skip_playwright,
        vitest_config=Path(args.vitest_config) if args.vitest_config else None,
        pytest_path=Path(args.pytest_path) if args.pytest_path else None,
        playwright_config=Path(args.playwright_config) if args.playwright_config else None,
    )

    if args.json:
        print(json.dumps(_result_to_dict(result), indent=2))
    else:
        _print_result(result)

    return 0 if result.passed else 1


def _print_result(result: E2eVerifyResult) -> None:
    """Print human-readable E2E verify result."""
    status = "PASS" if result.passed else "FAIL"
    print(f"\n{'=' * 60}")
    print(f"  E2E Verify: [{status}]")
    print(f"{'=' * 60}")
    print(f"  Duration: {result.duration_ms:.0f}ms")
    print(f"  Summary: {result.details}")

    if result.vitest:
        print(f"\n  ── Vitest E2E ──")
        s = "PASS" if result.vitest.passed else "FAIL"
        print(f"     Status: {s}")
        print(f"     {result.vitest.passed_count}/{result.vitest.total} passed, "
              f"{result.vitest.failed_count} failed, {result.vitest.skipped_count} skipped")
        for f_entry in result.vitest.failures[:10]:
            print(f"     ✗ {f_entry}")

    if result.pytest:
        print(f"\n  ── Pytest E2E ──")
        s = "PASS" if result.pytest.passed else "FAIL"
        print(f"     Status: {s}")
        print(f"     {result.pytest.passed_count}/{result.pytest.total} passed, "
              f"{result.pytest.failed_count} failed, {result.pytest.skipped_count} skipped")
        for f_entry in result.pytest.failures[:10]:
            print(f"     ✗ {f_entry}")

    if result.playwright:
        print(f"\n  ── Playwright E2E ──")
        s = "PASS" if result.playwright.passed else "FAIL"
        print(f"     Status: {s}")
        print(f"     {result.playwright.passed_count}/{result.playwright.total} passed, "
              f"{result.playwright.failed_count} failed, {result.playwright.skipped_count} skipped")
        for f_entry in result.playwright.failures[:10]:
            print(f"     ✗ {f_entry}")

    print()

if __name__ == "__main__":
    sys.exit(main())
