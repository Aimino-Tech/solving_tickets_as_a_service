"""
CI Gate — "Leave It Cleaner Than You Found It" enforcement.

Three gates that run on every PR to enforce code quality:
  Gate 1 — LSP/TypeScript diagnostics on changed files (zero-tolerance)
  Gate 2 — Test regression check (compare base vs head test results)
  Gate 3 — Lint diff enforcement (biome check --changed --since=<base>)

Returns a structured result with per-gate pass/fail and diagnostics.
Blocks PR creation if any gate fails (zero tolerance per Quality Gates spec).
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

TS_EXTENSIONS = {".ts", ".tsx", ".mts", ".cts"}
JS_EXTENSIONS = {".js", ".jsx", ".mjs", ".cjs"}
CHECK_EXTENSIONS = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"}

BASE_BRANCH = os.environ.get("BASE_BRANCH", "origin/main")
HEAD_REF = os.environ.get("HEAD_REF", "HEAD")

TIMEOUT_LSP_MS = int(os.environ.get("CI_GATE_LSP_TIMEOUT", "120000"))
TIMEOUT_TEST_MS = int(os.environ.get("CI_GATE_TEST_TIMEOUT", "300000"))
TIMEOUT_LINT_MS = int(os.environ.get("CI_GATE_LINT_TIMEOUT", "60000"))


# ── Result Types ───────────────────────────────────────────────────────────────


@dataclass
class Diagnostic:
    """A single diagnostic (error/warning) for a file."""

    file: str
    line: int
    column: int
    severity: str  # "error" | "warning"
    message: str
    code: str = ""


@dataclass
class LspGateResult:
    """Gate 1 result — LSP diagnostics on changed files."""

    passed: bool
    files_checked: list[str] = field(default_factory=list)
    errors: list[Diagnostic] = field(default_factory=list)
    warnings: list[Diagnostic] = field(default_factory=list)
    duration_ms: float = 0.0
    details: str = ""


@dataclass
class TestRegressionResult:
    """Gate 2 result — test regression comparison between base and head."""

    passed: bool
    base_total: int = 0
    base_passed: int = 0
    head_total: int = 0
    head_passed: int = 0
    head_failed: int = 0
    regressions: list[str] = field(default_factory=list)
    new_failures: list[str] = field(default_factory=list)
    duration_ms: float = 0.0
    details: str = ""


@dataclass
class LintDiffResult:
    """Gate 3 result — biome lint diff on changed files."""

    passed: bool
    files_checked: list[str] = field(default_factory=list)
    errors: list[Diagnostic] = field(default_factory=list)
    warnings: list[Diagnostic] = field(default_factory=list)
    duration_ms: float = 0.0
    details: str = ""


@dataclass
class CiGateResult:
    """Top-level result from the CI gate run."""

    passed: bool
    lsp: LspGateResult | None = None
    test_regression: TestRegressionResult | None = None
    lint_diff: LintDiffResult | None = None
    touched_files: list[str] = field(default_factory=list)
    base_sha: str = ""
    head_sha: str = ""
    duration_ms: float = 0.0
    details: str = ""


# ── Helpers ────────────────────────────────────────────────────────────────────


def _get_changed_files(base: str = BASE_BRANCH, head: str = HEAD_REF) -> list[str]:
    """Get list of files changed between base and head."""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "--diff-filter=ACMRT", f"{base}...{head}"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(PROJECT_ROOT),
        )
        if result.returncode != 0:
            logger.warning("git diff failed (fallback to HEAD): %s", result.stderr.strip())
            result = subprocess.run(
                ["git", "diff", "--name-only", "--diff-filter=ACMRT", "HEAD~1..HEAD"],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(PROJECT_ROOT),
            )
        files = [f.strip() for f in result.stdout.split("\n") if f.strip()]
        return files
    except subprocess.TimeoutExpired:
        logger.error("git diff timed out")
        return []
    except FileNotFoundError:
        logger.error("git not found")
        return []


def _filter_ts_files(files: list[str]) -> list[str]:
    """Return only TypeScript files from the list."""
    return [f for f in files if Path(f).suffix in TS_EXTENSIONS]


def _filter_checkable_files(files: list[str]) -> list[str]:
    """Return files that biome can check."""
    return [f for f in files if Path(f).suffix in CHECK_EXTENSIONS]


def _get_git_sha(ref: str) -> str:
    """Resolve a git ref to a full SHA."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", ref],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=str(PROJECT_ROOT),
        )
        return result.stdout.strip() if result.returncode == 0 else ref
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ref


