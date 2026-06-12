"""Platform publisher registry.

Maps human-readable platform names to :class:`PlatformPublisher` subclasses
so client code can look up the right publisher at runtime without import
chains.

Usage::

    from marketing.platforms import publisher_registry

    for name in publisher_registry.list_platforms():
        pub_cls = publisher_registry.get(name)
        pub = pub_cls()
        ...  # use pub.publish(), pub.dry_run(), etc.

The registry auto-populates at import time by scanning for all
:class:`PlatformPublisher` subclasses that have been imported.  Platform
publisher modules in this package are imported eagerly so they register
themselves.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from marketing.platforms.publisher_base import PlatformPublisher

logger = logging.getLogger(__name__)


class PublisherRegistry:
    """Registry that maps platform names to publisher classes.

    Thread-safe for read operations after initial registration is complete.
    """

    def __init__(self) -> None:
        self._mapping: dict[str, type[PlatformPublisher]] = {}

    # ── Public API ────────────────────────────────────────────────────────

    def register(self, publisher_cls: type[PlatformPublisher]) -> None:
        """Register a publisher class.

        The class is indexed by its ``get_platform_name()`` return value
        (lowercased).  If a platform name is already registered, the new
        class **replaces** the old one and a warning is logged.

        Args:
            publisher_cls: A concrete :class:`PlatformPublisher` subclass.
        """
        # Instantiate temporarily to get the platform name
        name = publisher_cls().get_platform_name().lower()

        if name in self._mapping:
            logger.warning(
                "Publisher for %r already registered (%s) — "
                "replacing with %s",
                name,
                self._mapping[name].__name__,
                publisher_cls.__name__,
            )

        self._mapping[name] = publisher_cls
        logger.debug("Registered publisher %s as %r", publisher_cls.__name__, name)

    def get(self, platform_name: str) -> type[PlatformPublisher]:
        """Look up a publisher class by platform name.

        Args:
            platform_name: Case-insensitive platform name (e.g. ``"x"``,
                ``"hn"``, ``"linkedin"``, ``"twitter"``).

        Returns:
            The registered :class:`PlatformPublisher` subclass.

        Raises:
            KeyError: If *platform_name* is not registered.
        """
        key = platform_name.lower().strip()
        if key not in self._mapping:
            known = ", ".join(sorted(self._mapping))
            raise KeyError(
                f"Unknown platform {platform_name!r}. "
                f"Registered platforms: {known}"
            )
        return self._mapping[key]

    def list_platforms(self) -> list[str]:
        """Return all registered platform names, sorted alphabetically.

        Returns:
            Sorted list of lowercased platform name strings.
        """
        return sorted(self._mapping.keys())

    def __contains__(self, platform_name: str) -> bool:
        return platform_name.lower().strip() in self._mapping

    def __len__(self) -> int:
        return len(self._mapping)

    def __repr__(self) -> str:
        return (
            f"<PublisherRegistry platforms={list(self._mapping)}>"
        )


# ── Module-level singleton ──────────────────────────────────────────────────

publisher_registry = PublisherRegistry()
"""Module-level singleton :class:`PublisherRegistry` instance.

Import this from anywhere in the codebase:

    from marketing.platforms import publisher_registry
"""
