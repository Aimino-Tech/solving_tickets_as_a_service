"""
Agent Output Sanitizer — strips internal system details from agent-generated content.
"""

from __future__ import annotations

import logging
import os as os_mod
import re
import time
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)

_REDACTED_API_KEY = "[REDACTED_API_KEY]"
_REDACTED_URL = "[REDACTED_URL]"
_REDACTED_PATH = "[REDACTED_PATH]"
_REDACTED_ENV_VAR = "[REDACTED_ENV_VAR]"
_REDACTED_SYSTEM_PROMPT = "[REDACTED_SYSTEM_PROMPT]"
_REDACTED_INTERNAL_IP = "[REDACTED_INTERNAL_IP]"
_REDACTED = "[REDACTED]"

_API_KEY_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("openai_sk", re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}(?![A-Za-z0-9-])"), _REDACTED_API_KEY),
    ("openai_proj", re.compile(r"(?<![A-Za-z0-9])sk-proj-[A-Za-z0-9]{20,}(?![A-Za-z0-9-])"), _REDACTED_API_KEY),
    ("pk_key", re.compile(r"(?<![A-Za-z0-9])pk-[A-Za-z0-9]{20,}(?![A-Za-z0-9-])"), _REDACTED_API_KEY),
    ("github_token", re.compile(r"(?<![A-Za-z0-9])gh[opsuf]_[A-Za-z0-9_]{36,251}(?![A-Za-z0-9])"), _REDACTED_API_KEY),
    ("aws_key", re.compile(r"(?<![A-Za-z0-9/+])AKIA[0-9A-Z]{16}(?![A-Za-z0-9/+])"), _REDACTED_API_KEY),
    ("slack_token", re.compile(r"xox[abpr]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])"), _REDACTED_API_KEY),
    ("jwt_token", re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"), _REDACTED_API_KEY),
    ("private_key", re.compile(r"-{3,}BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-{3,}.*?-{3,}END\s+(RSA\s+)?PRIVATE\s+KEY-{3,}", re.DOTALL), _REDACTED_API_KEY),
    ("generic_secret", re.compile(r"""(['"])[A-Za-z0-9_]{16,64}\1"""), _REDACTED),
]

_INTERNAL_URL_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("internal_host", re.compile(r"https?://[a-zA-Z0-9-]+\.internal(?::\d+)?(?:/[^\s\"')\]]*)?"), _REDACTED_URL),
    ("local_cloud", re.compile(r"https?://[a-zA-Z0-9-]+\.local(?::\d+)?(?:/[^\s\"')\]]*)?"), _REDACTED_URL),
    ("syntaro_internal", re.compile(r"https?://syntaro[-.][a-zA-Z0-9.-]+(?::\d+)?(?:/[^\s\"')\]]*)?"), _REDACTED_URL),
    ("localhost", re.compile(r"https?://localhost(?::\d+)?(?:/[^\s\"')\]]*)?"), _REDACTED_URL),
    ("loopback", re.compile(r"https?://127\.0\.0\.1(?::\d+)?(?:/[^\s\"')\]]*)?"), _REDACTED_URL),
    ("ip_url", re.compile(r"https?://(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?::\d+)?(?:/[^\s\"')\]]*)?"), _REDACTED_URL),
]

_SYSTEM_PROMPT_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("you_are_ai", re.compile(r"(?i)you\s+are\s+an?\s+(AI|assistant|chatbot|helpful|expert|intelligent|autonomous)\s+(assistant|agent|bot|system)"), _REDACTED_SYSTEM_PROMPT),
    ("system_directive", re.compile(r"(?i)(?:system\s+(?:prompt|message|directive|instruction)|your\s+(?:system\s+)?prompt\s+is)"), _REDACTED_SYSTEM_PROMPT),
    ("tool_access", re.compile(r"(?i)you\s+have\s+access\s+to\s+(?:the\s+)?(?:following\s+)?(?:tools|commands|functions|capabilities)"), _REDACTED_SYSTEM_PROMPT),
    ("never_mention", re.compile(r"(?i)(?:never|do\s+not|don't)\s+(?:mention|reveal|disclose|share|tell|say|output)\s+(?:this|these|the\s+(?:above|following))"), _REDACTED_SYSTEM_PROMPT),
    ("use_following", re.compile(r"(?i)(?:use|follow|adhere\s+to)\s+the\s+following\s+(?:instructions|rules|guidelines|format)"), _REDACTED_SYSTEM_PROMPT),
]

