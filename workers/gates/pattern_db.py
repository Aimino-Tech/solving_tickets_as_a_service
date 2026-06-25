"""
Pattern definitions for the malicious code detection gate.

Each pattern entry contains:
  - pattern: Compiled regex or raw regex string
  - severity: HIGH | MEDIUM | LOW
  - category: secrets | dangerous_import | suspicious_network | obfuscated
  - description: Human-readable description of the finding
"""

from __future__ import annotations

import re
from typing import NamedTuple


class MaliciousPattern(NamedTuple):
    """A single malicious code pattern definition."""

    pattern: re.Pattern[str]
    severity: str  # HIGH | MEDIUM | LOW
    category: str  # secrets | dangerous_import | suspicious_network | obfuscated
    description: str


def _re(raw: str, flags: int = re.IGNORECASE) -> re.Pattern[str]:
    return re.compile(raw, flags)


# ---------------------------------------------------------------------------
# 1. SECRETS — API keys, tokens, credentials
# ---------------------------------------------------------------------------

SECRET_PATTERNS: list[MaliciousPattern] = [
    # AWS Access Key
    MaliciousPattern(
        pattern=_re(r"(?<![A-Za-z0-9/+])AKIA[0-9A-Z]{16}(?![A-Za-z0-9/+])"),
        severity="HIGH",
        category="secrets",
        description="AWS Access Key ID exposed in code",
    ),
    # GitHub Personal Access Token (ghp_, gho_, ghu_, ghs_, ghf_)
    MaliciousPattern(
        pattern=_re(r"(?<![A-Za-z0-9])gh[opsuf]_[A-Za-z0-9_]{36,251}(?![A-Za-z0-9])"),
        severity="HIGH",
        category="secrets",
        description="GitHub personal access token",
    ),
    # Generic API key patterns (e.g., sk-... for OpenAI)
    MaliciousPattern(
        pattern=_re(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}(?![A-Za-z0-9])"),
        severity="HIGH",
        category="secrets",
        description="Generic API key (sk-... pattern)",
    ),
    # Slack token (xoxb-, xoxp-, xoxa-, xoxr-)
    MaliciousPattern(
        pattern=_re(r"xox[abpr]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])"),
        severity="HIGH",
        category="secrets",
        description="Slack token",
    ),
    # Private key headers
    MaliciousPattern(
        pattern=_re(r"-{3,}BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-{3,}"),
        severity="HIGH",
        category="secrets",
        description="Private key block in source code",
    ),
    # JWT eyJ... pattern (base64-encoded JSON header)
    MaliciousPattern(
        pattern=_re(
            r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
        ),
        severity="MEDIUM",
        category="secrets",
        description="JWT token in source code",
    ),
    # Password / secret assignment (password = "xxx", secret = "xxx")
    MaliciousPattern(
        pattern=_re(
            r'(?i)(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[=:]\s*["\'][^"\']{8,}["\']'
        ),
        severity="MEDIUM",
        category="secrets",
        description="Hardcoded credential assignment",
    ),
]

# ---------------------------------------------------------------------------
# 2. DANGEROUS IMPORTS — code execution / system access
# ---------------------------------------------------------------------------

DANGEROUS_IMPORT_PATTERNS: list[MaliciousPattern] = [
    MaliciousPattern(
        pattern=_re(r"^\s*(?:import|from)\s+os\b"),
        severity="MEDIUM",
        category="dangerous_import",
        description="Import of 'os' module — check for os.system usage",
    ),
    MaliciousPattern(
        pattern=_re(r"^\s*(?:import|from)\s+subprocess\b"),
        severity="HIGH",
        category="dangerous_import",
        description="Import of 'subprocess' module — potential arbitrary execution",
    ),
    MaliciousPattern(
        pattern=_re(r"^\s*(?:import|from)\s+shutil\b"),
        severity="LOW",
        category="dangerous_import",
        description="Import of 'shutil' module — file system operations",
    ),
    MaliciousPattern(
        pattern=_re(r"^\s*(?:import|from)\s+ctypes\b"),
        severity="MEDIUM",
        category="dangerous_import",
        description="Import of 'ctypes' module — native code execution",
    ),
    # Direct dangerous calls without import context
    MaliciousPattern(
        pattern=_re(r"(?<![A-Za-z_])os\.system\s*\("),
        severity="HIGH",
        category="dangerous_import",
        description="os.system() call — shell command execution",
    ),
    MaliciousPattern(
        pattern=_re(r"(?<![A-Za-z_])subprocess\s*\.\s*(?:call|Popen|run|check_call|check_output)\s*\("),
        severity="HIGH",
        category="dangerous_import",
        description="subprocess execution call",
    ),
    MaliciousPattern(
        pattern=_re(r"(?<![A-Za-z_])eval\s*\("),
        severity="HIGH",
        category="dangerous_import",
        description="eval() — arbitrary code execution",
    ),
    MaliciousPattern(
        pattern=_re(r"(?<![A-Za-z_])exec\s*\("),
        severity="HIGH",
        category="dangerous_import",
        description="exec() — arbitrary code execution",
    ),
    MaliciousPattern(
        pattern=_re(r"(?<![A-Za-z_])__import__\s*\("),
        severity="HIGH",
        category="dangerous_import",
        description="__import__() — dynamic code loading",
    ),
    MaliciousPattern(
        pattern=_re(r"(?<![A-Za-z_])compile\s*\("),
        severity="MEDIUM",
        category="dangerous_import",
        description="compile() — dynamic code compilation",
    ),
]

# ---------------------------------------------------------------------------
# 3. SUSPICIOUS NETWORK — crypto mining, reverse shells, data exfiltration
# ---------------------------------------------------------------------------