# ── Gate 1 — LSP Diagnostics ──────────────────────────────────────────────────


def run_lsp_gate(files: list[str] | None = None) -> LspGateResult:
    """
    Gate 1 — LSP/TypeScript diagnostics on changed files (zero-tolerance).

    Runs `npx tsc --noEmit` and filters diagnostics to only the touched files.
    Any error in a touched file is a FAIL.
    """
    start = time.time()
    ts_files = _filter_ts_files(files) if files else []

    if not ts_files:
        return LspGateResult(
            passed=True,
            files_checked=[],
            duration_ms=(time.time() - start) * 1000,
            details="No TypeScript files to check",
        )

    logger.info("Gate 1 — Running tsc --noEmit on %d TS file(s)", len(ts_files))
    try:
        result = subprocess.run(
            ["npx", "tsc", "--noEmit"],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_LSP_MS / 1000,
            cwd=str(PROJECT_ROOT),
        )
        output = result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return LspGateResult(
            passed=False,
            files_checked=ts_files,
            duration_ms=(time.time() - start) * 1000,
            details=f"tsc --noEmit timed out after {TIMEOUT_LSP_MS}ms",
        )
    except FileNotFoundError:
        return LspGateResult(
            passed=False,
            files_checked=ts_files,
            duration_ms=(time.time() - start) * 1000,
            details="npx/tsc not found — is Node.js installed?",
        )

    all_errors: list[Diagnostic] = []
    all_warnings: list[Diagnostic] = []

    for file_path in ts_files:
        errors, warnings = _parse_tsc_diagnostics(output, file_path)
        all_errors.extend(errors)
        all_warnings.extend(warnings)

    passed = len(all_errors) == 0
    detail_lines: list[str] = [f"Files checked: {len(ts_files)}"]

    for ef in ts_files:
        detail_lines.append(f"  - {ef}")

    if all_errors:
        detail_lines.append(f"\n{len(all_errors)} error(s) in changed files:")
        for e in all_errors:
            loc = f":{e.line}:{e.column}" if e.line else ""
            code = f" ({e.code})" if e.code else ""
            detail_lines.append(f"  ✗ {e.file}{loc}{code} — {e.message}")
    if all_warnings:
        detail_lines.append(f"\n{len(all_warnings)} warning(s) in changed files")
        for w in all_warnings:
            loc = f":{w.line}:{w.column}" if w.line else ""
            detail_lines.append(f"  ⚠ {w.file}{loc} — {w.message}")

    if not all_errors and not all_warnings:
        if result.returncode != 0:
            detail_lines.append(
                "Compilation errors exist elsewhere but not in touched files — passing"
            )
        else:
            detail_lines.append("All TypeScript files pass diagnostics — ✓")

    return LspGateResult(
        passed=passed,
        files_checked=ts_files,
        errors=all_errors,
        warnings=all_warnings,
        duration_ms=(time.time() - start) * 1000,
        details="\n".join(detail_lines),
    )


def _parse_tsc_diagnostics(output: str, file_path: str) -> tuple[list[Diagnostic], list[Diagnostic]]:
    """Parse tsc --noEmit output into structured diagnostics for a specific file."""
    errors: list[Diagnostic] = []
    warnings: list[Diagnostic] = []

    basename = Path(file_path).name
    diag_re = re.compile(
        rf"(?:{re.escape(file_path)}|{re.escape(basename)})"
        r"(?:\((\d+),(\d+)\))?"
        r":\s+(error|warning)\s+(TS\d+|)\s*[:-]?\s*(.+)$",
        re.MULTILINE,
    )

    for match in diag_re.finditer(output):
        line = int(match.group(1)) if match.group(1) else 0
        col = int(match.group(2)) if match.group(2) else 0
        severity = match.group(3)
        code = match.group(4) or ""
        message = match.group(5).strip() if match.group(5) else ""

        d = Diagnostic(
            file=file_path,
            line=line,
            column=col,
            severity=severity,
            message=message,
            code=code,
        )
        if severity == "error":
            errors.append(d)
        else:
            warnings.append(d)

    if not errors and not warnings:
        for line in output.split("\n"):
            if file_path in line and ("error" in line.lower() or "warning" in line.lower()):
                sev = "error" if "error" in line.lower() else "warning"
                (errors if sev == "error" else warnings).append(
                    Diagnostic(file=file_path, line=0, column=0, severity=sev, message=line.strip())
                )

    return errors, warnings