_FILE_PATH_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("abs_etc", re.compile(r"/etc/[^\s\"')\]]+"), _REDACTED_PATH),
    ("abs_home", re.compile(r"/home/[^\s\"')\]]+"), _REDACTED_PATH),
    ("abs_root", re.compile(r"/root/[^\s\"')\]]+"), _REDACTED_PATH),
    ("abs_var", re.compile(r"/var/[^\s\"')\]]+"), _REDACTED_PATH),
    ("abs_tmp", re.compile(r"/tmp/[^\s\"')\]]+"), _REDACTED_PATH),
    ("abs_usr", re.compile(r"/usr/[^\s\"')\]]+"), _REDACTED_PATH),
    ("abs_opt", re.compile(r"/opt/[^\s\"')\]]+"), _REDACTED_PATH),
    ("env_file", re.compile(r"(?<!process)(?<!os)(?<![A-Za-z])\.env[\w.-]*"), _REDACTED_PATH),
    ("ssh_key", re.compile(r"[/\"']?~?/\.ssh/[^\s\"')\]]+"), _REDACTED_PATH),
]

_ENV_VAR_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("process_env", re.compile(r"process\.env\.([A-Za-z_][A-Za-z0-9_]*)"), _REDACTED_ENV_VAR),
    ("os_environ", re.compile(r"(?:os\.environ|os\.getenv)\s*\.?\s*(?:get|\[\])?\s*\(?[\"']([A-Za-z_][A-Za-z0-9_]*)['\"]"), _REDACTED_ENV_VAR),
    ("shell_var", re.compile(r"\$([A-Z][A-Z0-9_]{3,}(?:\$)?)"), _REDACTED_ENV_VAR),
    ("braced_var", re.compile(r"\$\{([A-Z][A-Z0-9_]{2,})\}"), _REDACTED_ENV_VAR),
    ("export_var", re.compile(r"(?i)^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=|$)"), _REDACTED_ENV_VAR),
]

_INTERNAL_IP_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("rfc1918_10", re.compile(r"(?<!\d)10\.\d{1,3}\.\d{1,3}\.\d{1,3}(?!\d)"), _REDACTED_INTERNAL_IP),
    ("rfc1918_172", re.compile(r"(?<!\d)172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(?!\d)"), _REDACTED_INTERNAL_IP),
    ("rfc1918_192", re.compile(r"(?<!\d)192\.168\.\d{1,3}\.\d{1,3}(?!\d)"), _REDACTED_INTERNAL_IP),
    ("loopback_ip", re.compile(r"(?<!\d)127\.\d{1,3}\.\d{1,3}\.\d{1,3}(?!\d)"), _REDACTED_INTERNAL_IP),
]


def _parse_allowlist(raw: str | None = None) -> set[str]:
    raw = raw or os_mod.getenv("SYNTARO_SANITIZER_ALLOWLIST", "")
    if not raw.strip():
        return set()
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


class SanitizerConfig:
    def __init__(self, allowlist: str | None = None) -> None:
        self.enabled = os_mod.getenv("SYNTARO_SANITIZER_ENABLED", "true").strip().lower() in (
            "true", "1", "yes",
        )
        self.allowlist = _parse_allowlist(allowlist)


class SanitizerResult:
    __slots__ = ("sanitized_text", "replaced_count", "patterns_matched", "categories_matched", "scan_duration_ms")

    def __init__(self, sanitized_text: str, replaced_count: int, patterns_matched: list[str], categories_matched: dict[str, int], scan_duration_ms: float) -> None:
        self.sanitized_text = sanitized_text
        self.replaced_count = replaced_count
        self.patterns_matched = patterns_matched
        self.categories_matched = categories_matched
        self.scan_duration_ms = scan_duration_ms

    def to_dict(self) -> dict[str, Any]:
        return {"replaced_count": self.replaced_count, "patterns_matched": self.patterns_matched, "categories_matched": self.categories_matched, "scan_duration_ms": round(self.scan_duration_ms, 1), "preview": self.sanitized_text[:200]}

    def __repr__(self) -> str:
        return f"SanitizerResult(replaced={self.replaced_count}, patterns={self.patterns_matched}, categories={self.categories_matched})"


