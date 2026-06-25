"""
Prompt injection guard for issue descriptions.

Pure regex-based scanner that detects prompt injection attempts in
user-generated content (issue titles, descriptions, comments). Runs
in < 100ms with no external dependencies.

Usage::

    result = InjectionGuard.scan("ignore all previous instructions")
    if result.detected and result.severity == "critical":
        block_pipeline()
"""

from __future__ import annotations

import enum
import logging
import os
import re
import time
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pattern definitions
# ---------------------------------------------------------------------------

_DIRECT_PATTERNS: list[tuple[str, str, float]] = [
    # (pattern_name, regex, severity_score)
    ("ignore_previous", r"ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|commands|directions|rules|directives)", 0.9),
    ("ignore_all_rules", r"ignore\s+all\s+(rules|instructions|commands|constraints)", 0.9),
    ("system_prompt", r"(system\s+prompt|system\s+message|system\s+directive)", 0.8),
    ("you_are_now", r"you\s+are\s+(now|not\s+an?\s+(ai|assistant|chatbot|bot|model|llm|agent))", 0.9),
    ("act_as", r"act\s+as\s+(if\s+you\s+are|though\s+you\s+are|an?\s+(ai|assistant|chatbot))", 0.7),
    ("do_not_follow", r"do\s+not\s+(follow|obey|listen\s+to|adhere\s+to)", 0.8),
    ("new_rules", r"(here\s+are\s+(your\s+)?new\s+(rules|instructions|directives)|update\s+(your\s+)?(rules|instructions))", 0.7),
    ("forget_all", r"(forget|disregard|discard|overwrite|override)\s+(all\s+)?(previous|prior)\s+(instructions|rules|directives)", 0.9),
]

_DELIMITER_PATTERNS: list[tuple[str, str, float]] = [
    ("triple_backtick", r"```(system|user|assistant|prompt|role|instruction|ai)\b", 0.5),
    ("triple_dash", r"^---\s*$", 0.3),
    ("role_injection_system", r"(role|act)\s*:\s*(system|assistant|user|ai)", 0.7),
    ("role_injection_markdown", r"^>\s*(system|assistant|user|ai)\s*:", 0.6),
    ("sep_line", r"^={3,}\s*$", 0.2),
    ("xml_tag_close_open", r"</?\w+>\s*</?\w+>", 0.4),
]

_CONTEXT_LEAK_PATTERNS: list[tuple[str, str, float]] = [
    ("output_system_prompt", r"(output|reveal|show|display|print|leak|dump)\s+(your\s+)?(system\s+)?prompt", 0.9),
    ("what_are_instructions", r"(what\s+are\s+(your\s+)?(instructions|rules|directives|prompt)|tell\s+me\s+(your\s+)?(instructions|prompt))", 0.8),
    ("how_are_you_prompted", r"how\s+(are\s+you\s+(programmed|prompted|configured|instructed)|were\s+you\s+(built|created|programmed))", 0.6),
    ("repeat_after_me", r"repeat\s+(after\s+me|(back|exactly)\s+(what|the\s+(above|previous)))", 0.5),
    ("say_everything", r"(say|type|write|output|print)\s+(everything|all\s+your\s+(instructions|prompts|rules))", 0.8),
    ("ignore_safety", r"ignore\s+(all\s+)?(safety|ethics|guidelines|policies|boundaries|restrictions)", 0.9),
]

_HOMOGLYPH_PATTERNS: list[tuple[str, str, float]] = [
    # Cyrillic homoglyphs for common ASCII letters
    # Each pattern looks for a Cyrillic lookalike substituted into a known ASCII word
    ("cyrillic_ignore", r"\b[іn][gԁ][nո][oо][rг][eе]\b", 0.7),
    ("cyrillic_system", r"\b[sѕ][yу][sѕ][tт][eе][mм]\b", 0.7),
    ("cyrillic_prompt", r"\b[pр][rг][oо][mм][pр][tт]\b", 0.6),
    ("cyrillic_ascii_mix", r"\b\w*[а-яА-Я][a-zA-Z]\w*\b", 0.5),
]

# ---- Built patterns (compiled once at module load) -----------------------

_DIRECT_RE = [(name, re.compile(pattern, re.IGNORECASE | re.MULTILINE), score)
              for name, pattern, score in _DIRECT_PATTERNS]
_DELIMITER_RE = [(name, re.compile(pattern, re.IGNORECASE | re.MULTILINE), score)
                 for name, pattern, score in _DELIMITER_PATTERNS]
_CONTEXT_LEAK_RE = [(name, re.compile(pattern, re.IGNORECASE | re.MULTILINE), score)
                    for name, pattern, score in _CONTEXT_LEAK_PATTERNS]