# ── Gate 2 — Test Regression Check ────────────────────────────────────────────


def run_test_regression_gate(
    files: list[str] | None = None,
    *,
    base_sha: str = "",
    head_sha: str = "",
) -> TestRegressionResult:
    """
    Gate 2 — Test regression check.

    Runs the test suite on the base branch, then on the PR head.
    Compares results — any previously-passing test that now fails is a regression.
    """
    start = time.time()
    touched = files or []
    base = base_sha or BASE_BRANCH
    head = head_sha or HEAD_REF

    if not touched:
        return TestRegressionResult(
            passed=True,
            duration_ms=(time.time() - start) * 1000,
            details="No files touched — skipping test regression check",
        )

    logger.info("Gate 2 — Running test regression check (base=%s head=%s)", base, head)

    # Determine test command — prefer vitest, fallback to pytest for workers
    has_vitest = (PROJECT_ROOT / "node_modules" / ".bin" / "vitest").exists()
    has_npm = (PROJECT_ROOT / "package.json").exists()

    base_results: dict[str, Any] = {}
    head_results: dict[str, Any] = {}

    # Run tests on base
    vitest_cmd = ["npx", "vitest", "run", "--reporter=json"]
    pytest_cmd = [sys.executable, "-m", "pytest", "workers/tests/", "--json=/tmp/pytest-base.json"]

    try:
        if has_vitest:
            logger.info("  Running vitest on BASE (%s)...", base)
            base_out = _run_with_git_checkout(base, vitest_cmd)
            base_results = _parse_vitest_json(base_out)
        elif has_npm:
            base_out = _run_with_git_checkout(base, ["npm", "test", "--", "--reporter=json"])
            base_results = _parse_vitest_json(base_out)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.warning("  Base test run failed: %s", e)

    # Run tests on head
    try:
        if has_vitest:
            logger.info("  Running vitest on HEAD (%s)...", head)
            head_out = _run_with_git_checkout(head, vitest_cmd)
            head_results = _parse_vitest_json(head_out)
        elif has_npm:
            head_out = _run_with_git_checkout(head, ["npm", "test", "--", "--reporter=json"])
            head_results = _parse_vitest_json(head_out)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.warning("  Head test run failed: %s", e)

    # Fallback: if vitest not available or JSON parsing failed, run pytest on workers
    if not base_results and not head_results:
        return _run_pytest_regression(touched)

    # Compare results
    base_passed_set: set[str] = set()
    for tr in base_results.get("testResults", []):
        for ar in tr.get("assertionResults", []):
            if ar.get("status") == "passed":
                full_name = f"{tr.get('name', '')} > {ar.get('fullName', ar.get('title', ''))}"
                base_passed_set.add(full_name)

    head_failed_set: set[str] = set()
    head_all_tests: list[dict[str, Any]] = []
    for tr in head_results.get("testResults", []):
        for ar in tr.get("assertionResults", []):
            entry = {
                "suite": tr.get("name", ""),
                "name": ar.get("fullName", ar.get("title", "")),
                "status": ar.get("status", ""),
            }
            head_all_tests.append(entry)
            if ar.get("status") == "failed":
                full_name = f"{tr.get('name', '')} > {ar.get('fullName', ar.get('title', ''))}"
                head_failed_set.add(full_name)

    regressions: list[str] = []
    new_failures: list[str] = []
    for test_name in head_failed_set:
        if test_name in base_passed_set:
            regressions.append(test_name)
        else:
            new_failures.append(test_name)

    base_total = base_results.get("numTotalTests", 0)
    base_passed = base_results.get("numPassedTests", 0)
    head_total = head_results.get("numTotalTests", 0)
    head_passed = head_results.get("numPassedTests", 0)
    head_failed = head_results.get("numFailedTests", 0)

    passed = len(regressions) == 0
    detail_lines: list[str] = [
        f"BASE ({base}): {base_passed}/{base_total} passed",
        f"HEAD ({head}): {head_passed}/{head_total} passed, {head_failed} failed",
    ]
    if regressions:
        detail_lines.append(f"\n{len(regressions)} regression(s) found:")
        for r in regressions[:20]:
            detail_lines.append(f"  ✗ {r}")
    if new_failures:
        detail_lines.append(f"\n{len(new_failures)} new failure(s):")
        for nf in new_failures[:10]:
            detail_lines.append(f"  ! {nf}")
    if not regressions and not new_failures:
        detail_lines.append("✓ No regressions — all previously-passing tests still pass")

    return TestRegressionResult(
        passed=passed,
        base_total=base_total,
        base_passed=base_passed,
        head_total=head_total,
        head_passed=head_passed,
        head_failed=head_failed,
        regressions=regressions,
        new_failures=new_failures,
        duration_ms=(time.time() - start) * 1000,
        details="\n".join(detail_lines),
    )


