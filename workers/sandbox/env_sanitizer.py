import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

ALWAYS_ALLOWED = {"PATH", "HOME", "USER", "TMPDIR"}

BLOCKLIST_PATTERNS: list[re.Pattern] = [
    re.compile(r"SECRET", re.IGNORECASE),
    re.compile(r"KEY", re.IGNORECASE),
    re.compile(r"TOKEN", re.IGNORECASE),
    re.compile(r"PASSWORD", re.IGNORECASE),
    re.compile(r"CREDENTIAL", re.IGNORECASE),
    re.compile(r"API", re.IGNORECASE),
    re.compile(r"AUTH", re.IGNORECASE),
    re.compile(r"STRIPE", re.IGNORECASE),
    re.compile(r"AWS_"),
    re.compile(r"AZURE_"),
    re.compile(r"GCP_"),
    re.compile(r"OPENAI"),
    re.compile(r"ANTHROPIC"),
    re.compile(r"DATABASE"),
    re.compile(r"REDIS"),
    re.compile(r"RABBITMQ"),
    re.compile(r"BROKER"),
    re.compile(r"HTTP_PROXY"),
    re.compile(r"HTTPS_PROXY"),
    re.compile(r"NO_PROXY"),
]


def _matches_blocklist(key: str) -> bool:
    for pattern in BLOCKLIST_PATTERNS:
        if pattern.search(key):
            return True
    return False


class SanitizedEnvironment:
    @staticmethod
    def build(allowlist: set[str] | None = None) -> dict[str, str]:
        clean: dict[str, str] = {}
        allowlist = allowlist or set()

        for key, value in os.environ.items():
            if _matches_blocklist(key) and key not in allowlist:
                logger.debug("Stripped env var: %s", key)
                continue
            if key in ALWAYS_ALLOWED or key in allowlist:
                clean[key] = value
                continue

        for key in ALWAYS_ALLOWED:
            if key not in clean and key in os.environ:
                clean[key] = os.environ[key]

        return clean

    @staticmethod
    def build_for_subprocess(allowlist_path: str | None = None) -> dict[str, str]:
        allowlist: set[str] = set()
        if allowlist_path and os.path.isfile(allowlist_path):
            with open(allowlist_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        allowlist.add(line)

        return SanitizedEnvironment.build(allowlist)
