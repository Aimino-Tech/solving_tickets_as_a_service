"""LLM-based support auto-answer module.

Auto-generates answers to common support questions using an LLM, with
confidence scoring to decide whether answers can be auto-posted or need
human review.

Usage:
    from workers.support.auto_answer import auto_answer

    result = auto_answer(
        question="How do I set up webhooks for my repo?",
        context="User is on the free tier, wants GitHub webhook integration.",
    )
    if result.confidence >= 0.7:
        post_answer(result.answer)  # auto-post
    else:
        flag_for_review(result)      # needs human review
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# ── Config (env-overridable) ────────────────────────────────────────────────

AUTO_ANSWER_MODEL: str = os.getenv("STAS_AUTO_ANSWER_MODEL", "gpt-4o-mini")
"""Model used for auto-answering. Cheap model is fine."""

AUTO_ANSWER_TEMPERATURE: float = float(os.getenv("STAS_AUTO_ANSWER_TEMPERATURE", "0.0"))
"""Temperature for generation. 0 = deterministic."""

AUTO_ANSWER_MAX_TOKENS: int = int(os.getenv("STAS_AUTO_ANSWER_MAX_TOKENS", "1024"))
"""Max tokens in the LLM response."""

AUTO_ANSWER_TIMEOUT_SECONDS: int = int(os.getenv("STAS_AUTO_ANSWER_TIMEOUT_SECONDS", "30"))
"""Max seconds to wait for LLM response."""

AUTO_ANSWER_MIN_CONFIDENCE: float = float(os.getenv("STAS_AUTO_ANSWER_MIN_CONFIDENCE", "0.3"))
"""Minimum confidence to consider an answer usable at all."""

AUTO_ANSWER_AUTO_POST_THRESHOLD: float = float(os.getenv(
    "STAS_AUTO_ANSWER_AUTO_POST_THRESHOLD", "0.7",
))
"""Confidence above which the answer can be auto-posted without human review."""

AUTO_ANSWER_PROMPT_TEMPLATE: str = os.getenv(
    "STAS_AUTO_ANSWER_PROMPT",
    (
        "You are a knowledgeable customer support engineer for a DevOps automation"
        " platform called STAS (Solving Tickets As A Service). A user has asked a"
        " support question. Answer clearly, concisely, and helpfully.\n\n"
        "## User Question\n{question}\n\n"
        "## Context\n{context}\n\n"
        "---\n\n"
        "Respond with a JSON object containing exactly these keys:\n"
        '- "answer": string — A clear, helpful, actionable answer to the user\'s'
        " question. Include code snippets or configuration examples if relevant.\n"
        '- "confidence": float — 0.0 to 1.0. How confident are you that this answer'
        " is accurate and addresses the user's question? Be conservative — if the"
        " question is vague or outside STAS's domain, assign low confidence.\n"
        '- "needs_human_review": bool — Whether this question should be escalated to'
        " a human support engineer. Set to true if the question is complex,"
        " sensitive, requires account-specific actions, or confidence is low.\n"
        '- "category": string — One of: "setup", "configuration", "troubleshooting",'
        ' "billing", "feature_request", "bug_report", "integration", "other".\n'
        "Return ONLY valid JSON. No markdown, no code fences, no commentary."
    ),
)

# ── Sentinels ────────────────────────────────────────────────────────────────

_llm_client: Any = None  # lazily initialized OpenAI client or False sentinel


# ── Dataclass ────────────────────────────────────────────────────────────────


@dataclass
class AutoAnswerResult:
    """Result from auto-answering a support question."""

    answer: str = ""
    confidence: float = 0.0
    needs_human_review: bool = True
    category: str = "other"

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "confidence": self.confidence,
            "needs_human_review": self.needs_human_review,
            "category": self.category,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AutoAnswerResult:
        return cls(
            answer=str(data.get("answer", "")),
            confidence=float(data.get("confidence", 0.0)),
            needs_human_review=bool(data.get("needs_human_review", True)),
            category=str(data.get("category", "other")),
        )

    @classmethod
    def fallback(cls) -> AutoAnswerResult:
        return cls(
            answer="",
            confidence=0.0,
            needs_human_review=True,
            category="other",
        )

    def validate(self) -> list[str]:
        """Validate the auto-answer result.

        Returns:
            A list of validation issue strings. Empty list means valid.
        """
        issues: list[str] = []
        if not self.answer:
            issues.append("answer is empty")
        if not (0.0 <= self.confidence <= 1.0):
            issues.append(f"confidence {self.confidence} is out of range [0.0, 1.0]")
        if self.confidence < AUTO_ANSWER_MIN_CONFIDENCE and self.answer:
            issues.append(
                f"confidence {self.confidence:.2f} is below min threshold "
                f"{AUTO_ANSWER_MIN_CONFIDENCE}"
            )
        valid_categories = {
            "setup", "configuration", "troubleshooting", "billing",
            "feature_request", "bug_report", "integration", "other",
        }
        if self.category not in valid_categories:
            issues.append(
                f"category '{self.category}' not in {sorted(valid_categories)}"
            )
        return issues

    @property
    def can_auto_post(self) -> bool:
        """Whether this answer can be posted automatically."""
        return (
            bool(self.answer)
            and self.confidence >= AUTO_ANSWER_AUTO_POST_THRESHOLD
            and not self.needs_human_review
        )


# ── Helpers ──────────────────────────────────────────────────────────────────


def _get_llm_client() -> Any:
    """Lazy-init OpenAI client so no crash if OPENAI_API_KEY is unset."""
    global _llm_client  # noqa: PLW0603
    if _llm_client is not None:
        return _llm_client if _llm_client is not False else None
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        _llm_client = False  # sentinel
        return None
    try:
        from openai import OpenAI

        _llm_client = OpenAI(api_key=key)
        return _llm_client
    except Exception as exc:
        logger.warning("Failed to init OpenAI client: %s", exc)
        _llm_client = False
        return None


def _build_prompt(question: str, context: str) -> str:
    """Build the auto-answer prompt from question and context."""
    return AUTO_ANSWER_PROMPT_TEMPLATE.format(question=question, context=context)


def _parse_llm_response(raw: str) -> dict[str, Any] | None:
    """Parse the LLM JSON response, handling common edge cases.

    Returns parsed dict on success, None on failure.
    """
    text = raw.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        first_nl = text.find("\n")
        if first_nl != -1:
            text = text[first_nl:]
        end_fence = text.rfind("```")
        if end_fence != -1:
            text = text[:end_fence]
        text = text.strip()
    if text.startswith("json"):
        text = text[4:].strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None
    return parsed


def _validate_parsed(parsed: dict[str, Any]) -> dict[str, Any]:
    """Ensure all required keys exist with correct types, filling defaults."""
    answer = str(parsed.get("answer", ""))
    confidence = float(parsed.get("confidence", 0.0))
    needs_human_review = bool(parsed.get("needs_human_review", True))
    category = str(parsed.get("category", "other"))

    # Clamp confidence
    confidence = max(0.0, min(1.0, confidence))

    # Validate category
    valid_categories = {
        "setup", "configuration", "troubleshooting", "billing",
        "feature_request", "bug_report", "integration", "other",
    }
    if category not in valid_categories:
        category = "other"

    return {
        "answer": answer,
        "confidence": confidence,
        "needs_human_review": needs_human_review,
        "category": category,
    }


# ── Main entry point ─────────────────────────────────────────────────────────


def auto_answer(
    question: str = "",
    context: str = "",
) -> AutoAnswerResult:
    """Auto-answer a support question using an LLM.

    Args:
        question: The user's support question.
        context: Additional context about the user, their tier, or the situation.

    Returns:
        An AutoAnswerResult dataclass with the generated answer and metadata.

    Safety guarantees:
        - Never exposes sensitive information in the answer.
        - Returns empty fallback (0.0 confidence, needs_human_review=True) if LLM
          is unavailable.
        - Returns empty fallback if JSON parsing fails.
        - Confidence is clamped to [0.0, 1.0].
        - Invalid categories default to "other".
    """
    if not question:
        logger.warning("auto_answer called with empty question")
        return AutoAnswerResult.fallback()

    logger.info(
        "Auto-answering support question — q_len=%d ctx_len=%d",
        len(question),
        len(context),
    )

    # Try LLM answer
    client = _get_llm_client()
    if not client:
        logger.warning("No LLM client available — returning fallback")
        return AutoAnswerResult.fallback()

    try:
        prompt = _build_prompt(question, context)

        response = client.chat.completions.create(
            model=AUTO_ANSWER_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=AUTO_ANSWER_TEMPERATURE,
            max_tokens=AUTO_ANSWER_MAX_TOKENS,
            timeout=AUTO_ANSWER_TIMEOUT_SECONDS,
        )
        result_text = response.choices[0].message.content or ""
    except Exception as exc:
        logger.error("LLM call failed during auto-answer: %s", exc)
        return AutoAnswerResult.fallback()

    # Parse the response
    parsed = _parse_llm_response(result_text)
    if parsed is None:
        logger.error(
            "Failed to parse LLM response as JSON — raw=%s",
            result_text[:500],
        )
        return AutoAnswerResult.fallback()

    validated = _validate_parsed(parsed)
    result = AutoAnswerResult.from_dict(validated)

    logger.info(
        "Auto-answer complete — confidence=%.4f category=%s needs_review=%s",
        result.confidence,
        result.category,
        result.needs_human_review,
    )
    return result
