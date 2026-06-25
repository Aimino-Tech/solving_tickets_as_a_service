"""Real-time quality scoring for fix diffs.

Provides ``score_fix()`` which evaluates a fix diff across four dimensions
and returns a 0-100 quality score with detailed breakdown.

Scoring dimensions (weighted, default 25 pts each):
    1. Test integrity  — tests exist, pass, have real assertions
    2. Hallucination risk — no stubs, TODOs, placeholders
    3. Diff quality    — clean diff, no debug code, proper structure
    4. Regression safety — existing tests preserved, no breaking changes
"""

from __future__ import annotations

import logging
import re
from typing import Any

from workers.quality.scorer_config import ScorerConfig

logger = logging.getLogger(__name__)


# ── Public result type ─────────────────────────────────────────────────────


class ScorerResult:
    """Result from a quality scorer evaluation.

    Attributes:
        score: Overall quality score 0-100 (int).
        breakdown: Per-dimension scores and details.
        passed: Whether the score meets the pass threshold.
        config_used: Snapshot of config used for scoring.
    """

    def __init__(
        self,
        score: int,
        breakdown: dict[str, Any],
        passed: bool,
        config_used: dict[str, Any],
    ) -> None:
        self.score = score
        self.breakdown = breakdown
        self.passed = passed
        self.config_used = config_used

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "breakdown": self.breakdown,
            "passed": self.passed,
            "config_used": self.config_used,
        }

    def __repr__(self) -> str:
        return f"ScorerResult(score={self.score}, passed={self.passed})"


# ── Dimension scorers ──────────────────────────────────────────────────────


def _score_test_integrity(
    diff_text: str,
    test_results: dict[str, Any] | None,
) -> tuple[float, dict[str, Any]]:
    """Score 0.0-1.0 for test integrity.

    Rewards:
    - Tests are present in the diff (added/modified test files).
    - Tests contain real assertions (assert, expect, should, etc.).
    - Test results indicate passing (if provided).
    - Test results include non-zero assertion counts.
    """
    details: dict[str, Any] = {}
    score = 0.0

    # Detect test files in the diff
    test_file_pattern = re.compile(
        r"^\+\+\+ b/(?:test|tests|spec|__tests__)/|\.(test|spec)\.(py|ts|js|tsx|jsx)$",
        re.IGNORECASE | re.MULTILINE,
    )
    test_files = test_file_pattern.findall(diff_text)
    details["test_files_changed"] = len(test_files)

    # Detect assertion statements in added lines
    added_lines = _get_added_lines(diff_text)
    assertion_pattern = re.compile(
        r"\b(?:assert|expect|should|assertEqual|assertTrue|assertFalse|"
        r"assertThat|verify|check_equal|assertEquals|assertIn|assertIs)\b",
        re.IGNORECASE,
    )
    assertion_count = sum(1 for line in added_lines if assertion_pattern.search(line))
    details["assertion_count"] = assertion_count

    if test_files:
        score += 0.4  # tests exist
        if assertion_count >= 3:
            score += 0.6  # strong assertions
        elif assertion_count >= 1:
            score += 0.3  # some assertions
        else:
            score += 0.1  # tests but vacuous
    else:
        score += 0.0  # no tests

    # Incorporate test results if provided
    if test_results:
        passed = test_results.get("passed", False)
        total = test_results.get("total", 0)
        details["test_results_passed"] = passed
        details["test_results_total"] = total

        if passed and total > 0:
            score += 0.3  # tests pass
            if total >= 5:
                score += 0.2  # meaningful test suite
        elif total == 0:
            score += 0.0  # no tests run
        else:
            score += 0.1  # some tests ran
    else:
        details["test_results_passed"] = None

    return min(max(score, 0.0), 1.0), details


