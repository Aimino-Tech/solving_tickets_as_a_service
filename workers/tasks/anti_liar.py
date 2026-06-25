"""
3-layer anti-liar enforcement for STAS.

Layer 1 — test_coverage_mapping(): maps every new/changed production function
to a corresponding test function, fails if untested function is found.

Layer 2 — verify_interfaces(): detects HTTP routes/endpoints from the diff,
verifies that each route has a corresponding test reference (GET expected 200).

Layer 3 — scan_placeholders(): scans the diff for placeholder/test-double
patterns: expect(true).toBe(true), empty test bodies, TODO placeholders,
empty catch blocks, and similar anti-patterns.

All three layers must pass for overall passed=True.
"""

import json
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path

from celery import shared_task

from workers.quality.models import AntiLiarFinding, AntiLiarResult, TestMapping

logger = logging.getLogger(__name__)

_COVERAGE_THRESHOLD_DEFAULT = 80  # percent
_COMMAND_TIMEOUT_S = 120


# — Helpers ————————————————————————————————————————————————————————————


def _get_changed_files(workspace_path: str, base_branch: str = "main") -> list[str]:
    """Return list of files changed in the latest commit vs base branch."""
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
        for fpath in Path(workspace_path).rglob("*"):
            if fpath.is_file() and not fpath.name.startswith("."):
                changed_files.append(str(fpath.relative_to(Path(workspace_path))))
    return changed_files


def _is_test_file(file_path: str) -> bool:
    """Check whether *file_path* is a test file (by naming convention)."""
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


def _get_python_function_names(file_path: str) -> list[str]:
    """Extract function names (def / async def) from a Python file."""
    funcs: list[str] = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except (OSError, UnicodeDecodeError) as exc:
        logger.warning("Cannot read %s: %s", file_path, exc)
        return funcs

    funcs.extend(re.findall(r"^def (\w+)\(", content, re.MULTILINE))
    funcs.extend(re.findall(r"^async def (\w+)\(", content, re.MULTILINE))
    funcs.extend(re.findall(r"^\s+def (\w+)\(", content, re.MULTILINE))
    funcs.extend(re.findall(r"^\s+async def (\w+)\(", content, re.MULTILINE))

    return list(set(funcs))


def _resolve_test_file(prod_file: str, workspace_path: str) -> str | None:
    """Resolve the conventional test-file path for a given production file."""
    p = Path(prod_file)
    stem = p.stem
    candidates: list[Path] = [
        Path(workspace_path) / "tests" / f"test_{stem}.py",
        Path(workspace_path) / "tests" / p.parent.name / f"test_{stem}.py",
        p.parent / f"test_{stem}.py",
        p.parent.parent / "tests" / f"test_{stem}.py",
    ]
    for cand in candidates:
        if cand.is_file():
            return str(cand)
    return None


# — Layer 1: Test Coverage Mapping ————————————————————————————————————


def test_coverage_mapping(
    workspace_path: str,
    base_branch: str = "main",
    coverage_threshold: int = _COVERAGE_THRESHOLD_DEFAULT,
) -> tuple[list[TestMapping], list[AntiLiarFinding]]:
    """
    Layer 1: Map every new/changed production function to a corresponding
    test.  Returns (mappings, findings).

    Convention: ``def foo()`` in ``src/module.py`` expects
    ``def test_foo()`` in ``tests/test_module.py``.
    """
    mappings: list[TestMapping] = []
    findings: list[AntiLiarFinding] = []

    changed_files = _get_changed_files(workspace_path, base_branch)
    prod_files = [f for f in changed_files if not _is_test_file(f) and f.endswith(".py")]

    total_functions = 0
    tested_functions = 0

    for prod_file in prod_files:
        full_path = os.path.join(workspace_path, prod_file)
        if not os.path.isfile(full_path):
            continue

        funcs = _get_python_function_names(full_path)
        if not funcs:
            continue

        test_file = _resolve_test_file(prod_file, workspace_path)
        test_funcs: list[str] = []
        if test_file and os.path.isfile(test_file):
            test_funcs = _get_python_function_names(test_file)

        for func_name in funcs:
            expected_test_name = f"test_{func_name}"
            has_test = any(
                expected_test_name == tf or expected_test_name in tf
                for tf in test_funcs
            )
            total_functions += 1
            if has_test:
                tested_functions += 1

            mappings.append(
                TestMapping(
                    production_function=func_name,
                    production_file=prod_file,
                    test_function=expected_test_name,
                    test_file=os.path.relpath(test_file, workspace_path)
                    if test_file
                    else "",
                    has_test=has_test,
                )
            )

            if not has_test:
                findings.append(
                    AntiLiarFinding(
                        file=prod_file,
                        line=0,
                        layer="test_coverage_mapping",
                        message=f"Untested function: {func_name} — "
                        f"expected test {expected_test_name}",
                        severity="blocking",
                    )
                )

    if total_functions > 0:
        coverage_pct = (tested_functions / total_functions) * 100
        if coverage_pct < coverage_threshold:
            findings.append(
                AntiLiarFinding(
                    file="(aggregate)",
                    line=0,
                    layer="test_coverage_mapping",
                    message=f"Coverage {coverage_pct:.1f}% is below "
                    f"threshold {coverage_threshold}% "
                    f"({tested_functions}/{total_functions} functions tested)",
                    severity="critical",
                )
            )

    return mappings, findings


