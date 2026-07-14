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

# ── Input guardrail patterns (injection, prompt leak, system prompt extraction) ─

INPUT_INJECTION_PATTERNS: list[re.Pattern] = [
    re.compile(r"ignore\s+(all\s+)?(previous|above|below)\s+instructions", re.IGNORECASE),
    re.compile(r"forget\s+(all\s+)?(previous|above|below)", re.IGNORECASE),
    re.compile(r"you\s+(are\s+)?(now|will\s+act\s+as)\s+dAN|do\s+anything\s+now", re.IGNORECASE),
    re.compile(r"system\s+prompt\s*[=:].*", re.IGNORECASE),
    re.compile(r"output\s+your\s+(system\s+)?(prompt|instructions)", re.IGNORECASE),
    re.compile(r"reveal\s+(your\s+)?(system\s+)?(prompt|instructions)", re.IGNORECASE),
    re.compile(r"role\s*[=:]\s*(system|assistant)", re.IGNORECASE),
    re.compile(r"you\s+must\s+(ignore|disregard|skip)", re.IGNORECASE),
    re.compile(r"\[internal\]", re.IGNORECASE),
]

INPUT_INJECTION_LABELS: dict[str, str] = {
    "ignore_instructions": "Prompt injection — instruction override attempt",
    "forget_instructions": "Prompt injection — memory reset attempt",
    "jailbreak_roleplay": "Jailbreak — DAN / roleplay override",
    "system_prompt_extraction": "System prompt extraction attempt",
    "leak_system_prompt": "System prompt leak request",
    "reveal_prompt": "Prompt reveal attempt",
    "role_override": "Role override attempt",
    "ignore_command": "Disregard instruction attempt",
    "internal_tag": "Internal tag detected in user input",
}

INPUT_CAUTION_PREFIX = "\n\n---\n*CAUTION — Input guardrail flagged content:*"

INPUT_CAUTION_ANNOTATION = (
    "\n\nYour prompt contained patterns that may indicate prompt injection "
    "or system prompt extraction. The flagged content has been noted."
)


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
        self._input_match_log: list[dict[str, str]] = []

        self._silent_annotate = (
            os.environ.get("SLOP_SILENT_ANNOTATE", "false").lower() == "true"
            or str(kwargs.get("silent_annotate", "false")).lower() == "true"
        )

        self._guardrail_level = int(
            os.environ.get("SLOP_GUARDRAIL_LEVEL", kwargs.get("guardrail_level", "2"))
        )

        if not self._all_patterns:
            logger.warning(
                "SlopIntentGuardrail loaded with 0 patterns — will allow all responses"
            )

        logger.info(
            "SlopIntentGuardrail initialized: %d patterns across %d categories, "
            "silent_annotate=%s, guardrail_level=%d",
            len(self._all_patterns),
            len(self._categorized),
            self._silent_annotate,
            self._guardrail_level,
        )

    # ── Public hooks ─────────────────────────────────────────────────────

    async def async_pre_call_hook(
        self,
        data: dict,
        user_api_key_dict: Any,
    ) -> Optional[dict]:
        """
        Pre-call hook. Scans user input for injection/security patterns.
        When guardrail_level >= 2 and patterns are detected, injects a
        CAUTION system message into the request data.
        """
        self._input_match_log = []
        messages = data.get("messages", [])
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                self._check_input_content(content)
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and "text" in part:
                        self._check_input_content(part["text"])

        if not self._input_match_log:
            return None

        for m in self._input_match_log:
            logger.warning(
                "INPUT GUARDRAIL [%s]: '%s' — %s",
                m["category"],
                m["pattern"],
                m["label"],
            )

        if self._silent_annotate:
            return None

        if self._guardrail_level >= 2:
            annotation_lines = [
                f"{INPUT_CAUTION_PREFIX}",
            ]
            for m in self._input_match_log[:5]:
                annotation_lines.append(f"* {m['label']}: matched '{m['pattern']}'")
            annotation_lines.append(INPUT_CAUTION_ANNOTATION)
            annotation = "\n".join(annotation_lines)

            modified = dict(data)
            messages = list(modified.get("messages", []))
            messages.append({
                "role": "system",
                "content": annotation.strip(),
            })
            modified["messages"] = messages
            logger.info(
                "INPUT GUARDRAIL ANNOTATED: %d patterns, level=%d",
                len(self._input_match_log),
                self._guardrail_level,
            )
            return modified

        return None

    async def async_post_call_success_hook(
        self,
        data: dict,
        user_api_key_dict: Any,
        response: Any,
    ) -> None:
        """
        Post-call hook. Runs after LLM responds but before response is returned
        to the client. Raises ValueError to block the response.
        """
        if not isinstance(response, litellm.ModelResponse):
            return

        self._match_log = []

        for idx, choice in enumerate(response.choices):
            msg = choice.message
            self._check_content(msg.content, f"choice[{idx}].content")
            self._check_reasoning(msg, idx)
            self._check_thinking_blocks(msg, idx)

        if self._match_log:
            # Log all detections, raise on the first one
            for m in self._match_log:
                logger.warning(
                    "SLOP DETECTED [%s]: '%s' in %s — snippet: %s",
                    m["category"],
                    m["pattern"],
                    m["source"],
                    m["snippet"],
                )
            first = self._match_log[0]
            raise SlopIntentGuardrailError(
                source=first["source"],
                pattern=first["pattern"],
                snippet=first["snippet"],
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
                    "SLOP DETECTED (streaming, post-delivery): '%s'", match.group(0)
                )
                break

    # ── Input checks ───────────────────────────────────────────────────────

    def _check_input_content(self, content: str) -> None:
        """Check user input for injection/security patterns."""
        if not content or not isinstance(content, str):
            return

        for label_key, pattern in zip(INPUT_INJECTION_LABELS.keys(), INPUT_INJECTION_PATTERNS):
            match = pattern.search(content)
            if match:
                self._input_match_log.append({
                    "category": label_key,
                    "pattern": match.group(0)[:100],
                    "source": "user_input",
                    "snippet": self._extract_snippet(content, match.start()),
                    "label": INPUT_INJECTION_LABELS[label_key],
                })

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
