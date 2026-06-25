import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)

DANGEROUS_PATTERNS: list[dict[str, Any]] = [
    {"pattern": r"(?i)(?:sk-|pk-|ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]{20,}", "severity": "HIGH", "category": "secret", "description": "Hardcoded API key or token"},
    {"pattern": r"(?i)-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----", "severity": "HIGH", "category": "secret", "description": "Hardcoded private key"},
    {"pattern": r"(?i)os\.system\(|subprocess\.(?:call|popen|run)\(|exec\(|eval\(|__import__\(", "severity": "HIGH", "category": "dangerous_import", "description": "Dangerous code execution"},
    {"pattern": r"(?i)socket\.connect\(|urllib\.request\.urlopen\(|httpx\.(?:get|post|put|delete|request)\(|requests\.(?:get|post|put|delete|request)\(", "severity": "MEDIUM", "category": "network", "description": "Network call in agent code"},
    {"pattern": r"(?i)(?:base64|decode|encode)\s*\(.*[a-zA-Z0-9+/=]{40,}", "severity": "MEDIUM", "category": "obfuscation", "description": "Possible obfuscated payload"},
    {"pattern": r"(?i)exec\(|compile\(|eval\(|__import__\(", "severity": "HIGH", "category": "obfuscation", "description": "Dynamic code execution"},
    {"pattern": r"(?i)(?:miner|monero|eth|bitcoin|wallet|0x[a-fA-F0-9]{40})", "severity": "HIGH", "category": "crypto", "description": "Cryptocurrency mining or wallet reference"},
    {"pattern": r"(?i)(?:password|passwd|pwd)\s*[:=]\s*['\"][^'\"]+['\"]", "severity": "HIGH", "category": "secret", "description": "Hardcoded password"},
    {"pattern": r"(?i)aws_access_key_id|aws_secret_access_key|AKIA[0-9A-Z]{16}", "severity": "HIGH", "category": "secret", "description": "AWS credential"},
]

IGNORE_FILE = ".trufflehogignore"


class MaliciousCodeFinding:
    def __init__(self, file: str, line: int, pattern: str, severity: str, category: str, snippet: str) -> None:
        self.file = file
        self.line = line
        self.pattern = pattern
        self.severity = severity
        self.category = category
        self.snippet = snippet

    def to_dict(self) -> dict[str, Any]:
        return {
            "file": self.file,
            "line": self.line,
            "pattern": self.pattern,
            "severity": self.severity,
            "category": self.category,
            "snippet": self.snippet,
        }


