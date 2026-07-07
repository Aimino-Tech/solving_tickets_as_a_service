"""
EpistemicGuardrail: LiteLLM CustomGuardrail that evaluates LLM responses
against epistemic constraints to detect factual inaccuracies.
"""
from __future__ import annotations

import logging
from typing import Any, AsyncGenerator, Optional

import litellm
from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm.types.utils import ModelResponseStream

from guardrail.epistemic.claim_extractor import extract_claims
from guardrail.epistemic.loader import get_constraints
from guardrail.epistemic.policy_engine import evaluate_claims
from guardrail.epistemic.types import Decision

logger = logging.getLogger(__name__)


SLOP_ANNOTATION_PREFIX = "\n\n---\n*Epistemic guardrail detected potential issues:"

WARN_ANNOTATION = (
    "\n\nThe response may contain statements that conflict with known constraints. "
    "Please verify the flagged content."
)

BLOCK_ANNOTATION = (
    "\n\nThe response contains statements that violate epistemic constraints. "
    "A revised response is recommended."
)


class EpistemicGuardrailError(ValueError):
    """Raised when epistemic violations are detected."""


class EpistemicGuardrail(CustomGuardrail):
    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._constraints = get_constraints()
        logger.info(
            "EpistemicGuardrail initialized: %d constraints loaded",
            len(self._constraints),
        )

    async def async_pre_call_hook(
        self,
        data: dict,
        user_api_key_dict: Any,
    ) -> Optional[dict]:
        return None

    async def async_post_call_success_hook(
        self,
        data: dict,
        user_api_key_dict: Any,
        response: Any,
    ) -> None:
        if not isinstance(response, litellm.ModelResponse):
            return

        if not self._constraints:
            return

        text = ""
        for choice in response.choices:
            msg = choice.message
            content = getattr(msg, "content", None)
            if content and isinstance(content, str):
                text += content + "\n"

        if not text.strip():
            return

        claims = extract_claims(text)
        if not claims:
            return

        result = evaluate_claims(claims, self._constraints)
        if not result.violations:
            return

        for v in result.violations:
            logger.warning(
                "EPISTEMIC VIOLATION [%s]: strength=%.2f, severity=%s — %s",
                v.constraint_id,
                v.strength,
                v.severity.value,
                v.explanation,
            )

        annotation = (
            f"{SLOP_ANNOTATION_PREFIX}\n"
            f"* Violations: {len(result.violations)}\n"
            f"* Decision: {result.decision.value}\n"
        )

        if result.decision == Decision.WARN:
            annotation += WARN_ANNOTATION
        elif result.decision == Decision.BLOCK:
            annotation += BLOCK_ANNOTATION

        response.choices[0].message.content = (
            (response.choices[0].message.content or "") + annotation
        )

    async def async_post_call_streaming_iterator_hook(
        self,
        user_api_key_dict: Any,
        response: Any,
        request_data: dict,
    ) -> AsyncGenerator[ModelResponseStream, None]:
        async for chunk in response:
            yield chunk
