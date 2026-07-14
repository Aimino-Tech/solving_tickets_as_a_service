"""
Slop-intent detection guardrail for LiteLLM proxy.

Intercepts LLM responses (including thinking/reasoning traces) and blocks
code that contains slop patterns: stubs, placeholders, mocks, deferrals,
and self-aware "this is just a demo" patterns.

Architecture:
  LiteLLM CustomGuardrail → async_post_call_success_hook
    → scans reasoning_content (deepseek) + thinking_blocks (anthropic) + content
    → raises ValueError to block the response (block mode)
    → injects CAUTION annotation into response (annotate mode)
    → logs detection only (warn mode)
    → fallback: async_post_call_streaming_iterator_hook for streaming audit

Gating modes (set via guardrail params):
  - warn:      Log detection, pass response through unchanged
  - annotate:  Inject CAUTION text into response content
  - block:     Raise ValueError → LiteLLM returns HTTP 400

Usage in proxy_config.yaml:
  guardrails:
    - guardrail_name: slop-detector
      litellm_params:
        guardrail: guardrail.slop_guardrail.SlopIntentGuardrail
        mode: post_call
        default_on: true
        guardrail_params:
          gate_mode: block          # warn | annotate | block
          block_threshold: 1.0      # 0.0-1.0, fraction of categories that must match
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
    """Raised when slop intent is detected (block mode). LiteLLM maps this to a 400 response."""

    def __init__(self, source: str, pattern: str, snippet: str) -> None:
        self.source = source
        self.pattern = pattern
        self.snippet = snippet[:200]
        super().__init__(f"Slop pattern detected in {source}: '{pattern}'")


GUARDRAIL_BLOCKED_CODE = "GUARDRAIL_BLOCKED"


class SlopIntentGuardrail(CustomGuardrail):
    """
    LiteLLM guardrail that detects slop-intent patterns in model responses.

    Checks three sources:
    1. response.choices[].message.reasoning_content (deepseek, openai o-series)
    2. response.choices[].message.thinking_blocks (anthropic)
    3. response.choices[].message.content (all models)

    Gating modes (set via guardrail_params in proxy_config.yaml):
      - warn:      Log detection, pass response through
      - annotate:  Inject CAUTION text into response content
      - block:     Raise ValueError → LiteLLM returns HTTP 400

    Configurable params:
      gate_mode: str        — "warn" | "annotate" | "block" (default: "block")
      block_threshold: float — 0.0-1.0, fraction of categories that must
                               match to trigger a block (default: 0.5)
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._categorized = _load_patterns()
        self._all_patterns = _flatten_patterns(self._categorized)
        self._match_log: list[dict[str, str]] = []

        self.gate_mode = (kwargs.get("gate_mode") or "block").lower()
        if self.gate_mode not in ("warn", "annotate", "block"):
            logger.warning(
                "Unknown gate_mode '%s', falling back to 'block'",
                self.gate_mode,
            )
            self.gate_mode = "block"

        self.block_threshold = float(kwargs.get("block_threshold") or 0.5)
        self.block_threshold = max(0.0, min(1.0, self.block_threshold))

        if not self._all_patterns:
            logger.warning(
                "SlopIntentGuardrail loaded with 0 patterns — will allow all responses"
            )

        logger.info(
            "SlopIntentGuardrail initialized: %d patterns across %d categories, "
            "gate_mode=%s, block_threshold=%.2f",
            len(self._all_patterns),
            len(self._categorized),
            self.gate_mode,
            self.block_threshold,
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
        to the client. Behavior depends on gate_mode:
          - block:    Raise ValueError → LiteLLM returns HTTP 400
          - annotate: Inject CAUTION prefix into response content
          - warn:     Log detection only
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

        matched_categories: set[str] = set()
        for m in self._match_log:
            matched_categories.add(m["category"])
            logger.warning(
                "SLOP DETECTED [%s]: '%s' in %s — snippet: %s",
                m["category"],
                m["pattern"],
                m["source"],
                m["snippet"],
            )

        category_ratio = len(matched_categories) / max(len(self._categorized), 1)
        first = self._match_log[0]

        if self.gate_mode == "block":
            if category_ratio >= self.block_threshold:
                raise SlopIntentGuardrailError(
                    source=first["source"],
                    pattern=first["pattern"],
                    snippet=first["snippet"],
                )
            logger.info(
                "Block threshold not met: %.2f < %.2f — falling back to warn",
                category_ratio, self.block_threshold,
            )

        elif self.gate_mode == "annotate":
            annotation = (
                f"\n\n[CAUTION: Slop pattern detected — '{first['pattern']}' "
                f"in {first['source']} — response may contain placeholder content.]\n"
            )
            for choice in response.choices:
                msg = choice.message
                if msg.content:
                    msg.content = annotation + msg.content

        # warn mode: just log (already done above)

    async def async_post_call_streaming_iterator_hook(
        self,
        user_api_key_dict: Any,
        response: Any,
        request_data: dict,
    ) -> AsyncGenerator[ModelResponseStream, None]:
        """
        For streaming requests: buffer chunks, scan progressively, and
        inject CAUTION annotation at chunk boundary when slop is detected.

        Gate modes:
            block   — deliver chunks, then raise ValueError (client gets
                      partial content + error — best-effort)
            annotate — inject CAUTION comment in the next chunk after detection
            warn    — log at warning level, let all chunks through
        """
        buffer = ""
        slop_detected = False
        slop_category = ""
        slop_pattern = ""
        slop_snippet = ""

        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta:
                delta = chunk.choices[0].delta.content or ""
                buffer += delta

            if not slop_detected:
                for category, patterns in self._categorized.items():
                    for pattern in patterns:
                        match = pattern.search(buffer)
                        if match:
                            slop_detected = True
                            slop_category = category
                            slop_pattern = match.group(0)
                            slop_snippet = self._extract_snippet(buffer, match.start())
                            logger.warning(
                                "SLOP DETECTED (streaming): category=%s, pattern='%s', mode=%s",
                                category,
                                slop_pattern,
                                self._gate_mode,
                            )

                            if self._gate_mode == "annotate":
                                annotation = (
                                    f"\n\n---\n*CAUTION — Slop pattern detected in stream:*\n"
                                    f"* Category: {category}\n"
                                    f"* Pattern: '{slop_pattern}'"
                                    f"\n\n[Stream annotation — slop detected and flagged]"
                                )
                                if chunk.choices and chunk.choices[0].delta:
                                    chunk.choices[0].delta.content = (
                                        (chunk.choices[0].delta.content or "") + annotation
                                    )
                            break
                    if slop_detected:
                        break

            yield chunk

        if slop_detected and self._gate_mode == "block":
            raise SlopIntentGuardrailError(
                source="streaming",
                pattern=slop_pattern,
                snippet=slop_snippet,
            )

        matched_patterns: list[str] = []
        for pattern in self._all_patterns:
            match = pattern.search(assembled)
            if match:
                matched_patterns.append(match.group(0))

        if matched_patterns:
            logger.warning(
                "SLOP DETECTED (streaming, post-delivery): '%s'",
                "', '".join(matched_patterns[:5]),
            )

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