def _load_ignore_patterns(workspace_path: str) -> list[re.Pattern]:
    ignore_file = Path(workspace_path) / IGNORE_FILE
    patterns: list[re.Pattern] = []
    if ignore_file.exists():
        with open(ignore_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    try:
                        patterns.append(re.compile(line))
                    except re.error:
                        logger.warning("Invalid ignore pattern: %s", line)
    return patterns


def _is_ignored(file_path: str, snippet: str, ignore_patterns: list[re.Pattern]) -> bool:
    for pattern in ignore_patterns:
        if pattern.search(file_path) or pattern.search(snippet):
            return True
    return False


def _scan_file(file_path: str, workspace_path: str, ignore_patterns: list[re.Pattern]) -> list[MaliciousCodeFinding]:
    findings: list[MaliciousCodeFinding] = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
            lines = content.split("\n")
    except (OSError, UnicodeDecodeError) as exc:
        logger.warning("Cannot read %s: %s", file_path, exc)
        return findings

    rel_path = os.path.relpath(file_path, workspace_path)
    for line_num, line in enumerate(lines, start=1):
        for entry in DANGEROUS_PATTERNS:
            matches = re.finditer(entry["pattern"], line)
            for match in matches:
                snippet = match.group()[:120]
                if _is_ignored(rel_path, snippet, ignore_patterns):
                    continue
                findings.append(
                    MaliciousCodeFinding(
                        file=rel_path,
                        line=line_num,
                        pattern=entry["description"],
                        severity=entry["severity"],
                        category=entry["category"],
                        snippet=snippet,
                    )
                )
    return findings


def _scan_with_trufflehog(workspace_path: str) -> list[MaliciousCodeFinding]:
    findings: list[MaliciousCodeFinding] = []
    try:
        result = subprocess.run(
            ["trufflehog", "filesystem", "--no-verification", "--json", workspace_path],
            capture_output=True,
            text=True,
            timeout=120,
        )
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                import json
                entry = json.loads(line)
                findings.append(
                    MaliciousCodeFinding(
                        file=entry.get("SourceMetadata", {}).get("Data", {}).get("Filesystem", {}).get("file", "unknown"),
                        line=entry.get("SourceMetadata", {}).get("Data", {}).get("Filesystem", {}).get("line", 0),
                        pattern=entry.get("DetectorName", "trufflehog"),
                        severity="HIGH",
                        category="secret",
                        snippet=entry.get("Raw", "")[:120],
                    )
                )
            except (json.JSONDecodeError, KeyError):
                continue
    except FileNotFoundError:
        logger.info("trufflehog not installed, falling back to gitleaks")
        try:
            result = subprocess.run(
                ["gitleaks", "detect", "--source", workspace_path, "--no-git", "--verbose"],
                capture_output=True,
                text=True,
                timeout=120,
            )
            for line in result.stdout.strip().split("\n"):
                if "leak found" in line.lower() or "secret" in line.lower():
                    parts = line.split(":")
                    if len(parts) >= 3:
                        findings.append(
                            MaliciousCodeFinding(
                                file=parts[1].strip() if len(parts) > 1 else "unknown",
                                line=0,
                                pattern="gitleaks: secret detected",
                                severity="HIGH",
                                category="secret",
                                snippet=line[:120],
                            )
                        )
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            logger.warning("gitleaks also unavailable: %s", exc)
    except subprocess.TimeoutExpired:
        logger.warning("trufflehog timed out")
    return findings


def _get_changed_files(workspace_path: str) -> list[str]:
    changed_files: list[str] = []
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD~1", "HEAD"],
            capture_output=True,
            text=True,
            cwd=workspace_path,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            changed_files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
        else:
            for fpath in Path(workspace_path).rglob("*"):
                if fpath.is_file() and not fpath.name.startswith(".") and ".git" not in fpath.parts:
                    changed_files.append(str(fpath.relative_to(workspace_path)))
    except (subprocess.SubprocessError, FileNotFoundError):
        for fpath in Path(workspace_path).rglob("*"):
            if fpath.is_file() and not fpath.name.startswith(".") and ".git" not in fpath.parts:
                changed_files.append(str(fpath.relative_to(workspace_path)))
    return changed_files


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.malicious_code_detection.scan_for_malicious_code",
    autoretry_for=(Exception,),
)
def scan_for_malicious_code(self, workspace_path: str, block_on_high: bool = True) -> dict[str, Any]:
    logger.info("Running malicious code detection on workspace=%s", workspace_path)

    ignore_patterns = _load_ignore_patterns(workspace_path)
    changed_files = _get_changed_files(workspace_path)

    regex_findings: list[MaliciousCodeFinding] = []
    for cf in changed_files:
        full_path = os.path.join(workspace_path, cf)
        if os.path.isfile(full_path):
            file_findings = _scan_file(full_path, workspace_path, ignore_patterns)
            regex_findings.extend(file_findings)

    tool_findings = _scan_with_trufflehog(workspace_path)

    all_findings = regex_findings + tool_findings

    high_findings = [f for f in all_findings if f.severity == "HIGH"]
    medium_findings = [f for f in all_findings if f.severity == "MEDIUM"]

    passed = len(high_findings) == 0 or not block_on_high

    for f in all_findings:
        logger.info(
            "Finding: %s:%d [%s/%s] %s",
            f.file, f.line, f.severity, f.category, f.pattern,
        )

    return {
        "passed": passed,
        "block_on_high": block_on_high,
        "findings": [f.to_dict() for f in all_findings],
        "summary": {
            "total": len(all_findings),
            "high": len(high_findings),
            "medium": len(medium_findings),
            "low": len(all_findings) - len(high_findings) - len(medium_findings),
        },
    }
