"""
Slop-intent detection guardrail for LiteLLM proxy.

Intercepts LLM responses (including thinking/reasoning traces) and blocks
code that contains slop patterns: stubs, placeholders, mocks, deferrals,
and self-aware "this is just a demo" patterns.

Architecture:
  LiteLLM CustomGuardrail → async_post_call_success_hook
    → scans reasoning_content (deepseek) + thinking_blocks (anthropic) + content
    → raises ValueError to block the response
    → fallback: async_post_call_streaming_iterator_hook for streaming audit

Usage in proxy_config.yaml:
  guardrails:
    - guardrail_name: slop-detector
      litellm_params:
        guardrail: guardrail.slop_guardrail.SlopIntentGuardrail
        mode: post_call
        default_on: true
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import litellm
from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm.types.utils import ModelResponseStream

logger = logging.getLogger(__name__)

# ── Pattern loading ──────────────────────────────────────────────────────────

def _load_patterns() -> dict[str, list[re.Pattern]]:
    """Load slop patterns from slop_patterns.json, compile regexes."""
    patterns_file = Path(__file__).parent / "slop_patterns.json"
    if not patterns_file.exists():
        logger.warning("slop_patterns.json not found at %s", patterns_file)
        return {}

    raw = json.loads(patterns_file.read_text())
    compiled: dict[str, list[re.Pattern]] = {}
    for category, config in raw.get("categories", {}).items():
        for p in config.get("patterns", []):
            compiled.setdefault(category, []).append(
                re.compile(p, re.IGNORECASE)
            )
    return compiled


def _flatten_patterns(categorized: dict[str, list[re.Pattern]]) -> list[re.Pattern]:
    """Flatten categorized patterns into a single list."""
    return [p for patterns in categorized.values() for p in patterns]


# ── Guardrail implementation ─────────────────────────────────────────────────

class SlopIntentGuardrailError(ValueError):
    """Raised when slop intent is detected. LiteLLM maps this to a 400 response."""

    def __init__(self, source: str, pattern: str, snippet: str) -> None:
        self.source = source
        self.pattern = pattern
        self.snippet = snippet[:200]
        super().__init__(f"Slop pattern detected in {source}: '{pattern}'")


GUARDRAIL_BLOCKED_RESPONSE = {
    "error": {
        "code": "GUARDRAIL_BLOCKED",
        "message": "Response blocked by slop intent guardrail",
        "details": {},
    }
}

CAUTION_PREFIX = "\n\n---\n*CAUTION — Slop pattern detected:*"

CAUTION_ANNOTATION = (
    "\n\nThe response contained patterns associated with AI-generated code slop "
    "(stubs, placeholders, mocks, or deferrals). Please review the flagged "
    "content before using."
)


class SlopIntentGuardrail(CustomGuardrail):
    """
    LiteLLM guardrail that detects slop-intent patterns in model responses.

    Checks three sources:
    1. response.choices[].message.reasoning_content (deepseek, openai o-series)
    2. response.choices[].message.thinking_blocks (anthropic)
    3. response.choices[].message.content (all models)

    On detection, raises ValueError → LiteLLM returns 400 with slop message.
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._categorized = _load_patterns()
        self._all_patterns = _flatten_patterns(self._categorized)
        self._match_log: list[dict[str, str]] = []

        self._gate_mode = os.environ.get(
            "SLOP_GATE_MODE", kwargs.get("gate_mode", "block")
        ).lower()
        if self._gate_mode not in ("warn", "annotate", "block"):
            logger.warning(
                "Unknown gate_mode '%s', defaulting to 'block'", self._gate_mode
            )
            self._gate_mode = "block"

        self._block_threshold = float(
            os.environ.get("SLOP_BLOCK_THRESHOLD", kwargs.get("block_threshold", "0.5"))
        )

        if not self._all_patterns:
            logger.warning(
                "SlopIntentGuardrail loaded with 0 patterns — will allow all responses"
            )

        logger.info(
            "SlopIntentGuardrail initialized: %d patterns across %d categories, "
            "gate_mode=%s, block_threshold=%.2f",
            len(self._all_patterns),
            len(self._categorized),
            self._gate_mode,
            self._block_threshold,
        )

    # ── Public hooks ─────────────────────────────────────────────────────

    async def async_post_call_success_hook(
        self,
        data: dict,
        user_api_key_dict: Any,
        response: Any,
    ) -> None:
        """
        Post-call hook. Runs after LLM responds but before response is returned
        to the client.

        Gate modes:
            block   — raise ValueError → LiteLLM returns HTTP 400/422
            annotate — inject CAUTION annotation into response content
            warn    — log at warning level, let response through
        """
        if not isinstance(response, litellm.ModelResponse):
            return

        self._match_log = []

        for idx, choice in enumerate(response.choices):
            msg = choice.message
            self._check_content(msg.content, f"choice[{idx}].content")
            self._check_reasoning(msg, idx)
            self._check_thinking_blocks(msg, idx)

        if not self._match_log:
            return

        score = self._compute_slop_score()

        for m in self._match_log:
            logger.warning(
                "SLOP DETECTED [%s]: '%s' in %s — snippet: %s (score=%.2f, mode=%s)",
                m["category"],
                m["pattern"],
                m["source"],
                m["snippet"],
                score,
                self._gate_mode,
            )

        if self._gate_mode == "block" or (
            self._gate_mode == "annotate" and score >= self._block_threshold
        ):
            first = self._match_log[0]
            raise SlopIntentGuardrailError(
                source=first["source"],
                pattern=first["pattern"],
                snippet=first["snippet"],
            )

        if self._gate_mode == "annotate":
            annotation = (
                f"{CAUTION_PREFIX}\n"
                f"* Patterns matched: {len(self._match_log)}\n"
                f"* Top category: {self._match_log[0]['category']}\n"
                f"* Score: {score:.2f}\n"
                f"{CAUTION_ANNOTATION}"
            )
            if response.choices and response.choices[0].message:
                existing = response.choices[0].message.content or ""
                response.choices[0].message.content = existing + annotation
            logger.info(
                "SLOP ANNOTATED: score=%.2f, patterns=%d, category=%s",
                score,
                len(self._match_log),
                self._match_log[0]["category"],
            )

    async def async_post_call_streaming_iterator_hook(
        self,
        user_api_key_dict: Any,
        response: Any,
        request_data: dict,
    ) -> AsyncGenerator[ModelResponseStream, None]:
        """
        For streaming requests: re-assemble chunks, check at end.

        NOTE: For streaming, LiteLLM has already delivered chunks to the client
        by the time this hook runs. This is an AUDIT-ONLY fallback for streaming.
        For real-time blocking, use during_call mode instead.
        """
        accumulated: list[ModelResponseStream] = []
        async for chunk in response:
            accumulated.append(chunk)
            yield chunk

        assembled = "".join(
            c.choices[0].delta.content or ""
            for c in accumulated
            if c.choices and c.choices[0].delta
        )
        if not assembled:
            return

        for pattern in self._all_patterns:
            match = pattern.search(assembled)
            if match:
                logger.warning(
                    "SLOP DETECTED (streaming, post-delivery): '%s' (mode=%s)",
                    match.group(0),
                    self._gate_mode,
                )
                break

    # ── Scoring ──────────────────────────────────────────────────────────

    def _compute_slop_score(self) -> float:
        """Compute a 0-1 slop score from the current match log."""
        if not self._match_log:
            return 0.0

        categories_matched = len({m["category"] for m in self._match_log})
        total_matches = len(self._match_log)

        base = min(total_matches / 5.0, 1.0)
        category_bonus = min(categories_matched / 3.0, 0.3)

        return min(base + category_bonus, 1.0)

    # ── Internal checks ──────────────────────────────────────────────────

    def _check_content(self, content: Optional[str], source: str) -> None:
        """Check visible response content."""
        if not content or not isinstance(content, str):
            return
        for category, patterns in self._categorized.items():
            for pattern in patterns:
                match = pattern.search(content)
                if match:
                    self._match_log.append({
                        "category": category,
                        "pattern": match.group(0),
                        "source": source,
                        "snippet": self._extract_snippet(content, match.start()),
                    })
                    return  # one match per source suffices

    def _check_reasoning(self, msg: Any, choice_idx: int) -> None:
        """Check reasoning/thinking content (deepseek, openai o-series)."""
        reasoning = getattr(msg, "reasoning_content", None)
        if reasoning and isinstance(reasoning, str):
            self._check_content(
                reasoning,
                f"choice[{choice_idx}].reasoning_content",
            )

    def _check_thinking_blocks(self, msg: Any, choice_idx: int) -> None:
        """Check Anthropic thinking blocks."""
        thinking_blocks = getattr(msg, "thinking_blocks", None)
        if not thinking_blocks or not isinstance(thinking_blocks, list):
            return
        for tb_idx, tb in enumerate(thinking_blocks):
            if isinstance(tb, dict) and tb.get("type") == "thinking":
                thinking = tb.get("thinking", "")
                self._check_content(
                    thinking,
                    f"choice[{choice_idx}].thinking_blocks[{tb_idx}]",
                )

    @staticmethod
    def _extract_snippet(text: str, start: int, width: int = 80) -> str:
        """Extract a readable snippet around a match position."""
        left = max(0, start - width)
        right = min(len(text), start + width)
        snippet = text[left:right]
        if left > 0:
            snippet = "..." + snippet
        if right < len(text):
            snippet = snippet + "..."
        return snippet