def _run_with_git_checkout(ref: str, cmd: list[str]) -> str:
    """Run a command after stashing changes and checking out a ref."""
    # Stash working changes
    subprocess.run(
        ["git", "stash", "push", "--include-untracked"],
        capture_output=True, text=True, timeout=30, cwd=str(PROJECT_ROOT),
    )

    try:
        # Checkout the ref
        subprocess.run(
            ["git", "checkout", ref, "--"],
            capture_output=True, text=True, timeout=30, cwd=str(PROJECT_ROOT),
        )

        # Run the command
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=300, cwd=str(PROJECT_ROOT),
        )
        return result.stdout + result.stderr
    finally:
        # Restore head
        subprocess.run(
            ["git", "checkout", "HEAD", "--"],
            capture_output=True, text=True, timeout=30, cwd=str(PROJECT_ROOT),
        )
        subprocess.run(
            ["git", "stash", "pop"],
            capture_output=True, text=True, timeout=30, cwd=str(PROJECT_ROOT),
        )


def _parse_vitest_json(output: str) -> dict[str, Any]:
    """Extract vitest JSON result from combined stdout/stderr."""
    json_match = re.search(r"(\{.*\"testResults\".*\})", output, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    return {}


def _run_pytest_regression(touched_files: list[str]) -> TestRegressionResult:
    """Fallback: run pytest on workers tests and report pass/fail."""
    start = time.time()
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "workers/tests/", "-x", "--tb=short", "-q"],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_TEST_MS / 1000,
            cwd=str(PROJECT_ROOT),
        )
        output = result.stdout + result.stderr
        passed = result.returncode == 0

        # Extract test counts from pytest output
        summary_match = re.search(r"(\d+) passed(?:, (\d+) failed)?", output)
        passed_count = int(summary_match.group(1)) if summary_match else 0
        failed_count = int(summary_match.group(2)) if summary_match and summary_match.group(2) else 0

        failed_names: list[str] = []
        if failed_count > 0:
            failed_lines = re.findall(r"FAILED\s+(\S+)", output)
            failed_names = failed_lines[:20]

        return TestRegressionResult(
            passed=passed,
            base_total=passed_count + failed_count,
            base_passed=passed_count,
            head_total=passed_count + failed_count,
            head_passed=passed_count,
            head_failed=failed_count,
            regressions=[],
            new_failures=failed_names,
            duration_ms=(time.time() - start) * 1000,
            details=f"pytest: {passed_count} passed, {failed_count} failed"
            + (f"\nFailures: {', '.join(failed_names)}" if failed_names else "\n✓ All tests pass"),
        )
    except subprocess.TimeoutExpired:
        return TestRegressionResult(
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"Test suite timed out after {TIMEOUT_TEST_MS}ms",
        )
    except FileNotFoundError:
        return TestRegressionResult(
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details="pytest not found",
        )


# ── Gate 3 — Lint Diff Enforcement ────────────────────────────────────────────


