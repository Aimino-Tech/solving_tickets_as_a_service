"""LinkedIn post publisher — stub implementation.

Posts an article/update to LinkedIn with the link in the **first comment**
(rather than the post body), because LinkedIn's algorithm penalises external
links in the post body for organic reach.

Reference: ``knowledge/humanize-prompt.md`` section on LinkedIn voice:

    - Links in post body = reach penalty. Use "🔗 in comments" or first comment.
    - Max 1 post/day
    - Personal profile > company page for engagement
    - Long-form posts (1000-2000 chars) outperform short ones

**This is a STUB** — actual browser-based posting will be performed
by the campaign execution engine using Hermes browser tools.
"""

from __future__ import annotations

import logging
import os
import re
import time
import uuid
from typing import Any

from marketing.platforms.publisher_base import PlatformPublisher
from marketing.platforms.publisher_registry import publisher_registry

logger = logging.getLogger(__name__)

# ── AI tell word lists (sourced from knowledge/humanize-prompt.md) ──────────

_TIER_1_WORDS: frozenset[str] = frozenset({
    "delve", "tapestry", "realm", "landscape", "journey",
    "pivotal", "underscore", "foster", "testament", "enhance",
})

_TIER_2_WORDS: frozenset[str] = frozenset({
    "leverage", "robust", "seamless", "holistic", "streamline",
    "utilize", "facilitate", "navigate", "ecosystem", "transformative",
    "multifaceted", "paramount", "cutting-edge", "innovative",
})

_FORMULAIC_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bplays?\s+(?:a\s+)?(?:crucial|critical|important|vital)\s+role\b", re.IGNORECASE),
    re.compile(r"\bnot\s+just\s+\S+(?:\s+\S+){0,4}\s+but\b", re.IGNORECASE),
    re.compile(r"\bnot\s+only\s+\S+(?:\s+\S+){0,4}\s+but\b", re.IGNORECASE),
    re.compile(r"\bin recent years\b", re.IGNORECASE),
    re.compile(r"\bin today's\b", re.IGNORECASE),
    re.compile(r"\bit is important to\b", re.IGNORECASE),
    re.compile(r"\bit is noteworthy that\b", re.IGNORECASE),
    re.compile(r"\bensuring\b", re.IGNORECASE),
    re.compile(r"\brather than\b", re.IGNORECASE),
]

_AI_TELL_WORDS: frozenset[str] = frozenset({
    "significantly", "effectively", "increasingly", "extremely",
    "highly", "notably", "remarkably", "substantially",
    "seamlessly", "holistically", "transformatively",
    "game-changing", "industry-leading", "best-in-class",
    "world-class", "cutting-edge",
})

# ── Constants ───────────────────────────────────────────────────────────────

_MAX_BODY_CHARS = 3000
"""LinkedIn post body character limit."""

_RECOMMENDED_MIN_CHARS = 150
"""Minimum recommended post length for engagement."""

_RECOMMENDED_MAX_CHARS = 300
"""Maximum recommended post length for optimal engagement on LinkedIn."""

_MAX_DAILY = 1
"""LinkedIn daily posting limit for organic engagement.

LinkedIn's algorithm prefers quality over quantity — more than 1 post/day
can reduce reach per post.
"""

_LINK_IN_BODY_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"https?://\S+", re.IGNORECASE),
    re.compile(r"www\.\S+", re.IGNORECASE),
    re.compile(r"bit\.ly/\S+", re.IGNORECASE),
    re.compile(r"tinyurl\.com/\S+", re.IGNORECASE),
]

# For LinkedIn, the AI tell threshold is lower (60) because the platform
# expects a more formal tone than Reddit (70) or HN (80), but AI-generated
# content is still detectable.
_AI_TELL_THRESHOLD = 60
"""LinkedIn-specific AI tell detection threshold (lower = more formal tone allowed)."""


# ===================================================================
# LinkedInPublisher
# ===================================================================