# ── CLI entrypoint (for offline scanning) ────────────────────────────────────

def cli() -> None:
    """
    CLI entrypoint: reads text from stdin, scans for slop patterns, exits with
    non-zero if any match.

    Usage:
      echo "let me stub this out" | python guardrail/slop_guardrail.py
      cat response.json | python guardrail/slop_guardrail.py
    """
    import argparse

    parser = argparse.ArgumentParser(
        description="Scan text for slop-intent patterns"
    )
    parser.add_argument(
        "--patterns",
        default=None,
        help="Path to slop_patterns.json (default: next to this script)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Input is JSON with 'choices' array (model response format)",
    )
    args = parser.parse_args()

    text = sys.stdin.read()
    if not text.strip():
        sys.exit(0)

    # Load patterns
    patterns_file = args.patterns or (
        Path(__file__).parent / "slop_patterns.json"
    )
    raw = json.loads(Path(patterns_file).read_text())
    all_patterns: list[re.Pattern] = []
    for config in raw.get("categories", {}).values():
        for p in config.get("patterns", []):
            all_patterns.append(re.compile(p, re.IGNORECASE))

    if not all_patterns:
        print("No patterns loaded.")
        sys.exit(0)

    # Parse input
    if args.json:
        data = json.loads(text)
        texts_to_check: list[str] = []
        for choice in data.get("choices", []):
            msg = choice.get("message", {})
            if msg.get("content"):
                texts_to_check.append(msg["content"])
            if msg.get("reasoning_content"):
                texts_to_check.append(msg["reasoning_content"])
    else:
        texts_to_check = [text]

    found_any = False
    for text_to_check in texts_to_check:
        for pattern in all_patterns:
            match = pattern.search(text_to_check)
            if match:
                print(f"DETECTED: '{match.group(0)}'")
                found_any = True

    sys.exit(1 if found_any else 0)


if __name__ == "__main__":
    cli()