def run_lint_diff_gate(
    files: list[str] | None = None,
    *,
    base: str = "",
) -> LintDiffResult:
    """
    Gate 3 — Lint diff enforcement using biome.

    Runs `npx biome check --changed --since=<base>` or targets specific files.
    Any new error in a changed file is a FAIL.
    """
    start = time.time()
    touched = files if files is not None else []
    base_ref = base or BASE_BRANCH

    checkable_files = _filter_checkable_files(touched) if touched else None

    if checkable_files is not None and not checkable_files:
        return LintDiffResult(
            passed=True,
            files_checked=[],
            duration_ms=(time.time() - start) * 1000,
            details="No checkable files (JS/TS/JSON/CSS) changed — skipping",
        )

    logger.info("Gate 3 — Running biome check")

    all_errors: list[Diagnostic] = []
    all_warnings: list[Diagnostic] = []

    try:
        if checkable_files is not None:
            # Check specific files directly
            cmd = ["npx", "biome", "check"] + checkable_files
        else:
            # Use --changed with --since
            cmd = ["npx", "biome", "check", "--changed", "--since", base_ref]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_LINT_MS / 1000,
            cwd=str(PROJECT_ROOT),
        )
        output = result.stdout + result.stderr

        # Parse biome output
        errors, warnings = _parse_biome_output(output, checkable_files or _get_changed_files(base_ref))
        all_errors.extend(errors)
        all_warnings.extend(warnings)

        passed = result.returncode == 0
        detail_lines: list[str] = []

        if all_errors:
            detail_lines.append(f"{len(all_errors)} lint error(s) found:")
            for e in all_errors:
                loc = f":{e.line}:{e.column}" if e.line else ""
                detail_lines.append(f"  ✗ {e.file}{loc} — {e.message}")
        if all_warnings:
            detail_lines.append(f"{len(all_warnings)} lint warning(s) found:")
            for w in all_warnings:
                loc = f":{w.line}:{w.column}" if w.line else ""
                detail_lines.append(f"  ⚠ {w.file}{loc} — {w.message}")
        if not all_errors and not all_warnings:
            if passed:
                detail_lines.append("✓ Biome check: no errors or warnings")
            else:
                detail_lines.append("Biome check failed (non-diagnostic error)")

        return LintDiffResult(
            passed=passed,
            files_checked=checkable_files or [],
            errors=all_errors,
            warnings=all_warnings,
            duration_ms=(time.time() - start) * 1000,
            details="\n".join(detail_lines) if detail_lines else "Lint check completed",
        )

    except subprocess.TimeoutExpired:
        return LintDiffResult(
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details=f"Biome check timed out after {TIMEOUT_LINT_MS}ms",
        )
    except FileNotFoundError:
        return LintDiffResult(
            passed=False,
            duration_ms=(time.time() - start) * 1000,
            details="npx/biome not found — is Node.js installed?",
        )


def _parse_biome_output(output: str, relevant_files: list[str]) -> tuple[list[Diagnostic], list[Diagnostic]]:
    """Parse biome CLI output into structured diagnostics."""
    errors: list[Diagnostic] = []
    warnings: list[Diagnostic] = []

    # Biome format: <file>:<line>:<column> <severity> <message>
    # e.g., src/file.ts:1:2 error(noAny): Unexpected use of `any`.
    diag_re = re.compile(
        r"^(\S+?):(\d+):(\d+)\s+(error|warning)(?:\((\w+)\))?\s*(.*)$",
        re.MULTILINE,
    )

    relevant_set = set(relevant_files)

    for match in diag_re.finditer(output):
        file_path = match.group(1)
        line = int(match.group(2))
        col = int(match.group(3))
        severity = match.group(4)
        rule = match.group(5) or ""
        message = match.group(6).strip() or rule

        # Only report diagnostics for our relevant files
        if relevant_set and file_path not in relevant_set:
            continue

        d = Diagnostic(
            file=file_path,
            line=line,
            column=col,
            severity=severity,
            message=message,
            code=rule,
        )
        if severity == "error":
            errors.append(d)
        else:
            warnings.append(d)

    return errors, warnings


# ── Orchestrator ──────────────────────────────────────────────────────────────


