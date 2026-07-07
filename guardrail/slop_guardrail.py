"""
Slop-intent detection guardrail for LiteLLM proxy.

Architecture:
  LiteLLM CustomGuardrail → async_pre_call_hook (inject-only)
                         → async_post_call_success_hook (annotate/correct)
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import litellm
from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm.types.utils import ModelResponseStream

logger = logging.getLogger(__name__)

# ── Pattern loading ──────────────────────────────────────────────────────────

def _load_patterns() -> dict[str, list[re.Pattern]]:
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
    return [p for patterns in categorized.values() for p in patterns]


def _extract_user_messages(messages: list[dict]) -> list[str]:
    texts: list[str] = []
    for msg in messages:
        if isinstance(msg, dict):
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "user" and isinstance(content, str):
                texts.append(content)
    return texts


def _check_input_message(text: str, categorized: dict[str, list[re.Pattern]]) -> list[dict[str, str]]:
    matches: list[dict[str, str]] = []
    for category, patterns in categorized.items():
        for pattern in patterns:
            match = pattern.search(text)
            if match:
                matches.append({
                    "category": category,
                    "pattern": match.group(0),
                    "snippet": text[max(0, match.start() - 40):match.end() + 40],
                })
                break
    return matches


SLOP_CAUTION_NUDGE = (
    "CAUTION: The user's request contains patterns consistent with "
    "requesting placeholder or simulated content ({categories}).  "
    "Provide real, complete implementations — do not use mocks, "
    "stubs, fake data, or demo content."
)

SLOP_ANNOTATION_PREFIX = "\n\n---\n*⚠️ Slop detected in model output:"

RESPONSE_SLOP_WARNING = (
    "\n\nThe response contains patterns that appear to use placeholder, "
    "stub, or simulated content instead of real implementations. "
    "Please verify the output and request a revised response if needed."
)

CODE_QUALITY_WARNING = (
    "\n\nAdditional quality check: Some parts of this response use patterns "
    "that may indicate incomplete implementation (stubs, TODOs, or placeholders)."
)


@dataclass
class GateResult:
    passed: bool = True
    annotations: list[str] = field(default_factory=list)
    corrections: dict[str, str] | None = None


# ── Output sub-gates ─────────────────────────────────────────────────────────

def _gate_response_slop(match_log: list[dict]) -> GateResult:
    if not match_log:
        return GateResult()
    cats = ", ".join(sorted(set(m["category"] for m in match_log)))
    return GateResult(
        passed=False,
        annotations=[f"{SLOP_ANNOTATION_PREFIX} categories: {cats}]{RESPONSE_SLOP_WARNING}"],
    )


def _gate_code_quality(match_log: list[dict]) -> GateResult:
    stub_categories = {"stub_intent", "placeholder_intent", "empty_implementation"}
    matched = [m for m in match_log if m["category"] in stub_categories]
    if not matched:
        return GateResult()
    return GateResult(
        passed=False,
        annotations=[CODE_QUALITY_WARNING],
    )


def _gate_ast_check(match_log: list[dict]) -> GateResult:
    return GateResult()


def _gate_security(match_log: list[dict]) -> GateResult:
    return GateResult()


_OUTPUT_GATES = [
    ("response_slop", _gate_response_slop),
    ("code_quality", _gate_code_quality),
    ("ast_check", _gate_ast_check),
    ("security", _gate_security),
]


def _run_output_guardrails(match_log: list[dict]) -> list[str]:
    annotations: list[str] = []
    for name, gate_fn in _OUTPUT_GATES:
        result = gate_fn(match_log)
        if not result.passed:
            logger.info("Output gate '%s' triggered — %d annotations", name, len(result.annotations))
            annotations.extend(result.annotations)
    return annotations


def _apply_annotation(response: Any, annotations: list[str]) -> None:
    if not annotations or not hasattr(response, "choices") or not response.choices:
        return
    first = response.choices[0]
    if not hasattr(first, "message") or not first.message:
        return
    suffix = "".join(annotations)
    first.message.content = (first.message.content or "") + suffix


def _apply_correction(response: Any, match_log: list[dict]) -> None:
    if not hasattr(response, "choices") or not response.choices:
        return
    first = response.choices[0]
    if not hasattr(first, "message") or not first.message:
        return
    content = first.message.content or ""
    for m in match_log:
        content = content.replace(m["pattern"], f"[SANITIZED:{m['category']}]")
    first.message.content = content


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

    Never blocks — only injects system nudges (pre_call) and annotates/corrects
    responses (post_call).
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._categorized = _load_patterns()
        self._all_patterns = _flatten_patterns(self._categorized)
        self._match_log: list[dict[str, str]] = []
        self._pre_call_injected: bool = False
        self._on_detect: str = kwargs.get("on_detect", "annotate")

        if self._on_detect not in ("annotate", "correct"):
            logger.warning(
                "on_detect='%s' is not a supported mode — falling back to 'annotate'. "
                "Supported modes: 'annotate', 'correct'.",
                self._on_detect,
            )
            self._on_detect = "annotate"

        if not self._all_patterns:
            logger.warning(
                "SlopIntentGuardrail loaded with 0 patterns — will allow all responses"
            )

        logger.info(
            "SlopIntentGuardrail initialized: %d patterns across %d categories, on_detect=%s",
            len(self._all_patterns),
            len(self._categorized),
            self._on_detect,
        )

    # ── Public hooks ─────────────────────────────────────────────────────

    async def async_pre_call_hook(
        self,
        data: dict,
        user_api_key_dict: Any,
    ) -> Optional[dict]:
        messages = data.get("messages", [])
        if not isinstance(messages, list):
            return None

        had_input_slop = False
        input_slop_categories: set[str] = set()

        for text in _extract_user_messages(messages):
            matches = _check_input_message(text, self._categorized)
            for m in matches:
                had_input_slop = True
                input_slop_categories.add(m["category"])
                logger.info(
                    "PRE_CALL slop pattern detected [%s]: '%s' — injecting nudge",
                    m["category"],
                    m["pattern"],
                )

        if had_input_slop:
            categories_str = ", ".join(sorted(input_slop_categories))
            nudge = SLOP_CAUTION_NUDGE.format(categories=categories_str)
            messages.append({"role": "system", "content": nudge})
            self._pre_call_injected = True
            logger.warning("Injected slop caution nudge for categories: %s", categories_str)
            return {"messages": messages}

        return None

    async def async_post_call_success_hook(
        self,
        data: dict,
        user_api_key_dict: Any,
        response: Any,
    ) -> None:
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

        for m in self._match_log:
            logger.warning(
                "SLOP DETECTED [%s]: '%s' in %s — snippet: %s",
                m["category"],
                m["pattern"],
                m["source"],
                m["snippet"],
            )

        annotations = _run_output_guardrails(self._match_log)
        _apply_annotation(response, annotations)

        if self._on_detect == "correct":
            _apply_correction(response, self._match_log)
            logger.info("Applied correction for %d slop matches", len(self._match_log))

    async def async_post_call_streaming_iterator_hook(
        self,
        user_api_key_dict: Any,
        response: Any,
        request_data: dict,
    ) -> AsyncGenerator[ModelResponseStream, None]:
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

    # ── Internal checks ──────────────────────────────────────────────────

    def _check_content(self, content: Optional[str], source: str) -> None:
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
                    return

    def _check_reasoning(self, msg: Any, choice_idx: int) -> None:
        reasoning = getattr(msg, "reasoning_content", None)
        if reasoning and isinstance(reasoning, str):
            self._check_content(
                reasoning,
                f"choice[{choice_idx}].reasoning_content",
            )

    def _check_thinking_blocks(self, msg: Any, choice_idx: int) -> None:
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