def _score_hallucination_risk(
    diff_text: str,
    stub_patterns: list[str],
) -> tuple[float, dict[str, Any]]:
    """Score 0.0-1.0 for hallucination / stub risk.

    Penalises:
    - TODO, FIXME, HACK comments in added code.
    - Placeholder implementations (pass, return None stubs).
    - "Not implemented" / stub patterns.
    - Debug print statements left in production code.
    """
    details: dict[str, Any] = {}
    added_lines = _get_added_lines(diff_text)
    total_added = len(added_lines)
    details["total_added_lines"] = total_added

    if total_added == 0:
        details["stub_count"] = 0
        details["debug_count"] = 0
        return 1.0, details  # no diff = no hallucination risk

    # Count stub pattern matches (case-insensitive per-line search)
    stub_findings: list[dict[str, Any]] = []
    for pattern in stub_patterns:
        for lineno, line in enumerate(added_lines, 1):
            if pattern.lower() in line.lower():
                stub_findings.append({"pattern": pattern, "line": lineno, "snippet": line.strip()[:80]})

    details["stub_count"] = len(stub_findings)
    details["stub_findings"] = stub_findings[:10]  # cap at 10

    if not stub_findings:
        score = 1.0
    elif len(stub_findings) == 1:
        score = 0.5
    elif len(stub_findings) <= 3:
        score = 0.2
    else:
        score = 0.0

    return min(max(score, 0.0), 1.0), details


def _score_diff_quality(
    diff_text: str,
    debug_patterns: list[str],
) -> tuple[float, dict[str, Any]]:
    """Score 0.0-1.0 for diff quality and cleanliness.

    Rewards:
    - Concise, focused diffs (not too large).
    - No debug/print statements.
    - No large blocks of commented-out code.
    - Proper file structure (changes are in right places).
    """
    details: dict[str, Any] = {}
    added_lines = _get_added_lines(diff_text)
    removed_lines = _get_removed_lines(diff_text)
    total_added = len(added_lines)
    total_removed = len(removed_lines)

    details["added_lines"] = total_added
    details["removed_lines"] = total_removed

    # Penalise excessively large diffs
    if total_added == 0 and total_removed == 0:
        return 0.0, details  # empty diff

    score = 0.0

    # Size scoring
    if total_added <= 30:
        score += 0.3  # concise
    elif total_added <= 100:
        score += 0.2  # moderate
    elif total_added <= 300:
        score += 0.1  # large but ok
    else:
        score += 0.0  # too large

    # Ratio of added vs removed (cleanup vs bloat)
    if total_removed > 0 and total_added > 0:
        ratio = total_removed / total_added
        if ratio > 0.3:
            score += 0.2  # good cleanup
        elif ratio > 0.1:
            score += 0.1  # some removal
    elif total_removed == 0 and total_added > 0:
        score += 0.05  # only additions

    # Debug pattern detection
    debug_findings: list[dict[str, Any]] = []
    for pattern in debug_patterns:
        for lineno, line in enumerate(added_lines, 1):
            if pattern.lower() in line.lower():
                debug_findings.append({"pattern": pattern, "line": lineno, "snippet": line.strip()[:80]})

    details["debug_count"] = len(debug_findings)
    details["debug_findings"] = debug_findings[:5]

    if debug_findings:
        score -= 0.3 * min(len(debug_findings), 3)  # penalty per finding

    # Commented-out code detection
    commented_lines = sum(1 for line in added_lines if re.match(r"^\s*//\s*|^\s*#\s*|^\s*/\*|^\s*\*", line))
    details["commented_lines"] = commented_lines
    if commented_lines > 5:
        score -= 0.2

    return min(max(score, 0.0), 1.0), details


def _score_regression_safety(
    diff_text: str,
    test_results: dict[str, Any] | None,
) -> tuple[float, dict[str, Any]]:
    """Score 0.0-1.0 for regression safety.

    Rewards:
    - Existing tests still pass (from test_results).
    - Fix is focused (doesn't touch unrelated files).
    - No deletions of existing functionality.
    """
    details: dict[str, Any] = {}
    score = 0.0

    # Check test results for regressions
    if test_results:
        passed = test_results.get("passed", False)
        previous_passed = test_results.get("previous_passed", None)
        total = test_results.get("total", 0)

        details["tests_passed"] = passed
        details["previous_tests_passed"] = previous_passed
        details["test_count"] = total

        if passed and total > 0:
            score += 0.5  # tests pass
            if previous_passed is True:
                score += 0.2  # no regression from baseline
        elif passed is False and total > 0:
            score += 0.0  # regression!
    else:
        details["tests_passed"] = None
        score += 0.2  # neutral when no results

    # Check diff scope — touching fewer files is safer
    files_changed = _count_files_changed(diff_text)
    details["files_changed"] = files_changed

    if files_changed == 0:
        score += 0.0
    elif files_changed == 1:
        score += 0.3  # single file
    elif files_changed <= 3:
        score += 0.2  # few files
    elif files_changed <= 5:
        score += 0.1
    else:
        score += 0.0  # too many files

    return min(max(score, 0.0), 1.0), details


