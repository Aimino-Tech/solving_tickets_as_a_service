"""Anti-Liar — detect lies, hallucinated code, and vacuous patterns in AI output.

Scans code for common AI-generated fabrications:
1. Vacuous assertions — tests that always pass regardless of implementation
2. Contradictory conditions — if/while/for conditions that can never trigger
3. Phantom references — imports of non-existent modules, references to missing files
4. Dead code — unreachable code after return/raise/continue
5. Self-assignment — x = x, always a no-op
6. Empty exception handlers — except: pass that silently swallows errors
"""

from __future__ import annotations

import ast
import logging
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from workers.quality.models import AntiMockupFinding, AntiMockupResult

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# Constants
# ═══════════════════════════════════════════════════════════════════════════════

VACUOUS_ASSERT_PATTERNS: list[re.Pattern] = [
    re.compile(r"assert\s+True\b"),
    re.compile(r"assert\s+False\s+is\s+False"),
    re.compile(r"assert\s+None\s+is\s+None"),
    re.compile(r"assert\s+1\s*==\s*1"),
    re.compile(r"assert\s+True\s*==\s*True"),
    re.compile(r"assert\s+0\s*==\s*0"),
    re.compile(r"assert\s+len\(.*?\)\s*>=\s*0"),
    re.compile(r"assert\s+isinstance\(.*?,\s*(?:object|type)\)"),
    re.compile(r"assert\s+not\s+None"),
    re.compile(r"\bassert\s+(?:True|False)\b"),
]

CONTRADICTORY_PATTERNS: list[re.Pattern] = [
    re.compile(r"\bif\s+False\s*:"),
    re.compile(r"\bwhile\s+False\s*:"),
    re.compile(r"\bwhile\s+True\s*:(?!.*\bbreak\b)"),
    re.compile(r"\bif\s+None\s*:"),
    re.compile(r"\bif\s+0\s*:"),
    re.compile(r"\belif\s+False\s*:"),
]

PHANTOM_PACKAGE_PATTERNS: list[re.Pattern] = [
    # import that references obviously fake/placeholder package names
    re.compile(r"(?i)^import\s+(?:placeholder|dummy|fake|mock_?module|test_?utils?)\b"),
    re.compile(r"(?i)^from\s+(?:placeholder|dummy|fake|mock_?module|test_?utils?)\s+import\b"),
]

SELF_ASSIGN_PATTERN: re.Pattern = re.compile(r"^\s+(\w+)\s*=\s*\1\s*$", re.MULTILINE)

EMPTY_EXCEPT_PATTERN: re.Pattern = re.compile(r"except\s*[^:]*:\s*\n\s*(?:pass|#.*)?\s*$", re.MULTILINE)

# ═══════════════════════════════════════════════════════════════════════════════
# Detectors
# ═══════════════════════════════════════════════════════════════════════════════


def detect_vacuous_assertions(
    source: str,
    file_path: str,
    base_dir: str,
) -> list[AntiMockupFinding]:
    """Detect test assertions that always pass regardless of implementation."""
    findings: list[AntiMockupFinding] = []
    lines = source.split("\n")
    for line_num, line in enumerate(lines, start=1):
        for pattern in VACUOUS_ASSERT_PATTERNS:
            if pattern.search(line):
                rel_path = os.path.relpath(file_path, base_dir)
                findings.append(
                    AntiMockupFinding(
                        file=rel_path,
                        line=line_num,
                        pattern=f"Vacuous assertion: {pattern.pattern}",
                        severity="warning",
                        snippet=line.strip()[:120],
                    )
                )
    return _deduplicate(findings)


def detect_contradictory_conditions(
    source: str,
    file_path: str,
    base_dir: str,
) -> list[AntiMockupFinding]:
    """Detect conditions that can never be true (AI-generated dead branches)."""
    findings: list[AntiMockupFinding] = []
    lines = source.split("\n")
    for line_num, line in enumerate(lines, start=1):
        for pattern in CONTRADICTORY_PATTERNS:
            if pattern.search(line):
                rel_path = os.path.relpath(file_path, base_dir)
                findings.append(
                    AntiMockupFinding(
                        file=rel_path,
                        line=line_num,
                        pattern=f"Contradictory condition: {pattern.pattern}",
                        severity="blocking",
                        snippet=line.strip()[:120],
                    )
                )
    return _deduplicate(findings)


