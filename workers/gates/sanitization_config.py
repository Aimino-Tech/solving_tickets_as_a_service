"""
Sanitization configuration - pattern registry, allowlist management, and rule definitions.

This module is the single source of truth for sanitization patterns used
by the agent output sanitizer (sanitizer.py). It defines:

- Structured pattern categories with severity, description, and replacement strategy
- Allowlist parsing and membership checks
- Environment variable bindings for runtime configuration
- Helper functions to build sanitizer.SanitizerConfig from centralised rules
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, NamedTuple

logger = logging.getLogger(__name__)

SEVERITY_CRITICAL = "CRITICAL"
SEVERITY_HIGH = "HIGH"
SEVERITY_MEDIUM = "MEDIUM"
SEVERITY_LOW = "LOW"

_ALL_SEVERITIES = (SEVERITY_CRITICAL, SEVERITY_HIGH, SEVERITY_MEDIUM, SEVERITY_LOW)

REPLACEMENT_API_KEY = "[REDACTED_API_KEY]"
REPLACEMENT_URL = "[REDACTED_URL]"
REPLACEMENT_PATH = "[REDACTED_PATH]"
REPLACEMENT_ENV_VAR = "[REDACTED_ENV_VAR]"
REPLACEMENT_SYSTEM_PROMPT = "[REDACTED_SYSTEM_PROMPT]"
REPLACEMENT_INTERNAL_IP = "[REDACTED_INTERNAL_IP]"
REPLACEMENT_GENERIC = "[REDACTED]"

ENV_ENABLED = "STAS_SANITIZER_ENABLED"
ENV_ALLOWLIST = "STAS_SANITIZER_ALLOWLIST"


class SanitizationRule(NamedTuple):
    """A single sanitization rule with metadata."""

    name: str
    category: str
    pattern: re.Pattern[str]
    replacement: str
    severity: str
    description: str


class CategoryConfig(NamedTuple):
    """Configuration for a group of related sanitization rules."""

    name: str
    description: str
    rules: list[SanitizationRule]


_RE_FLAGS = re.IGNORECASE | re.MULTILINE


def _re(raw: str, flags: int = _RE_FLAGS) -> re.Pattern[str]:
    return re.compile(raw, flags)


def _re_dotall(raw: str) -> re.Pattern[str]:
    return re.compile(raw, _RE_FLAGS | re.DOTALL)


# ---------------------------------------------------------------------------
# 1. API Keys & Secrets
# ---------------------------------------------------------------------------

_API_KEY_RULES: list[SanitizationRule] = [
    SanitizationRule(
        name="openai_sk",
        category="api_keys",
        pattern=_re(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}(?![A-Za-z0-9-])"),
        replacement=REPLACEMENT_API_KEY,
        severity=SEVERITY_HIGH,
        description="OpenAI-style secret key (sk-...)",
    ),
    SanitizationRule(
        name="openai_proj",
        category="api_keys",
        pattern=_re(r"(?<![A-Za-z0-9])sk-proj-[A-Za-z0-9]{20,}(?![A-Za-z0-9-])"),
        replacement=REPLACEMENT_API_KEY,
        severity=SEVERITY_HIGH,
        description="OpenAI project-level secret key (sk-proj-...)",
    ),
    SanitizationRule(
        name="pk_key",
        category="api_keys",
        pattern=_re(r"(?<![A-Za-z0-9])pk-[A-Za-z0-9]{20,}(?![A-Za-z0-9-])"),
        replacement=REPLACEMENT_API_KEY,
        severity=SEVERITY_HIGH,
        description="Anthropic-style public key (pk-...)",
    ),
    SanitizationRule(
        name="github_token",
        category="api_keys",
        pattern=_re(r"(?<![A-Za-z0-9])gh[opsuf]_[A-Za-z0-9_]{36,251}(?![A-Za-z0-9])"),
        replacement=REPLACEMENT_API_KEY,
        severity=SEVERITY_HIGH,
        description="GitHub personal access token (ghp_/gho_/ghu_/ghs_/ghf_)",
    ),
    SanitizationRule(
        name="aws_key",
        category="api_keys",
        pattern=_re(r"(?<![A-Za-z0-9/+])AKIA[0-9A-Z]{16}(?![A-Za-z0-9/+])"),
        replacement=REPLACEMENT_API_KEY,
        severity=SEVERITY_HIGH,
        description="AWS Access Key ID (AKIA...)",
    ),
    SanitizationRule(
        name="slack_token",
        category="api_keys",
        pattern=_re(r"xox[abpr]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])"),
        replacement=REPLACEMENT_API_KEY,
        severity=SEVERITY_HIGH,
        description="Slack API token (xoxb-/xoxp-/xoxa-/xoxr-)",
    ),
    SanitizationRule(
        name="jwt_token",
        category="api_keys",
        pattern=_re(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
        replacement=REPLACEMENT_API_KEY,
        severity=SEVERITY_MEDIUM,
        description="JWT token (base64-encoded JSON header)",
    ),
    SanitizationRule(
        name="private_key",
        category="api_keys",
        pattern=_re_dotall(r"-{3,}BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-{3,}.*?-{3,}END\s+(RSA\s+)?PRIVATE\s+KEY-{3,}"),
        replacement=REPLACEMENT_API_KEY,
        severity=SEVERITY_CRITICAL,
        description="Private key block in source code",
    ),
    SanitizationRule(
        name="generic_secret",
        category="api_keys",
        pattern=_re(r"""(['"])[A-Za-z0-9_]{16,64}\1"""),
        replacement=REPLACEMENT_GENERIC,
        severity=SEVERITY_LOW,
        description="Generic quoted secret (16-64 alphanumeric chars in quotes)",
    ),
]

