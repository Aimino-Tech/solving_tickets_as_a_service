"""
3-layer anti-liar enforcement module.

Ensures every production function has a real test with no placeholder stubs.

Layer 1: Test Coverage Mapping
    For each changed function/component, find a corresponding test reference.
    Threshold: configurable (default 80%).

Layer 2: Button/Route/Endpoint Verification
    Detect routes/endpoints from diff, start dev server, HTTP GET each route → expect 200.

Layer 3: No Placeholder Stubs
    Scan test files for expect(true).toBe(true), it.todo, test.skip, empty catch,
    TODO/FIXME/HACK placeholders, and NotImplementedError.

Usage:
    from workers.tasks.anti_liar import anti_liar_enforcement
    result = anti_liar_enforcement.delay(
        workspace_path="/path/to/repo",
        diff_files=["src/foo.py", "tests/test_foo.py"],
        dev_command="npm run dev",
    )
"""

import json
import logging
import os
import re
import subprocess
import time
from pathlib import Path

from celery import shared_task

logger = logging.getLogger(__name__)

# Default test coverage threshold
_DEFAULT_COVERAGE_THRESHOLD = 0.8

# ── Pattern Lists ────────────────────────────────────────────────────────────

# Placeholder patterns for Layer 3 — matches against test file lines
_PLACEHOLDER_PATTERNS: list[re.Pattern] = [
    re.compile(r"expect\(\s*true\s*\)\.toBe\(\s*true\s*\)"),
    re.compile(r"\.todo\s*\("),
    re.compile(r"describe\.todo\s*\("),
    re.compile(r"test\.skip\s*\("),
    re.compile(r"it\.skip\s*\("),
    re.compile(r"describe\.skip\s*\("),
    re.compile(r"catch\s*\(\s*(?:\(?\s*\w+\s*\)?\s*)?=>\s*\{\s*\}\s*\)"),
    re.compile(r"//\s*TODO\b", re.IGNORECASE),
    re.compile(r"//\s*FIXME\b", re.IGNORECASE),
    re.compile(r"//\s*HACK\b", re.IGNORECASE),
    re.compile(r"raise\s+NotImplementedError"),
    re.compile(r"return\s+None\s*#\s*TODO"),
    re.compile(r"#\s*TODO\b", re.IGNORECASE),
    re.compile(r"#\s*FIXME\b", re.IGNORECASE),
]

# Route/endpoint detection patterns for Layer 2
_ROUTE_PATTERNS: list[re.Pattern] = [
    re.compile(r"""@(?:app|router)\.(?:get|post|put|patch|delete|options|head)\s*\(\s*['"]([^'"]+)['"]"""),
    re.compile(r"""router\.(?:get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]"""),
    re.compile(r"['\"]?(?:GET|POST|PUT|PATCH|DELETE)\s+['\"]?([/\w\-_{}:]+)"),
]

# Test file name patterns
_TEST_FILE_PATTERNS: list[re.Pattern] = [
    re.compile(r"test_.*\.py$"),
    re.compile(r".*_test\.py$"),
    re.compile(r".*\.test\.tsx?$"),
    re.compile(r".*\.spec\.tsx?$"),
    re.compile(r".*_test\.go$"),
    re.compile(r".*_test\.rs$"),
    re.compile(r".*\.test\.jsx?$"),
    re.compile(r".*\.spec\.jsx?$"),
]

# Production source file patterns
_PRODUCTION_FILE_PATTERNS: list[re.Pattern] = [
    re.compile(r".*\.py$"),
    re.compile(r".*\.ts$"),
    re.compile(r".*\.tsx$"),
    re.compile(r".*\.js$"),
    re.compile(r".*\.jsx$"),
    re.compile(r".*\.go$"),
]

# ── Utility Helpers ──────────────────────────────────────────────────────────


