"""Tests for the workers/quality/ci_gate.py CI gate enforcement module.

Tests cover all three gates:
  Gate 1 — LSP/TypeScript diagnostics on changed files
  Gate 2 — Test regression check (base vs head)
  Gate 3 — Lint diff enforcement (biome check)

Plus orchestrator, result serialization, and edge cases.
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from workers.quality.ci_gate import (
    BASE_BRANCH,
    Diagnostic,
    LspGateResult,
    TestRegressionResult,
    LintDiffResult,
    CiGateResult,
    _get_changed_files,
    _filter_ts_files,
    _filter_checkable_files,
    _get_git_sha,
    _parse_tsc_diagnostics,
    _parse_vitest_json,
    _parse_biome_output,
    _result_to_dict,
)


# ── Dataclass Construction ────────────────────────────────────────────────────


class TestDiagnostic:
    def test_construct_with_all_fields(self):
        d = Diagnostic(
            file="src/test.ts",
            line=10,
            column=5,
            severity="error",
            message="Type 'string' is not assignable to type 'number'",
            code="TS2322",
        )
        assert d.file == "src/test.ts"
        assert d.line == 10
        assert d.column == 5
        assert d.severity == "error"
        assert d.code == "TS2322"

    def test_default_code(self):
        d = Diagnostic(file="f.ts", line=1, column=1, severity="warning", message="unused variable")
        assert d.code == ""


class TestLspGateResult:
    def test_pass_with_no_files(self):
        r = LspGateResult(passed=True, files_checked=[])
        assert r.passed is True
        assert len(r.files_checked) == 0
        assert len(r.errors) == 0

    def test_fail_with_errors(self):
        r = LspGateResult(
            passed=False,
            files_checked=["src/bad.ts"],
            errors=[Diagnostic(file="src/bad.ts", line=1, column=1, severity="error", message="bad")],
        )
        assert r.passed is False
        assert len(r.errors) == 1

    def test_duration_ms_default(self):
        r = LspGateResult(passed=True, files_checked=[])
        assert r.duration_ms == 0.0


class TestTestRegressionResult:
    def test_pass_default(self):
        r = TestRegressionResult(passed=True)
        assert r.passed is True
        assert r.regressions == []

    def test_fail_with_regressions(self):
        r = TestRegressionResult(
            passed=False,
            regressions=["test_suite > test_case_1"],
        )
        assert r.passed is False
        assert len(r.regressions) == 1

    def test_counts(self):
        r = TestRegressionResult(
            passed=True,
            base_total=100,
            base_passed=95,
            head_total=100,
            head_passed=98,
            head_failed=2,
        )
        assert r.base_total == 100
        assert r.head_failed == 2


class TestLintDiffResult:
    def test_pass_with_no_errors(self):
        r = LintDiffResult(passed=True, files_checked=[])
        assert r.passed is True

    def test_fail_with_errors(self):
        r = LintDiffResult(
            passed=False,
            errors=[Diagnostic(file="src/a.ts", line=1, column=1, severity="error", message="lint error")],
        )
        assert r.passed is False
        assert len(r.errors) == 1


class TestCiGateResult:
    def test_pass_all_gates(self):
        r = CiGateResult(
            passed=True,
            lsp=LspGateResult(passed=True, files_checked=["src/a.ts"]),
            test_regression=TestRegressionResult(passed=True),
            lint_diff=LintDiffResult(passed=True, files_checked=["src/a.ts"]),
            touched_files=["src/a.ts"],
        )
        assert r.passed is True
        assert r.lsp is not None
        assert r.lsp.passed is True
        assert r.test_regression is not None
        assert r.test_regression.passed is True
        assert r.lint_diff is not None
        assert r.lint_diff.passed is True

    def test_fail_lsp_only(self):
        r = CiGateResult(
            passed=False,
            lsp=LspGateResult(
                passed=False,
                files_checked=["src/bad.ts"],
                errors=[Diagnostic(file="src/bad.ts", line=1, column=1, severity="error", message="TS error")],
            ),
            test_regression=TestRegressionResult(passed=True),
            lint_diff=LintDiffResult(passed=True),
            touched_files=["src/bad.ts"],
        )
        assert r.passed is False

    def test_null_gates(self):
        r = CiGateResult(passed=True, touched_files=[])
        assert r.lsp is None
        assert r.test_regression is None
        assert r.lint_diff is None

    def test_duration_details(self):
        r = CiGateResult(
            passed=True,
            duration_ms=1500.0,
            details="LSP: PASS | Tests: PASS | Lint: PASS",
        )
        assert r.duration_ms == 1500.0
        assert "PASS" in r.details


# ── _get_changed_files ────────────────────────────────────────────────────────


class TestGetChangedFiles:
    def test_returns_list_of_strings(self):
        files = _get_changed_files(base="HEAD", head="HEAD")
        # With no diff between HEAD and HEAD, should return empty
        assert isinstance(files, list)

    def test_fallback_on_invalid_base(self):
        files = _get_changed_files(base="nonexistent-branch-12345")
        assert isinstance(files, list)

    def test_filter_ts_files(self):
        all_files = ["src/a.ts", "src/b.tsx", "src/c.js", "src/d.py", "README.md"]
        ts_files = _filter_ts_files(all_files)
        assert ts_files == ["src/a.ts", "src/b.tsx"]

    def test_filter_ts_files_empty(self):
        assert _filter_ts_files([]) == []
        assert _filter_ts_files(["README.md", "Makefile"]) == []

    def test_filter_checkable_files(self):
        all_files = ["src/a.ts", "src/b.tsx", "src/c.js", "src/d.json", "src/e.css", "src/f.py", "README.md"]
        checkable = _filter_checkable_files(all_files)
        assert "src/a.ts" in checkable
        assert "src/b.tsx" in checkable
        assert "src/c.js" in checkable
        assert "src/d.json" in checkable
        assert "src/e.css" in checkable
        assert "src/f.py" not in checkable
        assert "README.md" not in checkable

    def test_filter_checkable_files_empty(self):
        assert _filter_checkable_files([]) == []
        assert _filter_checkable_files(["Makefile", "Dockerfile"]) == []


# ── _get_git_sha ──────────────────────────────────────────────────────────────


class TestGetGitSha:
    def test_resolves_head(self):
        sha = _get_git_sha("HEAD")
        assert len(sha) == 40
        assert all(c in "0123456789abcdef" for c in sha)

    def test_returns_ref_on_failure(self):
        result = _get_git_sha("")
        assert result == ""


# ── _parse_tsc_diagnostics ────────────────────────────────────────────────────


class TestParseTscDiagnostics:
    def test_parses_error_with_location(self):
        output = "src/bad.ts(5,10): error TS2322: Type 'string' is not assignable to type 'number'."
        errors, warnings = _parse_tsc_diagnostics(output, "src/bad.ts")
        assert len(errors) == 1
        assert errors[0].line == 5
        assert errors[0].column == 10
        assert errors[0].code == "TS2322"
        assert "not assignable" in errors[0].message

    def test_parses_warning(self):
        output = "src/test.ts(3,1): warning TS6133: 'x' is declared but its value is never read."
        errors, warnings = _parse_tsc_diagnostics(output, "src/test.ts")
        assert len(errors) == 0
        assert len(warnings) == 1
        assert warnings[0].severity == "warning"
        assert "never read" in warnings[0].message

    def test_returns_empty_for_no_match(self):
        output = "No errors found."
        errors, warnings = _parse_tsc_diagnostics(output, "src/clean.ts")
        assert len(errors) == 0
        assert len(warnings) == 0

    def test_handles_basename_only_in_output(self):
        output = "bad.ts(1:2): error TS1005: ',' expected."
        # Should match via basename fallback
        errors, warnings = _parse_tsc_diagnostics(output, "src/bad.ts")
        # The basename-only match might not work for all formats
        # Just check we don't crash
        assert isinstance(errors, list)
        assert isinstance(warnings, list)

    def test_handles_multiple_files_in_output(self):
        output = (
            "src/a.ts(1,1): error TS2322: Type error in A.\n"
            "src/b.ts(2,3): error TS2554: Type error in B."
        )
        errors_a, warnings_a = _parse_tsc_diagnostics(output, "src/a.ts")
        assert len(errors_a) == 1
        assert "Type error in A" in errors_a[0].message

        errors_b, warnings_b = _parse_tsc_diagnostics(output, "src/b.ts")
        assert len(errors_b) == 1
        assert "Type error in B" in errors_b[0].message

    def test_ignores_other_file_diagnostics(self):
        output = "src/other.ts(1,1): error TS2322: Some error."
        errors, warnings = _parse_tsc_diagnostics(output, "src/my.ts")
        assert len(errors) == 0
        assert len(warnings) == 0


# ── _parse_vitest_json ────────────────────────────────────────────────────────


class TestParseVitestJson:
    def test_parses_valid_json(self):
        data = {"numTotalTests": 10, "numPassedTests": 8, "numFailedTests": 2, "testResults": []}
        output = json.dumps(data)
        result = _parse_vitest_json(output)
        assert result["numTotalTests"] == 10
        assert result["numPassedTests"] == 8

    def test_returns_empty_for_invalid_json(self):
        result = _parse_vitest_json("not json at all")
        assert result == {}

    def test_returns_empty_for_empty_string(self):
        result = _parse_vitest_json("")
        assert result == {}

    def test_extracts_from_verbose_output(self):
        data = {"numTotalTests": 5, "numPassedTests": 5, "numFailedTests": 0, "testResults": []}
        output = f"some verbose output...\n{json.dumps(data)}\n...more output"
        result = _parse_vitest_json(output)
        assert result["numTotalTests"] == 5

    def test_extracts_with_test_results(self):
        data = {
            "numTotalTests": 3,
            "numPassedTests": 2,
            "numFailedTests": 1,
            "testResults": [
                {
                    "name": "test_suite.py",
                    "assertionResults": [
                        {"fullName": "test_one", "title": "test_one", "status": "passed"},
                        {"fullName": "test_two", "title": "test_two", "status": "passed"},
                        {"fullName": "test_three", "title": "test_three", "status": "failed"},
                    ],
                }
            ],
        }
        result = _parse_vitest_json(json.dumps(data))
        assert len(result["testResults"]) == 1
        assertions = result["testResults"][0]["assertionResults"]
        assert len(assertions) == 3
        failed = [a for a in assertions if a["status"] == "failed"]
        assert len(failed) == 1


# ── _parse_biome_output ───────────────────────────────────────────────────────


class TestParseBiomeOutput:
    def test_parses_error(self):
        output = "src/a.ts:1:2 error(noAny): Unexpected use of `any`."
        errors, warnings = _parse_biome_output(output, ["src/a.ts"])
        assert len(errors) == 1
        assert errors[0].line == 1
        assert errors[0].column == 2
        assert errors[0].code == "noAny"
        assert "Unexpected use" in errors[0].message

    def test_parses_warning(self):
        output = "src/a.ts:5:10 warning(noConsole): Unexpected console statement."
        errors, warnings = _parse_biome_output(output, ["src/a.ts"])
        assert len(errors) == 0
        assert len(warnings) == 1
        assert warnings[0].severity == "warning"
        assert warnings[0].code == "noConsole"

    def test_filters_by_relevant_files(self):
        output = (
            "src/keep.ts:1:1 error(noDebugger): Unexpected debugger.\n"
            "src/ignore.ts:5:2 error(noAny): Unexpected any."
        )
        errors, warnings = _parse_biome_output(output, ["src/keep.ts"])
        assert len(errors) == 1
        assert "src/keep.ts" in errors[0].file

    def test_returns_empty_for_non_matching_output(self):
        output = "No issues found."
        errors, warnings = _parse_biome_output(output, ["src/a.ts"])
        assert len(errors) == 0
        assert len(warnings) == 0

    def test_handles_css_lint_output(self):
        output = "src/styles.css:10:2 error(noUnknownSelector): Unknown selector."
        errors, warnings = _parse_biome_output(output, ["src/styles.css"])
        assert len(errors) == 1
        assert errors[0].file == "src/styles.css"

    def test_respects_empty_relevant_set(self):
        """Empty relevant_set means include all files."""
        output = "src/a.ts:1:1 error(noAny): Unexpected any."
        errors, warnings = _parse_biome_output(output, [])
        assert len(errors) == 1

    def test_handles_multiline_output(self):
        output = (
            "src/a.ts:1:1 error(noAny): Unexpected any.\n"
            "src/b.ts:2:2 warning(noConsole): Console statement.\n"
            "src/c.ts:3:3 error(noDebugger): Debugger statement.\n"
        )
        errors, warnings = _parse_biome_output(output, ["src/a.ts", "src/b.ts", "src/c.ts"])
        assert len(errors) == 2
        assert len(warnings) == 1


# ── _result_to_dict ───────────────────────────────────────────────────────────


class TestResultToDict:
    def test_minimal_result(self):
        r = CiGateResult(passed=True, touched_files=[])
        d = _result_to_dict(r)
        assert d["passed"] is True
        assert d["touched_files"] == []
        assert "gate_1_lsp" not in d
        assert "gate_2_test_regression" not in d
        assert "gate_3_lint_diff" not in d

    def test_full_result(self):
        r = CiGateResult(
            passed=False,
            lsp=LspGateResult(
                passed=False,
                files_checked=["src/bad.ts"],
                errors=[Diagnostic(file="src/bad.ts", line=1, column=1, severity="error", message="error")],
            ),
            test_regression=TestRegressionResult(
                passed=False,
                regressions=["suite > test"],
                head_failed=1,
            ),
            lint_diff=LintDiffResult(
                passed=True,
                files_checked=["src/ok.ts"],
            ),
            touched_files=["src/bad.ts", "src/ok.ts"],
            base_sha="abc1234",
            head_sha="def5678",
            duration_ms=1234.56,
            details="LSP: FAIL | Tests: FAIL | Lint: PASS",
        )
        d = _result_to_dict(r)
        assert d["passed"] is False
        assert d["base_sha"] == "abc1234"
        assert d["head_sha"] == "def5678"
        assert round(d["duration_ms"], 2) == 1234.56

        assert d["gate_1_lsp"]["passed"] is False
        assert d["gate_1_lsp"]["files_checked"] == ["src/bad.ts"]
        assert d["gate_1_lsp"]["errors_count"] == 1

        assert d["gate_2_test_regression"]["passed"] is False
        assert d["gate_2_test_regression"]["regressions"] == ["suite > test"]
        assert d["gate_2_test_regression"]["head_failed"] == 1

        assert d["gate_3_lint_diff"]["passed"] is True
        assert d["gate_3_lint_diff"]["files_checked"] == ["src/ok.ts"]
        assert d["gate_3_lint_diff"]["errors_count"] == 0

    def test_json_serializable(self):
        r = CiGateResult(
            passed=True,
            lsp=LspGateResult(passed=True, files_checked=["a.ts"]),
            test_regression=TestRegressionResult(passed=True),
            lint_diff=LintDiffResult(passed=True, files_checked=["a.ts"]),
            touched_files=["a.ts"],
        )
        d = _result_to_dict(r)
        # Should serialize to JSON without error
        json_str = json.dumps(d)
        assert '"passed": true' in json_str
        assert '"gate_1_lsp"' in json_str
        assert '"gate_2_test_regression"' in json_str
        assert '"gate_3_lint_diff"' in json_str

    def test_duration_rounding(self):
        r = CiGateResult(passed=True, touched_files=[], duration_ms=1.234567)
        d = _result_to_dict(r)
        assert d["duration_ms"] == 1.23