# ---------------------------------------------------------------------------
# 2. Internal URLs
# ---------------------------------------------------------------------------

_INTERNAL_URL_RULES: list[SanitizationRule] = [
    SanitizationRule(
        name="internal_host",
        category="internal_urls",
        pattern=_re(r"https?://[a-zA-Z0-9-]+\.internal(?::\d+)?(?:/[^\s\"')\]]*)?"),
        replacement=REPLACEMENT_URL,
        severity=SEVERITY_HIGH,
        description="Internal .internal hostname URL",
    ),
    SanitizationRule(
        name="local_cloud",
        category="internal_urls",
        pattern=_re(r"https?://[a-zA-Z0-9-]+\.local(?::\d+)?(?:/[^\s\"')\]]*)?"),
        replacement=REPLACEMENT_URL,
        severity=SEVERITY_HIGH,
        description="Local .local hostname URL",
    ),
    SanitizationRule(
        name="stas_internal",
        category="internal_urls",
        pattern=_re(r"https?://stas[-.][a-zA-Z0-9.-]+(?::\d+)?(?:/[^\s\"')\]]*)?"),
        replacement=REPLACEMENT_URL,
        severity=SEVERITY_HIGH,
        description="STAS internal service URL",
    ),
    SanitizationRule(
        name="localhost",
        category="internal_urls",
        pattern=_re(r"https?://localhost(?::\d+)?(?:/[^\s\"')\]]*)?"),
        replacement=REPLACEMENT_URL,
        severity=SEVERITY_MEDIUM,
        description="Localhost URL",
    ),
    SanitizationRule(
        name="loopback",
        category="internal_urls",
        pattern=_re(r"https?://127\.0\.0\.1(?::\d+)?(?:/[^\s\"')\]]*)?"),
        replacement=REPLACEMENT_URL,
        severity=SEVERITY_MEDIUM,
        description="Loopback IP URL",
    ),
    SanitizationRule(
        name="ip_url",
        category="internal_urls",
        pattern=_re(
            r"https?://"
            r"(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
            r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
            r"|192\.168\.\d{1,3}\.\d{1,3})"
            r"(?::\d+)?(?:/[^\s\"')\]]*)?"
        ),
        replacement=REPLACEMENT_URL,
        severity=SEVERITY_HIGH,
        description="Internal IP-based URL (RFC 1918)",
    ),
]