def _is_test_file(file_path: str) -> bool:
    """Check if *file_path* matches known test file naming conventions."""
    return any(p.search(file_path) for p in _TEST_FILE_PATTERNS)


def _is_production_file(file_path: str) -> bool:
    """Check if *file_path* is a production source file (not test)."""
    return any(p.search(file_path) for p in _PRODUCTION_FILE_PATTERNS)


def _extract_function_names(file_path: str) -> list[str]:
    """Extract function, class, and component names from a source file.

    Supports Python (def/class), TypeScript/JavaScript (export function/class/const),
    and React components (FC, Component).
    """
    names: list[str] = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except (OSError, UnicodeDecodeError) as exc:
        logger.warning("Cannot read %s: %s", file_path, exc)
        return names

    # Python: def, async def, class
    names.extend(re.findall(r"^def\s+(\w+)\s*\(", content, re.MULTILINE))
    names.extend(re.findall(r"^class\s+(\w+)\s*[(:]", content, re.MULTILINE))
    names.extend(re.findall(r"^async\s+def\s+(\w+)\s*\(", content, re.MULTILINE))

    # TypeScript/JavaScript: exports
    names.extend(
        re.findall(
            r"^export\s+(?:default\s+)?(?:function|class|const)\s+(\w+)",
            content,
            re.MULTILINE,
        )
    )
    names.extend(
        re.findall(
            r"^export\s+const\s+(\w+)\s*[=:]",
            content,
            re.MULTILINE,
        )
    )

    # Named function/const declarations
    names.extend(
        re.findall(
            r"(?:function|const|let|var)\s+(\w+)\s*(?:[=\(])",
            content,
        )
    )

    # React components
    names.extend(
        re.findall(
            r"^export\s+default\s+function\s+(\w+)",
            content,
            re.MULTILINE,
        )
    )
    names.extend(
        re.findall(
            r"^const\s+(\w+)\s*[=:]\s*(?:React\.)?(?:FC|Component|memo|forwardRef)",
            content,
            re.MULTILINE,
        )
    )

    return list(set(names))


def _find_test_for_function(function_name: str, workspace_path: str) -> str | None:
    """Search for a test file under *workspace_path* that references *function_name*."""
    test_glob_patterns = [
        "**/test_*.py",
        "**/*_test.py",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.test.tsx",
        "**/*.spec.tsx",
        "**/*.test.js",
        "**/*.spec.js",
        "**/__tests__/**/*.ts",
        "**/__tests__/**/*.tsx",
    ]

    for pattern in test_glob_patterns:
        for test_file in Path(workspace_path).glob(pattern):
            try:
                content = test_file.read_text(encoding="utf-8", errors="replace")
                if function_name in content:
                    return str(test_file.relative_to(workspace_path))
            except (OSError, UnicodeDecodeError):
                continue

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# Layer 1: Test Coverage Mapping
# ═══════════════════════════════════════════════════════════════════════════════