_CATEGORIES: list[tuple[str, list[tuple[str, re.Pattern[str], str]]]] = [
    ("api_keys", _API_KEY_PATTERNS),
    ("internal_urls", _INTERNAL_URL_PATTERNS),
    ("system_prompts", _SYSTEM_PROMPT_PATTERNS),
    ("file_paths", _FILE_PATH_PATTERNS),
    ("env_vars", _ENV_VAR_PATTERNS),
    ("internal_ips", _INTERNAL_IP_PATTERNS),
]


class Sanitizer:
    def __init__(self, config: SanitizerConfig | None = None) -> None:
        self.config = config or SanitizerConfig()
        self._allowlist = self.config.allowlist

    def sanitize(self, text: str) -> SanitizerResult:
        start = time.perf_counter()
        if not text or not self.config.enabled:
            return SanitizerResult(text, 0, [], {}, 0.0)
        sanitized = text
        total = 0
        matched = []
        cat_matched = {}
        for cat_name, plist in _CATEGORIES:
            if self._is_allowlisted(cat_name):
                continue
            cat_count = 0
            for name, compiled, replacement in plist:
                if self._is_allowlisted(name):
                    continue
                new_text, cnt = compiled.subn(replacement, sanitized)
                if cnt > 0:
                    sanitized = new_text
                    total += cnt
                    cat_count += cnt
                    matched.append(name)
            if cat_count > 0:
                cat_matched[cat_name] = cat_count
        elapsed = (time.perf_counter() - start) * 1000
        return SanitizerResult(sanitized, total, matched, cat_matched, elapsed)

    def sanitize_diff(self, diff: str) -> SanitizerResult:
        return self.sanitize(diff)

    def _is_allowlisted(self, name: str) -> bool:
        if not self._allowlist:
            return False
        nl = name.lower()
        return any(nl == a or nl.startswith(a) for a in self._allowlist)


_SANITIZER: Sanitizer | None = None


def get_sanitizer() -> Sanitizer:
    global _SANITIZER
    if _SANITIZER is None:
        _SANITIZER = Sanitizer()
    return _SANITIZER


@shared_task(bind=True, max_retries=2, default_retry_delay=30, name="workers.gates.sanitizer.sanitize_agent_output", autoretry_for=(Exception,))
def sanitize_agent_output(self, fix_result: dict) -> dict:
    logger.info("Sanitizing agent output")
    s = get_sanitizer()
    result = dict(fix_result)
    log: dict[str, Any] = {"fields_sanitized": [], "total_replacements": 0, "patterns_matched": [], "categories_matched": {}}
    for field in ["summary", "pr_body", "diff", "description", "body", "message"]:
        if field in result and isinstance(result[field], str):
            sr = s.sanitize(result[field])
            if sr.replaced_count > 0:
                result[field] = sr.sanitized_text
                log["fields_sanitized"].append(field)
                log["total_replacements"] += sr.replaced_count
                log["patterns_matched"].extend(sr.patterns_matched)
                for c, n in sr.categories_matched.items():
                    log["categories_matched"][c] = log["categories_matched"].get(c, 0) + n
    comments = result.get("comments", {})
    if isinstance(comments, dict):
        cc = {}
        for k, v in comments.items():
            if isinstance(v, str):
                sr = s.sanitize(v)
                if sr.replaced_count > 0:
                    cc[k] = sr.sanitized_text
                    log["fields_sanitized"].append(f"comments.{k}")
                    log["total_replacements"] += sr.replaced_count
                    log["patterns_matched"].extend(sr.patterns_matched)
                    for c, n in sr.categories_matched.items():
                        log["categories_matched"][c] = log["categories_matched"].get(c, 0) + n
                else:
                    cc[k] = v
            else:
                cc[k] = v
        result["comments"] = cc
    for field in ["comment_bodies", "status_updates"]:
        if field in result and isinstance(result[field], list):
            cl = []
            for item in result[field]:
                if isinstance(item, str):
                    sr = s.sanitize(item)
                    if sr.replaced_count > 0:
                        cl.append(sr.sanitized_text)
                        log["fields_sanitized"].append(f"{field}[list]")
                        log["total_replacements"] += sr.replaced_count
                        log["patterns_matched"].extend(sr.patterns_matched)
                        for c, n in sr.categories_matched.items():
                            log["categories_matched"][c] = log["categories_matched"].get(c, 0) + n
                    else:
                        cl.append(item)
                else:
                    cl.append(item)
            result[field] = cl
    result["_sanitized"] = log
    logger.info("Sanitization complete \u2014 fields=%d replacements=%d patterns=%s", len(log["fields_sanitized"]), log["total_replacements"], log["patterns_matched"])
    return result