# ---------------------------------------------------------------------------
# 3. System Prompts
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_RULES: list[SanitizationRule] = [
    SanitizationRule(
        name="you_are_ai",
        category="system_prompts",
        pattern=_re(
            r"you\s+are\s+an?\s+"
            r"(AI|assistant|chatbot|helpful|expert|intelligent|autonomous)\s+"
            r"(assistant|agent|bot|system)"
        ),
        replacement=REPLACEMENT_SYSTEM_PROMPT,
        severity=SEVERITY_MEDIUM,
        description="'You are an AI assistant' system prompt template",
    ),
    SanitizationRule(
        name="system_directive",
        category="system_prompts",
        pattern=_re(
            r"(?:system\s+(?:prompt|message|directive|instruction)"
            r"|your\s+(?:system\s+)?prompt\s+is)"
        ),
        replacement=REPLACEMENT_SYSTEM_PROMPT,
        severity=SEVERITY_MEDIUM,
        description="Reference to system prompt/message/directive",
    ),
    SanitizationRule(
        name="tool_access",
        category="system_prompts",
        pattern=_re(
            r"you\s+have\s+access\s+to\s+(?:the\s+)?"
            r"(?:following\s+)?(?:tools|commands|functions|capabilities)"
        ),
        replacement=REPLACEMENT_SYSTEM_PROMPT,
        severity=SEVERITY_MEDIUM,
        description="Tool access description from system prompt",
    ),
    SanitizationRule(
        name="never_mention",
        category="system_prompts",
        pattern=_re(
            r"(?:never|do\s+not|don't)\s+"
            r"(?:mention|reveal|disclose|share|tell|say|output)\s+"
            r"(?:this|these|the\s+(?:above|following))"
        ),
        replacement=REPLACEMENT_SYSTEM_PROMPT,
        severity=SEVERITY_MEDIUM,
        description="Confidentiality instruction from system prompt",
    ),
    SanitizationRule(
        name="use_following",
        category="system_prompts",
        pattern=_re(r"(?:use|follow|adhere\s+to)\s+the\s+following\s+(?:instructions|rules|guidelines|format)"),
        replacement=REPLACEMENT_SYSTEM_PROMPT,
        severity=SEVERITY_MEDIUM,
        description="Instruction-following directive from system prompt",
    ),
]

# ---------------------------------------------------------------------------
# 4. File Paths
# ---------------------------------------------------------------------------

_FILE_PATH_RULES: list[SanitizationRule] = [
    SanitizationRule(
        name="abs_etc",
        category="file_paths",
        pattern=_re(r"/etc/[^\s\"')\]]+"),
        replacement=REPLACEMENT_PATH,
        severity=SEVERITY_MEDIUM,
        description="Absolute path under /etc/",
    ),
    SanitizationRule(
        name="abs_home",
        category="file_paths",
        pattern=_re(r"/home/[^\s\"')\]]+"),
        replacement=REPLACEMENT_PATH,
        severity=SEVERITY_MEDIUM,
        description="Absolute path under /home/",
    ),
    SanitizationRule(
        name="abs_root",
        category="file_paths",
        pattern=_re(r"/root/[^\s\"')\]]+"),
        replacement=REPLACEMENT_PATH,
        severity=SEVERITY_HIGH,
        description="Absolute path under /root/",
    ),
    SanitizationRule(
        name="abs_var",
        category="file_paths",
        pattern=_re(r"/var/[^\s\"')\]]+"),
        replacement=REPLACEMENT_PATH,
        severity=SEVERITY_MEDIUM,
        description="Absolute path under /var/",
    ),
    SanitizationRule(
        name="abs_tmp",
        category="file_paths",
        pattern=_re(r"/tmp/[^\s\"')\]]+"),
        replacement=REPLACEMENT_PATH,
        severity=SEVERITY_LOW,
        description="Absolute path under /tmp/",
    ),
    SanitizationRule(
        name="abs_usr",
        category="file_paths",
        pattern=_re(r"/usr/[^\s\"')\]]+"),
        replacement=REPLACEMENT_PATH,
        severity=SEVERITY_MEDIUM,
        description="Absolute path under /usr/",
    ),
    SanitizationRule(
        name="abs_opt",
        category="file_paths",
        pattern=_re(r"/opt/[^\s\"')\]]+"),
        replacement=REPLACEMENT_PATH,
        severity=SEVERITY_MEDIUM,
        description="Absolute path under /opt/",
    ),
    SanitizationRule(
        name="env_file",
        category="file_paths",
        pattern=_re(r"(?<!process)(?<!os)(?<![A-Za-z])\.env[\w.-]*"),
        replacement=REPLACEMENT_PATH,
        severity=SEVERITY_MEDIUM,
        description=".env file reference (credentials file)",
    ),
    SanitizationRule(
        name="ssh_key",
        category="file_paths",
        pattern=_re(r"[/\"']?~?/\.ssh/[^\s\"')\]]+"),
        replacement=REPLACEMENT_PATH,
        severity=SEVERITY_HIGH,
        description="SSH key path reference",
    ),
]

# ---------------------------------------------------------------------------
# 5. Environment Variables
# ---------------------------------------------------------------------------

