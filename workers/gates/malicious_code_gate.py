"""
Malicious Code Detection Gate.

Scans the agent's working tree for dangerous patterns before PR creation.
Uses ``gitleaks`` as a subprocess scanner, with a pure-Python regex fallback.

Blocking behaviour:
  - HIGH severity finding → gate FAILS → PR creation blocked.
  - MEDIUM / LOW severity → logged, reported, but does NOT block.
"""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Any

from celery import shared_task
from pydantic import BaseModel, Field

from workers.gates.pattern_db import ALL_PATTERNS, FALSE_POSITIVE_EXCLUSIONS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class MaliciousCodeFinding(BaseModel):
    """A single finding from the malicious code scan."""

    file: str
    line: int
    severity: str  # HIGH | MEDIUM | LOW
    category: str  # secrets | dangerous_import | suspicious_network | obfuscated
    description: str
    snippet: str = ""


class MaliciousCodeResult(BaseModel):
    """Aggregate result from the malicious code gate."""

    passed: bool
    findings: list[MaliciousCodeFinding] = Field(default_factory=list)
    gitleaks_available: bool = False
    gitleaks_findings: int = 0
    python_findings: int = 0
    blocked_by: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_binary_file(file_path: str) -> bool:
    """Quick check if a file is binary (null bytes in first 8KB)."""
    try:
        with open(file_path, "rb") as f:
            chunk = f.read(8192)
            return b"\0" in chunk
    except OSError:
        return True  # treat unreadable as binary


def _is_test_file(file_path: str) -> bool:
    """Check if a file is a test file — test files are excluded from the gate."""
    name = Path(file_path).name
    return (
        name.startswith("test_")
        or name.endswith("_test.py")
        or name.endswith("_test.go")
        or name.endswith(".test.ts")
        or name.endswith(".spec.ts")
        or name.endswith("_test.rs")
        or "test" in Path(file_path).parts
        or "__tests__" in Path(file_path).parts
    )


def _is_false_positive(line: str) -> bool:
    """Check if a line matches any false-positive exclusion pattern."""
    for exclusion in FALSE_POSITIVE_EXCLUSIONS:
        if exclusion.search(line):
            return True
    return False


def _scan_file_python(file_path: str, base_dir: str) -> list[MaliciousCodeFinding]:
    """Scan a single file using pure-Python regex against ALL_PATTERNS.

    Returns a list of findings sorted by line number.
    """
    findings: list[MaliciousCodeFinding] = []
    rel_path = os.path.relpath(file_path, base_dir)

    is_test = _is_test_file(file_path)
    if is_test:
        return findings

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except (OSError, UnicodeDecodeError) as exc:
        logger.debug("Cannot read %s: %s", file_path, exc)
        return findings

    for line_num, line in enumerate(lines, start=1):
        if _is_false_positive(line):
            continue
        for pat in ALL_PATTERNS:
            if pat.pattern.search(line):
                findings.append(
                    MaliciousCodeFinding(
                        file=rel_path,
                        line=line_num,
                        severity=pat.severity,
                        category=pat.category,
                        description=pat.description,
                        snippet=line.rstrip("\n").strip()[:200],
                    )
                )
    return findings


