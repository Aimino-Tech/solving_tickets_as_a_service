"""Ticket auto-expansion module.

Expands a minimal issue description into a structured ticket with acceptance
criteria, implementation plan, and test specification using an LLM.

Usage:
    from workers.triage.expander import expand_issue

    result = expand_issue(
        title="Login returns 500 for special chars",
        body="The login endpoint crashes when email has + or & characters.",
    )
    print(result.summary)
    print(result.acceptance_criteria)
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from .expander_config import (
    EXPANSION_PROMPT_TEMPLATE,
    EXPANDER_MAX_TOKENS,
    EXPANDER_MODEL,
    EXPANDER_TEMPERATURE,
    EXPANDER_TIMEOUT_SECONDS,
    ExpansionResult,
)

logger = logging.getLogger(__name__)

_llm_client: Any = None  # lazily initialized OpenAI client or False sentinel


def _get_llm_client() -> Any:
    """Lazy-init OpenAI client so no crash if OPENAI_API_KEY is unset at import time."""
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


def _build_prompt(title: str, body: str, extra_context: str = "") -> str:
    """Build the expansion prompt from issue fields."""
    combined = f"## Title\n{title}\n\n## Description\n{body}"
    if extra_context:
        combined += f"\n\n## Extra Context\n{extra_context}"
    return EXPANSION_PROMPT_TEMPLATE.format(description=combined)


def _parse_llm_response(raw: str) -> dict[str, Any] | None:
    """Parse the LLM JSON response, handling common edge cases.

    Returns parsed dict on success, None on failure.
    """
    text = raw.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        # Find the first newline after opening fence
        first_nl = text.find("\n")
        if first_nl != -1:
            text = text[first_nl:]
        # Strip closing fence
        end_fence = text.rfind("```")
        if end_fence != -1:
            text = text[:end_fence]
        text = text.strip()
    # Strip leading/trailing whitespace and any "json" label
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
    summary = str(parsed.get("summary", ""))
    context = str(parsed.get("context", ""))
    acs = list(parsed.get("acceptance_criteria", []))
    plan = list(parsed.get("implementation_plan", []))
    tests = list(parsed.get("test_spec", []))
    confidence = float(parsed.get("confidence", 0.0))
    effort = str(parsed.get("estimated_effort", "medium"))

    # Clamp confidence
    confidence = max(0.0, min(1.0, confidence))

    # Validate effort
    if effort not in ("small", "medium", "large"):
        effort = "medium"

    return {
        "summary": summary,
        "context": context,
        "acceptance_criteria": acs,
        "implementation_plan": plan,
        "test_spec": tests,
        "confidence": confidence,
        "estimated_effort": effort,
    }


def expand_issue(
    title: str = "",
    body: str = "",
    extra_context: str = "",
    auto_heal: bool = True,
) -> ExpansionResult:
    """Expand a minimal issue into a structured ticket with ACs, plan, tests.

    Args:
        title: Issue title.
        body: Issue body / description.
        extra_context: Optional additional context (e.g. code snippets, logs).
        auto_heal: If True, generate fallback structured fields when LLM is
            unavailable or parsing fails.

    Returns:
        An ExpansionResult dataclass with the expanded fields.

    Safety guarantees:
        - Never deletes or overwrites original issue content.
        - Returns fallback (empty fields, 0.0 confidence) if LLM is unavailable.
        - Returns fallback if JSON parsing fails.
        - Confidence is clamped to [0.0, 1.0].
    """
    if not title and not body:
        logger.warning("expand_issue called with empty title and body")
        return ExpansionResult.fallback()

    logger.info("Expanding issue — title=%s body_len=%d", title[:80], len(body))

    # Try LLM expansion
    client = _get_llm_client()
    if not client:
        logger.warning("No LLM client available — returning fallback expansion")
        if auto_heal:
            return _keyword_fallback(title, body)
        return ExpansionResult.fallback()

    try:
        prompt = _build_prompt(title, body, extra_context)

        response = client.chat.completions.create(
            model=EXPANDER_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=EXPANDER_TEMPERATURE,
            max_tokens=EXPANDER_MAX_TOKENS,
            timeout=EXPANDER_TIMEOUT_SECONDS,
        )
        result_text = response.choices[0].message.content or ""
    except Exception as exc:
        logger.error("LLM call failed during expansion: %s", exc)
        if auto_heal:
            return _keyword_fallback(title, body)
        return ExpansionResult.fallback()

    # Parse the response
    parsed = _parse_llm_response(result_text)
    if parsed is None:
        logger.error(
            "Failed to parse LLM response as JSON — raw=%s",
            result_text[:500],
        )
        if auto_heal:
            return _keyword_fallback(title, body)
        return ExpansionResult.fallback()

    validated = _validate_parsed(parsed)
    result = ExpansionResult.from_dict(validated)

    logger.info(
        "Expansion complete — confidence=%.4f acs=%d plan_steps=%d tests=%d",
        result.confidence,
        len(result.acceptance_criteria),
        len(result.implementation_plan),
        len(result.test_spec),
    )
    return result


def _keyword_fallback(title: str, body: str) -> ExpansionResult:
    """Rule-based fallback when no LLM is available.

    Generates basic structured fields from keyword heuristics.
    """
    combined = (title + " " + body).lower()

    acs: list[str] = []
    plan: list[str] = []
    tests: list[str] = []
    effort = "medium"

    # Detect common patterns
    has_error = any(kw in combined for kw in ["error", "crash", "bug", "broken", "fail"])
    has_feature = any(kw in combined for kw in ["feature", "request", "add", "implement", "new"])

    if has_error:
        acs = [
            "Given the error scenario, When the system processes the request, Then it returns a success response",
            "Given the error scenario, When the system processes the request, Then it logs the error appropriately",
            "All existing tests must continue to pass",
        ]
        plan = [
            "Reproduce the error and identify root cause",
            "Implement the fix with minimal changes",
            "Add regression test for the specific scenario",
        ]
        tests = [
            "Unit test for the specific error scenario",
            "Regression test to prevent re-introduction",
        ]
        effort = "small"
    elif has_feature:
        acs = [
            "The feature is implemented according to the specification",
            "The feature handles edge cases gracefully",
            "Documentation is updated to reflect the change",
            "All existing tests continue to pass",
        ]
        plan = [
            "Design the feature implementation approach",
            "Implement the feature with tests",
            "Update documentation",
        ]
        tests = [
            "Unit tests for the new feature",
            "Integration tests for the feature end-to-end",
        ]
        effort = "medium"
    else:
        acs = [
            "The change works as described in the issue",
            "Edge cases are handled appropriately",
            "All existing tests continue to pass",
        ]
        plan = [
            "Investigate the issue and determine root cause",
            "Implement the necessary changes",
            "Verify the fix with appropriate tests",
        ]
        tests = [
            "Add or update tests to cover the change",
        ]
        effort = "medium"

    summary = title if title else "Implement changes described in issue"
    context = body if body else "See issue description for details."

    return ExpansionResult(
        summary=summary,
        context=context,
        acceptance_criteria=acs,
        implementation_plan=plan,
        test_spec=tests,
        confidence=0.2,
        estimated_effort=effort,
    )
