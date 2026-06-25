from dataclasses import dataclass
from typing import Any


@dataclass
class SandboxResult:
    passed: bool
    output: str
    duration: float
    summary: dict[str, Any] | None = None


@dataclass
class TestSummary:
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    total: int = 0
    duration: float = 0.0


def detect_framework(output: str) -> str:
    return "unknown"


def parse_test_output(output: str, framework: str = "auto") -> SandboxResult:
    return SandboxResult(passed=True, output=output, duration=0.0)