def map_test_coverage(diff_files: list[str]) -> dict:
    """For each changed function, find the corresponding test file.

    Parameters
    ----------
    diff_files : list[str]
        List of file paths changed in the diff (relative to workspace root).

    Returns
    -------
    dict
        ``{
            "functions": {name: {"test_file": str|None, "covered": bool}, ...},
            "total": int,
            "covered": int,
            "coverage_ratio": float,
            "passed": bool,
            "threshold": float,
        }``

    Threshold is 80% by default (configurable via ``ANTI_LIAR_COVERAGE_THRESHOLD`` env var).
    """
    logger.info("Layer 1: Mapping test coverage for %d diff files", len(diff_files))

    threshold = float(os.getenv("ANTI_LIAR_COVERAGE_THRESHOLD", str(_DEFAULT_COVERAGE_THRESHOLD)))

    # Only production files (not test files themselves)
    prod_files = [f for f in diff_files if _is_production_file(f) and not _is_test_file(f)]

    if not prod_files:
        logger.info("No production files in diff — skipping coverage mapping")
        return {
            "functions": {},
            "total": 0,
            "covered": 0,
            "coverage_ratio": 1.0,
            "passed": True,
            "threshold": threshold,
        }

    # Extract all function names from production files
    all_functions: list[str] = []
    for prod_file in prod_files:
        functions = _extract_function_names(prod_file)
        all_functions.extend(functions)

    all_functions = list(set(all_functions))

    if not all_functions:
        logger.info("No functions/classes found in production diff files")
        return {
            "functions": {},
            "total": 0,
            "covered": 0,
            "coverage_ratio": 1.0,
            "passed": True,
            "threshold": threshold,
        }

    # Map each function to its test
    function_coverage: dict[str, dict] = {}
    covered_count = 0

    for func in all_functions:
        test_file = _find_test_for_function(func, ".")
        is_covered = test_file is not None
        if is_covered:
            covered_count += 1
        function_coverage[func] = {
            "test_file": test_file,
            "covered": is_covered,
        }

    coverage_ratio = covered_count / len(all_functions)
    passed = coverage_ratio >= threshold

    logger.info(
        "Coverage: %d/%d functions covered (%.1f%%) — threshold=%.0f%% — %s",
        covered_count,
        len(all_functions),
        coverage_ratio * 100,
        threshold * 100,
        "PASSED" if passed else "FAILED",
    )

    if not passed:
        uncovered = [f for f, v in function_coverage.items() if not v["covered"]]
        logger.warning("Uncovered functions: %s", ", ".join(uncovered))

    return {
        "functions": function_coverage,
        "total": len(all_functions),
        "covered": covered_count,
        "coverage_ratio": round(coverage_ratio, 3),
        "passed": passed,
        "threshold": threshold,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Layer 2: Button/Route/Endpoint Verification
# ═══════════════════════════════════════════════════════════════════════════════


def _detect_routes(diff_files: list[str]) -> list[str]:
    """Extract route path definitions from the files in *diff_files*."""
    routes: list[str] = []
    for file_path in diff_files:
        if not os.path.isfile(file_path):
            continue
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except (OSError, UnicodeDecodeError):
            continue

        for pattern in _ROUTE_PATTERNS:
            matches = pattern.findall(content)
            routes.extend(matches)

    return list(set(routes))


def verify_interfaces(workspace_path: str, diff_files: list[str]) -> dict:
    """Verify every exposed interface actually works.

    Detects routes from *diff_files*, then performs an HTTP GET against each
    detected route expecting a 200 status code.

    Parameters
    ----------
    workspace_path : str
        Path to the repository root (used as working directory).
    diff_files : list[str]
        List of changed files to scan for route definitions.

    Returns
    -------
    dict
        ``{
            "routes": [{"route": str, "status": int, "passed": bool}, ...],
            "tested": int,
            "passed_count": int,
            "failed_count": int,
            "failures": [{"route": str, "status": int, "error": str}, ...],
            "passed": bool,
        }``
    """
    logger.info("Layer 2: Verifying interfaces for %d diff files", len(diff_files))

    routes = _detect_routes(diff_files)
    if not routes:
        logger.info("No routes/endpoints detected in diff")
        return {
            "routes": [],
            "tested": 0,
            "passed_count": 0,
            "failed_count": 0,
            "failures": [],
            "passed": True,
        }

    import urllib.error
    import urllib.request

    results: list[dict] = []
    failures: list[dict] = []
    passed_count = 0

    for route in routes:
        url = f"http://localhost:3000{route}"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as response:
                status = response.status
                if status == 200:
                    passed_count += 1
                    results.append({"route": route, "status": status, "passed": True})
                    logger.info("  ✓ %s → %d", route, status)
                else:
                    failures.append(
                        {"route": route, "status": status, "error": f"Expected 200, got {status}"}
                    )
                    results.append({"route": route, "status": status, "passed": False})
                    logger.warning("  ✗ %s → %d (expected 200)", route, status)

        except urllib.error.HTTPError as e:
            status = e.code
            if status == 200:
                passed_count += 1
                results.append({"route": route, "status": status, "passed": True})
                logger.info("  ✓ %s → %d", route, status)
            else:
                failures.append({"route": route, "status": status, "error": str(e)})
                results.append({"route": route, "status": status, "passed": False})
                logger.warning("  ✗ %s → %d (expected 200)", route, status)

        except (urllib.error.URLError, OSError, ConnectionError) as e:
            failures.append({"route": route, "status": 0, "error": f"Connection failed: {e}"})
            results.append({"route": route, "status": 0, "passed": False})
            logger.warning("  ✗ %s → connection failed: %s", route, e)

        except Exception as e:
            failures.append({"route": route, "status": 0, "error": str(e)})
            results.append({"route": route, "status": 0, "passed": False})
            logger.error("  ✗ %s → unexpected error: %s", route, e)

    passed = len(failures) == 0
    logger.info(
        "Interface verification: %d/%d passed — %s",
        passed_count,
        len(routes),
        "PASSED" if passed else "FAILED",
    )

    return {
        "routes": results,
        "tested": len(routes),
        "passed_count": passed_count,
        "failed_count": len(failures),
        "failures": failures,
        "passed": passed,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Layer 3: No Placeholder Stubs
# ═══════════════════════════════════════════════════════════════════════════════


def _collect_test_files(diff_files: list[str]) -> list[str]:
    """Return only test file paths from *diff_files*."""
    return [f for f in diff_files if _is_test_file(f)]


def scan_placeholders(diff_files: list[str]) -> list[dict]:
    """Find placeholder implementations in NEW or modified test files.

    Scans test files for known stub/placeholder patterns including:
    * ``expect(true).toBe(true)`` — vacuous assertion
    * ``.todo()``, ``describe.todo()`` — unfinished tests
    * ``test.skip()``, ``it.skip()``, ``describe.skip()`` — skipped tests
    * Empty ``catch {}`` blocks
    * ``TODO``, ``FIXME``, ``HACK`` comments
    * ``raise NotImplementedError`` — unimplemented stubs
    * ``return None  # TODO`` — placeholder returns

    Parameters
    ----------
    diff_files : list[str]
        List of changed files to scan.

    Returns
    -------
    list[dict]
        List of findings: ``{"file": str, "line": int, "pattern": str, "snippet": str}``.
        Empty list means no placeholders found.
    """
    logger.info("Layer 3: Scanning for placeholder stubs in %d diff files", len(diff_files))

    test_files = _collect_test_files(diff_files)
    if not test_files:
        logger.info("No test files in diff to scan")
        return []

    findings: list[dict] = []
    for file_path in test_files:
        if not os.path.isfile(file_path):
            continue
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except (OSError, UnicodeDecodeError) as exc:
            logger.warning("Cannot read test file %s: %s", file_path, exc)
            continue

        for line_num, line in enumerate(lines, start=1):
            for pattern in _PLACEHOLDER_PATTERNS:
                if pattern.search(line):
                    finding = {
                        "file": file_path,
                        "line": line_num,
                        "pattern": pattern.pattern,
                        "snippet": line.rstrip("\n").strip()[:120],
                    }
                    findings.append(finding)
                    logger.warning(
                        "Placeholder in %s:%d — %s",
                        file_path,
                        line_num,
                        line.rstrip("\n").strip()[:60],
                    )
                    break  # One finding per line

    logger.info(
        "Placeholder scan: %d finding(s) in %d test file(s)",
        len(findings),
        len(test_files),
    )

    return findings


# ═══════════════════════════════════════════════════════════════════════════════
# Celery Task: 3-Layer Anti-Liar Enforcement
# ═══════════════════════════════════════════════════════════════════════════════


@shared_task(
    bind=True,
    max_retries=0,
    queue="stas.quality",
    name="workers.tasks.anti_liar.anti_liar_enforcement",
)
def anti_liar_enforcement(
    self,
    workspace_path: str,
    diff_files: list[str],
    dev_command: str | None = None,
) -> dict:
    """3-layer anti-liar enforcement before merge.

    All 3 layers must pass for the overall result to be ``passed=True``.

    Parameters
    ----------
    workspace_path : str
        Absolute path to the repository workspace.
    diff_files : list[str]
        List of file paths changed in the current diff (relative to workspace root).
    dev_command : str | None
        Optional shell command to start a dev server for Layer 2 verification.

    Returns
    -------
    dict
        ``{
            "workspace_path": str,
            "passed": bool,
            "layers": { ... },
        }``
    """
    logger.info(
        json.dumps({
            "event": "anti_liar.start",
            "workspace_path": workspace_path,
            "diff_files_count": len(diff_files),
            "dev_command": dev_command,
        })
    )

    try:
        # ── Layer 1: Test Coverage Mapping ──────────────────────────────
        layer1_result = map_test_coverage(diff_files)

        # ── Layer 2: Button/Route/Endpoint Verification ─────────────────
        # Start dev server if a command is provided and Layer 1 passed
        dev_server_proc: subprocess.Popen | None = None
        if dev_command:
            logger.info("Starting dev server: %s", dev_command)
            try:
                dev_server_proc = subprocess.Popen(
                    dev_command,
                    shell=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    cwd=workspace_path,
                )
                # Allow time for the server to bind
                time.sleep(5)
            except (OSError, subprocess.SubprocessError) as exc:
                logger.warning("Failed to start dev server: %s", exc)

        layer2_result = verify_interfaces(workspace_path, diff_files)

        # Clean up dev server
        if dev_server_proc is not None:
            dev_server_proc.terminate()
            try:
                dev_server_proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                dev_server_proc.kill()

        # ── Layer 3: No Placeholder Stubs ───────────────────────────────
        layer3_findings = scan_placeholders(diff_files)
        layer3_passed = len(layer3_findings) == 0

        # ── Overall Result ──────────────────────────────────────────────
        overall_passed = (
            layer1_result.get("passed", False)
            and layer2_result.get("passed", False)
            and layer3_passed
        )

        result = {
            "workspace_path": workspace_path,
            "passed": overall_passed,
            "layers": {
                "layer1_test_coverage": {
                    "passed": layer1_result.get("passed", False),
                    "coverage_ratio": layer1_result.get("coverage_ratio", 0),
                    "total_functions": layer1_result.get("total", 0),
                    "covered_functions": layer1_result.get("covered", 0),
                    "threshold": layer1_result.get("threshold", _DEFAULT_COVERAGE_THRESHOLD),
                    "functions": layer1_result.get("functions", {}),
                },
                "layer2_interface_verification": {
                    "passed": layer2_result.get("passed", False),
                    "tested_routes": layer2_result.get("tested", 0),
                    "passed_routes": layer2_result.get("passed_count", 0),
                    "failed_routes": layer2_result.get("failed_count", 0),
                    "failures": layer2_result.get("failures", []),
                },
                "layer3_placeholder_scan": {
                    "passed": layer3_passed,
                    "findings_count": len(layer3_findings),
                    "findings": layer3_findings,
                },
            },
        }

        logger.info(
            json.dumps({
                "event": "anti_liar.complete",
                "passed": overall_passed,
                "layer1_passed": layer1_result.get("passed", False),
                "layer2_passed": layer2_result.get("passed", False),
                "layer3_passed": layer3_passed,
            })
        )

        return result

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "anti_liar.error",
                "error": str(exc),
            }),
            exc_info=True,
        )
        return {
            "workspace_path": workspace_path,
            "passed": False,
            "error": str(exc),
        }
