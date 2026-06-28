"""Tests for workers/quality/e2e_verify.py — multi-runner E2E verification gate.

Tests cover all three runners (vitest, pytest, playwright), their parsers,
the orchestrator, serialization, and the CLI entry point.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch, ANY

import pytest


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_env():
    keys = [
        "E2E_VITEST_TIMEOUT", "E2E_PYTEST_TIMEOUT", "E2E_PLAYWRIGHT_TIMEOUT",
        "E2E_VERIFY_NODE_BIN", "E2E_VERIFY_NPX_BIN",
    ]
    saved = {k: os.environ.pop(k, None) for k in keys}
    yield
    for k, v in saved.items():
        if v is not None:
            os.environ[k] = v


@pytest.fixture
def e2e_verify_module():
    """Lazy-import the module so env vars are clean."""
    from workers.quality import e2e_verify as m
    return m


# ═══════════════════════════════════════════════════════════════════════════════
# Dataclass Construction
# ═══════════════════════════════════════════════════════════════════════════════


class TestVitestResult:
    def test_defaults(self, e2e_verify_module):
        m = e2e_verify_module
        r = m.VitestResult(passed=True)
        assert r.passed is True
        assert r.total == 0
        assert r.passed_count == 0
        assert r.failed_count == 0
        assert r.skipped_count == 0
        assert r.failures == []
        assert r.duration_ms == 0.0
        assert r.details == ""

    def test_with_failures(self, e2e_verify_module):
        m = e2e_verify_module
        r = m.VitestResult(
            passed=False,
            total=10,
            passed_count=7,
            failed_count=3,
            skipped_count=0,
            failures=["suite1 > test1", "suite1 > test2", "suite2 > test3"],
        )
        assert r.passed is False
        assert r.total == 10
        assert len(r.failures) == 3


class TestPytestResult:
    def test_defaults(self, e2e_verify_module):
        m = e2e_verify_module
        r = m.PytestResult(passed=True)
        assert r.passed is True
        assert r.total == 0


class TestPlaywrightResult:
    def test_defaults(self, e2e_verify_module):
        m = e2e_verify_module
        r = m.PlaywrightResult(passed=True)
        assert r.passed is True
        assert r.total == 0


class TestE2eVerifyResult:
    def test_all_pass(self, e2e_verify_module):
        m = e2e_verify_module
        vit = m.VitestResult(passed=True, total=5, passed_count=5)
        pyt = m.PytestResult(passed=True, total=3, passed_count=3)
        pw = m.PlaywrightResult(passed=True, total=2, passed_count=2)
        r = m.E2eVerifyResult(passed=True, vitest=vit, pytest=pyt, playwright=pw)
        assert r.passed is True
        assert r.vitest is vit
        assert r.pytest is pyt
        assert r.playwright is pw

    def test_one_fails(self, e2e_verify_module):
        m = e2e_verify_module
        vit = m.VitestResult(passed=False, total=5, passed_count=4, failed_count=1, failures=["x"])
        r = m.E2eVerifyResult(passed=False, vitest=vit)
        assert r.passed is False


# ═══════════════════════════════════════════════════════════════════════════════
# Vitest Runner
# ═══════════════════════════════════════════════════════════════════════════════


class TestRunVitest:
    def test_ok(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        cfg = tmp_path / "vitest.config.ts"
        cfg.write_text("")
        with patch.object(m, "E2E_VERIFY_NPX_BIN", "npx"):
            with patch("subprocess.run") as mr:
                mr.return_value = MagicMock(
                    stdout=json.dumps({
                        "numTotalTests": 10,
                        "numPassedTests": 10,
                        "numFailedTests": 0,
                        "numPendingTests": 0,
                        "testResults": [
                            {
                                "name": "suite.ts",
                                "assertionResults": [
                                    {"status": "passed", "fullName": "suite > test1"},
                                    {"status": "passed", "fullName": "suite > test2"},
                                ],
                            }
                        ],
                    }),
                    stderr="",
                    returncode=0,
                )
                r = m.run_vitest(config=cfg)
        assert r.passed is True
        assert r.total == 10
        assert r.passed_count == 10
        assert r.failed_count == 0
        assert r.failures == []

    def test_with_failures(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        cfg = tmp_path / "vitest.config.ts"
        cfg.write_text("")
        with patch.object(m, "E2E_VERIFY_NPX_BIN", "npx"):
            with patch("subprocess.run") as mr:
                mr.return_value = MagicMock(
                    stdout=json.dumps({
                        "numTotalTests": 5,
                        "numPassedTests": 3,
                        "numFailedTests": 2,
                        "numPendingTests": 0,
                        "testResults": [
                            {
                                "name": "suite.ts",
                                "assertionResults": [
                                    {"status": "passed", "fullName": "suite > test1"},
                                    {"status": "failed", "fullName": "suite > test2"},
                                    {"status": "failed", "fullName": "suite > test3"},
                                ],
                            }
                        ],
                    }),
                    stderr="",
                    returncode=1,
                )
                r = m.run_vitest(config=cfg)
        assert r.passed is False
        assert r.total == 5
        assert r.passed_count == 3
        assert r.failed_count == 2
        assert len(r.failures) == 2
        assert "suite > test2" in r.failures

    def test_config_not_found(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        cfg = tmp_path / "nonexistent.ts"
        r = m.run_vitest(config=cfg)
        assert r.passed is True  # skipped gracefully
        assert "not found" in r.details

    def test_timeout(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        cfg = tmp_path / "vitest.config.ts"
        cfg.write_text("")
        with patch("subprocess.run") as mr:
            mr.side_effect = subprocess.TimeoutExpired(cmd="vitest", timeout=10)
            r = m.run_vitest(config=cfg)
        assert r.passed is False
        assert "timed out" in r.details.lower()

    def test_npx_not_found(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        cfg = tmp_path / "vitest.config.ts"
        cfg.write_text("")
        with patch("subprocess.run") as mr:
            mr.side_effect = FileNotFoundError()
            r = m.run_vitest(config=cfg)
        assert r.passed is False
        assert "node.js" in r.details.lower() or "npx" in r.details.lower()


class TestParseVitestJson:
    def test_valid_json(self, e2e_verify_module):
        m = e2e_verify_module
        output = json.dumps({"numTotalTests": 5, "numPassedTests": 3, "numFailedTests": 1, "testResults": []})
        parsed = m._parse_vitest_json(output)
        assert parsed["numTotalTests"] == 5
        assert parsed["numPassedTests"] == 3

    def test_embedded_in_output(self, e2e_verify_module):
        m = e2e_verify_module
        output = (
            "RANDOM STUFF\n"
            + json.dumps({"numTotalTests": 2, "numPassedTests": 2, "numFailedTests": 0, "testResults": []})
            + "\nMORE STUFF"
        )
        parsed = m._parse_vitest_json(output)
        assert parsed["numTotalTests"] == 2

    def test_no_json(self, e2e_verify_module):
        m = e2e_verify_module
        parsed = m._parse_vitest_json("no json here")
        assert parsed == {}


# ═══════════════════════════════════════════════════════════════════════════════
# Pytest Runner
# ═══════════════════════════════════════════════════════════════════════════════


class TestRunPytest:
    def test_ok(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        tdir = tmp_path / "tests"
        tdir.mkdir()
        (tdir / "__init__.py").write_text("")
        with patch("subprocess.run") as mr:
            mr.return_value = MagicMock(
                stdout="3 passed, 2 skipped in 1.23s\n",
                stderr="",
                returncode=0,
            )
            r = m.run_pytest(test_path=tdir, timeout=5000)
        assert r.passed is True
        assert r.total == 5
        assert r.passed_count == 3
        assert r.failed_count == 0
        assert r.skipped_count == 2

    def test_with_failures(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        tdir = tmp_path / "tests"
        tdir.mkdir()
        (tdir / "__init__.py").write_text("")
        with patch("subprocess.run") as mr:
            mr.return_value = MagicMock(
                stdout="FAILED tests/test_foo.py::test_bar\nFAILED tests/test_baz.py::test_qux\n\n"
                       "2 failed, 3 passed in 2.34s\n",
                stderr="",
                returncode=1,
            )
            r = m.run_pytest(test_path=tdir, timeout=5000)
        assert r.passed is False
        assert r.failed_count == 2
        assert r.passed_count == 3
        assert r.total == 5
        assert len(r.failures) == 2
        assert "test_bar" in r.failures[0]

    def test_path_not_found(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        tdir = tmp_path / "nonexistent"
        r = m.run_pytest(test_path=tdir)
        assert r.passed is True  # skipped gracefully
        assert "not found" in r.details

    def test_timeout(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        tdir = tmp_path / "tests"
        tdir.mkdir()
        with patch("subprocess.run") as mr:
            mr.side_effect = subprocess.TimeoutExpired(cmd="pytest", timeout=10)
            r = m.run_pytest(test_path=tdir, timeout=5000)
        assert r.passed is False
        assert "timed out" in r.details.lower()

    def test_extra_args(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        tdir = tmp_path / "tests"
        tdir.mkdir()
        with patch("subprocess.run") as mr:
            mr.return_value = MagicMock(stdout="1 passed in 0.1s\n", stderr="", returncode=0)
            r = m.run_pytest(test_path=tdir, extra_args=["-k", "test_something", "--no-header"])
        # Verify extra args were passed
        call_args = mr.call_args[0][0]
        assert "-k" in call_args
        assert "test_something" in call_args
        assert "--no-header" in call_args
        assert r.passed is True


class TestParsePytestSummary:
    def test_normal(self, e2e_verify_module):
        m = e2e_verify_module
        total, passed, failed, skipped = m._parse_pytest_summary("3 passed, 1 failed, 2 skipped in 5.23s")
        assert total == 6
        assert passed == 3
        assert failed == 1
        assert skipped == 2

    def test_only_passed(self, e2e_verify_module):
        m = e2e_verify_module
        total, passed, failed, skipped = m._parse_pytest_summary("5 passed in 0.50s")
        assert total == 5
        assert passed == 5
        assert failed == 0
        assert skipped == 0

    def test_all_failed(self, e2e_verify_module):
        m = e2e_verify_module
        total, passed, failed, skipped = m._parse_pytest_summary("0 passed, 3 failed in 2.00s")
        assert total == 3
        assert passed == 0
        assert failed == 3
        assert skipped == 0

    def test_no_match(self, e2e_verify_module):
        m = e2e_verify_module
        total, passed, failed, skipped = m._parse_pytest_summary("no test data here")
        assert total == 0


class TestParsePytestFailures:
    def test_extracts(self, e2e_verify_module):
        m = e2e_verify_module
        failures = m._parse_pytest_failures(
            "FAILED tests/test_foo.py::test_bar\nFAILED tests/test_baz.py::test_qux\nSOME OTHER STUFF"
        )
        assert len(failures) == 2
        assert "test_foo.py::test_bar" in failures
        assert "test_baz.py::test_qux" in failures

    def test_empty(self, e2e_verify_module):
        m = e2e_verify_module
        failures = m._parse_pytest_failures("3 passed in 0.50s")
        assert failures == []


# ═══════════════════════════════════════════════════════════════════════════════
# Playwright Runner
# ═══════════════════════════════════════════════════════════════════════════════


class TestRunPlaywright:
    def test_ok(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        cfg = tmp_path / "playwright.config.ts"
        cfg.write_text("")
        # Create fake node_modules/.bin/playwright so the runner doesn't skip
        (tmp_path / "node_modules" / ".bin").mkdir(parents=True)
        (tmp_path / "node_modules" / ".bin" / "playwright").write_text("#!/bin/sh\necho fake")

        with patch.object(m, "DASHBOARD_ROOT", tmp_path):
            with patch.object(m, "E2E_VERIFY_NPX_BIN", "npx"):
                with patch("subprocess.run") as mr:
                    mr.return_value = MagicMock(
                        stdout="\n".join([
                            "Running 5 tests using 2 workers",
                            "  ✓ 1 passed (1)",
                            "  ✓ 2 passed (2)",
                            "  ✗ 3 failed (3)",
                            "  - 4 skipped (4)",
                            "  ✓ 5 passed (5)",
                            "",
                            "  passed: 4, failed: 1, skipped: 1",
                        ]),
                        stderr="",
                        returncode=1,
                    )
                    r = m.run_playwright(config=cfg, timeout=5000)
        assert r.passed is False
        assert r.total >= 0

    def test_ok_all_pass(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        cfg = tmp_path / "playwright.config.ts"
        cfg.write_text("")
        (tmp_path / "node_modules" / ".bin").mkdir(parents=True)
        (tmp_path / "node_modules" / ".bin" / "playwright").write_text("#!/bin/sh\necho fake")

        with patch.object(m, "DASHBOARD_ROOT", tmp_path):
            with patch.object(m, "E2E_VERIFY_NPX_BIN", "npx"):
                with patch("subprocess.run") as mr:
                    mr.return_value = MagicMock(
                        stdout="passed: 5, failed: 0, skipped: 0\n",
                        stderr="",
                        returncode=0,
                    )
                    r = m.run_playwright(config=cfg, timeout=5000)
        assert r.passed is True

    def test_config_not_found(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        cfg = tmp_path / "nonexistent.ts"
        r = m.run_playwright(config=cfg)
        assert r.passed is True  # skipped gracefully
        assert "not found" in r.details

    def test_not_installed(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        cfg = tmp_path / "playwright.config.ts"
        cfg.write_text("")
        (tmp_path / "node_modules" / ".bin").mkdir(parents=True)
        # No playwright binary

        with patch.object(m, "DASHBOARD_ROOT", tmp_path):
            r = m.run_playwright(config=cfg)
        assert r.passed is True  # skipped gracefully
        assert "not installed" in r.details.lower()

    def test_timeout(self, e2e_verify_module, tmp_path):
        m = e2e_verify_module
        cfg = tmp_path / "playwright.config.ts"
        cfg.write_text("")
        (tmp_path / "node_modules" / ".bin").mkdir(parents=True)
        (tmp_path / "node_modules" / ".bin" / "playwright").write_text("")

        with patch.object(m, "DASHBOARD_ROOT", tmp_path):
            with patch("subprocess.run") as mr:
                mr.side_effect = subprocess.TimeoutExpired(cmd="playwright", timeout=10)
                r = m.run_playwright(config=cfg, timeout=5000)
        assert r.passed is False
        assert "timed out" in r.details.lower()


class TestParsePlaywrightOutput:
    def test_all_pass(self, e2e_verify_module):
        m = e2e_verify_module
        output = "passed: 5, failed: 0, skipped: 1\n"
        total, passed, failed, skipped, failures = m._parse_playwright_output(output)
        assert total == 0  # no total field parsed
        assert passed == 5
        assert failed == 0
        assert skipped == 1
        assert failures == []

    def test_with_failures(self, e2e_verify_module):
        m = e2e_verify_module
        output = (
            "  ✗  tests/foo.spec.ts:25:3 › suite › test1 (1m)\n"
            "  ✗  tests/bar.spec.ts:10:1 › other › test2 (2s)\n"
            "passed: 3, failed: 2, skipped: 0\n"
        )
        total, passed, failed, skipped, failures = m._parse_playwright_output(output)
        assert len(failures) == 2
        assert "tests/foo.spec.ts" in failures[0]
        assert "tests/bar.spec.ts" in failures[1]

    def test_empty(self, e2e_verify_module):
        m = e2e_verify_module
        total, passed, failed, skipped, failures = m._parse_playwright_output("")
        assert total == 0
        assert failures == []


# ═══════════════════════════════════════════════════════════════════════════════
# Orchestrator
# ═══════════════════════════════════════════════════════════════════════════════


class TestRunE2eVerify:
    def test_all_pass(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_vitest") as mvit, \
             patch.object(m, "run_pytest") as mpyt, \
             patch.object(m, "run_playwright") as mpw:
            mvit.return_value = m.VitestResult(passed=True, total=10, passed_count=10)
            mpyt.return_value = m.PytestResult(passed=True, total=5, passed_count=5)
            mpw.return_value = m.PlaywrightResult(passed=True, total=3, passed_count=3)
            r = m.run_e2e_verify()
        assert r.passed is True
        assert r.vitest is not None
        assert r.pytest is not None
        assert r.playwright is not None
        assert "PASS" in r.details

    def test_vitest_fails(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_vitest") as mvit, \
             patch.object(m, "run_pytest") as mpyt, \
             patch.object(m, "run_playwright") as mpw:
            mvit.return_value = m.VitestResult(passed=False, total=10, passed_count=8, failed_count=2, failures=["suite > bad"])
            mpyt.return_value = m.PytestResult(passed=True, total=5, passed_count=5)
            mpw.return_value = m.PlaywrightResult(passed=True, total=3, passed_count=3)
            r = m.run_e2e_verify()
        assert r.passed is False
        assert r.vitest is not None
        assert r.vitest.passed is False

    def test_pytest_fails(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_vitest") as mvit, \
             patch.object(m, "run_pytest") as mpyt, \
             patch.object(m, "run_playwright") as mpw:
            mvit.return_value = m.VitestResult(passed=True, total=10, passed_count=10)
            mpyt.return_value = m.PytestResult(passed=False, total=5, passed_count=3, failed_count=2, failures=["test_x"])
            mpw.return_value = m.PlaywrightResult(passed=True, total=3, passed_count=3)
            r = m.run_e2e_verify()
        assert r.passed is False
        assert r.pytest is not None
        assert r.pytest.passed is False

    def test_playwright_fails(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_vitest") as mvit, \
             patch.object(m, "run_pytest") as mpyt, \
             patch.object(m, "run_playwright") as mpw:
            mvit.return_value = m.VitestResult(passed=True, total=10, passed_count=10)
            mpyt.return_value = m.PytestResult(passed=True, total=5, passed_count=5)
            mpw.return_value = m.PlaywrightResult(passed=False, total=3, passed_count=1, failed_count=2, failures=["spec > t"])
            r = m.run_e2e_verify()
        assert r.passed is False
        assert r.playwright is not None
        assert r.playwright.passed is False

    def test_all_skip(self, e2e_verify_module):
        m = e2e_verify_module
        r = m.run_e2e_verify(skip_vitest=True, skip_pytest=True, skip_playwright=True)
        assert r.passed is True  # nothing ran → vacuously pass
        assert r.vitest is None
        assert r.pytest is None
        assert r.playwright is None
        assert "skipped" in r.details

    def test_skip_selected(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_vitest") as mvit, \
             patch.object(m, "run_pytest") as mpyt:
            mvit.return_value = m.VitestResult(passed=True, total=5, passed_count=5)
            mpyt.return_value = m.PytestResult(passed=True, total=3, passed_count=3)
            r = m.run_e2e_verify(skip_playwright=True)
        assert r.passed is True
        assert r.vitest is not None
        assert r.pytest is not None
        assert r.playwright is None


# ═══════════════════════════════════════════════════════════════════════════════
# Serialization
# ═══════════════════════════════════════════════════════════════════════════════


class TestResultToDict:
    def test_empty(self, e2e_verify_module):
        m = e2e_verify_module
        r = m.E2eVerifyResult(passed=True)
        d = m._result_to_dict(r)
        assert d["passed"] is True
        assert "vitest" not in d
        assert "pytest" not in d
        assert "playwright" not in d

    def test_with_runners(self, e2e_verify_module):
        m = e2e_verify_module
        r = m.E2eVerifyResult(
            passed=True,
            vitest=m.VitestResult(passed=True, total=10, passed_count=10, duration_ms=500.0),
            pytest=m.PytestResult(passed=True, total=5, passed_count=5, duration_ms=300.0),
        )
        d = m._result_to_dict(r)
        assert d["passed"] is True
        assert d["vitest"]["passed"] is True
        assert d["vitest"]["total"] == 10
        assert d["pytest"]["passed"] is True
        assert d["pytest"]["total"] == 5
        assert "playwright" not in d
        assert isinstance(d["vitest"]["duration_ms"], float)

    def test_json_roundtrip(self, e2e_verify_module):
        m = e2e_verify_module
        r = m.E2eVerifyResult(
            passed=False,
            vitest=m.VitestResult(
                passed=False, total=5, passed_count=3, failed_count=2,
                failures=["suite > test_a", "suite > test_b"],
            ),
        )
        d = m._result_to_dict(r)
        dumped = json.dumps(d)
        loaded = json.loads(dumped)
        assert loaded["passed"] is False
        assert loaded["vitest"]["failed_count"] == 2
        assert len(loaded["vitest"]["failures"]) == 2


# ═══════════════════════════════════════════════════════════════════════════════
# CLI Entry Point
# ═══════════════════════════════════════════════════════════════════════════════


class TestMainCli:
    def test_default_run(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_e2e_verify") as mrun, \
             patch.object(m, "_print_result") as mprint:
            mrun.return_value = m.E2eVerifyResult(passed=True)
            with patch.object(sys, "argv", ["e2e_verify.py"]):
                rc = m.main()
        assert rc == 0
        mrun.assert_called_once()

    def test_json_output(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_e2e_verify") as mrun, \
             patch("builtins.print") as mprint:
            mrun.return_value = m.E2eVerifyResult(passed=True)
            with patch.object(sys, "argv", ["e2e_verify.py", "--json"]):
                rc = m.main()
        assert rc == 0
        # Verify JSON was printed
        json_arg = mprint.call_args[0][0]
        assert '"passed": true' in json_arg

    def test_json_with_failures(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_e2e_verify") as mrun, \
             patch("builtins.print") as mprint:
            mrun.return_value = m.E2eVerifyResult(
                passed=False,
                vitest=m.VitestResult(passed=False, total=5, passed_count=3, failed_count=2, failures=["x"]),
            )
            with patch.object(sys, "argv", ["e2e_verify.py", "--json"]):
                rc = m.main()
        assert rc == 1
        json_arg = mprint.call_args[0][0]
        assert '"passed": false' in json_arg

    def test_skip_flags(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_e2e_verify") as mrun, \
             patch.object(m, "_print_result") as mprint:
            mrun.return_value = m.E2eVerifyResult(passed=True)
            with patch.object(sys, "argv", [
                "e2e_verify.py",
                "--skip-vitest",
                "--skip-pytest",
                "--skip-playwright",
            ]):
                rc = m.main()
        assert rc == 0
        _, kwargs = mrun.call_args
        assert kwargs["skip_vitest"] is True
        assert kwargs["skip_pytest"] is True
        assert kwargs["skip_playwright"] is True

    def test_custom_paths(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_e2e_verify") as mrun, \
             patch.object(m, "_print_result") as mprint:
            mrun.return_value = m.E2eVerifyResult(passed=True)
            with patch.object(sys, "argv", [
                "e2e_verify.py",
                "--vitest-config", "/tmp/my-vitest.config.ts",
                "--pytest-path", "/tmp/my-tests",
                "--playwright-config", "/tmp/my-playwright.config.ts",
            ]):
                rc = m.main()
        assert rc == 0
        _, kwargs = mrun.call_args
        assert str(kwargs["vitest_config"]) == "/tmp/my-vitest.config.ts"
        assert str(kwargs["pytest_path"]) == "/tmp/my-tests"
        assert str(kwargs["playwright_config"]) == "/tmp/my-playwright.config.ts"

    def test_exit_code_on_fail(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_e2e_verify") as mrun, \
             patch.object(m, "_print_result"):
            mrun.return_value = m.E2eVerifyResult(passed=False)
            with patch.object(sys, "argv", ["e2e_verify.py"]):
                rc = m.main()
        assert rc == 1


class TestPrintResult:
    def test_prints_output(self, e2e_verify_module, capsys):
        m = e2e_verify_module
        r = m.E2eVerifyResult(
            passed=True,
            vitest=m.VitestResult(passed=True, total=5, passed_count=5),
        )
        m._print_result(r)
        captured = capsys.readouterr()
        assert "PASS" in captured.out
        assert "Vitest" in captured.out

    def test_failure_output(self, e2e_verify_module, capsys):
        m = e2e_verify_module
        r = m.E2eVerifyResult(
            passed=False,
            pytest=m.PytestResult(
                passed=False, total=3, passed_count=1, failed_count=2,
                failures=["test_a", "test_b"],
            ),
        )
        m._print_result(r)
        captured = capsys.readouterr()
        assert "FAIL" in captured.out
        assert "test_a" in captured.out


# ═══════════════════════════════════════════════════════════════════════════════
# Celery Task
# ═══════════════════════════════════════════════════════════════════════════════


class TestCeleryTask:
    def test_task_registered(self, e2e_verify_module):
        """Verify the task name matches what Celery expects."""
        task_func = getattr(e2e_verify_module, "run_e2e_verify_task", None)
        assert task_func is not None
        assert callable(task_func)

    def test_task_returns_dict(self, e2e_verify_module):
        m = e2e_verify_module
        with patch.object(m, "run_e2e_verify") as mrun:
            mrun.return_value = m.E2eVerifyResult(passed=True)
            result = m.run_e2e_verify_task()
        assert isinstance(result, dict)
        assert result["passed"] is True
