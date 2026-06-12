"""Hacker News Show HN publisher — stub implementation.

Submits a "Show HN" post with title, URL, and optional first comment.
Implements **dang's rule**: detects and rejects text containing LLM-generated
patterns (clusters of 3+ AI tell words trigger rejection).

Reference: ``knowledge/humanize-prompt.md`` section on Hacker News voice:

    - CRITICAL RULE: NO LLM-generated text (dang's 2026 rule)
    - Show HN: facts-only in title, technical detail in comment
    - Always: "I built", "what I found", "my experience"
    - Never: "we're building", "check out our", "we think"

**This is a STUB** — actual browser-based submission will be performed
by the campaign execution engine using Hermes browser tools.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from typing import Any

from marketing.platforms.publisher_base import PlatformPublisher
from marketing.platforms.publisher_registry import publisher_registry

logger = logging.getLogger(__name__)

# ── AI tell word lists (sourced from knowledge/humanize-prompt.md) ──────────

# Tier 1 — immediate flag when 2+ appear together
_TIER_1_WORDS: frozenset[str] = frozenset({
    "delve", "tapestry", "realm", "landscape", "journey",
    "pivotal", "underscore", "foster", "testament", "enhance",
})

# Tier 2 — suspicious in clusters of 3+
_TIER_2_WORDS: frozenset[str] = frozenset({
    "leverage", "robust", "seamless", "holistic", "streamline",
    "utilize", "facilitate", "navigate", "ecosystem", "transformative",
    "multifaceted", "paramount", "cutting-edge", "innovative",
})

# Formulaic AI sentence patterns (each match counts as one AI tell feature)
_FORMULAIC_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bplays?\s+(?:a\s+)?(?:crucial|critical|important|vital)\s+role\b", re.IGNORECASE),
    re.compile(r"\bnot\s+just\s+\S+(?:\s+\S+){0,4}\s+but\b", re.IGNORECASE),
    re.compile(r"\bnot\s+only\s+\S+(?:\s+\S+){0,4}\s+but\b", re.IGNORECASE),
    re.compile(r"\bin recent years\b", re.IGNORECASE),
    re.compile(r"\bin today's\b", re.IGNORECASE),
    re.compile(r"\bit is important to\b", re.IGNORECASE),
    re.compile(r"\bone of the most\b", re.IGNORECASE),
    re.compile(r"\bwhen it comes to\b", re.IGNORECASE),
    re.compile(r"\bensuring\b", re.IGNORECASE),
    re.compile(r"\brather than\b", re.IGNORECASE),
    re.compile(r"\bcheck out our\b", re.IGNORECASE),
    re.compile(r"\bwe're building\b", re.IGNORECASE),
    re.compile(r"\bwe think\b", re.IGNORECASE),
]

# Hedging / intensifier words that signal AI writing
_AI_TELL_WORDS: frozenset[str] = frozenset({
    "significantly", "effectively", "increasingly", "extremely",
    "highly", "notably", "remarkably", "substantially",
    "seamlessly", "holistically", "transformatively",
})

# Additional marketing / promotional language flagged on HN
_PROMO_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bcutting-edge\b", re.IGNORECASE),
    re.compile(r"\bindustry-leading\b", re.IGNORECASE),
    re.compile(r"\bgame-changing\b", re.IGNORECASE),
    re.compile(r"\bnext-gen(?:eration)?\b", re.IGNORECASE),
    re.compile(r"\brevolutionary\b", re.IGNORECASE),
    re.compile(r"\bdisruptive\b", re.IGNORECASE),
    re.compile(r"\bthe future of\b", re.IGNORECASE),
]

# ── Constants ───────────────────────────────────────────────────────────────

_MAX_TITLE_CHARS = 80
"""Maximum title length for Hacker News posts (80 chars recommended for HN)."""

_SHOW_HN_PREFIX = "Show HN:"
"""Standard prefix for Show HN submissions."""

_AI_TELL_THRESHOLD = 3
"""Number of AI tell features that triggers rejection under dang's rule."""