def run_all_gates(
    files: list[str] | None = None,
    *,
    skip_lsp: bool = False,
    skip_test_regression: bool = False,
    skip_lint_diff: bool = False,
    base: str = "",
    head: str = "",
) -> CiGateResult:
    """
    Run all three CI gates.

    Args:
        files: List of touched file paths. If None, auto-detect from git diff.
        skip_lsp: Skip Gate 1 (LSP diagnostics).
        skip_test_regression: Skip Gate 2 (test regression check).
        skip_lint_diff: Skip Gate 3 (lint diff enforcement).
        base: Base branch/ref for comparisons.
        head: Head branch/ref.

    Returns:
        CiGateResult with per-gate pass/fail.
    """
    start = time.time()

    touched_files = files if files is not None else _get_changed_files(base or BASE_BRANCH, head or HEAD_REF)
    base_sha = _get_git_sha(base or BASE_BRANCH)
    head_sha = _get_git_sha(head or HEAD_REF)

    if not touched_files:
        return CiGateResult(
            passed=True,
            touched_files=[],
            base_sha=base_sha,
            head_sha=head_sha,
            duration_ms=(time.time() - start) * 1000,
            details="No files changed — all gates pass automatically",
        )

    logger.info("Running all CI gates on %d touched file(s)", len(touched_files))

    lsp_result: LspGateResult | None = None
    test_result: TestRegressionResult | None = None
    lint_result: LintDiffResult | None = None
    all_passed = True

    # Gate 1 — LSP Diagnostics
    if not skip_lsp:
        lsp_result = run_lsp_gate(touched_files)
        if not lsp_result.passed:
            all_passed = False
            logger.warning("Gate 1 FAILED: %d error(s)", len(lsp_result.errors))

    # Gate 2 — Test Regression
    if not skip_test_regression:
        test_result = run_test_regression_gate(
            touched_files,
            base_sha=base or BASE_BRANCH,
            head_sha=head or HEAD_REF,
        )
        if not test_result.passed:
            all_passed = False
            logger.warning(
                "Gate 2 FAILED: %d regression(s), %d new failure(s)",
                len(test_result.regressions),
                len(test_result.new_failures),
            )

    # Gate 3 — Lint Diff
    if not skip_lint_diff:
        lint_result = run_lint_diff_gate(touched_files, base=base or BASE_BRANCH)
        if not lint_result.passed:
            all_passed = False
            logger.warning("Gate 3 FAILED: %d error(s)", len(lint_result.errors))

    detail_parts: list[str] = []
    if lsp_result:
        status = "PASS" if lsp_result.passed else "FAIL"
        detail_parts.append(f"LSP: {status} ({len(lsp_result.errors)} errors)")
    if test_result:
        status = "PASS" if test_result.passed else "FAIL"
        detail_parts.append(f"Tests: {status} ({test_result.regressions} regressions)")
    if lint_result:
        status = "PASS" if lint_result.passed else "FAIL"
        detail_parts.append(f"Lint: {status} ({len(lint_result.errors)} errors)")
    if not detail_parts:
        detail_parts.append("No gates configured — bypassed")

    return CiGateResult(
        passed=all_passed,
        lsp=lsp_result,
        test_regression=test_result,
        lint_diff=lint_result,
        touched_files=touched_files,
        base_sha=base_sha,
        head_sha=head_sha,
        duration_ms=(time.time() - start) * 1000,
        details=" | ".join(detail_parts),
    )


# ── CLI Entry Point ────────────────────────────────────────────────────────────


def main() -> int:
    """CLI entry point for the CI gate."""
    import argparse

    parser = argparse.ArgumentParser(
        description="CI Gate — Leave It Cleaner Than You Found It enforcement"
    )
    parser.add_argument("--files", nargs="*", default=None, help="Specific files to check")
    parser.add_argument("--skip-lsp", action="store_true", help="Skip LSP diagnostics gate")
    parser.add_argument("--skip-test-regression", action="store_true", help="Skip test regression gate")
    parser.add_argument("--skip-lint-diff", action="store_true", help="Skip lint diff gate")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    parser.add_argument("--base", default=BASE_BRANCH, help="Base branch (default: origin/main)")
    parser.add_argument("--head", default=HEAD_REF, help="Head ref (default: HEAD)")
    args = parser.parse_args()

    result = run_all_gates(
        files=args.files,
        skip_lsp=args.skip_lsp,
        skip_test_regression=args.skip_test_regression,
        skip_lint_diff=args.skip_lint_diff,
        base=args.base,
        head=args.head,
    )

    if args.json:
        print(json.dumps(_result_to_dict(result), indent=2))
    else:
        _print_result(result)

    return 0 if result.passed else 1


