"""Test output parsers for various test frameworks."""

import json
import logging
import re
import xml.etree.ElementTree as ET
from typing import Any

logger = logging.getLogger(__name__)


class TestSummary:
    __slots__ = ("passed", "failed", "skipped", "error", "total", "output")

    def __init__(
        self,
        passed: int = 0,
        failed: int = 0,
        skipped: int = 0,
        error: int = 0,
        total: int = 0,
        output: str = "",
    ) -> None:
        self.passed = passed
        self.failed = failed
        self.skipped = skipped
        self.error = error
        self.total = total
        self.output = output

    @property
    def pass_rate(self) -> float:
        effective = self.total - self.skipped
        if effective == 0:
            return 1.0 if self.total == 0 else 0.0
        return self.passed / effective

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "failed": self.failed,
            "skipped": self.skipped,
            "error": self.error,
            "total": self.total,
            "pass_rate": self.pass_rate,
        }

    def __repr__(self) -> str:
        return (
            f"TestSummary(passed={self.passed}, failed={self.failed}, "
            f"skipped={self.skipped}, error={self.error}, total={self.total})"
        )


class SandboxResult:
    __slots__ = ("exit_code", "timed_out", "duration_ms", "summary", "raw_output", "error_message")

    def __init__(
        self,
        exit_code: int = 0,
        timed_out: bool = False,
        duration_ms: int = 0,
        summary: TestSummary | None = None,
        raw_output: str = "",
        error_message: str = "",
    ) -> None:
        self.exit_code = exit_code
        self.timed_out = timed_out
        self.duration_ms = duration_ms
        self.summary = summary or TestSummary()
        self.raw_output = raw_output
        self.error_message = error_message

    @property
    def passed(self) -> bool:
        if self.timed_out:
            return False
        return self.exit_code == 0 and self.summary.failed == 0 and self.summary.error == 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "exit_code": self.exit_code,
            "timed_out": self.timed_out,
            "duration_ms": self.duration_ms,
            "summary": self.summary.to_dict(),
            "raw_output": self.raw_output[:5000],
            "error_message": self.error_message,
        }


def parse_pytest_junit(xml_content: str) -> TestSummary:
    summary = TestSummary()
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError:
        return summary
    suites: list[ET.Element] = []
    if root.tag == "testsuites":
        suites = root.findall("testsuite")
    elif root.tag == "testsuite":
        suites = [root]
    for suite in suites:
        summary.total += int(suite.get("tests", 0))
        summary.error += int(suite.get("errors", 0))
        summary.failed += int(suite.get("failures", 0))
        summary.skipped += int(suite.get("skipped", 0))
    summary.passed = summary.total - summary.failed - summary.error - summary.skipped
    return summary


def parse_pytest_text(text_output: str) -> TestSummary:
    summary = TestSummary(output=text_output)
    if not text_output:
        return summary

    m = re.search(r"(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+skipped.*?(\d+)\s+error", text_output, re.DOTALL)
    if m:
        summary.passed = int(m.group(1))
        summary.failed = int(m.group(2))
        summary.skipped = int(m.group(3))
        summary.error = int(m.group(4))
        summary.total = summary.passed + summary.failed + summary.skipped + summary.error
        return summary

    m = re.search(r"(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+skipped", text_output, re.DOTALL)
    if m:
        summary.passed = int(m.group(1))
        summary.failed = int(m.group(2))
        summary.skipped = int(m.group(3))
        summary.total = summary.passed + summary.failed + summary.skipped
        return summary

    m = re.search(r"(\d+)\s+passed.*?(\d+)\s+failed", text_output, re.DOTALL)
    if m:
        summary.passed = int(m.group(1))
        summary.failed = int(m.group(2))
        summary.total = summary.passed + summary.failed
        return summary

    m = re.search(r"(\d+)\s+passed", text_output)
    if m and "failed" not in text_output and "error" not in text_output:
        summary.passed = int(m.group(1))
        summary.total = summary.passed
        return summary

    return summary


def parse_pytest(output: str, xml_content: str | None = None) -> TestSummary:
    if xml_content:
        s = parse_pytest_junit(xml_content)
        if s.total > 0:
            return s
    return parse_pytest_text(output)


def parse_jest_json(json_output: str) -> TestSummary:
    summary = TestSummary()
    try:
        data = json.loads(json_output)
    except json.JSONDecodeError:
        return summary
    summary.total = data.get("numTotalTests", 0)
    summary.passed = data.get("numPassedTests", 0)
    summary.failed = data.get("numFailedTests", 0)
    summary.skipped = data.get("numPendingTests", 0)
    summary.error = data.get("numRuntimeErrorTestSuites", 0)
    return summary


