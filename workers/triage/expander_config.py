"""Configuration for the ticket expander module.

All values can be overridden via environment variables.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any


# ── LLM settings ──────────────────────────────────────────────────────────

EXPANDER_MODEL: str = os.getenv("STAS_EXPANDER_MODEL", "gpt-4o-mini")
"""Model used for expanding issues. Cheap model is fine for this task."""

EXPANDER_TEMPERATURE: float = float(os.getenv("STAS_EXPANDER_TEMPERATURE", "0.0"))
"""Temperature for generation. 0 = deterministic."""

EXPANDER_MAX_TOKENS: int = int(os.getenv("STAS_EXPANDER_MAX_TOKENS", "2048"))
"""Max tokens in the LLM response."""

EXPANDER_TIMEOUT_SECONDS: int = int(os.getenv("STAS_EXPANDER_TIMEOUT_SECONDS", "30"))
"""Max seconds to wait for LLM response."""


# ── Quality thresholds ────────────────────────────────────────────────────

EXPANDER_MIN_CONFIDENCE: float = float(os.getenv("STAS_EXPANDER_MIN_CONFIDENCE", "0.3"))
"""Minimum confidence to accept an expansion. Below this, expansion is discarded."""

EXPANDER_REVIEW_THRESHOLD: float = float(os.getenv("STAS_EXPANDER_REVIEW_THRESHOLD", "0.7"))
"""Confidence above which expansion is posted without review flag."""

EXPANDER_SKIP_SCORE: float = float(os.getenv("STAS_EXPANDER_SKIP_SCORE", "0.7"))
"""If issue quality score is above this, skip expansion entirely."""


# ── Prompt templates ──────────────────────────────────────────────────────

EXPANSION_PROMPT_TEMPLATE: str = os.getenv(
    "STAS_EXPANDER_PROMPT",
    (
        "You are a senior software engineer refining a ticket. Given a raw issue"
        " description, expand it into a structured specification.\n\n"
        "Issue Description:\n{description}\n\n"
        "---\n\n"
        "Respond with a JSON object containing exactly these keys:\n"
        '- "summary": string — One-sentence summary of what needs to be done.\n'
        '- "context": string — Background, motivation, and problem this solves.\n'
        '- "acceptance_criteria": list of strings — At least 3, at most 8 specific,'
        " testable criteria. Use Given/When/Then format when possible.\n"
        '- "implementation_plan": list of strings — Step-by-step implementation'
        " approach. At least 2 steps, at most 6.\n"
        '- "test_spec": list of strings — What tests should be written or updated to'
        " verify this change. At least 1, at most 4.\n"
        '- "confidence": float — 0.0 to 1.0. How confident are you that this'
        " expansion is accurate based on the input? Be conservative for vague issues.\n"
        '- "estimated_effort": string — One of "small", "medium", "large".'
        " Estimate based on scope and complexity.\n\n"
        "Return ONLY valid JSON. No markdown, no code fences, no commentary."
    ),
)


# ── Fallback expansion (used when LLM is unavailable) ─────────────────────

FALLBACK_EXPANSION: dict[str, Any] = {
    "summary": "",
    "context": "",
    "acceptance_criteria": [],
    "implementation_plan": [],
    "test_spec": [],
    "confidence": 0.0,
    "estimated_effort": "medium",
}
"""Fallback expansion returned when no LLM client is available."""


# ── Structured dataclass ──────────────────────────────────────────────────


@dataclass
class ExpansionResult:
    """Structured result from expanding a ticket."""

    summary: str = ""
    context: str = ""
    acceptance_criteria: list[str] = field(default_factory=list)
    implementation_plan: list[str] = field(default_factory=list)
    test_spec: list[str] = field(default_factory=list)
    confidence: float = 0.0
    estimated_effort: str = "medium"

    def to_dict(self) -> dict[str, Any]:
        return {
            "summary": self.summary,
            "context": self.context,
            "acceptance_criteria": list(self.acceptance_criteria),
            "implementation_plan": list(self.implementation_plan),
            "test_spec": list(self.test_spec),
            "confidence": self.confidence,
            "estimated_effort": self.estimated_effort,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ExpansionResult:
        return cls(
            summary=str(data.get("summary", "")),
            context=str(data.get("context", "")),
            acceptance_criteria=list(data.get("acceptance_criteria", [])),
            implementation_plan=list(data.get("implementation_plan", [])),
            test_spec=list(data.get("test_spec", [])),
            confidence=float(data.get("confidence", 0.0)),
            estimated_effort=str(data.get("estimated_effort", "medium")),
        )

    @classmethod
    def fallback(cls) -> ExpansionResult:
        return cls.from_dict(FALLBACK_EXPANSION)

    def validate(self) -> list[str]:
        """Validate the expansion result and return a list of issues.

        Returns:
            A list of validation issue strings. Empty list means valid.
        """
        issues: list[str] = []
        if not self.summary:
            issues.append("summary is empty")
        if not self.context:
            issues.append("context is empty")
        if not self.acceptance_criteria:
            issues.append("acceptance_criteria is empty")
        elif len(self.acceptance_criteria) < 3:
            issues.append(
                f"acceptance_criteria has only {len(self.acceptance_criteria)} items (minimum 3)"
            )
        if not self.implementation_plan:
            issues.append("implementation_plan is empty")
        if not self.test_spec:
            issues.append("test_spec is empty")
        if not (0.0 <= self.confidence <= 1.0):
            issues.append(f"confidence {self.confidence} is out of range [0.0, 1.0]")
        if self.estimated_effort not in ("small", "medium", "large"):
            issues.append(
                f"estimated_effort '{self.estimated_effort}' not in (small, medium, large)"
            )
        return issues

    @property
    def is_actionable(self) -> bool:
        """Whether this expansion has enough content to act on."""
        return (
            bool(self.summary)
            and len(self.acceptance_criteria) >= 1
            and len(self.implementation_plan) >= 1
            and self.confidence >= 0.3
        )


def get_config() -> dict[str, Any]:
    """Return the full expander configuration as a dict."""
    return {
        "model": EXPANDER_MODEL,
        "temperature": EXPANDER_TEMPERATURE,
        "max_tokens": EXPANDER_MAX_TOKENS,
        "timeout_seconds": EXPANDER_TIMEOUT_SECONDS,
        "thresholds": {
            "min_confidence": EXPANDER_MIN_CONFIDENCE,
            "review_threshold": EXPANDER_REVIEW_THRESHOLD,
            "skip_score": EXPANDER_SKIP_SCORE,
        },
    }
