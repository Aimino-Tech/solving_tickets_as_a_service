"""
Slop-intent detection guardrail for LiteLLM proxy.

POLICY: This guardrail NEVER blocks requests or responses.
It only injects system message nudges and annotates/corrects responses.
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
    patterns_file = Path(__file__).parent / "slop_patterns.json"
    if not patterns_file.exists():
        logger.warning("slop_patterns.json not found at %s", patterns_file)
        return {}
    raw = json.loads(patterns_file.read_text())
    compiled: dict[str, list[re.Pattern]] = {}
    for category, config in raw.get("categories", {}).items():
        for p in config.get("patterns", []):
            compiled.setdefault(category, []).append(re.compile(p, re.IGNORECASE))
    return compiled


def _flatten_patterns(categorized: dict[str, list[re.Pattern]]) -> list[re.Pattern]:
    return [p for patterns in categorized.values() for p in patterns]


# ── Guardrail implementation ─────────────────────────────────────────────────

class SlopIntentGuardrailError(ValueError):
    """Kept for backwards compatibility — never raised by the guardrail."""


SLOP_ANNOTATION = (
    "\n\n---\n*⚠️ The response contains patterns consistent with placeholder or "
    "simulated content. Review the output and request a revised response if needed.*"
)


class SlopIntentGuardrail(CustomGuardrail):
    """
    LiteLLM guardrail that detects slop-intent patterns.

    POLICY: Never blocks — only injects system nudges (pre_call) and
    annotates responses (post_call).
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._categorized = _load_patterns()
        self._all_patterns = _flatten_patterns(self._categorized)
        self._match_log: list[dict[str, str]] = []
        self._on_detect = kwargs.get("on_detect", "annotate")

        if self._on_detect not in ("annotate", "correct"):
            logger.warning(
                "on_detect='%s' is not a supported mode — guardrail never blocks. "
                "Falling back to 'annotate'. Supported modes: 'annotate', 'correct'.",
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
        """
        Pre-call hook. Never blocks — only injects system message nudges.
        """
        messages = data.get("messages", [])
        if not isinstance(messages, list):
            return None

        had_input_slop = False
        input_slop_categories: set[str] = set()

        for msg in messages:
            if isinstance(msg, dict) and msg.get("role") == "user":
                text = msg.get("content", "")
                if isinstance(text, str):
                    for category, patterns in self._categorized.items():
                        for pattern in patterns:
                            match = pattern.search(text)
                            if match:
                                had_input_slop = True
                                input_slop_categories.add(category)
                                break
                        if had_input_slop and category in input_slop_categories:
                            continue

        if had_input_slop:
            cats = ", ".join(sorted(input_slop_categories))
            nudge = (
                "CAUTION: The user's request contains patterns consistent with "
                f"requesting placeholder or simulated content ({cats}).  "
                "Provide real, complete implementations — do not use mocks, "
                "stubs, fake data, or demo content."
            )
            messages.append({"role": "system", "content": nudge})
            logger.warning("Injected slop caution nudge for categories: %s", cats)
            return {"messages": messages}

        return None

    async def async_post_call_success_hook(
        self,
        data: dict,
        user_api_key_dict: Any,
        response: Any,
    ) -> None:
        """
        Post-call hook. Never blocks — only annotates or corrects responses.
        """
        if not isinstance(response, litellm.ModelResponse):
            return

        self._match_log = []

        for idx, choice in enumerate(response.choices):
            msg = choice.message
            content = getattr(msg, "content", None)
            if content and isinstance(content, str):
                for category, patterns in self._categorized.items():
                    for pattern in patterns:
                        match = pattern.search(content)
                        if match:
                            self._match_log.append({
                                "category": category,
                                "pattern": match.group(0),
                                "source": f"choice[{idx}].content",
                                "snippet": self._extract_snippet(content, match.start()),
                            })
                            break

            reasoning = getattr(msg, "reasoning_content", None)
            if reasoning and isinstance(reasoning, str):
                for category, patterns in self._categorized.items():
                    for pattern in patterns:
                        match = pattern.search(reasoning)
                        if match:
                            self._match_log.append({
                                "category": category,
                                "pattern": match.group(0),
                                "source": f"choice[{idx}].reasoning_content",
                                "snippet": self._extract_snippet(reasoning, match.start()),
                            })
                            break

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

        first = response.choices[0]
        msg = first.message
        if self._on_detect == "correct":
            content = msg.content or ""
            for m in self._match_log:
                content = content.replace(m["pattern"], f"[SANITIZED:{m['category']}]")
            msg.content = content
        else:
            msg.content = (msg.content or "") + SLOP_ANNOTATION

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
                break

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


# ── CLI entrypoint ───────────────────────────────────────────────────────────

def cli() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Scan text for slop-intent patterns")
    parser.add_argument("--patterns", default=None)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    text = sys.stdin.read()
    if not text.strip():
        sys.exit(0)
    patterns_file = args.patterns or (Path(__file__).parent / "slop_patterns.json")
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
