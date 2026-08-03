"""Configuration for the real-time quality scorer module.

All values can be overridden via environment variables.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any


# ── Scoring weights (must sum to 100) ──────────────────────────────────────

SCORER_WEIGHT_TEST_INTEGRITY: float = float(
    os.getenv("SYNTARO_SCORER_WEIGHT_TEST_INTEGRITY", "25.0"),
)
"""Weight for the test integrity dimension (0-100 contribution)."""

SCORER_WEIGHT_HALLUCINATION_RISK: float = float(
    os.getenv("SYNTARO_SCORER_WEIGHT_HALLUCINATION_RISK", "25.0"),
)
"""Weight for hallucination/stub risk dimension."""

SCORER_WEIGHT_DIFF_QUALITY: float = float(
    os.getenv("SYNTARO_SCORER_WEIGHT_DIFF_QUALITY", "25.0"),
)
"""Weight for diff cleanliness and structure dimension."""

SCORER_WEIGHT_REGRESSION_SAFETY: float = float(
    os.getenv("SYNTARO_SCORER_WEIGHT_REGRESSION_SAFETY", "25.0"),
)
"""Weight for regression safety dimension."""


# ── Quality thresholds ─────────────────────────────────────────────────────

SCORER_PASS_THRESHOLD: float = float(os.getenv("SYNTARO_SCORER_PASS_THRESHOLD", "70.0"))
"""Score above which a fix is considered passing quality."""

SCORER_WARN_THRESHOLD: float = float(os.getenv("SYNTARO_SCORER_WARN_THRESHOLD", "50.0"))
"""Score above which a fix passes but should be flagged for review."""

SCORER_FAIL_THRESHOLD: float = float(os.getenv("SYNTARO_SCORER_FAIL_THRESHOLD", "30.0"))
"""Score below which a fix is rejected outright."""


# ── Anti-pattern detection ─────────────────────────────────────────────────

SCORER_STUB_PATTERNS: list[str] = [
    "TODO",
    "FIXME",
    "HACK",
    "XXX",
    "placeholder",
    "implement this later",
    "pass  # TODO",
    "return None  # TODO",
    "not implemented",
    "stub",
]
"""Patterns that indicate stubs or placeholders in fix code."""

SCORER_DEBUG_PATTERNS: list[str] = [
    "console.log",
    "print(",
    "print (",
    "logging.debug",
    "var_dump",
    "dump(",
]
"""Patterns that indicate debug code left in the fix."""


# ── Structured dataclass ───────────────────────────────────────────────────


@dataclass
class ScorerConfig:
    """Configuration for the quality scorer.

    Controls dimension weights, pass/fail thresholds, and detection patterns.
    """

    weight_test_integrity: float = SCORER_WEIGHT_TEST_INTEGRITY
    weight_hallucination_risk: float = SCORER_WEIGHT_HALLUCINATION_RISK
    weight_diff_quality: float = SCORER_WEIGHT_DIFF_QUALITY
    weight_regression_safety: float = SCORER_WEIGHT_REGRESSION_SAFETY

    pass_threshold: float = SCORER_PASS_THRESHOLD
    warn_threshold: float = SCORER_WARN_THRESHOLD
    fail_threshold: float = SCORER_FAIL_THRESHOLD

    stub_patterns: list[str] = field(default_factory=lambda: list(SCORER_STUB_PATTERNS))
    debug_patterns: list[str] = field(default_factory=lambda: list(SCORER_DEBUG_PATTERNS))

    def __post_init__(self) -> None:
        """Validate that weights sum to 100 (with tolerance)."""
        total = (
            self.weight_test_integrity
            + self.weight_hallucination_risk
            + self.weight_diff_quality
            + self.weight_regression_safety
        )
        if abs(total - 100.0) > 0.01:
            import warnings

            warnings.warn(
                f"Scorer weights sum to {total}, expected 100. "
                "Scoring may produce unexpected results.",
                stacklevel=2,
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "weights": {
                "test_integrity": self.weight_test_integrity,
                "hallucination_risk": self.weight_hallucination_risk,
                "diff_quality": self.weight_diff_quality,
                "regression_safety": self.weight_regression_safety,
            },
            "thresholds": {
                "pass": self.pass_threshold,
                "warn": self.warn_threshold,
                "fail": self.fail_threshold,
            },
            "patterns": {
                "stub_count": len(self.stub_patterns),
                "debug_count": len(self.debug_patterns),
            },
        }


def get_config() -> dict[str, Any]:
    """Return the full scorer configuration as a dict."""
    return ScorerConfig().to_dict()