_HOMOGLYPH_RE = [(name, re.compile(pattern, re.MULTILINE), score)
                 for name, pattern, score in _HOMOGLYPH_PATTERNS]

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


class GuardMode(str, enum.Enum):
    STRICT = "strict"
    MODERATE = "moderate"
    OFF = "off"


class InjectionGuardConfig:
    """Configuration for the injection guard.

    Reads from environment variable ``QUALITY_PROMPT_INJECTION_GUARD``
    (default: ``"strict"``).  Accepts ``"strict"``, ``"moderate"``, ``"off"``.
    """

    def __init__(
        self,
        mode: str | None = None,
        strict_threshold: float = 0.5,
        moderate_threshold: float = 0.7,
    ) -> None:
        raw = (mode or os.getenv("QUALITY_PROMPT_INJECTION_GUARD", "strict")).strip().lower()
        if raw not in ("strict", "moderate", "off"):
            logger.warning("Unknown guard mode %r — falling back to 'strict'", raw)
            raw = "strict"
        self.mode = GuardMode(raw)
        self.strict_threshold = strict_threshold
        self.moderate_threshold = moderate_threshold


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------


class InjectionGuardResult:
    """Result of an injection scan.

    Attributes:
        detected: Whether any injection patterns were found.
        score: Aggregate severity score (0.0 — 1.0).
        patterns_matched: List of pattern names that matched.
        severity: ``"critical"`` (score ≥ 0.8), ``"high"`` (≥ 0.6),
            ``"medium"`` (≥ 0.3), ``"low"`` (> 0.0), or ``"none"``.
        scan_duration_ms: Time taken for the scan in milliseconds.
    """

    __slots__ = ("detected", "score", "patterns_matched", "severity", "scan_duration_ms")

    def __init__(
        self,
        detected: bool,
        score: float,
        patterns_matched: list[str],
        scan_duration_ms: float,
    ) -> None:
        self.detected = detected
        self.score = score
        self.patterns_matched = patterns_matched
        self.severity = self._classify(score)
        self.scan_duration_ms = scan_duration_ms

    @staticmethod
    def _classify(score: float) -> str:
        if score >= 0.8:
            return "critical"
        if score >= 0.6:
            return "high"
        if score >= 0.3:
            return "medium"
        if score > 0.0:
            return "low"
        return "none"

    def to_dict(self) -> dict[str, Any]:
        return {
            "detected": self.detected,
            "score": round(self.score, 2),
            "patterns_matched": self.patterns_matched,
            "severity": self.severity,
            "scan_duration_ms": round(self.scan_duration_ms, 1),
        }

    def __repr__(self) -> str:
        return (
            f"InjectionGuardResult(detected={self.detected}, score={self.score:.2f}, "
            f"severity={self.severity!r}, patterns={self.patterns_matched})"
        )


# ---------------------------------------------------------------------------
# Guard
# ---------------------------------------------------------------------------


class InjectionGuard:
    """Prompt injection scanner using pure regex patterns.

    Usage::

        result = InjectionGuard.scan(text)
        if result.detected and result.severity in ("critical", "high"):
            block_pipeline()
    """

    @staticmethod
    def scan(text: str) -> InjectionGuardResult:
        """Scan *text* for prompt injection patterns.

        Args:
            text: The text to scan (issue title, body, comments, etc.).

        Returns:
            An ``InjectionGuardResult`` with detection details.
        """
        start = time.perf_counter()
        patterns_matched: list[str] = []
        total_score = 0.0

        # Category weights — direct injection is weighted highest
        categories = [
            (_DIRECT_RE, 4.0),
            (_CONTEXT_LEAK_RE, 3.0),
            (_HOMOGLYPH_RE, 2.0),
            (_DELIMITER_RE, 1.0),
        ]

        for patterns, weight in categories:
            cat_score, cat_matches = _scan_category(text, patterns)
            total_score += cat_score * weight
            patterns_matched.extend(cat_matches)

        # Normalize score to 0-1 range (max possible is sum of weights = 10)
        total_score = min(total_score / 10.0, 1.0)

        elapsed = (time.perf_counter() - start) * 1000

        return InjectionGuardResult(
            detected=total_score > 0.0,
            score=total_score,
            patterns_matched=patterns_matched,
            scan_duration_ms=elapsed,
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _scan_category(
    text: str,
    patterns: list[tuple[str, re.Pattern, float]],
) -> tuple[float, list[str]]:
    """Scan *text* against a list of compiled patterns.

    Returns:
        ``(cumulative_score, list_of_matching_pattern_names)``
    """
    score = 0.0
    matched: list[str] = []
    for name, compiled, severity in patterns:
        if compiled.search(text):
            score += severity
            matched.append(name)
    return score, matched
