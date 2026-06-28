"""Verification configuration."""

import os
from typing import Any

SCORE_WEIGHT_TEST_PASS_RATE: float = float(os.getenv("STAS_VERIFY_WEIGHT_TEST", "0.7"))
SCORE_WEIGHT_AC_COVERAGE: float = float(os.getenv("STAS_VERIFY_WEIGHT_AC", "0.3"))
MIN_PASS_RATE: float = float(os.getenv("STAS_VERIFY_MIN_PASS_RATE", "0.8"))
MIN_SCORE: float = float(os.getenv("STAS_VERIFY_MIN_SCORE", "0.7"))
DEFAULT_TIMEOUT_SECONDS: int = int(os.getenv("STAS_SANDBOX_TIMEOUT_SECONDS", "300"))
LARGE_PROJECT_TIMEOUT_SECONDS: int = int(os.getenv("STAS_SANDBOX_TIMEOUT_LARGE_SECONDS", "900"))
DEFAULT_MEMORY_LIMIT: str = os.getenv("STAS_SANDBOX_MEMORY", "2g")
DEFAULT_CPU_LIMIT: float = float(os.getenv("STAS_SANDBOX_CPU", "1.0"))
SECCOMP_PROFILE: str = os.getenv("STAS_SECCOMP_PROFILE", "")
APPARMOR_PROFILE: str = os.getenv("STAS_APPARMOR_PROFILE", "")
SANDBOX_NETWORK_DISABLED: bool = os.getenv("STAS_SANDBOX_NETWORK_DISABLED", "false").lower() == "true"
SANDBOX_READ_ONLY_ROOTFS: bool = os.getenv("STAS_SANDBOX_READ_ONLY", "true").lower() == "true"

FRAMEWORK_COMMANDS: dict[str, str] = {
    "pytest": "python -m pytest -v --tb=short --junitxml=.stas-test-report.xml 2>&1",
    "pytest_no_xml": "python -m pytest -v --tb=short 2>&1",
    "vitest": "npx vitest run --reporter=verbose 2>&1",
    "vitest_json": "npx vitest run --reporter=json --outputFile=.stas-test-results.json 2>&1",
    "jest": "npx jest --verbose 2>&1",
    "jest_json": "npx jest --json --outputFile=.stas-test-results.json 2>&1",
    "go_test": "go test ./... -v 2>&1",
    "go_test_json": "go test ./... -json 2>&1",
    "cargo_test": "cargo test 2>&1",
    "npm_test": "npm test 2>&1",
    "make_test": "make test 2>&1",
}

LANGUAGE_IMAGES: dict[str, str] = {
    "python": os.getenv("STAS_IMAGE_PYTHON", "python:3.12-slim"),
    "node": os.getenv("STAS_IMAGE_NODE", "node:22-slim"),
    "go": os.getenv("STAS_IMAGE_GO", "golang:1.23-alpine"),
    "rust": os.getenv("STAS_IMAGE_RUST", "rust:1.78-slim"),
    "ruby": os.getenv("STAS_IMAGE_RUBY", "ruby:3.3-slim"),
    "java": os.getenv("STAS_IMAGE_JAVA", "eclipse-temurin:21-jdk"),
    "generic": os.getenv("STAS_IMAGE_GENERIC", "python:3.12-slim"),
}


def get_config() -> dict[str, Any]:
    """Return the full config dict."""
    return {
        "score_weights": {
            "test_pass_rate": SCORE_WEIGHT_TEST_PASS_RATE,
            "ac_coverage": SCORE_WEIGHT_AC_COVERAGE,
        },
        "thresholds": {
            "min_pass_rate": MIN_PASS_RATE,
            "min_score": MIN_SCORE,
        },
        "timeouts": {
            "default_seconds": DEFAULT_TIMEOUT_SECONDS,
            "large_project_seconds": LARGE_PROJECT_TIMEOUT_SECONDS,
        },
        "resources": {
            "memory_limit": DEFAULT_MEMORY_LIMIT,
            "cpu_limit": DEFAULT_CPU_LIMIT,
        },
        "security": {
            "seccomp_profile": SECCOMP_PROFILE,
            "apparmor_profile": APPARMOR_PROFILE,
            "network_disabled": SANDBOX_NETWORK_DISABLED,
            "read_only_rootfs": SANDBOX_READ_ONLY_ROOTFS,
        },
        "frameworks": dict(FRAMEWORK_COMMANDS),
        "images": dict(LANGUAGE_IMAGES),
    }