def parse_jest_text(text_output: str) -> TestSummary:
    summary = TestSummary(output=text_output)
    if not text_output:
        return summary

    m = re.search(r"Tests:\s*(?:(\d+)\s+failed.*?)?(\d+)\s+passed.*?(\d+)\s+total", text_output)
    if m:
        summary.passed = int(m.group(2))
        summary.total = int(m.group(3))
        summary.failed = int(m.group(1)) if m.group(1) is not None else 0
        return summary

    m = re.search(r"Test Suites:\s*(?:(\d+)\s+failed.*?)?(\d+)\s+passed.*?(\d+)\s+total", text_output)
    if m:
        summary.passed = int(m.group(2))
        summary.total = int(m.group(3))
        summary.failed = int(m.group(1)) if m.group(1) is not None else 0
        return summary

    m = re.search(r"(\d+)\s+passing", text_output)
    if m:
        summary.passed = int(m.group(1))
        m2 = re.search(r"(\d+)\s+failing", text_output)
        if m2:
            summary.failed = int(m2.group(1))
        summary.total = summary.passed + summary.failed
        return summary

    return summary


def parse_jest(output: str, json_output: str | None = None) -> TestSummary:
    if json_output:
        s = parse_jest_json(json_output)
        if s.total > 0:
            return s
    return parse_jest_text(output)


def parse_go_test_json(json_output: str) -> TestSummary:
    summary = TestSummary()
    seen: set[str] = set()
    for line in json_output.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        action = event.get("Action", "")
        test_name = event.get("Test", "")
        if not test_name:
            continue
        if test_name in seen and action in ("pass", "fail", "skip"):
            continue
        if action == "pass" and test_name not in seen:
            summary.passed += 1
            summary.total += 1
            seen.add(test_name)
        elif action == "fail" and test_name not in seen:
            summary.failed += 1
            summary.total += 1
            seen.add(test_name)
        elif action == "skip" and test_name not in seen:
            summary.skipped += 1
            summary.total += 1
            seen.add(test_name)
    return summary


def parse_go_test_text(text_output: str) -> TestSummary:
    summary = TestSummary(output=text_output)
    if not text_output:
        return summary
    has_fail = bool(re.search(r"^FAIL\s+\S+", text_output, re.MULTILINE))
    has_ok = bool(re.search(r"^ok\s+\S+", text_output, re.MULTILINE))
    if has_ok and not has_fail:
        summary.passed = 1
        summary.total = 1
    elif has_fail:
        summary.failed = 1
        summary.total = 1
    return summary


def parse_go_test(output: str, json_output: str | None = None) -> TestSummary:
    if json_output:
        s = parse_go_test_json(json_output)
        if s.total > 0:
            return s
    return parse_go_test_text(output)


def parse_generic(exit_code: int, output: str) -> TestSummary:
    summary = TestSummary(output=output)
    if not output:
        summary.passed = 1 if exit_code == 0 else 0
        summary.total = 1 if exit_code == 0 else 0
        return summary

    m = re.search(r"(\d+)\s+passed", output)
    if m:
        summary.passed = int(m.group(1))

    m = re.search(r"(\d+)\s+failed", output)
    if m:
        summary.failed = int(m.group(1))

    m = re.search(r"(\d+)\s+total", output)
    if m:
        summary.total = int(m.group(1))
    elif summary.passed > 0 or summary.failed > 0 or "test result" in output.lower():
        m_ignored = re.search(r"(\d+)\s+ignored", output)
        summary.skipped = int(m_ignored.group(1)) if m_ignored else 0
        summary.total = summary.passed + summary.failed + summary.skipped
    elif exit_code == 0:
        summary.passed = 1
        summary.total = 1
    else:
        summary.total = summary.passed + summary.failed
    return summary


def detect_framework(command: str) -> str:
    cmd_lower = command.lower()
    if "pytest" in cmd_lower or "py.test" in cmd_lower or "unittest" in cmd_lower:
        return "pytest"
    if "vitest" in cmd_lower:
        return "vitest"
    if "jest" in cmd_lower or "npx jest" in cmd_lower:
        return "jest"
    if "cargo test" in cmd_lower:
        return "cargo"
    if "go test" in cmd_lower or "gotest" in cmd_lower:
        return "go"
    if "mocha" in cmd_lower:
        return "mocha"
    if "rspec" in cmd_lower or "ruby" in cmd_lower:
        return "rspec"
    return "generic"


def parse_test_output(
    exit_code: int,
    output: str,
    command: str = "",
    *,
    json_output: str | None = None,
    xml_content: str | None = None,
) -> TestSummary:
    framework = detect_framework(command)
    if framework == "pytest":
        return parse_pytest(output, xml_content=xml_content)
    elif framework in ("vitest", "jest", "mocha"):
        return parse_jest(output, json_output=json_output)
    elif framework == "go":
        return parse_go_test(output, json_output=json_output)
    else:
        return parse_generic(exit_code, output)