def _result_to_dict(result: CiGateResult) -> dict[str, Any]:
    """Convert CiGateResult to a JSON-serializable dict."""
    d: dict[str, Any] = {
        "passed": result.passed,
        "touched_files": result.touched_files,
        "base_sha": result.base_sha,
        "head_sha": result.head_sha,
        "duration_ms": round(result.duration_ms, 2),
        "details": result.details,
    }
    if result.lsp:
        d["gate_1_lsp"] = {
            "passed": result.lsp.passed,
            "files_checked": result.lsp.files_checked,
            "errors_count": len(result.lsp.errors),
            "warnings_count": len(result.lsp.warnings),
            "duration_ms": round(result.lsp.duration_ms, 2),
            "details": result.lsp.details,
        }
    if result.test_regression:
        d["gate_2_test_regression"] = {
            "passed": result.test_regression.passed,
            "base_total": result.test_regression.base_total,
            "base_passed": result.test_regression.base_passed,
            "head_total": result.test_regression.head_total,
            "head_passed": result.test_regression.head_passed,
            "head_failed": result.test_regression.head_failed,
            "regressions": result.test_regression.regressions,
            "new_failures": result.test_regression.new_failures,
            "duration_ms": round(result.test_regression.duration_ms, 2),
            "details": result.test_regression.details,
        }
    if result.lint_diff:
        d["gate_3_lint_diff"] = {
            "passed": result.lint_diff.passed,
            "files_checked": result.lint_diff.files_checked,
            "errors_count": len(result.lint_diff.errors),
            "warnings_count": len(result.lint_diff.warnings),
            "duration_ms": round(result.lint_diff.duration_ms, 2),
            "details": result.lint_diff.details,
        }
    return d


def _print_result(result: CiGateResult) -> None:
    """Print human-readable gate result."""
    status = "PASS" if result.passed else "FAIL"
    print(f"\n{'=' * 60}")
    print(f"  CI Gates: [{status}]")
    print(f"{'=' * 60}")
    print(f"  Files touched: {len(result.touched_files)}")
    print(f"  Base: {result.base_sha[:12]}")
    print(f"  Head: {result.head_sha[:12]}")
    print(f"  Duration: {result.duration_ms:.0f}ms")
    print(f"  Summary: {result.details}")

    if result.lsp:
        print(f"\n  ── Gate 1 — LSP Diagnostics ──")
        s = "PASS" if result.lsp.passed else "FAIL"
        print(f"     Status: {s}")
        print(f"     Files: {len(result.lsp.files_checked)}")
        for e in result.lsp.errors:
            loc = f"{e.file}:{e.line}:{e.column}" if e.line else e.file
            print(f"     ✗ {loc} — {e.message}")
        if not result.lsp.errors and not result.lsp.warnings:
            print(f"     ✓ No diagnostics errors in changed files")

    if result.test_regression:
        print(f"\n  ── Gate 2 — Test Regression ──")
        s = "PASS" if result.test_regression.passed else "FAIL"
        print(f"     Status: {s}")
        print(f"     Base: {result.test_regression.base_passed}/{result.test_regression.base_total}")
        print(f"     Head: {result.test_regression.head_passed}/{result.test_regression.head_total}")
        for r in result.test_regression.regressions[:10]:
            print(f"     ✗ Regression: {r}")
        if not result.test_regression.regressions:
            print(f"     ✓ No regressions")

    if result.lint_diff:
        print(f"\n  ── Gate 3 — Lint Diff ──")
        s = "PASS" if result.lint_diff.passed else "FAIL"
        print(f"     Status: {s}")
        for e in result.lint_diff.errors:
            print(f"     ✗ {e.file}:{e.line}:{e.column} — {e.message}")
        if not result.lint_diff.errors:
            print(f"     ✓ No lint errors in changed files")

    print()


if __name__ == "__main__":
    sys.exit(main())
