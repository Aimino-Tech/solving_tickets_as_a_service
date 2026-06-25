"""
Cleaner Gate — "Leave It Cleaner Than You Found It" enforcement.

Enforces two deterministic checks on every file touched in a PR/branch:
  1. LSP Diagnostics — runs tsc --noEmit on changed TypeScript files
  2. Test Suite Enforcement — runs vitest on tests related to touched files

Returns a structured result with per-file diagnostics and test outcomes.
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
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

TS_EXTENSIONS = {".ts", ".tsx", ".mts", ".cts"}
BASE_BRANCH = os.environ.get("BASE_BRANCH", "origin/main")
TIMEOUT_LSP_MS = int(os.environ.get("CLEANER_GATE_LSP_TIMEOUT", "120000"))
TIMEOUT_TEST_MS = int(os.environ.get("CLEANER_GATE_TEST_TIMEOUT", "180000"))


@dataclass
class FileDiagnostic:
    file: str
    line: int
    column: int
    severity: str
    message: str


@dataclass
class LspDiagnosticsResult:
    passed: bool
    files_checked: list[str] = field(default_factory=list)
    errors: list[FileDiagnostic] = field(default_factory=list)
    warnings: list[FileDiagnostic] = field(default_factory=list)
    duration_ms: float = 0.0
    details: str = ""


@dataclass
class TestSuiteResult:
    passed: bool
    total_tests: int = 0
    passed_tests: int = 0
    failed_tests: int = 0
    failed_test_names: list[str] = field(default_factory=list)
    related_test_files: list[str] = field(default_factory=list)
    command: str = ""
    duration_ms: float = 0.0
    output: str = ""
    details: str = ""


@dataclass
class CleanerGateResult:
    passed: bool
    lsp: LspDiagnosticsResult | None = None
    tests: TestSuiteResult | None = None
    touched_files: list[str] = field(default_factory=list)
    duration_ms: float = 0.0
    details: str = ""


def _get_changed_files(base: str = BASE_BRANCH, head: str = "HEAD") -> list[str]:
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "--diff-filter=ACMRT", f"{base}...{head}"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(PROJECT_ROOT),
        )
        if result.returncode != 0:
            result = subprocess.run(
                ["git", "diff", "--name-only", "--diff-filter=ACMRT", "HEAD"],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(PROJECT_ROOT),
            )
        return [f.strip() for f in result.stdout.split("\n") if f.strip()]
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []


def _filter_ts_files(files: list[str]) -> list[str]:
    return [f for f in files if Path(f).suffix in TS_EXTENSIONS]


def _find_related_test_files(source_files: list[str]) -> list[str]:
    related: list[str] = []
    for src in source_files:
        p = Path(src)
        stem = p.stem
        parent = str(p.parent) if str(p.parent) != "." else ""
        patterns = [
            f"**/{parent}/{stem}.test.ts",
            f"**/{parent}/{stem}.spec.ts",
            f"**/{parent}/{stem}.test.tsx",
            f"**/{parent}/{stem}.spec.tsx",
        ]
        if parent:
            patterns.append(f"**/{parent}/__tests__/{stem}.test.ts")
            patterns.append(f"**/{parent}/__tests__/{stem}.spec.ts")
        test_dir = f"tests/{parent}" if parent else "tests"
        patterns.append(f"{test_dir}/test_{stem}.py")
        patterns.append(f"{test_dir}/test_{stem}.ts")
        worker_test_dir = f"workers/tests/{parent}" if parent else "workers/tests"
        patterns.append(f"{worker_test_dir}/test_{stem}.py")
        for pattern in patterns:
            matches = sorted(PROJECT_ROOT.glob(pattern))
            related.extend(str(m.relative_to(PROJECT_ROOT)) for m in matches)
    seen: set[str] = set()
    return [f for f in related if not (f in seen or seen.add(f))]


def _parse_tsc_diagnostics(output: str, file_path: str) -> tuple[list[FileDiagnostic], list[FileDiagnostic]]:
    errors: list[FileDiagnostic] = []
    warnings: list[FileDiagnostic] = []
    escaped = re.escape(file_path)
    diag_re = re.compile(
        rf"^{escaped}"
        r"(?:\((\d+),(\d+)\))?"
        r":\s+(error|warning)\s+(TS\d+|)\s*[:-]?\s*(.+)$",
        re.MULTILINE,
    )
    for match in diag_re.finditer(output):
        line = int(match.group(1)) if match.group(1) else 0
        col = int(match.group(2)) if match.group(2) else 0
        severity = match.group(3)
        message = (match.group(5) or match.group(4) or "").strip()
        d = FileDiagnostic(file=file_path, line=line, column=col, severity=severity, message=message)
        if severity == "error":
            errors.append(d)
        else:
            warnings.append(d)
    if not errors and not warnings:
        for line in output.split("\n"):
            if file_path.lower() in line.lower() and "error" in line.lower():
                errors.append(FileDiagnostic(file=file_path, line=0, column=0, severity="error", message=line.strip()))
    return errors, warnings


def run_lsp_diagnostics(files: list[str] | None = None) -> LspDiagnosticsResult:
    start = time.time()
    ts_files = _filter_ts_files(files) if files else []
    if not ts_files:
        return LspDiagnosticsResult(passed=True, files_checked=[], duration_ms=(time.time() - start) * 1000, details="No TypeScript files to check")
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
        return LspDiagnosticsResult(passed=False, files_checked=ts_files, duration_ms=(time.time() - start) * 1000, details=f"tsc --noEmit timed out after {TIMEOUT_LSP_MS}ms")
    except FileNotFoundError:
        return LspDiagnosticsResult(passed=False, files_checked=ts_files, duration_ms=(time.time() - start) * 1000, details="npx/tsc not found")
    all_errors: list[FileDiagnostic] = []
    all_warnings: list[FileDiagnostic] = []
    for file_path in ts_files:
        errors, warnings = _parse_tsc_diagnostics(output, file_path)
        all_errors.extend(errors)
        all_warnings.extend(warnings)
    passed = len(all_errors) == 0
    detail_lines: list[str] = []
    if all_errors:
        detail_lines.append(f"{len(all_errors)} error(s) found in changed files:")
        for e in all_errors:
            loc = f":{e.line}:{e.column}" if e.line else ""
            detail_lines.append(f"  {e.file}{loc} — {e.message}")
    if all_warnings:
        detail_lines.append(f"{len(all_warnings)} warning(s) found in changed files")
    if not all_errors and not all_warnings:
        if "error" in output.lower() and result.returncode != 0:
            detail_lines.append("Compilation errors detected elsewhere in the project (not in touched files)")
            passed = True
    return LspDiagnosticsResult(
        passed=passed,
        files_checked=ts_files,
        errors=all_errors,
        warnings=all_warnings,
        duration_ms=(time.time() - start) * 1000,
        details="\n".join(detail_lines) if detail_lines else "All TypeScript files pass diagnostics",
    )


def run_tests_for_files(files: list[str] | None = None, *, test_command: str = "") -> TestSuiteResult:
    start = time.time()
    touched = files or []
    if not touched:
        return TestSuiteResult(passed=True, duration_ms=(time.time() - start) * 1000, details="No files touched — skipping test suite")
    related_test_files = _find_related_test_files(touched)
    if not related_test_files:
        return TestSuiteResult(passed=True, related_test_files=[], duration_ms=(time.time() - start) * 1000, details="No related test files found — skipping")
    if test_command:
        cmd_parts = test_command.split()
    else:
        cmd_parts = ["npx", "vitest", "run", "--reporter=verbose"]
        for tf in related_test_files:
            cmd_parts.extend(["--testPathPattern", tf])
    try:
        result = subprocess.run(
            cmd_parts,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_TEST_MS / 1000,
            cwd=str(PROJECT_ROOT),
        )
        output = result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return TestSuiteResult(passed=False, related_test_files=related_test_files, duration_ms=(time.time() - start) * 1000, details=f"Test suite timed out after {TIMEOUT_TEST_MS}ms")
    except FileNotFoundError:
        return TestSuiteResult(passed=False, related_test_files=related_test_files, duration_ms=(time.time() - start) * 1000, details="npx/vitest not found")
    json_match = re.search(r"(\{.*\"testResults\".*\})", output, re.DOTALL)
    total_tests = 0
    passed_tests = 0
    failed_tests = 0
    failed_test_names: list[str] = []
    if json_match:
        try:
            data = json.loads(json_match.group(1))
            total_tests = data.get("numTotalTests", 0)
            passed_tests = data.get("numPassedTests", 0)
            failed_tests = data.get("numFailedTests", 0)
            for tr in data.get("testResults", []):
                for ar in tr.get("assertionResults", []):
                    if ar.get("status") == "failed":
                        name = ar.get("fullName", ar.get("title", "unknown"))
                        failed_test_names.append(name)
        except (json.JSONDecodeError, KeyError):
            pass
    if total_tests == 0:
        pass_count = len(re.findall(r"(?:✓|√|PASS)\s", output))
        fail_count = len(re.findall(r"(?:✗|×|FAIL)\s", output))
        total_tests = pass_count + fail_count
        passed_tests = pass_count
        failed_tests = fail_count
    passed = result.returncode == 0 and failed_tests == 0
    detail_lines: list[str] = []
    if related_test_files:
        detail_lines.append(f"Related test files: {len(related_test_files)}")
        for tf in related_test_files:
            detail_lines.append(f"  - {tf}")
    detail_lines.append(f"Tests: {total_tests} total, {passed_tests} passed, {failed_tests} failed")
    if failed_test_names:
        detail_lines.append("Failed tests:")
        for name in failed_test_names[:10]:
            detail_lines.append(f"  ✗ {name}")
    return TestSuiteResult(
        passed=passed,
        total_tests=total_tests,
        passed_tests=passed_tests,
        failed_tests=failed_tests,
        failed_test_names=failed_test_names,
        related_test_files=related_test_files,
        command=" ".join(cmd_parts) if isinstance(cmd_parts, list) else cmd_parts,
        duration_ms=(time.time() - start) * 1000,
        output=output[:2000] if output else "",
        details="\n".join(detail_lines) if detail_lines else "All tests passed",
    )


def run_cleaner_gate(files: list[str] | None = None, *, skip_lsp: bool = False, skip_tests: bool = False) -> CleanerGateResult:
    start = time.time()
    touched_files = files if files is not None else _get_changed_files()
    if not touched_files:
        return CleanerGateResult(passed=True, touched_files=[], duration_ms=(time.time() - start) * 1000, details="No files changed — cleaner gate passes automatically")
    lsp_result = None
    test_result = None
    all_passed = True
    if not skip_lsp:
        lsp_result = run_lsp_diagnostics(touched_files)
        if not lsp_result.passed:
            all_passed = False
    if not skip_tests:
        test_result = run_tests_for_files(touched_files)
        if not test_result.passed:
            all_passed = False
    detail_parts: list[str] = []
    if lsp_result:
        detail_parts.append(f"LSP: {'PASS' if lsp_result.passed else 'FAIL'} ({len(lsp_result.errors)} errors, {len(lsp_result.warnings)} warnings)")
    if test_result:
        detail_parts.append(f"Tests: {'PASS' if test_result.passed else 'FAIL'} ({test_result.passed_tests}/{test_result.total_tests} passed)")
    if not detail_parts:
        detail_parts.append("No gates configured — bypassed")
    return CleanerGateResult(passed=all_passed, lsp=lsp_result, tests=test_result, touched_files=touched_files, duration_ms=(time.time() - start) * 1000, details=" | ".join(detail_parts))


def _result_to_dict(result: CleanerGateResult) -> dict[str, Any]:
    d: dict[str, Any] = {"passed": result.passed, "touched_files": result.touched_files, "duration_ms": round(result.duration_ms, 2), "details": result.details}
    if result.lsp:
        d["lsp"] = {
            "passed": result.lsp.passed,
            "files_checked": result.lsp.files_checked,
            "errors": [{"file": e.file, "line": e.line, "column": e.column, "message": e.message} for e in result.lsp.errors],
            "warnings": [{"file": w.file, "line": w.line, "column": w.column, "message": w.message} for w in result.lsp.warnings],
            "duration_ms": round(result.lsp.duration_ms, 2),
            "details": result.lsp.details,
        }
    if result.tests:
        d["tests"] = {
            "passed": result.tests.passed,
            "total_tests": result.tests.total_tests,
            "passed_tests": result.tests.passed_tests,
            "failed_tests": result.tests.failed_tests,
            "failed_test_names": result.tests.failed_test_names,
            "related_test_files": result.tests.related_test_files,
            "duration_ms": round(result.tests.duration_ms, 2),
            "details": result.tests.details,
        }
    return d


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Leave It Cleaner Gate")
    parser.add_argument("--files", nargs="*", default=None)
    parser.add_argument("--skip-lsp", action="store_true")
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--base", default=None)
    args = parser.parse_args()

    if args.base:
        os.environ["BASE_BRANCH"] = args.base

    result = run_cleaner_gate(files=args.files, skip_lsp=args.skip_lsp, skip_tests=args.skip_tests)
    if args.json:
        print(json.dumps(_result_to_dict(result), indent=2))
    else:
        _print_result(result)
    return 0 if result.passed else 1


def _print_result(result: CleanerGateResult) -> None:
    status = "PASS" if result.passed else "FAIL"
    print(f"\n═══ Cleaner Gate: [{status}] ═══")
    print(f"  Files touched: {len(result.touched_files)}")
    print(f"  Duration: {result.duration_ms:.0f}ms")
    print(f"  Details: {result.details}")
    if result.lsp:
        print(f"\n── Gate 1 — LSP Diagnostics ──")
        print(f"  Status: {'PASS' if result.lsp.passed else 'FAIL'}")
        print(f"  Files checked: {len(result.lsp.files_checked)}")
        if result.lsp.errors:
            for e in result.lsp.errors:
                loc = f"{e.file}:{e.line}:{e.column}" if e.line else e.file
                print(f"  ✗ {loc} — {e.message}")
        if not result.lsp.errors and not result.lsp.warnings:
            print(f"  ✓ No diagnostics errors")
    if result.tests:
        print(f"\n── Gate 2 — Test Suite Enforcement ──")
        print(f"  Status: {'PASS' if result.tests.passed else 'FAIL'}")
        print(f"  Tests: {result.tests.total_tests} total, {result.tests.passed_tests} passed, {result.tests.failed_tests} failed")
        if result.tests.related_test_files:
            print(f"  Related test files: {len(result.tests.related_test_files)}")
            for tf in result.tests.related_test_files:
                print(f"    - {tf}")
        if result.tests.failed_test_names:
            print(f"  Failed tests:")
            for name in result.tests.failed_test_names[:10]:
                print(f"    ✗ {name}")
        if result.tests.passed:
            print(f"  ✓ All related tests pass")
    print()


if __name__ == "__main__":
    sys.exit(main())