class LinkedInPublisher(PlatformPublisher):
    """Publish an update to LinkedIn with link in the first comment.

    Expected ``content_spec`` shape for ``publish()`` and ``dry_run()``::

        {
            "body": "Post body text — max 3000 chars, no links here...",
            "link": "https://github.com/user/repo",          # optional
            "link_comment": "🔗 Full details: https://...",  # optional, overrides link
            "hashtags": ["tech", "opensource"],               # optional
            "media_urls": ["https://...png"],                 # optional
        }

    **Critical rule**: Links must go in the first comment, NOT in the body.
    LinkedIn's algorithm penalises posts with external links in the body,
    reducing organic reach.  Use ``link_comment`` for the link text that
    will appear as the first comment.
    """

    # ── Required interface ────────────────────────────────────────────────

    def validate_credentials(self) -> bool:
        """Check for ``LINKEDIN_API_KEY`` environment variable.

        Returns:
            ``True`` if ``LINKEDIN_API_KEY`` is set, ``False`` otherwise.
            (Stub — real auth requires OAuth 2.0 tokens.)
        """
        has_key = bool(os.environ.get("LINKEDIN_API_KEY"))
        if not has_key:
            logger.warning(
                "LINKEDIN_API_KEY not found in environment — "
                "credentials missing"
            )
        return has_key

    def publish(
        self,
        content_spec: dict[str, Any],
        account: str = "",
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Publish a post to LinkedIn.

        Args:
            content_spec: Must contain ``"body"``.  Optionally ``"link"``
                or ``"link_comment"``, ``"hashtags"``, ``"media_urls"``.
            account: LinkedIn profile or page name (for logging).
            dry_run: If ``True``, validate without posting.

        Returns:
            Result dict per :meth:`PlatformPublisher.publish`.
        """
        # 1. Validate content structure
        validation = self._validate_content(content_spec)
        if not validation["valid"]:
            return {
                "success": False,
                "url": None,
                "platform": "linkedin",
                "status_code": "error",
                "error": "; ".join(validation["errors"]),
                "metadata": {"validation_errors": validation["errors"]},
            }

        # 2. Ensure link is NOT in body
        link_in_body = self._detect_link_in_body(content_spec.get("body", ""))
        if link_in_body and not dry_run:
            logger.warning(
                "Link detected in LinkedIn post body — this will reduce "
                "organic reach.  Links should go in the first comment."
            )

        # 3. Dry-run → return early with full validation
        if dry_run:
            result = self._dry_run_impl(content_spec)
            return result

        # 4. STUB: log and return mock result
        stub_id = uuid.uuid4().hex[:10]
        mock_url = (
            f"https://linkedin.com/feed/update/urn:li:activity:{stub_id}"
        )

        body = content_spec["body"]
        link = content_spec.get("link", "")
        link_comment = content_spec.get("link_comment", "")
        hashtags = content_spec.get("hashtags", [])

        logger.info(
            "STUB: Would post to LinkedIn as %s — "
            "body_length=%d link=%s hashtags=%s mock URL=%s",
            account or "(default)",
            len(body),
            link or "(none)",
            hashtags,
            mock_url,
        )

        return {
            "success": True,
            "url": mock_url,
            "platform": "linkedin",
            "status_code": "published",
            "error": None,
            "metadata": {
                "post_id": stub_id,
                "body_length": len(body),
                "has_link": bool(link),
                "has_link_comment": bool(link_comment),
                "hashtags": hashtags,
                "link_in_body_detected": link_in_body,
                "account": account,
                "_stub": True,
                "_note": "STUB — no actual LinkedIn post was made",
            },
        }

    def dry_run(self, content_spec: dict[str, Any]) -> dict[str, Any]:
        """Validate content without posting.

        In addition to structural validation, this ensures:
        - No links are present in the post body
        - The post body passes AI tell detection (LinkedIn threshold: 60)
        - Body length is within the recommended range

        Args:
            content_spec: Same shape as ``publish()``.

        Returns:
            Same shape as ``publish()`` with ``status_code = "dry_run"``
            on success.
        """
        return self._dry_run_impl(content_spec)

    def get_max_daily(self) -> int:
        """Return the maximum daily posting limit for LinkedIn.

        LinkedIn's algorithm penalises frequent posting.  1 per day is the
        recommended maximum for organic engagement.
        """
        return _MAX_DAILY

    def get_platform_name(self) -> str:
        """Return ``\"LinkedIn\"`` as the human-readable platform name."""
        return "LinkedIn"

    def get_content_requirements(self) -> dict[str, Any]:
        """Return LinkedIn content formatting constraints."""
        return {
            "max_body_chars": _MAX_BODY_CHARS,
            "recommended_body_range": [_RECOMMENDED_MIN_CHARS, _RECOMMENDED_MAX_CHARS],
            "link_position": "first_comment",
            "supports_media": True,
            "supports_hashtags": True,
        }

    # ── Internal validation helpers ───────────────────────────────────────

    def _validate_content(self, spec: dict[str, Any]) -> dict[str, Any]:
        """Validate the structure of *spec*.

        Returns:
            A dict with ``valid`` (bool) and ``errors`` (list[str]).
        """
        errors: list[str] = []

        if "body" not in spec:
            errors.append('Missing required key "body"')
            return {"valid": False, "errors": errors}

        body = spec["body"]
        if not isinstance(body, str):
            errors.append('"body" must be a string')
            return {"valid": False, "errors": errors}

        if not body.strip():
            errors.append('"body" must not be empty')
            return {"valid": False, "errors": errors}

        if len(body) > _MAX_BODY_CHARS:
            errors.append(
                f"Body exceeds {_MAX_BODY_CHARS} characters "
                f"(has {len(body)})"
            )

        return {"valid": len(errors) == 0, "errors": errors}

    def _dry_run_impl(self, content_spec: dict[str, Any]) -> dict[str, Any]:
        """Full dry-run validation implementation."""
        # 1. Structural validation
        validation = self._validate_content(content_spec)
        if not validation["valid"]:
            return {
                "success": False,
                "url": None,
                "platform": "linkedin",
                "status_code": "error",
                "error": "; ".join(validation["errors"]),
                "metadata": {"validation_errors": validation["errors"]},
            }

        body = content_spec["body"]
        link = content_spec.get("link", "")
        link_comment = content_spec.get("link_comment", "")
        errors: list[str] = []
        warnings: list[str] = []

        # 2. Check: no links in body
        link_in_body = self._detect_link_in_body(body)
        if link_in_body:
            errors.append(
                "Link detected in post body — LinkedIn penalises body links. "
                "Links must go in the first comment only."
            )

        # 3. Check body length recommendations
        body_len = len(body)
        if body_len < _RECOMMENDED_MIN_CHARS:
            warnings.append(
                f"Below recommended length: {body_len} chars. "
                f"Recommended range is {_RECOMMENDED_MIN_CHARS}-{_RECOMMENDED_MAX_CHARS}."
            )

        # 4. AI tell detection (LinkedIn threshold)
        ai_check = self._check_ai_tells(body)
        if not ai_check["pass"]:
            errors.extend(ai_check["errors"])

        # 5. Determine pass/fail
        if errors:
            return {
                "success": False,
                "url": None,
                "platform": "linkedin",
                "status_code": "error",
                "error": "; ".join(errors),
                "metadata": {
                    "body_length": body_len,
                    "link_in_body_detected": link_in_body,
                    "ai_tell_count": ai_check.get("tell_count", 0),
                    "validation_errors": errors,
                    "warnings": warnings,
                },
            }

        return {
            "success": True,
            "url": None,
            "platform": "linkedin",
            "status_code": "dry_run",
            "error": None,
            "metadata": {
                "body_length": body_len,
                "link": link or None,
                "has_link_comment": bool(link_comment),
                "link_in_body_detected": link_in_body,
                "ai_tell_count": ai_check.get("tell_count", 0),
                "ai_score": ai_check.get("score", 100),
                "warnings": warnings,
            },
        }

    @staticmethod
    def _detect_link_in_body(body: str) -> bool:
        """Check if *body* contains any URL patterns.

        Returns:
            ``True`` if a URL is found in the body.
        """
        body_lower = body.lower()
        for pattern in _LINK_IN_BODY_PATTERNS:
            if pattern.search(body_lower):
                return True
        return False

    @staticmethod
    def _check_ai_tells(body: str) -> dict[str, Any]:
        """Detect AI tell features in the post body.

        LinkedIn is a more formal platform, so the AI tell detection
        threshold is set to ``_AI_TELL_THRESHOLD`` (60) — higher tolerance
        than Reddit, but still flags heavy AI-generated patterns.

        Scoring: starts at 100, deducts for each category found.

        Returns:
            A dict with:
            - ``pass`` (bool): ``True`` if score >= threshold.
            - ``score`` (float): The computed AI tell score (0-100).
            - ``errors`` (list[str]): Reasons for rejection.
            - ``tell_count`` (int): Number of distinct AI tell categories.
            - ``details`` (dict): Per-category breakdown.
        """
        text_lower = body.lower()
        words = text_lower.split()
        clean_words = [w.strip(".,!?;:()\"'-") for w in words]

        score = 100.0
        features_found: dict[str, float] = {}
        reasons: list[str] = []

        # Check Tier 1 cluster (deduct 30)
        tier1_hits = {w for w in clean_words if w in _TIER_1_WORDS}
        if len(tier1_hits) >= 2:
            features_found["tier1_cluster"] = 30
            reasons.append(
                f"Tier-1 AI tell words: {', '.join(sorted(tier1_hits))}"
            )

        # Check Tier 2 cluster (deduct 15)
        tier2_hits = {w for w in clean_words if w in _TIER_2_WORDS}
        if len(tier2_hits) >= 3:
            features_found["tier2_cluster"] = 15
            reasons.append(
                f"Tier-2 AI tell words: {', '.join(sorted(tier2_hits))}"
            )

        # Check formulaic patterns (deduct 10 per pattern, max 30)
        formulaic_count = sum(
            1 for pat in _FORMULAIC_PATTERNS if pat.search(text_lower)
        )
        if formulaic_count > 0:
            deduction = min(formulaic_count * 10, 30)
            features_found["formulaic_patterns"] = deduction
            reasons.append(
                f"{formulaic_count} formulaic AI pattern(s) detected"
            )

        # Check AI tell words (deduct 8 per word, max 24)
        tell_hits = {w for w in clean_words if w in _AI_TELL_WORDS}
        if tell_hits:
            deduction = min(len(tell_hits) * 8, 24)
            features_found["tell_words"] = deduction
            reasons.append(
                f"AI tell words: {', '.join(sorted(tell_hits))}"
            )

        # Apply deductions
        for deduction in features_found.values():
            score -= deduction
        score = max(0.0, score)
        tell_count = len(features_found)

        passed = score >= _AI_TELL_THRESHOLD
        errors: list[str] = []
        if not passed:
            errors.append(
                f"AI-generated content detected (score: {score:.0f}/100, "
                f"threshold: {_AI_TELL_THRESHOLD}). "
                f"{' '.join(reasons)}"
            )

        return {
            "pass": passed,
            "score": score,
            "errors": errors,
            "tell_count": tell_count,
            "details": features_found,
        }


# ── Auto-register ───────────────────────────────────────────────────────────

publisher_registry.register(LinkedInPublisher)