# — Layer 2: Interface Verification ————————————————————————————————————


def verify_interfaces(
    workspace_path: str,
    base_branch: str = "main",
) -> list[AntiLiarFinding]:
    """
    Layer 2: Detect HTTP routes/endpoints in the diff and verify they have
    corresponding test coverage.

    Parses changed files for route definitions (FastAPI/Flask/Express-style),
    then checks whether test files reference those routes.
    """
    findings: list[AntiLiarFinding] = []

    changed_files = _get_changed_files(workspace_path, base_branch)
    routes: list[tuple[str, str, str]] = []

    for changed_file in changed_files:
        full_path = os.path.join(workspace_path, changed_file)
        if not os.path.isfile(full_path):
            continue
        try:
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except (OSError, UnicodeDecodeError):
            continue

        for match in re.finditer(
            r"""@\w+\.(get|post|put|delete|patch|options)\(['"]([^'"]+)['"]""",
            content,
        ):
            method, path = match.groups()
            routes.append((method.upper(), path, changed_file))

        for match in re.finditer(
            r"""@\w+\.route\(['"]([^'"]+)['"]""",
            content,
        ):
            path = match.group(1)
            routes.append(("GET", path, changed_file))

    test_files = [f for f in changed_files if _is_test_file(f)]

    for method, path, source_file in routes:
        full_route = f"{method} {path}"
        route_tested = False

        for tf in test_files:
            tf_path = os.path.join(workspace_path, tf)
            if not os.path.isfile(tf_path):
                continue
            try:
                with open(tf_path, "r", encoding="utf-8", errors="replace") as f:
                    tf_content = f.read()
                if path in tf_content:
                    route_tested = True
                    break
            except (OSError, UnicodeDecodeError):
                continue

        if not route_tested:
            findings.append(
                AntiLiarFinding(
                    file=source_file,
                    line=0,
                    layer="verify_interfaces",
                    message=f"Untested route: {full_route} — "
                    f"no test references this endpoint",
                    severity="blocking",
                )
            )

    return findings


# — Layer 3: Placeholder Scan —————————————————————————————————————————


def scan_placeholders(
    workspace_path: str,
    base_branch: str = "main",
) -> list[AntiLiarFinding]:
    """
    Layer 3: Scan the diff for placeholder and test-double anti-patterns.

    Detects:
    - Tautological assertions (expect(true).toBe(true))
    - Vacuous assertions (resolves.toBeUndefined())
    - Empty catch blocks
    - TODO/FIXME/HACK/XXX markers
    - Empty test function bodies
    - Assert True / assert False stubs
    """
    findings: list[AntiLiarFinding] = []
    changed_files = _get_changed_files(workspace_path, base_branch)

    patterns: list[tuple[str, str, str]] = [
        (
            r"expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)",
            "Tautological assertion: expect(true).toBe(true)",
            "blocking",
        ),
        (
            r"expect\s*\(\s*false\s*\)\s*\.\s*toBe\s*\(\s*false\s*\)",
            "Tautological assertion: expect(false).toBe(false)",
            "blocking",
        ),
        (
            r"expect\s*\(\s*1\s*\)\s*\.\s*toBe\s*\(\s*1\s*\)",
            "Tautological assertion: expect(1).toBe(1)",
            "blocking",
        ),
        (
            r"expect\s*\(.*\)\s*\.\s*resolves\s*\.\s*toBeUndefined\s*\(\)",
            "Vacuous assertion: resolves.toBeUndefined()",
            "warning",
        ),
        (
            r"(?i)(TODO|FIXME|HACK|XXX)",
            "TODO/FIXME/HACK/XXX placeholder",
            "warning",
        ),
        (
            r"except\s+\w+\s*:\s*pass\s*$",
            "Empty catch block (pass)",
            "blocking",
        ),
        (
            r"catch\s*\(.*?\)\s*\{\s*\}",
            "Empty catch block",
            "blocking",
        ),
        (
            r"^\s*def test_.*?\)\s*:\s*$",
            "Empty test function (no body)",
            "warning",
        ),
        (
            r"assert\s+True",
            "Vacuous assertion: assert True",
            "warning",
        ),
        (
            r"assert\s+False",
            "Stub assertion: assert False",
            "blocking",
        ),
        (
            r"""it\(['"].*?['"]\s*,\s*function\s*\(\s*\)\s*\{\s*\}\)""",
            "Empty it() block",
            "warning",
        ),
        (
            r"""describe\(['"].*?['"]\s*,\s*function\s*\(\s*\)\s*\{\s*\}\)""",
            "Empty describe() block",
            "warning",
        ),
    ]

    for changed_file in changed_files:
        full_path = os.path.join(workspace_path, changed_file)
        if not os.path.isfile(full_path):
            continue
        try:
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except (OSError, UnicodeDecodeError):
            continue

        for line_num, line in enumerate(lines, start=1):
            for pat, description, severity in patterns:
                if re.search(pat, line):
                    findings.append(
                        AntiLiarFinding(
                            file=changed_file,
                            line=line_num,
                            layer="scan_placeholders",
                            message=description,
                            severity=severity,
                            snippet=line.rstrip("\n").strip()[:120],
                        )
                    )

    return findings