_ENV_VAR_RULES: list[SanitizationRule] = [
    SanitizationRule(
        name="process_env",
        category="env_vars",
        pattern=_re(r"process\.env\.([A-Za-z_][A-Za-z0-9_]*)"),
        replacement=REPLACEMENT_ENV_VAR,
        severity=SEVERITY_MEDIUM,
        description="process.env.X access in JavaScript/TypeScript",
    ),
    SanitizationRule(
        name="os_environ",
        category="env_vars",
        pattern=_re(r"(?:os\.environ|os\.getenv)\s*\.?\s*(?:get|\[\])?\s*\(?[\"']([A-Za-z_][A-Za-z0-9_]*)['\"]"),
        replacement=REPLACEMENT_ENV_VAR,
        severity=SEVERITY_MEDIUM,
        description="os.environ / os.getenv access in Python",
    ),
    SanitizationRule(
        name="shell_var",
        category="env_vars",
        pattern=_re(r"\$([A-Z][A-Z0-9_]{3,}(?:\$)?)"),
        replacement=REPLACEMENT_ENV_VAR,
        severity=SEVERITY_LOW,
        description="Shell variable reference ($UPPER_CASE_VAR)",
    ),
    SanitizationRule(
        name="braced_var",
        category="env_vars",
        pattern=_re(r"\$\{([A-Z][A-Z0-9_]{2,})\}"),
        replacement=REPLACEMENT_ENV_VAR,
        severity=SEVERITY_LOW,
        description="Braced shell variable reference (${VAR})",
    ),
    SanitizationRule(
        name="export_var",
        category="env_vars",
        pattern=_re(r"(?i)^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=|$)"),
        replacement=REPLACEMENT_ENV_VAR,
        severity=SEVERITY_LOW,
        description="Shell export statement",
    ),
]

# ---------------------------------------------------------------------------
# 6. Internal IPs
# ---------------------------------------------------------------------------

_INTERNAL_IP_RULES: list[SanitizationRule] = [
    SanitizationRule(
        name="rfc1918_10",
        category="internal_ips",
        pattern=_re(r"(?<!\d)10\.\d{1,3}\.\d{1,3}\.\d{1,3}(?!\d)"),
        replacement=REPLACEMENT_INTERNAL_IP,
        severity=SEVERITY_MEDIUM,
        description="RFC 1918 10.0.0.0/8 private IP address",
    ),
    SanitizationRule(
        name="rfc1918_172",
        category="internal_ips",
        pattern=_re(r"(?<!\d)172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(?!\d)"),
        replacement=REPLACEMENT_INTERNAL_IP,
        severity=SEVERITY_MEDIUM,
        description="RFC 1918 172.16.0.0/12 private IP address",
    ),
    SanitizationRule(
        name="rfc1918_192",
        category="internal_ips",
        pattern=_re(r"(?<!\d)192\.168\.\d{1,3}\.\d{1,3}(?!\d)"),
        replacement=REPLACEMENT_INTERNAL_IP,
        severity=SEVERITY_MEDIUM,
        description="RFC 1918 192.168.0.0/16 private IP address",
    ),
    SanitizationRule(
        name="loopback_ip",
        category="internal_ips",
        pattern=_re(r"(?<!\d)127\.\d{1,3}\.\d{1,3}\.\d{1,3}(?!\d)"),
        replacement=REPLACEMENT_INTERNAL_IP,
        severity=SEVERITY_LOW,
        description="Loopback IP address (127.x.x.x)",
    ),
]

# ---------------------------------------------------------------------------
# False-positive suppression patterns
# ---------------------------------------------------------------------------

_FALSE_POSITIVE_EXCLUSIONS: list[re.Pattern[str]] = [
    _re(r"(?i)example\.com"),
    _re(r"(?i)test\.secret\.key"),
    _re(r"(?i)your-api-key-here"),
    _re(r"(?i)your_token_here"),
    _re(r"(?i)my_secret_password"),
    _re(r"AKIAIOSFODNN7EXAMPLE"),
    _re(r"(?i)placeholder"),
]

# ---------------------------------------------------------------------------
# Master category registry
# ---------------------------------------------------------------------------

CATEGORIES: list[CategoryConfig] = [
    CategoryConfig(name="api_keys", description="API keys, tokens, and secrets", rules=_API_KEY_RULES),
    CategoryConfig(name="internal_urls", description="Internal service URLs and endpoints", rules=_INTERNAL_URL_RULES),
    CategoryConfig(name="system_prompts", description="System prompt templates and directives", rules=_SYSTEM_PROMPT_RULES),
    CategoryConfig(name="file_paths", description="Absolute file system paths", rules=_FILE_PATH_RULES),
    CategoryConfig(name="env_vars", description="Environment variable references", rules=_ENV_VAR_RULES),
    CategoryConfig(name="internal_ips", description="Private/internal IP addresses", rules=_INTERNAL_IP_RULES),
]

