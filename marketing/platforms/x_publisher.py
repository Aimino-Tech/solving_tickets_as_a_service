"""X (Twitter) thread publisher — stub implementation.

Posts content as a threaded set of tweets.  The link goes in the **last**
tweet, not the first (following the Hermes platform voice guide in
``knowledge/humanize-prompt.md``).

**This is a STUB** — no actual X API calls are made.  Browser-based posting
will be performed by the campaign execution engine using Hermes browser
tools (Playwright / oc-vision).
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

# Additional intensifier / hedging words flagged as AI tells
_INTENSIFIER_WORDS: frozenset[str] = frozenset({
    "significantly", "effectively", "increasingly", "extremely",
    "highly", "notably", "remarkably", "substantially",
})

_HEDGING_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bensuring\b", re.IGNORECASE),
    re.compile(r"\brather than\b", re.IGNORECASE),
    re.compile(r"\bplays?\s+(?:a\s+)?(?:crucial|critical|important|vital)\s+role\b", re.IGNORECASE),
    re.compile(r"\bnot\s+just\s+\S+(?:\s+\S+){0,4}\s+but\b", re.IGNORECASE),
    re.compile(r"\bnot\s+only\s+\S+(?:\s+\S+){0,4}\s+but\b", re.IGNORECASE),
]

# ── Constants ───────────────────────────────────────────────────────────────

_MAX_TWEETS = 25
"""Maximum number of tweets in a single thread."""

_MAX_CHARS_PER_TWEET = 280
"""Character limit for a single tweet."""

_MAX_DAILY = 50
"""X/Twitter daily posting limit (varies by account age; 50 is conservative)."""


# ===================================================================
# XPublisher
# ===================================================================


class XPublisher(PlatformPublisher):
    """Publish a thread of tweets to X/Twitter.

    Expected ``content_spec`` shape for ``publish()`` and ``dry_run()``::

        {
            "tweets": [
                "First tweet — hook, no link",
                "Middle tweet — supporting data / story",
                "Last tweet — link + call to action",
            ],
            "scheduled_at": "2026-06-15T14:00:00Z",  # optional
        }

    The link must be in the **last** tweet only.  This matches the Hermes
    platform voice guide recommendation.
    """

    # ── Required interface ────────────────────────────────────────────────

    def validate_credentials(self) -> bool:
        """Check for ``X_API_KEY`` environment variable.

        Returns:
            ``True`` if ``X_API_KEY`` is set, ``False`` otherwise.
            (Stub — real auth requires OAuth tokens, not just a single key.)
        """
        has_key = bool(os.environ.get("X_API_KEY"))
        if not has_key:
            logger.warning("X_API_KEY not found in environment — credentials missing")
        return has_key

    def publish(
        self,
        content_spec: dict[str, Any],
        account: str = "",
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Publish a thread of tweets to X/Twitter.

        Args:
            content_spec: Must contain a ``"tweets"`` key with a list of
                tweet strings.  Optionally ``"scheduled_at"`` for delayed
                posting.
            account: X handle (e.g. ``"@myaccount"``).
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
                "platform": "x",
                "status_code": "error",
                "error": "; ".join(validation["errors"]),
                "metadata": {"validation_errors": validation["errors"]},
            }

        tweets: list[str] = content_spec["tweets"]

        # 2. Dry-run → return early
        if dry_run:
            return {
                "success": True,
                "url": None,
                "platform": "x",
                "status_code": "dry_run",
                "error": None,
                "metadata": {
                    "tweet_count": len(tweets),
                    "char_counts": [len(t) for t in tweets],
                    "thread_valid": True,
                },
            }

        # 3. STUB: log and return mock result
        thread_id = uuid.uuid4().hex[:10]
        mock_url = f"https://x.com/{account or 'user'}/status/{thread_id}"

        logger.info(
            "STUB: Would post %d-tweet thread to X as %s — "
            "mock URL: %s",
            len(tweets),
            account or "(default)",
            mock_url,
        )

        tweet_ids = [f"{thread_id}_{i}" for i in range(len(tweets))]

        return {
            "success": True,
            "url": mock_url,
            "platform": "x",
            "status_code": "published",
            "error": None,
            "metadata": {
                "thread_id": thread_id,
                "tweet_ids": tweet_ids,
                "tweet_count": len(tweets),
                "char_counts": [len(t) for t in tweets],
                "account": account,
                "_stub": True,
                "_note": "STUB — no actual tweet was posted",
            },
        }

    def dry_run(self, content_spec: dict[str, Any]) -> dict[str, Any]:
        """Validate content without posting.

        In addition to structural validation (count, length), this also
        checks for AI tell words in each tweet and verifies that every
        tweet ends with an alphanumeric character.

        Args:
            content_spec: Same shape as ``publish()``.

        Returns:
            Same shape as ``publish()`` with ``status_code = "dry_run"``
            on success.
        """
        # 1. Structural validation
        validation = self._validate_content(content_spec)
        if not validation["valid"]:
            return {
                "success": False,
                "url": None,
                "platform": "x",
                "status_code": "error",
                "error": "; ".join(validation["errors"]),
                "metadata": {"validation_errors": validation["errors"]},
            }

        # 2. Per-tweet AI tell detection & end-character check
        tweets: list[str] = content_spec["tweets"]
        tweet_checks: list[dict[str, Any]] = []
        all_errors: list[str] = []

        for i, tweet in enumerate(tweets):
            check = self._check_tweet_quality(tweet)
            tweet_checks.append(check)
            if not check["pass"]:
                all_errors.extend(
                    [f"Tweet {i + 1}: {e}" for e in check["errors"]]
                )

        if all_errors:
            return {
                "success": False,
                "url": None,
                "platform": "x",
                "status_code": "error",
                "error": "; ".join(all_errors),
                "metadata": {
                    "tweet_count": len(tweets),
                    "tweet_checks": tweet_checks,
                    "validation_errors": all_errors,
                },
            }

        # 3. Verify link is in last tweet
        has_link_in_last = self._last_tweet_has_link(tweets)
        last_tweet_warnings: list[str] = []
        if not has_link_in_last:
            last_tweet_warnings.append(
                "No link found in the last tweet — "
                "links should go in the final tweet per platform guidelines"
            )

        return {
            "success": True,
            "url": None,
            "platform": "x",
            "status_code": "dry_run",
            "error": None,
            "metadata": {
                "tweet_count": len(tweets),
                "char_counts": [len(t) for t in tweets],
                "tweet_checks": tweet_checks,
                "thread_valid": True,
                "warnings": last_tweet_warnings,
            },
        }

    def get_max_daily(self) -> int:
        """Return the maximum daily posting limit for X."""
        return _MAX_DAILY

    def get_platform_name(self) -> str:
        """Return ``\"X\"`` as the human-readable platform name."""
        return "X"

    def get_content_requirements(self) -> dict[str, Any]:
        """Return X/Twitter's content formatting constraints."""
        return {
            "max_tweets": _MAX_TWEETS,
            "max_chars": _MAX_CHARS_PER_TWEET,
            "thread_link_position": "last",
            "supports_media": False,
            "supports_polls": True,
        }

    # ── Internal validation helpers ───────────────────────────────────────

    def _validate_content(self, spec: dict[str, Any]) -> dict[str, Any]:
        """Validate the structure of *spec*.

        Returns:
            A dict with ``valid`` (bool) and ``errors`` (list[str]).
        """
        errors: list[str] = []

        if "tweets" not in spec:
            errors.append('Missing required key "tweets"')
            return {"valid": False, "errors": errors}

        tweets = spec["tweets"]
        if not isinstance(tweets, list):
            errors.append('"tweets" must be a list of strings')
            return {"valid": False, "errors": errors}

        if not tweets:
            errors.append('"tweets" list is empty — must have at least 1 tweet')
            return {"valid": False, "errors": errors}

        if len(tweets) > _MAX_TWEETS:
            errors.append(
                f"Thread exceeds max tweet count: {len(tweets)} > {_MAX_TWEETS}"
            )

        for i, tweet in enumerate(tweets):
            if not isinstance(tweet, str):
                errors.append(f"Tweet {i + 1} is not a string")
                continue
            if not tweet.strip():
                errors.append(f"Tweet {i + 1} is empty")
            if len(tweet) > _MAX_CHARS_PER_TWEET:
                errors.append(
                    f"Tweet {i + 1} exceeds {_MAX_CHARS_PER_TWEET} chars "
                    f"(has {len(tweet)})"
                )

        return {"valid": len(errors) == 0, "errors": errors}

    @staticmethod
    def _check_tweet_quality(tweet: str) -> dict[str, Any]:
        """Check a single tweet for AI tell words and ending character.

        Returns:
            A dict with ``"pass"`` (bool) and ``"errors"`` (list[str]).
        """
        errors: list[str] = []
        text_lower = tweet.lower().strip()

        # Check for tier-1 banned words
        words = text_lower.split()
        tier1_hits = {
            w.strip(".,!?;:()\"'-") for w in words
            if w.strip(".,!?;:()\"'-") in _TIER_1_WORDS
        }
        if len(tier1_hits) >= 2:
            errors.append(
                f"Contains {len(tier1_hits)} Tier-1 AI tell words: "
                f"{', '.join(sorted(tier1_hits))}"
            )

        # Check for tier-2 clusters
        tier2_hits = {
            w.strip(".,!?;:()\"'-") for w in words
            if w.strip(".,!?;:()\"'-") in _TIER_2_WORDS
        }
        if len(tier2_hits) >= 3:
            errors.append(
                f"Contains {len(tier2_hits)} Tier-2 AI tell words: "
                f"{', '.join(sorted(tier2_hits))}"
            )

        # Check hedging / formulaic patterns
        for pattern in _HEDGING_PATTERNS:
            if pattern.search(text_lower):
                errors.append(
                    f"Contains AI-typical phrasing: {pattern.pattern}"
                )
                break  # one match is enough

        # Check intensifier adverbs
        intensifier_hits = {
            w.strip(".,!?;:()\"'-") for w in words
            if w.strip(".,!?;:()\"'-") in _INTENSIFIER_WORDS
        }
        if intensifier_hits:
            errors.append(
                f"Contains intensifier adverb(s): {', '.join(sorted(intensifier_hits))}"
            )

        # Check that tweet ends with alphanumeric character
        stripped = tweet.strip()
        if stripped and not stripped[-1].isalnum():
            errors.append(
                f"Tweet must end with an alphanumeric character, "
                f"ends with {stripped[-1]!r}"
            )

        return {"pass": len(errors) == 0, "errors": errors}

    @staticmethod
    def _last_tweet_has_link(tweets: list[str]) -> bool:
        """Check if the last tweet in the thread contains a URL.

        Very basic URL detection — looks for ``http`` or ``www.`` patterns.
        """
        if not tweets:
            return False
        last = tweets[-1]
        return bool(re.search(r"https?://\S+|www\.\S+", last))


# ── Auto-register ───────────────────────────────────────────────────────────

publisher_registry.register(XPublisher)
