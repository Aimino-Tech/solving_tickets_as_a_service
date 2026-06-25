"""Tests for the Leave It Cleaner Gate (lsp_diagnostics + test suite enforcement)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from workers.quality.cleaner_gate import (
    CleanerGateResult,
    FileDiagnostic,
    LspDiagnosticsResult,
    TestSuiteResult,
    _filter_ts_files,
    _find_related_test_files,
    _get_changed_files,
    _parse_tsc_diagnostics,
    _result_to_dict,
    run_cleaner_gate,
    run_lsp_diagnostics,
    run_tests_for_files,
)


class TestFileDiagnostic:
    def test_construct_with_all_fields(self):
        d = FileDiagnostic(file="src/app.ts", line=10, column=5, severity="error", message="Type X is not assignable")
        assert d.file == "src/app.ts"
        assert d.line == 10
        assert d.column == 5
        assert d.severity == "error"

    def test_default_values(self):
        d = FileDiagnostic(file="src/lib.ts", line=0, column=0, severity="warning", message="deprecated")
        assert d.file == "src/lib.ts"
        assert d.line == 0
        assert d.column == 0


class TestLspDiagnosticsResult:
    def test_construct_passed(self):
        r = LspDiagnosticsResult(passed=True, files_checked=["src/app.ts"], duration_ms=10.0)
        assert r.passed is True
        assert r.files_checked == ["src/app.ts"]
        assert r.errors == []
        assert r.warnings == []

    def test_construct_with_errors(self):
        err = FileDiagnostic(file="src/app.ts", line=1, column=1, severity="error", message="bad")
        r = LspDiagnosticsResult(passed=False, files_checked=["src/app.ts"], errors=[err])
        assert r.passed is False
        assert len(r.errors) == 1


class TestTestSuiteResult:
    def test_construct_passed(self):
        r = TestSuiteResult(passed=True, total_tests=10, passed_tests=10)
        assert r.passed is True
        assert r.total_tests == 10

    def test_construct_failed(self):
        r = TestSuiteResult(passed=False, total_tests=5, passed_tests=3, failed_tests=2, failed_test_names=["test_login"])
        assert r.passed is False
        assert r.failed_test_names == ["test_login"]

    def test_defaults(self):
        r = TestSuiteResult(passed=True)
        assert r.total_tests == 0
        assert r.related_test_files == []


class TestCleanerGateResult:
    def test_construct_passed(self):
        r = CleanerGateResult(passed=True, touched_files=["src/app.ts"])
        assert r.passed is True
        assert r.touched_files == ["src/app.ts"]
        assert r.lsp is None
        assert r.tests is None

    def test_construct_failed_with_gates(self):
        lsp = LspDiagnosticsResult(passed=False, files_checked=["src/app.ts"])
        tests = TestSuiteResult(passed=True)
        r = CleanerGateResult(passed=False, lsp=lsp, tests=tests)
        assert r.passed is False
        assert r.lsp is not None
        assert r.tests is not None


class TestFilterTsFiles:
    def test_ts_files_pass_through(self):
        files = ["src/app.ts", "src/lib.tsx", "src/util.mts", "src/config.cts"]
        result = _filter_ts_files(files)
        assert result == files

    def test_non_ts_files_filtered_out(self):
        files = ["src/app.ts", "src/style.css", "README.md", "src/lib.tsx", "package.json"]
        result = _filter_ts_files(files)
        assert result == ["src/app.ts", "src/lib.tsx"]

    def test_empty_list(self):
        assert _filter_ts_files([]) == []

    def test_no_ts_files(self):
        assert _filter_ts_files(["src/style.css", "README.md"]) == []


class TestParseTscDiagnostics:
    def test_parse_error_with_location(self):
        output = 'src/app.ts(10,5): error TS2322: Type "X" is not assignable.'
        errors, warnings = _parse_tsc_diagnostics(output, "src/app.ts")
        assert len(errors) == 1
        assert errors[0].line == 10
        assert errors[0].column == 5
        assert errors[0].severity == "error"

    def test_parse_warning(self):
        output = "src/lib.ts: warning TS1234: This is deprecated."
        errors, warnings = _parse_tsc_diagnostics(output, "src/lib.ts")
        assert len(errors) == 0
        assert len(warnings) == 1
        assert warnings[0].severity == "warning"

    def test_clean_output_no_diagnostics(self):
        output = "No errors found."
        errors, warnings = _parse_tsc_diagnostics(output, "src/app.ts")
        assert len(errors) == 0
        assert len(warnings) == 0

    def test_empty_output(self):
        errors, warnings = _parse_tsc_diagnostics("", "src/app.ts")
        assert len(errors) == 0
        assert len(warnings) == 0

    def test_ignores_other_files(self):
        output = "src/app.ts(1,1): error TS1000: First.\nsrc/lib.ts(5,5): error TS3000: Other."
        errors, warnings = _parse_tsc_diagnostics(output, "src/app.ts")
        assert len(errors) == 1
        assert errors[0].message == "First."


class TestGetChangedFiles:
    @patch("subprocess.run")
    def test_returns_list_of_files(self, mock_run):
        mock_run.return_value = MagicMock(stdout="src/app.ts\nsrc/lib.tsx\nREADME.md\n", returncode=0)
        files = _get_changed_files()
        assert files == ["src/app.ts", "src/lib.tsx", "README.md"]

    @patch("subprocess.run")
    def test_handles_empty_diff(self, mock_run):
        mock_run.return_value = MagicMock(stdout="", returncode=0)
        files = _get_changed_files()
        assert files == []

    @patch("subprocess.run")
    def test_fallback_on_failure(self, mock_run):
        mock_run.side_effect = [MagicMock(returncode=1, stdout="", stderr="fatal"), MagicMock(stdout="src/app.ts\n", returncode=0)]
        files = _get_changed_files()
        assert files == ["src/app.ts"]

    @patch("subprocess.run")
    def test_timeout_returns_empty(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="git", timeout=30)
        files = _get_changed_files()
        assert files == []


class TestFindRelatedTestFiles:
    def test_empty_source_list(self):
        related = _find_related_test_files([])
        assert related == []

    def test_returns_list_type(self):
        with patch.object(Path, "glob", return_value=[]):
            related = _find_related_test_files(["src/auth/login.ts"])
        assert isinstance(related, list)


class TestRunLspDiagnostics:
    def test_no_ts_files_returns_pass(self):
        result = run_lsp_diagnostics(files=["README.md"])
        assert result.passed is True
        assert result.files_checked == []

    @patch("subprocess.run")
    def test_passes_on_clean_tsc(self, mock_run):
        mock_run.return_value = MagicMock(stdout="No errors found.", stderr="", returncode=0)
        result = run_lsp_diagnostics(files=["src/app.ts"])
        assert result.passed is True
        assert "src/app.ts" in result.files_checked

    @patch("subprocess.run")
    def test_fails_on_tsc_error_in_touched_file(self, mock_run):
        mock_run.return_value = MagicMock(stdout='src/app.ts(10,5): error TS2322: Type "X" is not valid.', stderr="", returncode=2)
        result = run_lsp_diagnostics(files=["src/app.ts"])
        assert result.passed is False
        assert len(result.errors) >= 1

    @patch("subprocess.run")
    def test_timeout_returns_fail(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="npx tsc", timeout=120)
        result = run_lsp_diagnostics(files=["src/app.ts"])
        assert result.passed is False
        assert "timed out" in result.details.lower()

    @patch("subprocess.run")
    def test_tsc_not_found_returns_fail(self, mock_run):
        mock_run.side_effect = FileNotFoundError()
        result = run_lsp_diagnostics(files=["src/app.ts"])
        assert result.passed is False
        assert "not found" in result.details.lower()


class TestRunTestsForFiles:
    def test_no_files_returns_pass(self):
        result = run_tests_for_files(files=[])
        assert result.passed is True
        assert "No files touched" in result.details

    @patch("workers.quality.cleaner_gate._find_related_test_files")
    def test_no_related_tests_returns_pass(self, mock_find):
        mock_find.return_value = []
        result = run_tests_for_files(files=["src/app.ts"])
        assert result.passed is True
        assert "No related test files" in result.details

    @patch("workers.quality.cleaner_gate._find_related_test_files")
    @patch("subprocess.run")
    def test_passes_all_tests_pass(self, mock_run, mock_find):
        mock_find.return_value = ["src/app.test.ts"]
        mock_run.return_value = MagicMock(stdout=json.dumps({"numTotalTests": 5, "numPassedTests": 5, "numFailedTests": 0, "testResults": []}), stderr="", returncode=0)
        result = run_tests_for_files(files=["src/app.ts"])
        assert result.passed is True
        assert result.total_tests == 5
        assert result.passed_tests == 5

    @patch("workers.quality.cleaner_gate._find_related_test_files")
    @patch("subprocess.run")
    def test_fails_on_test_failure(self, mock_run, mock_find):
        mock_find.return_value = ["src/app.test.ts"]
        mock_run.return_value = MagicMock(stdout=json.dumps({"numTotalTests": 5, "numPassedTests": 4, "numFailedTests": 1, "testResults": [{"assertionResults": [{"fullName": "test_login fails", "title": "fails", "status": "failed"}]}]}), stderr="", returncode=1)
        result = run_tests_for_files(files=["src/app.ts"])
        assert result.passed is False
        assert result.failed_tests == 1
        assert len(result.failed_test_names) >= 1

    @patch("workers.quality.cleaner_gate._find_related_test_files")
    @patch("subprocess.run")
    def test_timeout_returns_fail(self, mock_run, mock_find):
        mock_find.return_value = ["src/app.test.ts"]
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="vitest", timeout=180)
        result = run_tests_for_files(files=["src/app.ts"])
        assert result.passed is False
        assert "timed out" in result.details.lower()

    @patch("workers.quality.cleaner_gate._find_related_test_files")
    @patch("subprocess.run")
    def test_vitest_not_found(self, mock_run, mock_find):
        mock_find.return_value = ["src/app.test.ts"]
        mock_run.side_effect = FileNotFoundError()
        result = run_tests_for_files(files=["src/app.ts"])
        assert result.passed is False


class TestRunCleanerGate:
    @patch("workers.quality.cleaner_gate._get_changed_files")
    @patch("workers.quality.cleaner_gate.run_lsp_diagnostics")
    @patch("workers.quality.cleaner_gate.run_tests_for_files")
    def test_both_gates_pass(self, mock_tests, mock_lsp, mock_changed):
        mock_changed.return_value = ["src/app.ts"]
        mock_lsp.return_value = LspDiagnosticsResult(passed=True, files_checked=["src/app.ts"])
        mock_tests.return_value = TestSuiteResult(passed=True, total_tests=5, passed_tests=5)
        result = run_cleaner_gate()
        assert result.passed is True
        assert "PASS" in result.details

    @patch("workers.quality.cleaner_gate._get_changed_files")
    @patch("workers.quality.cleaner_gate.run_lsp_diagnostics")
    def test_lsp_fails_blocks(self, mock_lsp, mock_changed):
        mock_changed.return_value = ["src/app.ts"]
        mock_lsp.return_value = LspDiagnosticsResult(passed=False, files_checked=["src/app.ts"], errors=[FileDiagnostic(file="src/app.ts", line=1, column=1, severity="error", message="bad")])
        result = run_cleaner_gate(skip_tests=True)
        assert result.passed is False

    @patch("workers.quality.cleaner_gate._get_changed_files")
    @patch("workers.quality.cleaner_gate.run_tests_for_files")
    def test_tests_fail_blocks(self, mock_tests, mock_changed):
        mock_changed.return_value = ["src/app.ts"]
        mock_tests.return_value = TestSuiteResult(passed=False, total_tests=5, passed_tests=3, failed_tests=2)
        result = run_cleaner_gate(skip_lsp=True)
        assert result.passed is False

    @patch("workers.quality.cleaner_gate._get_changed_files")
    @patch("workers.quality.cleaner_gate.run_lsp_diagnostics")
    @patch("workers.quality.cleaner_gate.run_tests_for_files")
    def test_both_gates_fail(self, mock_tests, mock_lsp, mock_changed):
        mock_changed.return_value = ["src/app.ts"]
        mock_lsp.return_value = LspDiagnosticsResult(passed=False, files_checked=["src/app.ts"], errors=[FileDiagnostic(file="src/app.ts", line=1, column=1, severity="error", message="bad")])
        mock_tests.return_value = TestSuiteResult(passed=False, total_tests=5, passed_tests=3, failed_tests=2)
        result = run_cleaner_gate()
        assert result.passed is False

    @patch("workers.quality.cleaner_gate._get_changed_files")
    def test_no_changed_files(self, mock_changed):
        mock_changed.return_value = []
        result = run_cleaner_gate()
        assert result.passed is True
        assert "No files changed" in result.details

    def test_explicit_files_provided(self):
        with patch("workers.quality.cleaner_gate.run_lsp_diagnostics") as mock_lsp, \
                patch("workers.quality.cleaner_gate.run_tests_for_files") as mock_tests:
            mock_lsp.return_value = LspDiagnosticsResult(passed=True, files_checked=["src/app.ts"])
            mock_tests.return_value = TestSuiteResult(passed=True)
            result = run_cleaner_gate(files=["src/app.ts"])
            assert result.passed is True

    def test_skip_both_gates(self):
        with patch("workers.quality.cleaner_gate._get_changed_files") as mock_changed:
            mock_changed.return_value = ["src/app.ts"]
            result = run_cleaner_gate(skip_lsp=True, skip_tests=True)
            assert result.passed is True
            assert result.lsp is None
            assert result.tests is None


class TestResultToDict:
    def test_basic_result(self):
        r = CleanerGateResult(passed=True, touched_files=["src/app.ts"], duration_ms=100.0)
        d = _result_to_dict(r)
        assert d["passed"] is True
        assert d["touched_files"] == ["src/app.ts"]

    def test_with_lsp_result(self):
        r = CleanerGateResult(passed=False, lsp=LspDiagnosticsResult(passed=False, files_checked=["src/app.ts"], errors=[FileDiagnostic(file="src/app.ts", line=1, column=1, severity="error", message="bad")]))
        d = _result_to_dict(r)
        assert d["lsp"]["passed"] is False
        assert len(d["lsp"]["errors"]) == 1

    def test_with_test_result(self):
        r = CleanerGateResult(passed=False, tests=TestSuiteResult(passed=False, total_tests=5, passed_tests=3, failed_tests=2, failed_test_names=["test_a"]))
        d = _result_to_dict(r)
        assert d["tests"]["passed"] is False
        assert d["tests"]["failed_test_names"] == ["test_a"]

    def test_serializable_to_json(self):
        r = CleanerGateResult(passed=True, touched_files=["src/app.ts"])
        d = _result_to_dict(r)
        json.dumps(d)
