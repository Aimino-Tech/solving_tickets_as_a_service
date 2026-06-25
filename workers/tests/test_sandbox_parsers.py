"""Tests for workers.sandbox.parsers."""

import json

from workers.sandbox.parsers import (
    TestSummary,
    SandboxResult,
    parse_pytest,
    parse_pytest_text,
    parse_pytest_junit,
    parse_jest,
    parse_jest_json,
    parse_jest_text,
    parse_go_test,
    parse_go_test_json,
    parse_go_test_text,
    parse_generic,
    detect_framework,
    parse_test_output,
)


class TestTestSummary:
    def test_pass_rate(self):
        s = TestSummary(passed=8, failed=2, total=10)
        assert s.pass_rate == 0.8

    def test_pass_rate_zero_total(self):
        s = TestSummary()
        assert s.pass_rate == 1.0

    def test_pass_rate_all_skipped(self):
        s = TestSummary(passed=0, skipped=5, total=5)
        assert s.pass_rate == 0.0

    def test_pass_rate_some_skipped(self):
        s = TestSummary(passed=3, failed=1, skipped=1, total=5)
        assert s.pass_rate == 0.75

    def test_to_dict(self):
        s = TestSummary(passed=5, failed=1, skipped=2, error=0, total=8)
        d = s.to_dict()
        assert d["passed"] == 5
        assert d["failed"] == 1
        assert d["pass_rate"] == 5 / 6


class TestSandboxResult:
    def test_passed(self):
        r = SandboxResult(exit_code=0, summary=TestSummary(passed=10, total=10))
        assert r.passed is True

    def test_failed_exit_code(self):
        r = SandboxResult(exit_code=1, summary=TestSummary(passed=8, failed=2, total=10))
        assert r.passed is False

    def test_failed_tests(self):
        r = SandboxResult(exit_code=0, summary=TestSummary(passed=7, failed=3, total=10))
        assert r.passed is False

    def test_timed_out(self):
        r = SandboxResult(exit_code=-1, timed_out=True)
        assert r.passed is False

    def test_to_dict(self):
        r = SandboxResult(exit_code=0, duration_ms=1500, summary=TestSummary(passed=5, total=5), raw_output="All tests passed")
        d = r.to_dict()
        assert d["passed"] is True
        assert d["exit_code"] == 0
        assert d["duration_ms"] == 1500
        assert d["summary"]["passed"] == 5


class TestDetectFramework:
    def test_pytest(self):
        assert detect_framework("pytest -v tests/") == "pytest"

    def test_vitest(self):
        assert detect_framework("npx vitest run") == "vitest"

    def test_jest(self):
        assert detect_framework("npx jest --coverage") == "jest"

    def test_go(self):
        assert detect_framework("go test ./...") == "go"

    def test_cargo(self):
        assert detect_framework("cargo test --lib") == "cargo"

    def test_mocha(self):
        assert detect_framework("mocha tests/") == "mocha"

    def test_rspec(self):
        assert detect_framework("bundle exec rspec") == "rspec"

    def test_generic(self):
        assert detect_framework("make test") == "generic"


class TestParsePytest:
    def test_text_full(self):
        s = parse_pytest_text("3 passed, 1 failed, 2 skipped, 1 error in 0.12s")
        assert s.passed == 3
        assert s.failed == 1
        assert s.skipped == 2
        assert s.error == 1
        assert s.total == 7

    def test_text_no_error(self):
        s = parse_pytest_text("3 passed, 1 failed, 2 skipped in 0.12s")
        assert s.passed == 3
        assert s.failed == 1
        assert s.skipped == 2
        assert s.total == 6

    def test_text_pass_fail_no_skip(self):
        s = parse_pytest_text("3 passed, 1 failed in 0.12s")
        assert s.passed == 3
        assert s.failed == 1
        assert s.total == 4

    def test_text_pass_only(self):
        s = parse_pytest_text("5 passed in 0.12s")
        assert s.passed == 5
        assert s.total == 5

    def test_text_empty(self):
        s = parse_pytest_text("")
        assert s.total == 0

    def test_text_no_match(self):
        s = parse_pytest_text("collecting ... no tests collected")
        assert s.total == 0

    def test_junit_single_suite(self):
        xml = """<?xml version="1.0"?>
<testsuite name="pytest" tests="42" errors="1" failures="2" skipped="3">
</testsuite>"""
        s = parse_pytest_junit(xml)
        assert s.total == 42
        assert s.error == 1
        assert s.failed == 2
        assert s.skipped == 3
        assert s.passed == 36

    def test_junit_testsuites(self):
        xml = """<?xml version="1.0"?>
<testsuites>
  <testsuite name="suite1" tests="10" errors="0" failures="1" skipped="0"/>
  <testsuite name="suite2" tests="20" errors="1" failures="2" skipped="3"/>
</testsuites>"""
        s = parse_pytest_junit(xml)
        assert s.total == 30
        assert s.error == 1
        assert s.failed == 3
        assert s.skipped == 3
        assert s.passed == 23

    def test_junit_invalid(self):
        s = parse_pytest_junit("not xml")
        assert s.total == 0

    def test_junit_no_attributes(self):
        xml = """<?xml version="1.0"?>
<testsuite name="pytest"></testsuite>"""
        s = parse_pytest_junit(xml)
        assert s.total == 0


