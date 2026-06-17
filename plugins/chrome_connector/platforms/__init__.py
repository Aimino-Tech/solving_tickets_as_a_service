"""Platform-specific CDP handlers for Chrome Connector."""

from __future__ import annotations

from plugins.chrome_connector.platforms.twitter import TwitterCDP
from plugins.chrome_connector.platforms.linkedin import LinkedInCDP
from plugins.chrome_connector.platforms.reddit import RedditCDP
from plugins.chrome_connector.platforms.threads import ThreadsCDP
from plugins.chrome_connector.platforms.hackernews import HackerNewsCDP
from plugins.chrome_connector.platforms.discord import DiscordCDP

PLATFORM_HANDLERS = {
    "twitter": TwitterCDP,
    "linkedin": LinkedInCDP,
    "reddit": RedditCDP,
    "threads": ThreadsCDP,
    "hackernews": HackerNewsCDP,
    "discord": DiscordCDP,
}


def get_handler(platform: str):
    """Get the CDP handler class for a platform."""
    handler_cls = PLATFORM_HANDLERS.get(platform)
    if handler_cls:
        return handler_cls()
    return None