# ── Helpers ────────────────────────────────────────────────────────────────


def _get_added_lines(diff_text: str) -> list[str]:
    """Extract lines that start with ``+`` (added lines) from a unified diff.

    Excludes the ``+++`` header line.
    """
    lines: list[str] = []
    for line in diff_text.split("\n"):
        if line.startswith("+") and not line.startswith("+++"):
            lines.append(line[1:])  # strip the leading '+'
    return lines


def _get_removed_lines(diff_text: str) -> list[str]:
    """Extract lines that start with ``-`` (removed lines) from a unified diff.

    Excludes the ``---`` header line.
    """
    lines: list[str] = []
    for line in diff_text.split("\n"):
        if line.startswith("-") and not line.startswith("---"):
            lines.append(line[1:])
    return lines


def _count_files_changed(diff_text: str) -> int:
    """Count the number of files changed in a unified diff."""
    return len(re.findall(r"^\+\+\+ b/", diff_text, re.MULTILINE))


# ── Main scorer ────────────────────────────────────────────────────────────


def score_fix(
    diff_text: str,
    test_results: dict[str, Any] | None = None,
    config: ScorerConfig | None = None,
) -> ScorerResult:
    """Score the quality of a fix diff on a 0-100 integer scale.

    Evaluates four dimensions (test integrity, hallucination risk, diff
    quality, regression safety) and produces a weighted composite score.

    Args:
        diff_text: Unified diff text of the fix.
        test_results: Optional dict with keys ``passed`` (bool),
            ``total`` (int), and optionally ``previous_passed`` (bool).
        config: :class:`ScorerConfig` instance. Uses defaults if ``None``.

    Returns:
        A :class:`ScorerResult` with the overall score, dimension
        breakdown, and pass/fail verdict.

    Safety guarantees:
        - Always returns a valid 0-100 integer score.
        - Never raises on malformed diff text.
        - Default config is used when ``config`` is ``None``.
        - All dimension sub-scores are clamped to [0.0, 1.0].
    """
    cfg = config or ScorerConfig()
    logger.debug(
        "Scoring fix — diff_len=%d test_results=%s",
        len(diff_text),
        bool(test_results),
    )

    # Score each dimension → float in [0.0, 1.0]
    test_score, test_details = _score_test_integrity(diff_text, test_results)
    hallucination_score, hall_details = _score_hallucination_risk(
        diff_text, cfg.stub_patterns,
    )
    diff_score, diff_details = _score_diff_quality(diff_text, cfg.debug_patterns)
    regression_score, reg_details = _score_regression_safety(diff_text, test_results)

    # Weighted composite → 0.0-1.0
    weighted = (
        cfg.weight_test_integrity * test_score
        + cfg.weight_hallucination_risk * hallucination_score
        + cfg.weight_diff_quality * diff_score
        + cfg.weight_regression_safety * regression_score
    ) / 100.0

    # Scale to 0-100 integer
    final_score = max(0, min(100, round(weighted * 100)))

    # Determine pass/fail
    passed = final_score >= cfg.pass_threshold

    breakdown: dict[str, Any] = {
        "test_integrity": {
            "score": round(test_score, 4),
            "weighted_contribution": round(cfg.weight_test_integrity * test_score / 100.0, 4),
            "details": test_details,
        },
        "hallucination_risk": {
            "score": round(hallucination_score, 4),
            "weighted_contribution": round(cfg.weight_hallucination_risk * hallucination_score / 100.0, 4),
            "details": hall_details,
        },
        "diff_quality": {
            "score": round(diff_score, 4),
            "weighted_contribution": round(cfg.weight_diff_quality * diff_score / 100.0, 4),
            "details": diff_details,
        },
        "regression_safety": {
            "score": round(regression_score, 4),
            "weighted_contribution": round(cfg.weight_regression_safety * regression_score / 100.0, 4),
            "details": reg_details,
        },
        "raw_weighted": round(weighted, 4),
    }

    result = ScorerResult(
        score=final_score,
        breakdown=breakdown,
        passed=passed,
        config_used=cfg.to_dict(),
    )

    logger.info(
        "Score result — score=%d test=%.2f hall=%.2f diff=%.2f reg=%.2f passed=%s",
        final_score,
        test_score,
        hallucination_score,
        diff_score,
        regression_score,
        passed,
    )
    return result