def detect_phantom_imports(
    source: str,
    file_path: str,
    base_dir: str,
    installed_modules: set[str] | None = None,
) -> list[AntiMockupFinding]:
    """Detect imports of modules that don't exist or are hallucinated."""
    findings: list[AntiMockupFinding] = []
    if installed_modules is None:
        installed_modules = _get_installed_modules()

    try:
        tree = ast.parse(source)
    except SyntaxError:
        logger.debug("Cannot parse %s as AST — skipping import analysis", file_path)
        return findings

    rel_path = os.path.relpath(file_path, base_dir)

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top_level = alias.name.split(".")[0]
                if top_level in installed_modules:
                    continue
                if _is_stdlib_module(top_level):
                    continue
                # Check pattern-based phantom detection
                for pat in PHANTOM_PACKAGE_PATTERNS:
                    if pat.search(f"import {alias.name}"):
                        findings.append(
                            AntiMockupFinding(
                                file=rel_path,
                                line=node.lineno,
                                pattern=f"Phantom import: {alias.name}",
                                severity="critical" if _looks_hallucinated(alias.name) else "warning",
                                snippet=alias.name[:120],
                            )
                        )
                        break

        elif isinstance(node, ast.ImportFrom):
            if node.module is None:
                continue
            top_level = node.module.split(".")[0]
            if top_level in installed_modules:
                continue
            if _is_stdlib_module(top_level):
                continue
            for pat in PHANTOM_PACKAGE_PATTERNS:
                if pat.search(f"from {node.module} import"):
                    findings.append(
                        AntiMockupFinding(
                            file=rel_path,
                            line=node.lineno,
                            pattern=f"Phantom import: {node.module}",
                            severity="critical" if _looks_hallucinated(node.module) else "warning",
                            snippet=f"from {node.module} import ...",
                        )
                    )
                    break

    return _deduplicate(findings)


def detect_dead_code(
    source: str,
    file_path: str,
    base_dir: str,
) -> list[AntiMockupFinding]:
    """Detect unreachable code after return/raise/continue."""
    findings: list[AntiMockupFinding] = []
    rel_path = os.path.relpath(file_path, base_dir)

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return findings

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            _check_unreachable_body(node, findings, rel_path, source)
    return findings


def _check_unreachable_body(
    func_node: ast.FunctionDef | ast.AsyncFunctionDef,
    findings: list[AntiMockupFinding],
    rel_path: str,
    source: str,
) -> None:
    """Walk function body stmts looking for return/raise without following stmts."""
    if not func_node.body:
        return
    for i, stmt in enumerate(func_node.body):
        if isinstance(stmt, (ast.Return, ast.Raise)):
            if i + 1 < len(func_node.body):
                next_stmt = func_node.body[i + 1]
                if not _is_docstring_or_pass(next_stmt):
                    findings.append(
                        AntiMockupFinding(
                            file=rel_path,
                            line=next_stmt.lineno,
                            pattern="Dead code after return/raise",
                            severity="warning",
                            snippet=_get_line_snippet(source, next_stmt.lineno),
                        )
                    )
        # Recurse into if/else bodies
        elif isinstance(stmt, ast.If):
            _check_body_for_dead_returns(stmt.body, findings, rel_path, source, returns_possible=True)
            if stmt.orelse:
                _check_body_for_dead_returns(stmt.orelse, findings, rel_path, source, returns_possible=True)


def _check_body_for_dead_returns(
    body: list[ast.stmt],
    findings: list[AntiMockupFinding],
    rel_path: str,
    source: str,
    returns_possible: bool = False,
) -> None:
    if not returns_possible or not body:
        return
    for i, stmt in enumerate(body):
        if isinstance(stmt, (ast.Return, ast.Raise)):
            if i + 1 < len(body):
                next_stmt = body[i + 1]
                if not _is_docstring_or_pass(next_stmt):
                    findings.append(
                        AntiMockupFinding(
                            file=rel_path,
                            line=next_stmt.lineno,
                            pattern="Dead code after return/raise in conditional branch",
                            severity="warning",
                            snippet=_get_line_snippet(source, next_stmt.lineno),
                        )
                    )


def detect_empty_except_handlers(
    source: str,
    file_path: str,
    base_dir: str,
) -> list[AntiMockupFinding]:
    """Detect bare except: pass handlers that silently swallow errors."""
    findings: list[AntiMockupFinding] = []
    rel_path = os.path.relpath(file_path, base_dir)

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return findings

    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler):
            if node.type is None and _is_only_pass(node.body):
                findings.append(
                    AntiMockupFinding(
                        file=rel_path,
                        line=node.lineno if hasattr(node, "lineno") else 0,
                        pattern="Empty exception handler (bare except: pass)",
                        severity="blocking",
                        snippet="except:  # silently swallows all errors",
                    )
                )
            elif _is_only_pass(node.body) and (
                _is_continuation_pass(node) or _is_builtin_exception_only(node)
            ):
                findings.append(
                    AntiMockupFinding(
                        file=rel_path,
                        line=node.lineno,
                        pattern="Empty exception handler (pass only)",
                        severity="warning",
                        snippet=_get_line_snippet(source, node.lineno),
                    )
                )
    return findings