def _run_gitleaks(workspace_path: str) -> list[dict[str, Any]]:
    """Run ``gitleaks detect`` on the given directory.

    Returns a list of finding dicts (each with ``Description``, ``File``,
    ``Line``, ``Secret``, ``Match`` keys), or an empty list on failure.
    """
    try:
        result = subprocess.run(
            ["gitleaks", "detect", "--source", workspace_path, "--no-git", "--verbose"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        # gitleaks exits 0 = no leaks, 1 = leaks found, 2 = error
        if result.returncode == 0:
            return []
        if result.returncode == 1:
            # Parse JSON output from gitleaks
            try:
                import json

                # Try to find JSON output in stderr or stdout
                for output in (result.stdout, result.stderr):
                    if output.strip():
                        # gitleaks outputs JSON lines
                        findings: list[dict[str, Any]] = []
                        for line in output.strip().split("\n"):
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                findings.append(json.loads(line))
                            except (json.JSONDecodeError, ValueError):
                                pass
                        if findings:
                            return findings
            except Exception as exc:
                logger.debug("Failed to parse gitleaks JSON: %s", exc)
            return []
        logger.warning("gitleaks exited with code %d: %s", result.returncode, result.stderr[:500])
        return []
    except FileNotFoundError:
        logger.info("gitleaks not installed — falling back to pure-Python scan")
        return []
    except subprocess.TimeoutExpired:
        logger.warning("gitleaks timed out after 60s — falling back to Python scan")
        return []
    except Exception as exc:
        logger.debug("gitleaks scan error: %s", exc)
        return []


def _gitleaks_finding_to_malic(finding: dict[str, Any], workspace_path: str) -> MaliciousCodeFinding:
    """Convert a gitleaks finding dict to our MaliciousCodeFinding model."""
    return MaliciousCodeFinding(
        file=finding.get("File", ""),
        line=int(finding.get("StartLine", finding.get("Line", 0))),
        severity="HIGH",  # gitleaks findings are all HIGH by default
        category="secrets",
        description=finding.get("Description", "Gitleaks detected secret"),
        snippet=finding.get("Match", finding.get("Secret", ""))[:200],
    )


def _gitleaks_is_available() -> bool:
    """Check if gitleaks binary is installed and accessible."""
    try:
        result = subprocess.run(
            ["gitleaks", "version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
        return False


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.gates.malicious_code_gate.malicious_code_gate",
    autoretry_for=(Exception,),
)
def malicious_code_gate(self, workspace_path: str, base_branch: str = "main") -> dict:
    """Run the malicious code gate on the working tree.

    Scans all changed files (vs *base_branch*) for dangerous patterns.
    Uses ``gitleaks`` if available, with a pure-Python regex fallback.

    Returns a ``MaliciousCodeResult`` model dump.
    """
    logger.info(
        "Running malicious code gate — workspace=%s base=%s",
        workspace_path,
        base_branch,
    )

    try:
        workspace = Path(workspace_path)
        if not workspace.is_dir():
            raise FileNotFoundError(f"Workspace does not exist: {workspace_path}")

        # ── Collect changed files ────────────────────────────────────
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
                result = subprocess.run(
                    ["git", "diff", "--name-only", base_branch, "HEAD"],
                    capture_output=True,
                    text=True,
                    cwd=workspace_path,
                    timeout=30,
                )
                if result.returncode == 0:
                    changed_files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
        except (subprocess.SubprocessError, FileNotFoundError) as exc:
            logger.warning("git diff failed — scanning all files: %s", exc)
            for fpath in workspace.rglob("*"):
                if fpath.is_file() and not fpath.name.startswith("."):
                    changed_files.append(str(fpath.relative_to(workspace)))

        if not changed_files:
            logger.info("No changed files to scan — passing gate")
            return MaliciousCodeResult(passed=True, findings=[]).model_dump()

        # ── gitleaks scan ────────────────────────────────────────────
        gitleaks_available = _gitleaks_is_available()
        gitleaks_findings_raw = _run_gitleaks(workspace_path) if gitleaks_available else []
        gitleaks_findings = [
            _gitleaks_finding_to_malic(f, workspace_path) for f in gitleaks_findings_raw
        ]

        # ── Python regex scan on changed files ────────────────────────
        python_findings: list[MaliciousCodeFinding] = []
        for cf in changed_files:
            full_path = os.path.join(workspace_path, cf)
            if os.path.isfile(full_path) and not _is_binary_file(full_path):
                file_findings = _scan_file_python(full_path, workspace_path)
                python_findings.extend(file_findings)

        # ── Merge findings (deduplicate by file:line:description) ────
        seen: set[tuple[str, int, str]] = set()
        all_findings: list[MaliciousCodeFinding] = []
        for f in gitleaks_findings + python_findings:
            key = (f.file, f.line, f.description)
            if key not in seen:
                seen.add(key)
                all_findings.append(f)

        high_sev = [f for f in all_findings if f.severity == "HIGH"]
        medium_sev = [f for f in all_findings if f.severity == "MEDIUM"]
        low_sev = [f for f in all_findings if f.severity == "LOW"]

        passed = len(high_sev) == 0
        blocked_by = [f"{f.file}:{f.line} [{f.severity}] {f.description}" for f in high_sev]

        # ── Log results ──────────────────────────────────────────────
        for f in all_findings:
            logger.info(
                "[%s] %s:%d — %s (%s) — %s",
                f.severity,
                f.file,
                f.line,
                f.description,
                f.category,
                f.snippet[:80],
            )

        logger.info(
            "Malicious code gate results — passed=%s HIGH=%d MEDIUM=%d LOW=%d gitleaks=%d python=%d",
            passed,
            len(high_sev),
            len(medium_sev),
            len(low_sev),
            len(gitleaks_findings),
            len(python_findings),
        )

        result = MaliciousCodeResult(
            passed=passed,
            findings=all_findings,
            gitleaks_available=gitleaks_available,
            gitleaks_findings=len(gitleaks_findings),
            python_findings=len(python_findings),
            blocked_by=blocked_by,
        )
        return result.model_dump()

    except Exception as exc:
        logger.error("Malicious code gate failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