# ---------------------------------------------------------------------------
# Flat index
# ---------------------------------------------------------------------------

_RULES_BY_NAME: dict[str, SanitizationRule] = {}
for cat in CATEGORIES:
    for rule in cat.rules:
        _RULES_BY_NAME[rule.name] = rule

ALL_RULES: list[SanitizationRule] = list(_RULES_BY_NAME.values())

RULES_BY_CATEGORY: dict[str, list[SanitizationRule]] = {}
for cat in CATEGORIES:
    RULES_BY_CATEGORY[cat.name] = list(cat.rules)


# ---------------------------------------------------------------------------
# Allowlist management
# ---------------------------------------------------------------------------


def _parse_allowlist(raw: str) -> set[str]:
    if not raw or not raw.strip():
        return set()
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


def load_allowlist(raw: str | None = None) -> set[str]:
    if raw is None:
        raw = os.getenv(ENV_ALLOWLIST, "")
    return _parse_allowlist(raw)


def is_allowlisted(name: str, allowlist: set[str]) -> bool:
    if not allowlist:
        return False
    nl = name.lower()
    return any(nl == a or nl.startswith(a) for a in allowlist)


# ---------------------------------------------------------------------------
# Config builders
# ---------------------------------------------------------------------------


class SanitizationConfig:
    """Runtime configuration for the sanitization system."""

    __slots__ = ("enabled", "allowlist", "exclusions")

    def __init__(
        self,
        enabled: bool = True,
        allowlist: set[str] | None = None,
        exclusions: list[re.Pattern[str]] | None = None,
    ) -> None:
        self.enabled = enabled
        self.allowlist = allowlist or set()
        self.exclusions = exclusions or list(_FALSE_POSITIVE_EXCLUSIONS)

    @classmethod
    def from_env(cls, allowlist_raw: str | None = None) -> SanitizationConfig:
        enabled_str = os.getenv(ENV_ENABLED, "true")
        enabled = enabled_str.strip().lower() in ("true", "1", "yes")
        allowlist = load_allowlist(allowlist_raw)
        return cls(enabled=enabled, allowlist=allowlist)

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "allowlist": sorted(self.allowlist),
            "exclusion_count": len(self.exclusions),
        }


def build_sanitizer_config(allowlist_raw: str | None = None) -> SanitizationConfig:
    return SanitizationConfig.from_env(allowlist_raw)


# ---------------------------------------------------------------------------
# Rule filtering
# ---------------------------------------------------------------------------


def get_active_rules(config: SanitizationConfig | None = None) -> list[SanitizationRule]:
    if config is None:
        config = build_sanitizer_config()
    if not config.enabled:
        return []

    result: list[SanitizationRule] = []
    seen_names: set[str] = set()
    for rule in ALL_RULES:
        if rule.name in seen_names:
            continue
        if is_allowlisted(rule.name, config.allowlist):
            continue
        if is_allowlisted(rule.category, config.allowlist):
            continue
        result.append(rule)
        seen_names.add(rule.name)
    return result


def get_rules_by_severity(severity: str, config: SanitizationConfig | None = None) -> list[SanitizationRule]:
    if severity not in _ALL_SEVERITIES:
        raise ValueError(f"Unknown severity: {severity!r}. Must be one of {_ALL_SEVERITIES}")
    return [r for r in get_active_rules(config) if r.severity == severity]


# ---------------------------------------------------------------------------
# Pattern source for compatibility with sanitizer.py
# ---------------------------------------------------------------------------


def build_category_patterns() -> list[tuple[str, list[tuple[str, re.Pattern[str], str]]]]:
    result: list[tuple[str, list[tuple[str, re.Pattern[str], str]]]] = []
    for cat in CATEGORIES:
        patterns: list[tuple[str, re.Pattern[str], str]] = []
        for rule in cat.rules:
            patterns.append((rule.name, rule.pattern, rule.replacement))
        result.append((cat.name, patterns))
    return result


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


def get_config_summary() -> dict[str, Any]:
    from_env = build_sanitizer_config()
    active = get_active_rules(from_env)
    by_category: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    for rule in active:
        by_category[rule.category] = by_category.get(rule.category, 0) + 1
        by_severity[rule.severity] = by_severity.get(rule.severity, 0) + 1
    return {
        "total_rules": len(ALL_RULES),
        "active_rules": len(active),
        "allowlisted": sorted(from_env.allowlist),
        "enabled": from_env.enabled,
        "rules_by_category": dict(sorted(by_category.items())),
        "rules_by_severity": dict(sorted(by_severity.items())),
    }