# — Cleanup ————————————————————————————————————————————————————————————


def _cleanup_workspace(workspace_path: str) -> None:
    """Clean up temporary workspace resources on completion or timeout."""
    if not workspace_path:
        return
    try:
        if os.path.isdir(workspace_path):
            logger.info("Cleaning up workspace: %s", workspace_path)
            subprocess.run(
                ["rm", "-rf", workspace_path],
                capture_output=True,
                timeout=30,
            )
    except Exception as exc:
        logger.warning("Cleanup failed for %s: %s", workspace_path, exc)


# — Main Shared Task ———————————————————————————————————————————————————


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.anti_liar.run_anti_liar",
    autoretry_for=(Exception,),
    queue="stas.quality",
)
def run_anti_liar(
    self,
    workspace_path: str,
    base_branch: str = "main",
    coverage_threshold: int = _COVERAGE_THRESHOLD_DEFAULT,
    correlation_id: str = "",
) -> dict:
    """
    Run all three anti-liar enforcement layers.

    Returns a dict serialized from AntiLiarResult with layer-level results
    and overall passed/failed status.
    """
    logger.info(
        json.dumps({
            "event": "anti_liar.start",
            "workspace_path": workspace_path,
            "base_branch": base_branch,
            "coverage_threshold": coverage_threshold,
            "correlation_id": correlation_id,
        })
    )

    tmp_workspace: str = ""
    try:
        # If workspace_path is a git URL, clone it into a temp directory
        if workspace_path and (
            workspace_path.startswith("http") or workspace_path.startswith("git@")
        ):
            tmp_workspace = tempfile.mkdtemp(prefix="antiliar_")
            subprocess.run(
                ["git", "clone", "--depth=1", workspace_path, tmp_workspace],
                capture_output=True,
                text=True,
                timeout=_COMMAND_TIMEOUT_S,
            )
            workspace_path = tmp_workspace

        # Layer 1: Test Coverage Mapping
        logger.info(
            "anti_liar.layer1.start — coverage_threshold=%d",
            coverage_threshold,
        )
        mappings, coverage_findings = test_coverage_mapping(
            workspace_path, base_branch, coverage_threshold,
        )
        layer1_passed = len(coverage_findings) == 0
        logger.info(
            "anti_liar.layer1.complete — passed=%s total_mappings=%d untested=%d",
            layer1_passed,
            len(mappings),
            len(coverage_findings),
        )

        # Layer 2: Interface Verification
        logger.info("anti_liar.layer2.start")
        interface_findings = verify_interfaces(workspace_path, base_branch)
        layer2_passed = len(interface_findings) == 0
        logger.info(
            "anti_liar.layer2.complete — passed=%s untested_routes=%d",
            layer2_passed,
            len(interface_findings),
        )

        # Layer 3: Placeholder Scan
        logger.info("anti_liar.layer3.start")
        placeholder_findings = scan_placeholders(workspace_path, base_branch)
        layer3_passed = len(placeholder_findings) == 0
        logger.info(
            "anti_liar.layer3.complete — passed=%s placeholders=%d",
            layer3_passed,
            len(placeholder_findings),
        )

        all_findings = coverage_findings + interface_findings + placeholder_findings
        passed = layer1_passed and layer2_passed and layer3_passed

        result = AntiLiarResult(
            passed=passed,
            layer1_passed=layer1_passed,
            layer2_passed=layer2_passed,
            layer3_passed=layer3_passed,
            findings=all_findings,
            test_mappings=mappings,
            coverage_threshold=coverage_threshold,
        )

        logger.info(
            json.dumps({
                "event": "anti_liar.complete",
                "passed": result.passed,
                "layer1_passed": result.layer1_passed,
                "layer2_passed": result.layer2_passed,
                "layer3_passed": result.layer3_passed,
                "total_findings": len(result.findings),
                "correlation_id": correlation_id,
            })
        )

        return result.model_dump()

    except subprocess.TimeoutExpired:
        logger.error(
            "anti_liar.timeout — command exceeded %ds",
            _COMMAND_TIMEOUT_S,
        )
        return AntiLiarResult(
            passed=False,
            layer1_passed=False,
            layer2_passed=False,
            layer3_passed=False,
            findings=[
                AntiLiarFinding(
                    file="",
                    line=0,
                    layer="run_anti_liar",
                    message=f"Anti-liar enforcement timed out after "
                    f"{_COMMAND_TIMEOUT_S}s",
                    severity="critical",
                )
            ],
        ).model_dump()

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "anti_liar.error",
                "error": str(exc),
                "correlation_id": correlation_id,
            }),
            exc_info=True,
        )
        raise self.retry(exc=exc)

    finally:
        _cleanup_workspace(tmp_workspace)
