"""Platform publisher abstraction and implementations.

Provides a common interface for publishing content to social platforms.
All publishers are **stubs** — actual browser-based posting is delegated
to the campaign execution engine using Hermes browser tools.

Usage::

    from marketing.platforms import publisher_registry

    # Look up a publisher by platform name
    XPub = publisher_registry.get("x")
    pub = XPub()

    # Validate without posting
    result = pub.dry_run({"tweets": ["Hello world", "https://..."], ...})
    if result["success"]:
        print("Content validates OK")
    else:
        print("Validation errors:", result["error"])

    # Publish (stub — returns mock result)
    result = pub.publish({...}, account="@myaccount")
    print(result["url"])
"""

from __future__ import annotations

from marketing.platforms.publisher_base import PlatformPublisher
from marketing.platforms.publisher_registry import PublisherRegistry, publisher_registry

# ── Eager-import platform publishers so they register themselves ────────────

from marketing.platforms import hn_publisher  # noqa: F401  # register Hacker News
from marketing.platforms import linkedin_publisher  # noqa: F401  # register LinkedIn
from marketing.platforms import x_publisher  # noqa: F401  # register X/Twitter

__all__ = [
    "PlatformPublisher",
    "PublisherRegistry",
    "publisher_registry",
]