SUSPICIOUS_NETWORK_PATTERNS: list[MaliciousPattern] = [
    # Crypto mining pools / wallets
    MaliciousPattern(
        pattern=_re(r"(?i)(?:cryptomining|crypto\s*mining|minerd|stratum\+tcp)"),
        severity="HIGH",
        category="suspicious_network",
        description="Cryptocurrency mining reference",
    ),
    MaliciousPattern(
        pattern=_re(r"(?i)(?:coinbase|bitcoin|ethereum|monero)\s*(?:address|wallet|adr)[:\s]*[13][a-km-zA-HJ-NP-Z1-9]{25,34}"),
        severity="HIGH",
        category="suspicious_network",
        description="Cryptocurrency wallet address hardcoded",
    ),
    # Reverse shell patterns
    MaliciousPattern(
        pattern=_re(r"(?i)(?:reverse\s*shell|revshell|bind\s*shell|backconnect)"),
        severity="HIGH",
        category="suspicious_network",
        description="Reverse shell reference",
    ),
    MaliciousPattern(
        pattern=_re(r"(?i)(?:sh|bash|nc|netcat)\s*-[eci]+\s+/dev/tcp/"),
        severity="HIGH",
        category="suspicious_network",
        description="Shell redirect over TCP (potential reverse shell)",
    ),
    MaliciousPattern(
        pattern=_re(r"/dev/tcp/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}"),
        severity="HIGH",
        category="suspicious_network",
        description="Bash /dev/tcp connection to remote IP",
    ),
    # Data exfiltration / phone-home
    MaliciousPattern(
        pattern=_re(r"(?i)(?:curl|wget|requests\.post|httpx\.post)\s*\(?.*(?:burpcollaborator|interactsh|requestbin|webhook\.site|hookbin)"),
        severity="HIGH",
        category="suspicious_network",
        description="Data exfiltration to lookback/request-bin service",
    ),
    # DNS exfiltration
    MaliciousPattern(
        pattern=_re(r"(?i)(?:nslookup|dig)\s+.*(?:burpcollaborator|interactsh)"),
        severity="HIGH",
        category="suspicious_network",
        description="DNS exfiltration attempt",
    ),
    # Suspicious port binding / listening (unusual ports)
    MaliciousPattern(
        pattern=_re(r"(?i)listen\s*\(?\s*(?:0\.0\.0\.0|127\.0\.0\.1)\s*,\s*(?:[45][0-9]{3,4}|6[0-4][0-9]{3}|[7-9][0-9]{4})"),
        severity="MEDIUM",
        category="suspicious_network",
        description="Suspicious port binding (non-standard port 5000+)",
    ),
]

# ---------------------------------------------------------------------------
# 4. OBFUSCATED CODE — encoded strings, hidden payloads
# ---------------------------------------------------------------------------

OBFUSCATED_PATTERNS: list[MaliciousPattern] = [
    # Long base64-encoded strings (likely payload)
    MaliciousPattern(
        pattern=_re(r'["\'][A-Za-z0-9+/]{200,}={0,2}["\']'),
        severity="MEDIUM",
        category="obfuscated",
        description="Suspiciously long base64-encoded string (>200 chars) in source",
    ),
    # b64decode with eval/exec chain
    MaliciousPattern(
        pattern=_re(r"(?i)(?:b64decode|base64\.b64decode)\s*\(.*(?:eval|exec|compile|__import__)"),
        severity="HIGH",
        category="obfuscated",
        description="Base64 decode combined with code execution",
    ),
    # hex-encoded strings with execution
    MaliciousPattern(
        pattern=_re(r"(?i)(?:bytes\.fromhex|binascii\.unhexlify|\.decode\s*\(\s*[\"']hex[\"'])\s*\).*"),
        severity="MEDIUM",
        category="obfuscated",
        description="Hex-encoded string decode (potential hidden payload)",
    ),
    # Extremely long lines of compact code (obfuscation heuristic)
    MaliciousPattern(
        pattern=_re(r"^\s*.{500,}$"),
        severity="LOW",
        category="obfuscated",
        description="Overly long line — possible minified/obfuscated code",
    ),
    # Character code / unicode escape sequences used for string construction
    MaliciousPattern(
        pattern=_re(r'(?i)(?:chr\s*\(\s*\d{2,3}\s*\)\s*[+&]){4,}'),
        severity="MEDIUM",
        category="obfuscated",
        description="Character code concatenation pattern (potential string obfuscation)",
    ),
    # Rot13 / cipher references with data
    MaliciousPattern(
        pattern=_re(r'(?i)(?:rot13|rot\s*13|codecs\.encode.*rot13)\s*\(["\']'),
        severity="LOW",
        category="obfuscated",
        description="ROT13 obfuscation pattern",
    ),
]

# ---------------------------------------------------------------------------
# Master pattern list
# ---------------------------------------------------------------------------

ALL_PATTERNS: list[MaliciousPattern] = (
    SECRET_PATTERNS + DANGEROUS_IMPORT_PATTERNS + SUSPICIOUS_NETWORK_PATTERNS + OBFUSCATED_PATTERNS
)

# Exclusions for false positive suppression — known safe patterns
# matched by line content (case-insensitive substring match).
# These are excluded from gate findings.
FALSE_POSITIVE_EXCLUSIONS: list[re.Pattern[str]] = [
    _re(r"(?i)example\.com"),
    _re(r"(?i)localhost"),
    _re(r"(?i)test\.secret\.key"),
    _re(r"(?i)your-api-key-here"),
    _re(r"(?i)your_token_here"),
    _re(r"(?i)my_secret_password"),
    _re(r"AKIAIOSFODNN7EXAMPLE"),  # Well-known AWS example key from docs
    _re(r"(?i)just an example"),
    _re(r"(?i)placeholder"),
]