def detect_self_assignments(
    source: str,
    file_path: str,
    base_dir: str,
) -> list[AntiMockupFinding]:
    """Detect x = x assignments (always a no-op)."""
    findings: list[AntiMockupFinding] = []
    lines = source.split("\n")
    for match in SELF_ASSIGN_PATTERN.finditer(source):
        line_num = match.string[: match.start()].count("\n") + 1  # approximate
        for i, line in enumerate(lines):
            if i + 1 >= line_num and SELF_ASSIGN_PATTERN.search(line):
                rel_path = os.path.relpath(file_path, base_dir)
                findings.append(
                    AntiMockupFinding(
                        file=rel_path,
                        line=i + 1,
                        pattern=f"Self-assignment (no-op): {line.strip()}",
                        severity="warning",
                        snippet=line.strip()[:120],
                    )
                )
                break
    return _deduplicate(findings)


def detect_phantom_file_references(
    source: str,
    file_path: str,
    base_dir: str,
    known_files: set[str] | None = None,
) -> list[AntiMockupFinding]:
    """Detect comments referencing files or modules that don't exist in the workspace."""
    findings: list[AntiMockupFinding] = []
    if known_files is None:
        known_files = set()
    rel_path = os.path.relpath(file_path, base_dir)

    # Look for patterns like "see file.py", "defined in utils.py"
    file_ref_pattern = re.compile(r"(?:see|defined in|located at|check|refer to)\s+([\w/.-]+\.\w+)", re.IGNORECASE)
    lines = source.split("\n")
    for line_num, line in enumerate(lines, start=1):
        if not line.strip().startswith("#") and "//" not in line:
            continue
        for match in file_ref_pattern.finditer(line):
            ref = match.group(1)
            if "/" in ref:
                # Check relative to the current file's dir
                parent_dir = os.path.dirname(file_path)
                candidate = os.path.normpath(os.path.join(parent_dir, ref))
            else:
                candidate = os.path.normpath(os.path.join(base_dir, ref))
            if os.path.exists(candidate):
                continue
            if ref in known_files:
                continue
            findings.append(
                AntiMockupFinding(
                    file=rel_path,
                    line=line_num,
                    pattern=f"Phantom file reference: {ref}",
                    severity="warning",
                    snippet=line.strip()[:120],
                )
            )
    return findings


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

_STDLIB_MODULES: set[str] | None = None


def _get_stdlib_modules() -> set[str]:
    global _STDLIB_MODULES
    if _STDLIB_MODULES is None:
        _STDLIB_MODULES = set(sys.stdlib_module_names) if hasattr(sys, "stdlib_module_names") else set()
    return _STDLIB_MODULES


def _is_stdlib_module(name: str) -> bool:
    return name in _get_stdlib_modules()


def _get_installed_modules() -> set[str]:
    """Return a set of top-level package names available in the current Python environment."""
    try:
        import pkg_resources  # type: ignore[import-untyped]

        return {pkg.key for pkg in pkg_resources.working_set}
    except ImportError:
        pass
    try:
        import importlib.metadata as ilm

        return {dist.metadata.get("Name", "").lower() or dist.name.lower() for dist in ilm.distributions()}
    except Exception:
        pass
    return set()


def _looks_hallucinated(name: str) -> bool:
    """Heuristic: hallucinated package names often contain 'test', 'mock', 'utils', 'placeholder'."""
    lowered = name.lower()
    hallucinated_indicators = [
        "placeholder",
        "test_utils",
        "mock_module",
        "fake_module",
        "dummymodule",
        "my_module",
        "sample",
        "example",
    ]
    return any(indicator in lowered for indicator in hallucinated_indicators)


def _deduplicate(findings: list[AntiMockupFinding]) -> list[AntiMockupFinding]:
    """Remove duplicate findings (same file, line, and pattern)."""
    seen: set[tuple[str, int, str]] = set()
    result: list[AntiMockupFinding] = []
    for f in findings:
        key = (f.file, f.line, f.pattern)
        if key not in seen:
            seen.add(key)
            result.append(f)
    return result


def _is_only_pass(body: list[ast.stmt]) -> bool:
    return len(body) == 1 and isinstance(body[0], ast.Pass)


def _is_continuation_pass(node: ast.ExceptHandler) -> bool:
    # Check if exception handler has a comment after pass like "# TODO"
    return False


def _is_builtin_exception_only(node: ast.ExceptHandler) -> bool:
    if node.type is None:
        return True
    if isinstance(node.type, ast.Name) and node.type.id in ("Exception", "BaseException", "RuntimeError"):
        return False
    return False


def _get_line_snippet(source: str, lineno: int, context: int = 1) -> str:
    lines = source.split("\n")
    if 1 <= lineno <= len(lines):
        return lines[lineno - 1].strip()[:120]
    return ""