_MAX_DAILY = 1
"""Hacker News limits Show HN submissions to 1 per day."""


# ===================================================================
# HackerNewsPublisher
# ===================================================================


class HackerNewsPublisher(PlatformPublisher):
    """Publish a Show HN submission to Hacker News.

    Expected ``content_spec`` shape for ``publish()`` and ``dry_run()``::

        {
            "title": "My Project — a fast thingy",      # str, required
            "url": "https://github.com/user/repo",      # str, required
            "text": "I built this because...",          # str, optional first comment
        }

    The title will be prefixed with ``"Show HN: "`` if not already present.
    Full title (including prefix) must be ≤ ``_MAX_TITLE_CHARS`` (80).
    """

    # ── Required interface ────────────────────────────────────────────────

    def validate_credentials(self) -> bool:
        """Hacker News does not require an API key for browser posting.

        Returns:
            Always ``True`` — browser-based submission is handled
            externally via Hermes browser tools.
        """
        return True

    def publish(
        self,
        content_spec: dict[str, Any],
        account: str = "",
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Submit a Show HN post.

        Args:
            content_spec: Must contain ``"title"`` and ``"url"`` keys.
                Optionally ``"text"`` for the first comment.
            account: HN username (for logging only — actual auth is
                browser-session based).
            dry_run: If ``True``, validate without submitting.

        Returns:
            Result dict per :meth:`PlatformPublisher.publish`.
        """
        # 1. Validate content structure
        validation = self._validate_content(content_spec)
        if not validation["valid"]:
            return {
                "success": False,
                "url": None,
                "platform": "hn",
                "status_code": "error",
                "error": "; ".join(validation["errors"]),
                "metadata": {"validation_errors": validation["errors"]},
            }

        normalized_title = self._normalize_title(content_spec["title"])
        url = content_spec["url"]
        text = content_spec.get("text", "")

        # 2. Run dang's rule on the text field
        if text:
            dang_check = self._check_dangs_rule(text)
            if not dang_check["pass"]:
                return {
                    "success": False,
                    "url": None,
                    "platform": "hn",
                    "status_code": "error",
                    "error": "; ".join(dang_check["errors"]),
                    "metadata": {
                        "ai_tell_count": dang_check["ai_tell_count"],
                        "validation_errors": dang_check["errors"],
                    },
                }

        # 3. Dry-run → return early
        if dry_run:
            return {
                "success": True,
                "url": None,
                "platform": "hn",
                "status_code": "dry_run",
                "error": None,
                "metadata": {
                    "normalized_title": normalized_title,
                    "url": url,
                    "has_text": bool(text),
                    "text_length": len(text) if text else 0,
                    "title_length": len(normalized_title),
                },
            }

        # 4. STUB: log and return mock result
        stub_id = uuid.uuid4().hex[:8]
        mock_url = f"https://news.ycombinator.com/item?id={stub_id}"

        logger.info(
            "STUB: Would submit Show HN to Hacker News as %s — "
            "title=%r url=%s mock URL=%s",
            account or "(anonymous)",
            normalized_title,
            url,
            mock_url,
        )

        return {
            "success": True,
            "url": mock_url,
            "platform": "hn",
            "status_code": "published",
            "error": None,
            "metadata": {
                "submission_id": stub_id,
                "normalized_title": normalized_title,
                "url": url,
                "has_text": bool(text),
                "account": account,
                "_stub": True,
                "_note": "STUB — no actual HN submission was made",
            },
        }

    def dry_run(self, content_spec: dict[str, Any]) -> dict[str, Any]:
        """Validate a Show HN submission without posting.

        Runs all checks that ``publish()`` runs, including dang's rule
        AI-tell detection on the text field.

        Args:
            content_spec: Same shape as ``publish()``.

        Returns:
            Same shape as ``publish()`` with ``status_code = "dry_run"``
            on success.
        """
        return self.publish(content_spec, dry_run=True)

    def get_max_daily(self) -> int:
        """Return the maximum daily Show HN submissions (1)."""
        return _MAX_DAILY

    def get_platform_name(self) -> str:
        """Return ``\"Hacker News\"`` as the human-readable platform name."""
        return "Hacker News"

    def get_content_requirements(self) -> dict[str, Any]:
        """Return Hacker News Show HN content constraints."""
        return {
            "max_title_chars": _MAX_TITLE_CHARS,
            "text_must_be_original": True,
            "llm_text_blocked": True,
            "url_required": True,
        }

    # ── Internal validation helpers ───────────────────────────────────────

    def _validate_content(self, spec: dict[str, Any]) -> dict[str, Any]:
        """Validate the structure of *spec*.

        Returns:
            A dict with ``valid`` (bool) and ``errors`` (list[str]).
        """
        errors: list[str] = []

        if "title" not in spec:
            errors.append('Missing required key "title"')
        elif not isinstance(spec["title"], str) or not spec["title"].strip():
            errors.append('"title" must be a non-empty string')

        if "url" not in spec:
            errors.append('Missing required key "url"')
        elif not isinstance(spec["url"], str) or not spec["url"].strip():
            errors.append('"url" must be a non-empty string')
        elif not self._is_valid_url(spec["url"]):
            errors.append(f'"url" is not a valid URL: {spec["url"]!r}')

        # Validate normalized title length
        if "title" in spec and isinstance(spec["title"], str):
            normalized = self._normalize_title(spec["title"])
            if len(normalized) > _MAX_TITLE_CHARS:
                errors.append(
                    f"Title exceeds {_MAX_TITLE_CHARS} characters "
                    f"(has {len(normalized)}): {normalized!r}"
                )

        # If text is present, check for AI tell patterns (dang's rule)
        text = spec.get("text", "")
        if text:
            if not isinstance(text, str):
                errors.append('"text" must be a string')
            else:
                dang_check = self._check_dangs_rule(text)
                if not dang_check["pass"]:
                    errors.extend(dang_check["errors"])

        # Check for promotional language in title
        if "title" in spec and isinstance(spec["title"], str):
            promo_check = self._check_promotional_language(spec["title"])
            if not promo_check["pass"]:
                errors.extend(promo_check["errors"])

        # Check for promotional language in text
        if text and isinstance(text, str):
            promo_check = self._check_promotional_language(text)
            if not promo_check["pass"]:
                errors.extend(promo_check["errors"])

        return {"valid": len(errors) == 0, "errors": errors}

    @staticmethod
    def _normalize_title(raw_title: str) -> str:
        """Ensure the title starts with ``\"Show HN: \"``.

        If the title already starts with ``\"Show HN\"`` (case-insensitive),
        it is left as-is.  Otherwise ``\"Show HN: \"`` is prepended.
        """
        stripped = raw_title.strip()
        if stripped.lower().startswith("show hn"):
            return stripped
        return f"{_SHOW_HN_PREFIX} {stripped}"

    @staticmethod
    def _is_valid_url(url: str) -> bool:
        """Basic URL validation — checks for scheme + domain structure."""
        return bool(re.match(r"^https?://[^\s/$.?#].[^\s]*$", url, re.IGNORECASE))

    @staticmethod
    def _check_promotional_language(text: str) -> dict[str, Any]:
        """Check for marketing/promotional language patterns.

        Returns:
            A dict with ``pass`` (bool) and ``errors`` (list[str]).
        """
        errors: list[str] = []
        text_lower = text.lower()

        for pattern in _PROMO_PATTERNS:
            if pattern.search(text_lower):
                errors.append(
                    f"Promotional language detected: {pattern.pattern!r} "
                    f"— HN Show HN should be facts-only"
                )
                break  # one match is enough

        return {"pass": len(errors) == 0, "errors": errors}

    @staticmethod
    def _check_dangs_rule(text: str) -> dict[str, Any]:
        """Apply dang's rule: detect LLM-generated text patterns.

        Scans the text for 12 AI tell word categories (formulaic patterns,
        tier-1/tier-2 banned words, hedging, intensifiers, promotional
        language).  If **3 or more** distinct AI tell features are detected,
        the text is flagged as likely LLM-generated and rejected.

        This implements the Hacker News community's "dang's rule" —
        named after dang, one of the HN moderators, who has stated that
        LLM-generated content on HN will be flagged and removed.

        Returns:
            A dict with:
            - ``pass`` (bool): ``True`` if text passes (fewer than 3 tells).
            - ``errors`` (list[str]): Human-readable failure reasons.
            - ``ai_tell_count`` (int): Number of distinct AI tell features.
            - ``details`` (list[str]): Which features were detected.
        """
        text_lower = text.lower()
        words = text_lower.split()
        clean_words = [w.strip(".,!?;:()\"'-") for w in words]

        features_detected: list[str] = []

        # Feature 1: Tier-1 word cluster (2+ unique tier-1 words)
        tier1_hits = {w for w in clean_words if w in _TIER_1_WORDS}
        if len(tier1_hits) >= 2:
            features_detected.append(
                f"Tier-1 banned word cluster: {', '.join(sorted(tier1_hits))}"
            )

        # Feature 2: Tier-2 word cluster (3+ unique tier-2 words)
        tier2_hits = {w for w in clean_words if w in _TIER_2_WORDS}
        if len(tier2_hits) >= 3:
            features_detected.append(
                f"Tier-2 banned word cluster: {', '.join(sorted(tier2_hits))}"
            )

        # Feature 3: Formulaic AI sentence patterns
        formulaic_count = sum(
            1 for pat in _FORMULAIC_PATTERNS if pat.search(text_lower)
        )
        if formulaic_count > 0:
            features_detected.append(
                f"{formulaic_count} formulaic AI pattern(s) detected"
            )

        # Feature 4: AI tell / intensifier words
        tell_hits = {w for w in clean_words if w in _AI_TELL_WORDS}
        if tell_hits:
            features_detected.append(
                f"AI tell words: {', '.join(sorted(tell_hits))}"
            )

        # Feature 5: Promotional/marketing language
        promo_count = sum(
            1 for pat in _PROMO_PATTERNS if pat.search(text_lower)
        )
        if promo_count > 0:
            features_detected.append(
                f"{promo_count} promotional language pattern(s) detected"
            )

        # Feature 6: Low first-person pronoun density
        i_count = len(re.findall(r"\bi\b|\bi'm\b|\bi've\b|\bi'd\b|\bi'll\b", text_lower))
        word_count = len(words)
        if word_count > 20 and i_count == 0:
            features_detected.append(
                "No first-person pronouns found — HN audience expects "
                "\"I built\", \"I found\", personal experience"
            )
        elif word_count > 50 and i_count < 3:
            features_detected.append(
                f"Low first-person pronoun count ({i_count} in {word_count} words) "
                f"— HN audience expects personal narrative"
            )

        ai_tell_count = len(features_detected)
        passed = ai_tell_count < _AI_TELL_THRESHOLD

        errors: list[str] = []
        if not passed:
            errors.append(
                f"AI-generated text detected (dang's rule): "
                f"{ai_tell_count} AI tell feature(s) found, "
                f"threshold is {_AI_TELL_THRESHOLD}. "
                f"Features: {'; '.join(features_detected)}"
            )

        return {
            "pass": passed,
            "errors": errors,
            "ai_tell_count": ai_tell_count,
            "details": features_detected,
        }


# ── Auto-register ───────────────────────────────────────────────────────────

publisher_registry.register(HackerNewsPublisher)
