"""PR rating and quality improvement feedback loop.

Provides ``rate_pr()`` for scoring a PR across multiple dimensions,
``improve_from_feedback()`` to generate actionable improvement suggestions,
and ``track_improvement()`` to monitor quality trends over time.

The feedback loop is designed to:
1. Rate a PR on code quality, test coverage, diff hygiene, and AC alignment
2. Collect structured feedback with evidence per dimension
3. Track rating history to surface quality trends and regressions
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


# ── Rating dimension enum ────────────────────────────────────────────────────


class FeedbackDimension(str, Enum):
    """Dimensions evaluated during PR feedback rating."""

    CODE_QUALITY = "code_quality"
    TEST_COVERAGE = "test_coverage"
    DIFF_HYGIENE = "diff_hygiene"
    AC_ALIGNMENT = "ac_alignment"


# ── Data models ──────────────────────────────────────────────────────────────


@dataclass
class DimensionRating:
    """Rating for a single feedback dimension.

    Attributes:
        dimension: Which dimension this rating applies to.
        score: Normalized 0.0-1.0 score.
        evidence: Specific observations supporting the score.
        suggestions: List of actionable improvement suggestions.
    """

    dimension: FeedbackDimension
    score: float
    evidence: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.score = max(0.0, min(1.0, self.score))

    def to_dict(self) -> dict[str, Any]:
        return {
            "dimension": self.dimension.value,
            "score": round(self.score, 4),
            "evidence": self.evidence,
            "suggestions": self.suggestions,
        }


@dataclass
class PRFeedback:
    """Complete feedback result for a single PR review.

    Attributes:
        pr_number: GitHub PR number.
        pr_title: PR title.
        overall_score: Weighted composite score 0.0-1.0.
        dimensions: Per-dimension ratings.
        summary: Human-readable feedback summary.
        loop_iteration: Which iteration of the feedback loop (for tracking).
    """

    pr_number: int
    pr_title: str
    overall_score: float
    dimensions: list[DimensionRating] = field(default_factory=list)
    summary: str = ""
    loop_iteration: int = 0

    def __post_init__(self) -> None:
        self.overall_score = max(0.0, min(1.0, self.overall_score))

    def to_dict(self) -> dict[str, Any]:
        return {
            "pr_number": self.pr_number,
            "pr_title": self.pr_title,
            "overall_score": round(self.overall_score, 4),
            "dimensions": [d.to_dict() for d in self.dimensions],
            "summary": self.summary,
            "loop_iteration": self.loop_iteration,
        }


@dataclass
class FeedbackResult:
    """Result of running the feedback loop, including history tracking.

    Attributes:
        current: The latest PRFeedback.
        history: Ordered list of previous feedback results (by iteration).
        improved: Whether quality improved since the last iteration.
        delta: Change in overall score since the last iteration.
    """

    current: PRFeedback
    history: list[PRFeedback] = field(default_factory=list)
    improved: bool = False
    delta: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "current": self.current.to_dict(),
            "history": [h.to_dict() for h in self.history],
            "improved": self.improved,
            "delta": round(self.delta, 4),
        }


# ── Feedback loop ────────────────────────────────────────────────────────────


@dataclass
class FeedbackLoop:
    """Feedback loop that rates PRs and tracks improvement over time.

    Maintains a history of feedback ratings so callers can detect whether
    quality is trending up, down, or flat across iterations.
    """

    history: list[PRFeedback] = field(default_factory=list)
    max_history: int = 50
    _iteration: int = 0

    # Default dimension weights (must sum to 1.0)
    weights: dict[FeedbackDimension, float] = field(default_factory=lambda: {
        FeedbackDimension.CODE_QUALITY: 0.35,
        FeedbackDimension.TEST_COVERAGE: 0.30,
        FeedbackDimension.DIFF_HYGIENE: 0.20,
        FeedbackDimension.AC_ALIGNMENT: 0.15,
    })

    def _validate_weights(self) -> None:
        total = sum(self.weights.values())
        if abs(total - 1.0) > 0.01:
            logger.warning(
                "FeedbackLoop weights sum to %.2f, expected 1.0. "
                "Scoring may be skewed.",
                total,
            )

    def rate(
        self,
        diff_text: str,
        pr_number: int,
        pr_title: str = "",
        acceptance_criteria: list[str] | None = None,
        test_results: dict[str, Any] | None = None,
    ) -> PRFeedback:
        """Rate a PR diff and return structured feedback.

        Evaluates the PR across all configured dimensions and produces a
        weighted composite score. Previous history is preserved for trend
        analysis via ``run()``.

        Args:
            diff_text: Unified diff of the PR changes.
            pr_number: GitHub PR number.
            pr_title: Optional PR title.
            acceptance_criteria: List of AC strings to check alignment.
            test_results: Optional dict with ``passed`` (bool) and ``total`` (int).

        Returns:
            A :class:`PRFeedback` with per-dimension ratings and suggestions.
        """
        self._validate_weights()
        self._iteration += 1

        dimensions: list[DimensionRating] = [
            self._rate_code_quality(diff_text),
            self._rate_test_coverage(diff_text, test_results),
            self._rate_diff_hygiene(diff_text),
            self._rate_ac_alignment(diff_text, acceptance_criteria),
        ]

        overall = sum(
            self.weights.get(d.dimension, 0.0) * d.score
            for d in dimensions
        )

        summary = self._build_summary(dimensions, overall)

        feedback = PRFeedback(
            pr_number=pr_number,
            pr_title=pr_title,
            overall_score=overall,
            dimensions=dimensions,
            summary=summary,
            loop_iteration=self._iteration,
        )

        self.history.append(feedback)
        if len(self.history) > self.max_history:
            self.history.pop(0)

        return feedback

    def run(
        self,
        diff_text: str,
        pr_number: int,
        pr_title: str = "",
        acceptance_criteria: list[str] | None = None,
        test_results: dict[str, Any] | None = None,
    ) -> FeedbackResult:
        """Run one iteration of the feedback loop and compare with history.

        This is the main entry point. It rates the PR, stores the result,
        and compares it against the previous iteration to measure improvement.

        Args:
            Same as ``rate()``.

        Returns:
            A :class:`FeedbackResult` with the current rating, history, and
            delta since the last iteration.
        """
        previous = self.history[-1] if self.history else None

        current = self.rate(
            diff_text=diff_text,
            pr_number=pr_number,
            pr_title=pr_title,
            acceptance_criteria=acceptance_criteria,
            test_results=test_results,
        )

        if previous is not None:
            delta = current.overall_score - previous.overall_score
            improved = delta > 0.01
        else:
            delta = 0.0
            improved = False

        return FeedbackResult(
            current=current,
            history=list(self.history[:-1]),  # all except the just-added
            improved=improved,
            delta=delta,
        )

    # ── Per-dimension raters ──────────────────────────────────────────────

    @staticmethod
    def _rate_code_quality(diff_text: str) -> DimensionRating:
        """Rate code quality based on the diff.

        Rewards:
        - Descriptive variable/function names.
        - Proper error handling (try/except, error returns).
        - Comments explaining non-obvious logic.
        - No debug print statements.
        """
        evidence: list[str] = []
        suggestions: list[str] = []
        score = 0.5  # neutral baseline

        added_lines = _get_added_lines(diff_text)

        if not added_lines:
            return DimensionRating(
                dimension=FeedbackDimension.CODE_QUALITY,
                score=0.5,
                evidence=["No added code to evaluate"],
                suggestions=[],
            )

        total = len(added_lines)

        # Check for type annotations (Python) or type annotations in TS
        typed_lines = sum(
            1 for line in added_lines
            if re.search(r":\s*(str|int|float|bool|list|dict|set|tuple|Optional|Any|None)\b", line)
        )
        if typed_lines / max(total, 1) > 0.3:
            score += 0.2
            evidence.append(f"{typed_lines}/{total} lines have type annotations")
        else:
            suggestions.append("Add type annotations to improve code quality")

        # Check for error handling patterns
        has_error_handling = any(
            re.search(r"\b(try|except|raise|return None|error|fail|handle)\b", line)
            for line in added_lines
        )
        if has_error_handling:
            score += 0.15
            evidence.append("Error handling detected in diff")
        else:
            suggestions.append("Consider adding error handling for edge cases")

        # Check for debug prints (penalty)
        debug_lines = sum(
            1 for line in added_lines
            if re.search(r"\b(print\(|console\.log|logging\.debug)\b", line)
        )
        if debug_lines > 0:
            score -= 0.2 * min(debug_lines, 3)
            evidence.append(f"Found {debug_lines} debug print statement(s)")
            suggestions.append("Remove debug print statements before shipping")
        else:
            evidence.append("No debug print statements detected")

        # Check for meaningful function/variable names
        short_names = sum(
            1 for line in added_lines
            if re.search(r"\b[a-z]_[a-z]?\b", line)  # very short underscored names
            and not re.search(r"def |class |import |from ", line)
        )
        if short_names > 2:
            suggestions.append("Use more descriptive variable names")

        return DimensionRating(
            dimension=FeedbackDimension.CODE_QUALITY,
            score=max(0.0, min(1.0, score)),
            evidence=evidence,
            suggestions=suggestions,
        )

    @staticmethod
    def _rate_test_coverage(
        diff_text: str,
        test_results: dict[str, Any] | None,
    ) -> DimensionRating:
        """Rate test coverage of the PR changes.

        Rewards:
        - New/modified test files in the diff.
        - Real assertions (not vacuous).
        - Test results indicate passing (if provided).
        """
        evidence: list[str] = []
        suggestions: list[str] = []
        score = 0.3  # start low — tests are important

        added_lines = _get_added_lines(diff_text)

        # Detect test files
        test_file_pattern = re.compile(
            r"^\+\+\+ b/(?:test|tests|spec|__tests__)/|\.(test|spec)\.(py|ts|js|tsx|jsx)$",
            re.IGNORECASE | re.MULTILINE,
        )
        test_files = test_file_pattern.findall(diff_text)

        if test_files:
            score += 0.2
            evidence.append(f"Test files changed: {len(test_files)}")

            # Check for real assertions
            assertion_pattern = re.compile(
                r"\b(?:assert|expect|should|assertEqual|assertTrue|assertFalse|"
                r"assertThat|verify|check_equal|assertEquals|assertIn|assertIs|"
                r"toStrictEqual|toBe|toEqual)\b",
                re.IGNORECASE,
            )
            assertion_count = sum(
                1 for line in added_lines if assertion_pattern.search(line)
            )
            if assertion_count >= 3:
                score += 0.3
                evidence.append(f"Found {assertion_count} assertions")
            elif assertion_count >= 1:
                score += 0.15
                evidence.append(f"Found {assertion_count} assertion(s)")
                suggestions.append("Add more assertions to cover edge cases")
            else:
                suggestions.append("Add assertions to test files (tests appear vacuous)")
        else:
            suggestions.append("Add tests for the changes in this PR")

        # Incorporate external test results
        if test_results:
            passed = test_results.get("passed", False)
            total = test_results.get("total", 0)
            if passed and total > 0:
                score += 0.2
                evidence.append(f"Test suite passed ({total} tests)")
            elif total > 0:
                score -= 0.1
                evidence.append(f"Test suite has failures ({total} tests)")
        else:
            evidence.append("No external test results provided")

        return DimensionRating(
            dimension=FeedbackDimension.TEST_COVERAGE,
            score=max(0.0, min(1.0, score)),
            evidence=evidence,
            suggestions=suggestions,
        )

    @staticmethod
    def _rate_diff_hygiene(diff_text: str) -> DimensionRating:
        """Rate diff hygiene — conciseness, focus, cleanliness.

        Rewards:
        - Small, focused diffs.
        - High remove-to-add ratio (cleanup).
        - No commented-out code blocks.
        - No TODO/FIXME/HACK markers.
        """
        evidence: list[str] = []
        suggestions: list[str] = []
        score = 0.5  # neutral

        added_lines = _get_added_lines(diff_text)
        removed_lines = _get_removed_lines(diff_text)
        total_added = len(added_lines)
        total_removed = len(removed_lines)

        if total_added == 0 and total_removed == 0:
            return DimensionRating(
                dimension=FeedbackDimension.DIFF_HYGIENE,
                score=0.3,
                evidence=["Empty diff — no changes"],
                suggestions=["Ensure the diff contains meaningful changes"],
            )

        # Size scoring
        if total_added <= 30:
            score += 0.15
            evidence.append(f"Concise diff ({total_added} added lines)")
        elif total_added <= 100:
            score += 0.05
            evidence.append(f"Moderate diff ({total_added} added lines)")
        elif total_added > 300:
            score -= 0.1
            suggestions.append("Consider splitting this diff into smaller PRs")

        # Removal ratio
        if total_removed > 0:
            removal_ratio = total_removed / max(total_added, 1)
            if removal_ratio > 0.3:
                score += 0.15
                evidence.append(f"Good cleanup ({total_removed} lines removed)")
            elif removal_ratio > 0.1:
                score += 0.05

        # Commented-out code penalty
        commented_lines = sum(
            1 for line in added_lines
            if re.match(r"^\s*//\s|^\s*#\s|^\s*/\*|^\s*\*", line)
        )
        if commented_lines > 5:
            score -= 0.15
            suggestions.append("Remove commented-out code before shipping")
        elif commented_lines > 0:
            evidence.append(f"{commented_lines} comment-only lines (low risk)")

        # TODO/FIXME stink
        todo_lines = sum(
            1 for line in added_lines
            if re.search(r"\b(TODO|FIXME|HACK|XXX)\b", line)
        )
        if todo_lines > 0:
            score -= 0.15 * min(todo_lines, 2)
            evidence.append(f"Found {todo_lines} TODO/FIXME marker(s)")
            suggestions.append("Resolve TODO/FIXME markers or track in an issue")
        else:
            evidence.append("No TODO/FIXME markers detected")

        return DimensionRating(
            dimension=FeedbackDimension.DIFF_HYGIENE,
            score=max(0.0, min(1.0, score)),
            evidence=evidence,
            suggestions=suggestions,
        )

    @staticmethod
    def _rate_ac_alignment(
        diff_text: str,
        acceptance_criteria: list[str] | None,
    ) -> DimensionRating:
        """Rate how well the diff aligns with acceptance criteria.

        When ACs are provided, checks for keyword overlap between AC
        descriptions and the diff context. Without ACs, returns a neutral
        score with a suggestion.
        """
        evidence: list[str] = []
        suggestions: list[str] = []

        if not acceptance_criteria:
            return DimensionRating(
                dimension=FeedbackDimension.AC_ALIGNMENT,
                score=0.5,
                evidence=["No acceptance criteria provided for comparison"],
                suggestions=["Add acceptance criteria to enable AC alignment checks"],
            )

        if not acceptance_criteria:
            return DimensionRating(
                dimension=FeedbackDimension.AC_ALIGNMENT,
                score=0.5,
                evidence=["Empty acceptance criteria list"],
                suggestions=["Define clear, testable acceptance criteria"],
            )

        diff_lower = diff_text.lower()

        matched_ac = 0
        for ac in acceptance_criteria:
            # Extract keywords from AC (skip stopwords)
            keywords = [
                w.lower() for w in re.findall(r"[a-zA-Z_]{3,}", ac)
                if w.lower() not in {"the", "and", "for", "that", "this", "with", "should", "will"}
            ]
            if not keywords:
                continue
            # If any keyword appears in the diff, consider it aligned
            if any(kw in diff_lower for kw in keywords):
                matched_ac += 1

        total_ac = len(acceptance_criteria)
        if total_ac > 0:
            alignment_ratio = matched_ac / total_ac
            score = 0.4 + (alignment_ratio * 0.6)
            evidence.append(
                f"AC alignment: {matched_ac}/{total_ac} criteria matched"
            )
            if alignment_ratio < 0.5:
                suggestions.append(
                    "Some acceptance criteria lack coverage in the diff — "
                    "review whether the implementation addresses all ACs"
                )
        else:
            score = 0.5

        return DimensionRating(
            dimension=FeedbackDimension.AC_ALIGNMENT,
            score=max(0.0, min(1.0, score)),
            evidence=evidence,
            suggestions=suggestions,
        )

    # ── Summary builder ──────────────────────────────────────────────────

    @staticmethod
    def _build_summary(
        dimensions: list[DimensionRating],
        overall: float,
    ) -> str:
        """Build a human-readable feedback summary."""
        lines: list[str] = [
            f"**Overall Score**: {overall:.1%}",
        ]

        for d in dimensions:
            icon = "✅" if d.score >= 0.7 else "⚠️" if d.score >= 0.4 else "❌"
            lines.append(f"{icon} **{d.dimension.value.replace('_', ' ').title()}**: {d.score:.1%}")
            for s in d.suggestions[:2]:  # top 2 suggestions per dimension
                lines.append(f"  - {s}")

        return "\n".join(lines)

    def trend(self) -> dict[str, Any]:
        """Compute quality trend from history.

        Returns:
            Dict with ``direction`` (``"improving"``, ``"declining"``,
            ``"stable"``), ``scores`` (list of historical overall scores),
            and ``iterations`` count.
        """
        if len(self.history) < 2:
            return {
                "direction": "stable",
                "scores": [h.overall_score for h in self.history],
                "iterations": len(self.history),
            }

        scores = [h.overall_score for h in self.history]
        first_half = sum(scores[: len(scores) // 2]) / max(len(scores) // 2, 1)
        second_half = sum(scores[len(scores) // 2:]) / max(len(scores) - len(scores) // 2, 1)
        delta = second_half - first_half

        if delta > 0.05:
            direction = "improving"
        elif delta < -0.05:
            direction = "declining"
        else:
            direction = "stable"

        return {
            "direction": direction,
            "scores": scores,
            "iterations": len(scores),
        }


# ── Standalone helpers ───────────────────────────────────────────────────────


def _get_added_lines(diff_text: str) -> list[str]:
    """Extract lines that start with ``+`` (added lines) from a unified diff.

    Excludes the ``+++`` header line.
    """
    lines: list[str] = []
    for line in diff_text.split("\n"):
        if line.startswith("+") and not line.startswith("+++"):
            lines.append(line[1:])
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


# ── Convenience functions (stateless, one-shot) ──────────────────────────────


def rate_pr(
    diff_text: str,
    pr_number: int,
    pr_title: str = "",
    acceptance_criteria: list[str] | None = None,
    test_results: dict[str, Any] | None = None,
) -> PRFeedback:
    """One-shot PR rating without persistent history tracking.

    Convenience wrapper around :class:`FeedbackLoop` that creates a
    single-use loop, rates the PR, and returns the result. No history
    is retained between calls.

    Args:
        Same as :meth:`FeedbackLoop.rate`.

    Returns:
        A :class:`PRFeedback` with dimension ratings and suggestions.
    """
    loop = FeedbackLoop()
    return loop.rate(
        diff_text=diff_text,
        pr_number=pr_number,
        pr_title=pr_title,
        acceptance_criteria=acceptance_criteria,
        test_results=test_results,
    )


def improve_from_feedback(
    feedback: PRFeedback,
    diff_text: str,
) -> list[dict[str, Any]]:
    """Generate structured improvement actions from feedback.

    Converts suggestions from each dimension into actionable items
    that can guide the next implementation iteration.

    Args:
        feedback: The :class:`PRFeedback` to extract improvements from.
        diff_text: Original diff text for context.

    Returns:
        A list of dicts with ``dimension``, ``action``, and ``priority``.
    """
    improvements: list[dict[str, Any]] = []

    priority_map = {
        FeedbackDimension.CODE_QUALITY: "high",
        FeedbackDimension.TEST_COVERAGE: "high",
        FeedbackDimension.DIFF_HYGIENE: "medium",
        FeedbackDimension.AC_ALIGNMENT: "medium",
    }

    for dim in feedback.dimensions:
        if not dim.suggestions:
            continue

        # Low-scoring dimensions get higher-priority improvements
        if dim.score < 0.4:
            priority = "high"
        elif dim.score < 0.7:
            priority = priority_map.get(dim.dimension, "medium")
        else:
            priority = "low"

        for suggestion in dim.suggestions:
            improvements.append({
                "dimension": dim.dimension.value,
                "action": suggestion,
                "priority": priority,
            })

    return improvements


def track_improvement(
    history: list[PRFeedback],
) -> dict[str, Any]:
    """Analyze a list of PRFeedback entries for quality trends.

    Convenience wrapper that builds a temporary :class:`FeedbackLoop`
    and computes the trend from the provided history.

    Args:
        history: Chronological list of past PR feedback ratings.

    Returns:
        Trend dict with ``direction``, ``scores``, and ``iterations``.
    """
    loop = FeedbackLoop()
    loop.history = list(history)
    return loop.trend()
