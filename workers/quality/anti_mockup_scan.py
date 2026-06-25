import logging
import os
import re
import subprocess
from pathlib import Path

from celery import shared_task

from workers.quality.models import AntiMockupFinding, AntiMockupResult

logger = logging.getLogger(__name__)

FORBIDDEN_PATTERNS: list[dict[str, str]] = [
    {"pattern": r"(?i)\bTODO\b(?!\s*\w*\s*:\s*\d+)", "severity": "blocking", "description": "TODO comment in production code"},
    {"pattern": r"(?i)\bFIXME\b", "severity": "blocking", "description": "FIXME marker"},
    {"pattern": r"(?i)\bHACK\b", "severity": "warning", "description": "HACK marker"},
    {"pattern": r"(?i)\bXXX\b", "severity": "warning", "description": "XXX marker"},
    {"pattern": r"(?i)\bstub\b", "severity": "warning", "description": "Stub in identifier name"},
    {"pattern": r"(?i)\bmock\b", "severity": "warning", "description": "Mock in identifier name (production code)"},
    {"pattern": r"(?i)\bfake\b", "severity": "warning", "description": "Fake in identifier name"},
    {"pattern": r"(?i)\bplaceholder\b", "severity": "blocking", "description": "Placeholder marker"},
    {"pattern": r"^\s*pass\s*(#.*)?$", "severity": "blocking", "description": "Empty function body (pass)"},
    {"pattern": r"return None\s*(#.*)?$", "severity": "blocking", "description": "Stub return None"},
    {"pattern": r"@ts-expect-error", "severity": "blocking", "description": "TypeScript error suppression"},
    {"pattern": r"@ts-ignore", "severity": "blocking", "description": "TypeScript ignore directive"},
    {"pattern": r"\bas any\b", "severity": "warning", "description": "TypeScript as any escape"},
    {"pattern": r"throw new Error\([\"'](?:Not implemented|TODO|FIXME|stub|placeholder)", "severity": "critical", "description": "Stub exception"},
    {"pattern": r"\{\s*\}\s*$", "severity": "warning", "description": "Empty function body"},
    {"pattern": r"//\s*TODO\b", "severity": "blocking", "description": "TODO comment"},
]


def _is_test_file(file_path: str) -> bool:
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


def _is_suppressible_ts_comment(line: str, pattern_entry: dict) -> bool:
    pat = pattern_entry["pattern"]
    if pat in ("@ts-expect-error", "@ts-ignore"):
        stripped = line.strip()
        if stripped.startswith("// @ts-expect-error") or stripped.startswith("// @ts-ignore"):
            stripped_no_directive = stripped
            if stripped.startswith("// @ts-expect-error"):
                stripped_no_directive = stripped[len("// @ts-expect-error"):].strip()
            elif stripped.startswith("// @ts-ignore"):
                stripped_no_directive = stripped[len("// @ts-ignore"):].strip()
            if not stripped_no_directive or stripped_no_directive.startswith("//"):
                return True
    return False


def _scan_file(file_path: str, base_dir: str) -> list[AntiMockupFinding]:
    findings: list[AntiMockupFinding] = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except (OSError, UnicodeDecodeError) as exc:
        logger.warning("Cannot read %s: %s", file_path, exc)
        return findings

    rel_path = os.path.relpath(file_path, base_dir)
    is_test = _is_test_file(file_path)

    for line_num, line in enumerate(lines, start=1):
        for entry in FORBIDDEN_PATTERNS:
            if is_test:
                continue
            if _is_suppressible_ts_comment(line, entry):
                continue
            if re.search(entry["pattern"], line):
                findings.append(
                    AntiMockupFinding(
                        file=rel_path,
                        line=line_num,
                        pattern=entry["description"],
                        severity=entry["severity"],
                        snippet=line.rstrip("\n").strip()[:120],
                    )
                )
    return findings


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.quality.anti_mockup_scan.anti_mockup_scan",
    autoretry_for=(Exception,),
)
def anti_mockup_scan(self, workspace_path: str, base_branch: str = "main") -> dict:
    logger.info("Running anti-mockup scan on workspace=%s base=%s", workspace_path, base_branch)
    try:
        workspace = Path(workspace_path)
        if not workspace.is_dir():
            raise FileNotFoundError(f"Workspace path does not exist: {workspace_path}")

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
            logger.warning("git diff failed, scanning all files: %s", exc)
            for fpath in workspace.rglob("*"):
                if fpath.is_file() and not fpath.name.startswith("."):
                    changed_files.append(str(fpath.relative_to(workspace)))

        all_findings: list[AntiMockupFinding] = []
        for cf in changed_files:
            full_path = os.path.join(workspace_path, cf)
            if os.path.isfile(full_path):
                file_findings = _scan_file(full_path, workspace_path)
                all_findings.extend(file_findings)

        critical = [f for f in all_findings if f.severity == "critical"]
        blocking = [f for f in all_findings if f.severity == "blocking"]

        passed = len(critical) == 0 and len(blocking) == 0
        for f in all_findings:
            logger.info("Finding: %s:%d [%s] %s — %s", f.file, f.line, f.severity, f.pattern, f.snippet[:60])

        result = AntiMockupResult(passed=passed, findings=all_findings)
        return result.model_dump()
    except Exception as exc:
        logger.error("Anti-mockup scan failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