def _is_docstring_or_pass(node: ast.stmt) -> bool:
    if isinstance(node, ast.Pass):
        return True
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
        return True
    return False


# ═══════════════════════════════════════════════════════════════════════════════
# Main scanning function
# ═══════════════════════════════════════════════════════════════════════════════


def scan_code(
    source: str,
    file_path: str,
    base_dir: str,
    known_files: set[str] | None = None,
    installed_modules: set[str] | None = None,
) -> list[AntiMockupFinding]:
    """Run all anti-liar detectors on a single source file.

    Parameters
    ----------
    source : str
        The source code to scan.
    file_path : str
        Full path to the source file (used for relative path computation).
    base_dir : str
        Base directory for relative path computation.
    known_files : set[str], optional
        Set of known file paths for cross-reference checking.
    installed_modules : set[str], optional
        Set of installed Python packages.

    Returns
    -------
    list[AntiMockupFinding]
        All detected findings from all detectors.
    """
    findings: list[AntiMockupFinding] = []

    findings.extend(detect_vacuous_assertions(source, file_path, base_dir))
    findings.extend(detect_contradictory_conditions(source, file_path, base_dir))
    findings.extend(detect_phantom_imports(source, file_path, base_dir, installed_modules))
    findings.extend(detect_dead_code(source, file_path, base_dir))
    findings.extend(detect_empty_except_handlers(source, file_path, base_dir))
    findings.extend(detect_self_assignments(source, file_path, base_dir))
    findings.extend(detect_phantom_file_references(source, file_path, base_dir, known_files))

    return findings


def scan_workspace(
    workspace_path: str,
    base_branch: str = "main",
) -> AntiMockupResult:
    """Run anti-liar scan on changed files in a workspace.

    Parameters
    ----------
    workspace_path : str
        Path to the git workspace.
    base_branch : str
        Base branch for git diff (default: main).

    Returns
    -------
    AntiMockupResult
        Scan result with passed/failed status and findings.
    """
    workspace = Path(workspace_path)
    if not workspace.is_dir():
        raise FileNotFoundError(f"Workspace path does not exist: {workspace_path}")

    # Collect changed files via git diff
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
        logger.warning("git diff failed in anti_liar scan: %s", exc)

    # Build known file set from workspace
    known_files: set[str] = set()
    for fpath in workspace.rglob("*"):
        if fpath.is_file() and not fpath.name.startswith("."):
            known_files.add(str(fpath.relative_to(workspace)))

    installed_modules = _get_installed_modules()

    all_findings: list[AntiMockupFinding] = []
    for cf in changed_files:
        full_path = os.path.join(workspace_path, cf)
        if not os.path.isfile(full_path):
            continue
        try:
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                source = f.read()
        except (OSError, UnicodeDecodeError) as exc:
            logger.warning("Cannot read %s: %s", full_path, exc)
            continue

        file_findings = scan_code(
            source=source,
            file_path=full_path,
            base_dir=workspace_path,
            known_files=known_files,
            installed_modules=installed_modules,
        )
        all_findings.extend(file_findings)

    critical = [f for f in all_findings if f.severity == "critical"]
    blocking = [f for f in all_findings if f.severity == "blocking"]

    passed = len(critical) == 0 and len(blocking) == 0
    for f in all_findings:
        logger.info("Anti-liar finding: %s:%d [%s] %s", f.file, f.line, f.severity, f.pattern[:80])

    return AntiMockupResult(passed=passed, findings=all_findings)


# ═══════════════════════════════════════════════════════════════════════════════
# Celery task
# ═══════════════════════════════════════════════════════════════════════════════

try:
    from celery import shared_task

    @shared_task(
        bind=True,
        max_retries=1,
        default_retry_delay=30,
        name="workers.quality.anti_liar.anti_liar_scan",
        autoretry_for=(Exception,),
    )
    def anti_liar_scan(self, workspace_path: str, base_branch: str = "main") -> dict[str, Any]:
        """Celery task: run anti-liar scan on a workspace.

        Parameters
        ----------
        workspace_path : str
            Path to git workspace to scan.
        base_branch : str
            Base branch for git diff.

        Returns
        -------
        dict
            Serialized AntiMockupResult.
        """
        logger.info("Running anti-liar scan on workspace=%s base=%s", workspace_path, base_branch)
        try:
            result = scan_workspace(workspace_path, base_branch)
            return result.model_dump()
        except Exception as exc:
            logger.error("Anti-liar scan failed — %s", exc, exc_info=True)
            raise self.retry(exc=exc)

except ImportError:
    # Celery not available — define a no-op for import safety
    def anti_liar_scan(workspace_path: str, base_branch: str = "main") -> dict[str, Any]:  # type: ignore[misc]
        logger.warning("Celery not available — anti_liar_scan called directly")
        result = scan_workspace(workspace_path, base_branch)
        return result.model_dump()
