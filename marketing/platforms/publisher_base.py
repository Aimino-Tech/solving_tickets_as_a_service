"""Platform publisher abstract base class.

Defines the :class:`PlatformPublisher` ABC that all platform publishers
must implement. Every publisher follows the same interface pattern so the
campaign execution engine can publish to any platform generically.

Each publisher is a **stub** — actual browser-based posting will happen
through the campaign execution engine using Hermes browser tools.
"""

from __future__ import annotations

import abc
import logging
from typing import Any

logger = logging.getLogger(__name__)


class PlatformPublisher(abc.ABC):
    """Abstract base for a platform-specific content publisher.

    Subclasses implement the platform-specific posting logic as stubs.
    Real browser automation is delegated to the campaign execution engine.

    Usage::

        pub = XPublisher()
        if pub.validate_credentials():
            result = pub.publish(
                {"tweets": ["Tweet 1", "Tweet 2", "https://..."],
                 "account": "@myaccount"},
            )
            print(result["url"])
    """

    # ── Lifecycle ─────────────────────────────────────────────────────────

    def __init__(self) -> None:
        self._log = logging.getLogger(
            f"{__name__}.{self.get_platform_name().lower()}"
        )

    # ── Required abstract methods ─────────────────────────────────────────

    @abc.abstractmethod
    def validate_credentials(self) -> bool:
        """Verify that platform authentication is available.

        Returns:
            ``True`` if the publisher has what it needs to post (API keys,
            tokens, session cookies, etc.), ``False`` otherwise.
        """

    @abc.abstractmethod
    def publish(
        self,
        content_spec: dict[str, Any],
        account: str = "",
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Post *content_spec* to the platform as *account*.

        Args:
            content_spec: Platform-specific content dictionary.  Keys vary
                by platform (see each subclass for the expected schema).
            account: Account/profile identifier on the platform.
            dry_run: If ``True``, validate and simulate posting without
                making any external call.

        Returns:
            A dict with at minimum:

            **success** (*bool*)
                Whether the publish was accepted.
            **url** (*str* | *None*)
                Permalink to the published content, if available.
            **platform** (*str*)
                Platform name (e.g. ``"x"``, ``"hn"``, ``"linkedin"``).
            **status_code** (*str*)
                One of ``"published"``, ``"dry_run"``, or ``"error"``.
            **error** (*str* | *None*)
                Error message if ``success`` is ``False``.
            **metadata** (*dict*)
                Extra info (tweet IDs, post ID, etc.).
        """

    @abc.abstractmethod
    def dry_run(self, content_spec: dict[str, Any]) -> dict[str, Any]:
        """Validate *content_spec* without posting anything.

        Runs all content validation checks that ``publish()`` would run,
        but never touches the external platform.  Default implementation
        delegates to ``publish(dry_run=True)``.

        Args:
            content_spec: The same structure that ``publish()`` accepts.

        Returns:
            Same shape as ``publish()`` but with ``status_code = "dry_run"``
            on success, or ``status_code = "error"`` with validation
            failures.
        """

    @abc.abstractmethod
    def get_max_daily(self) -> int:
        """Return the maximum number of posts this platform allows per day.

        Returns:
            Integer daily limit (e.g. 50 for X, 1 for HN/LinkedIn).
        """

    @abc.abstractmethod
    def get_platform_name(self) -> str:
        """Return a human-readable name for this platform.

        Returns:
            Short string like ``"X"``, ``"Hacker News"``, ``"LinkedIn"``.
            Used for registry lookup and logging.
        """

    @abc.abstractmethod
    def get_content_requirements(self) -> dict[str, Any]:
        """Return content formatting constraints for this platform.

        Returns:
            A dict with platform-specific keys and values describing
            character limits, formatting rules, link behaviour, etc.
            Common keys include ``max_chars``, ``max_tweets``,
            ``link_position``, ``supports_media``, ``supports_polls``,
            etc.
        """

    # ── Concrete helpers ──────────────────────────────────────────────────

    def __repr__(self) -> str:
        return f"<{type(self).__name__}[{self.get_platform_name()}]>"