class TestParseJest:
    def test_text_full(self):
        s = parse_jest_text("Tests:       1 failed, 5 passed, 6 total")
        assert s.passed == 5
        assert s.failed == 1
        assert s.total == 6

    def test_text_pass_only(self):
        s = parse_jest_text("Tests:       7 passed, 7 total")
        assert s.passed == 7
        assert s.total == 7
        assert s.failed == 0

    def test_text_mocha(self):
        s = parse_jest_text("\n  5 passing (2s)\n  1 failing\n")
        assert s.passed == 5
        assert s.failed == 1
        assert s.total == 6

    def test_text_mocha_pass_only(self):
        s = parse_jest_text("5 passing (2s)")
        assert s.passed == 5
        assert s.total == 5
        assert s.failed == 0

    def test_text_empty(self):
        s = parse_jest_text("")
        assert s.total == 0

    def test_json(self):
        data = {"numTotalTests": 42, "numPassedTests": 38, "numFailedTests": 3, "numPendingTests": 1, "numRuntimeErrorTestSuites": 0}
        s = parse_jest_json(json.dumps(data))
        assert s.total == 42
        assert s.passed == 38
        assert s.failed == 3
        assert s.skipped == 1

    def test_json_invalid(self):
        s = parse_jest_json("not json")
        assert s.total == 0


class TestParseGoTest:
    def test_text_ok(self):
        s = parse_go_test_text("ok  \tgithub.com/user/repo\t0.123s")
        assert s.passed == 1
        assert s.total == 1

    def test_text_fail(self):
        s = parse_go_test_text("FAIL\tgithub.com/user/repo\t0.456s")
        assert s.failed == 1
        assert s.total == 1

    def test_text_empty(self):
        s = parse_go_test_text("")
        assert s.total == 0

    def test_json(self):
        lines = [
            '{"Action":"pass","Test":"TestFoo","Elapsed":0}',
            '{"Action":"fail","Test":"TestBar","Elapsed":0.1}',
            '{"Action":"skip","Test":"TestSlow","Elapsed":0}',
            '{"Action":"pass","Test":"TestBaz","Elapsed":0}',
        ]
        s = parse_go_test_json("\n".join(lines))
        assert s.passed == 2
        assert s.failed == 1
        assert s.skipped == 1
        assert s.total == 4

    def test_json_empty(self):
        s = parse_go_test_json("")
        assert s.total == 0

    def test_json_dedup(self):
        lines = [
            '{"Action":"pass","Test":"TestFoo","Elapsed":0}',
            '{"Action":"pass","Test":"TestFoo","Elapsed":0}',
            '{"Action":"fail","Test":"TestBar","Elapsed":0.1}',
        ]
        s = parse_go_test_json("\n".join(lines))
        assert s.passed == 1
        assert s.failed == 1
        assert s.total == 2


class TestParseGeneric:
    def test_exit_zero(self):
        s = parse_generic(0, "All tests passed")
        assert s.passed == 1
        assert s.total == 1

    def test_exit_nonzero(self):
        s = parse_generic(1, "Some output here")
        assert s.passed == 0
        assert s.total == 0

    def test_with_counts(self):
        s = parse_generic(1, "10 passed, 2 failed, 12 total")
        assert s.passed == 10
        assert s.failed == 2
        assert s.total == 12

    def test_cargo_output(self):
        s = parse_generic(0, "test result: ok. 42 passed; 0 failed; 0 ignored")
        assert s.passed == 42
        assert s.total == 42


class TestParseTestOutput:
    def test_pytest(self):
        s = parse_test_output(0, "3 passed, 1 failed in 0.5s", "pytest -v")
        assert s.passed == 3
        assert s.failed == 1

    def test_jest(self):
        s = parse_test_output(0, "Tests: 1 failed, 5 passed, 6 total", "npx jest")
        assert s.passed == 5
        assert s.failed == 1

    def test_go(self):
        s = parse_test_output(0, "ok  \tgithub.com/test\t0.1s", "go test ./...")
        assert s.passed == 1

    def test_generic(self):
        s = parse_test_output(0, "All good", "make test")
        assert s.passed == 1

    def test_with_xml(self):
        xml = """<?xml version="1.0"?>
<testsuite name="pytest" tests="10" errors="0" failures="2" skipped="1">
</testsuite>"""
        s = parse_test_output(1, "", "pytest", xml_content=xml)
        assert s.total == 10
        assert s.failed == 2
        assert s.passed == 7

    def test_with_json(self):
        data = json.dumps({"numTotalTests": 5, "numPassedTests": 4, "numFailedTests": 1, "numPendingTests": 0, "numRuntimeErrorTestSuites": 0})
        s = parse_test_output(1, "", "jest", json_output=data)
        assert s.total == 5
        assert s.passed == 4
        assert s.failed == 1
