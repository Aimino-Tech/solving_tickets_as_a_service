"""Tests for the build_verify Celery task module."""

import json
import os
import tempfile
from unittest.mock import patch, mock_open

from workers.celery_app import app


def test_task_registered():
    """build_and_test must be registered in the Celery app."""
    import workers.tasks.build_verify  # noqa: F401
    assert "workers.tasks.build_verify.build_and_test" in app.tasks


# ── Auto-detection tests (using temp directories with real files) ────────


def _create_workspace(files: dict[str, str]) -> str:
    """Create a temp workspace with the given files."""
    tmpdir = tempfile.mkdtemp()
    for path, content in files.items():
        full_path = os.path.join(tmpdir, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)
    return tmpdir


def test_detect_commands_package_json():
    """Detects build/test from package.json scripts."""
    from workers.tasks.build_verify import _detect_commands

    ws = _create_workspace({
        "package.json": json.dumps({"scripts": {"build": "tsc", "test": "jest"}}),
    })
    try:
        result = _detect_commands(ws)
        assert result["build"] == "tsc"
        assert result["test"] == "jest"
    finally:
        import shutil
        shutil.rmtree(ws, ignore_errors=True)


def test_detect_commands_package_json_fallback():
    """Falls back to npm run build / npm test when scripts lack custom keys."""
    from workers.tasks.build_verify import _detect_commands

    ws = _create_workspace({
        "package.json": json.dumps({"scripts": {}}),
    })
    try:
        result = _detect_commands(ws)
        assert result["build"] == "npm run build"
        assert result["test"] == "npm test"
    finally:
        import shutil
        shutil.rmtree(ws, ignore_errors=True)


def test_detect_commands_makefile():
    """Detects build/test from Makefile."""
    from workers.tasks.build_verify import _detect_commands

    ws = _create_workspace({"Makefile": "build:\n\techo build\n"})
    try:
        result = _detect_commands(ws)
        assert result["build"] == "make build"
        assert result["test"] == "make test"
    finally:
        import shutil
        shutil.rmtree(ws, ignore_errors=True)


def test_detect_commands_cargo():
    """Detects build/test from Cargo.toml."""
    from workers.tasks.build_verify import _detect_commands

    ws = _create_workspace({"Cargo.toml": '[package]\nname = "test"\n'})
    try:
        result = _detect_commands(ws)
        assert result["build"] == "cargo build"
        assert result["test"] == "cargo test"
    finally:
        import shutil
        shutil.rmtree(ws, ignore_errors=True)


def test_detect_commands_pyproject():
    """Detects test=pytest from pyproject.toml (no build)."""
    from workers.tasks.build_verify import _detect_commands

    ws = _create_workspace({"pyproject.toml": '[project]\nname = "test"\n'})
    try:
        result = _detect_commands(ws)
        assert result["build"] == ""
        assert result["test"] == "pytest"
    finally:
        import shutil
        shutil.rmtree(ws, ignore_errors=True)


def test_detect_commands_none():
    """Returns empty commands when no config file is found."""
    from workers.tasks.build_verify import _detect_commands

    ws = _create_workspace({"README.md": "just a readme\n"})
    try:
        result = _detect_commands(ws)
        assert result["build"] == ""
        assert result["test"] == ""
    finally:
        import shutil
        shutil.rmtree(ws, ignore_errors=True)


# ── _run_command tests ──────────────────────────────────────────────────


@patch("workers.tasks.build_verify.subprocess.run")
def test_run_command_success(mock_run):
    from workers.tasks.build_verify import _run_command
    from pathlib import Path

    mock_run.return_value.returncode = 0
    mock_run.return_value.stdout = "Build succeeded"
    mock_run.return_value.stderr = ""

    result = _run_command("npm run build", Path("/fake/ws"))
    assert result["passed"] is True
    assert result["exit_code"] == 0
    assert "Build succeeded" in result["output"]
    assert result["duration_ms"] >= 0


@patch("workers.tasks.build_verify.subprocess.run")
def test_run_command_failure(mock_run):
    from workers.tasks.build_verify import _run_command
    from pathlib import Path

    mock_run.return_value.returncode = 1
    mock_run.return_value.stdout = ""
    mock_run.return_value.stderr = "error: Cannot find module 'foo'"

    result = _run_command("npm run build", Path("/fake/ws"))
    assert result["passed"] is False
    assert result["exit_code"] == 1
    assert "error: Cannot find module" in result["output"]


def test_run_command_empty():
    """Empty command returns passed=True immediately."""
    from workers.tasks.build_verify import _run_command
    from pathlib import Path

    result = _run_command("", Path("/fake/ws"))
    assert result["passed"] is True
    assert result["exit_code"] == 0
    assert result["output"] == ""
    assert result["duration_ms"] == 0


# ── Test output parsing ─────────────────────────────────────────────────


def test_parse_pytest_output():
    from workers.tasks.build_verify import _parse_test_output

    result = _parse_test_output("3 passed, 1 failed, 2 skipped, 1 error in 0.12s", "pytest")
    assert result["passed"] == 3
    assert result["failed"] == 1
    assert result["skipped"] == 2
    assert result["error"] == 1


def test_parse_cargo_output():
    from workers.tasks.build_verify import _parse_test_output

    output = "test result: ok. 10 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out"
    result = _parse_test_output(output, "cargo test")
    assert result["passed"] == 10
    assert result["failed"] == 2
    assert result["skipped"] == 1


def test_parse_jest_output():
    from workers.tasks.build_verify import _parse_test_output

    result = _parse_test_output("Tests:       7 passed, 7 total", "npm test")
    assert result["passed"] == 7


def test_parse_jest_with_failures():
    from workers.tasks.build_verify import _parse_test_output

    result = _parse_test_output("Tests:       1 failed, 5 passed, 6 total", "npm test")
    assert result["passed"] == 5
    assert result["failed"] == 1


def test_parse_mocha_output():
    from workers.tasks.build_verify import _parse_test_output

    result = _parse_test_output("\n  5 passing (2s)\n  1 failing\n", "mocha")
    assert result["passed"] == 5
    assert result["failed"] == 1


def test_parse_empty_output():
    from workers.tasks.build_verify import _parse_test_output

    result = _parse_test_output("", "pytest")
    assert result == {"passed": 0, "failed": 0, "skipped": 0, "error": 0}


# ── build_and_test integration tests ────────────────────────────────────


@patch("workers.tasks.build_verify.Path.is_dir")
@patch("workers.tasks.build_verify._detect_commands")
@patch("workers.tasks.build_verify._run_command")
def test_build_and_test_success(mock_run, mock_detect, mock_isdir):
    from workers.tasks.build_verify import build_and_test

    mock_isdir.return_value = True
    mock_detect.return_value = {"build": "npm run build", "test": "npm test"}

    mock_run.side_effect = [
        {"passed": True, "exit_code": 0, "output": "Build OK", "duration_ms": 1500},
        {"passed": True, "exit_code": 0, "output": "Tests: 10 passed, 10 total", "duration_ms": 2500},
    ]

    result = build_and_test.run(workspace_path="/fake/ws")

    assert result["build"]["passed"] is True
    assert result["build"]["exit_code"] == 0
    assert result["build"]["duration_ms"] == 1500
    assert result["test"]["passed"] is True
    assert result["test"]["exit_code"] == 0
    assert result["test"]["duration_ms"] == 2500
    assert result["test"]["summary"]["passed"] == 10
    assert result["overall"]["passed"] is True
    assert result["overall"]["status"] == "passed"


@patch("workers.tasks.build_verify.Path.is_dir")
@patch("workers.tasks.build_verify._detect_commands")
@patch("workers.tasks.build_verify._run_command")
def test_build_and_test_build_fails(mock_run, mock_detect, mock_isdir):
    from workers.tasks.build_verify import build_and_test

    mock_isdir.return_value = True
    mock_detect.return_value = {"build": "npm run build", "test": "npm test"}

    mock_run.return_value = {
        "passed": False, "exit_code": 1, "output": "Build failed", "duration_ms": 500,
    }

    result = build_and_test.run(workspace_path="/fake/ws")

    assert result["build"]["passed"] is False
    assert result["build"]["exit_code"] == 1
    assert result["test"]["exit_code"] == -1
    assert result["overall"]["passed"] is False
    assert result["overall"]["status"] == "build_failed"
    assert mock_run.call_count == 1


@patch("workers.tasks.build_verify.Path.is_dir")
@patch("workers.tasks.build_verify._detect_commands")
@patch("workers.tasks.build_verify._run_command")
def test_build_and_test_test_fails(mock_run, mock_detect, mock_isdir):
    from workers.tasks.build_verify import build_and_test

    mock_isdir.return_value = True
    mock_detect.return_value = {"build": "make build", "test": "make test"}

    mock_run.side_effect = [
        {"passed": True, "exit_code": 0, "output": "Build OK", "duration_ms": 1000},
        {"passed": False, "exit_code": 1, "output": "1 failed, 5 passed", "duration_ms": 3000},
    ]

    result = build_and_test.run(workspace_path="/fake/ws")

    assert result["build"]["passed"] is True
    assert result["test"]["passed"] is False
    assert result["test"]["exit_code"] == 1
    assert result["overall"]["passed"] is False
    assert result["overall"]["status"] == "test_failed"


@patch("workers.tasks.build_verify.Path.is_dir")
@patch("workers.tasks.build_verify._run_command")
def test_build_and_test_explicit_commands(mock_run, mock_isdir):
    """Explicit build/test commands used when provided (no detection)."""
    from workers.tasks.build_verify import build_and_test

    mock_isdir.return_value = True

    mock_run.side_effect = [
        {"passed": True, "exit_code": 0, "output": "cargo build done", "duration_ms": 5000},
        {"passed": True, "exit_code": 0, "output": "test result: ok. 42 passed; 0 failed; 0 ignored", "duration_ms": 2000},
    ]

    result = build_and_test.run(
        workspace_path="/fake/ws",
        build_command="cargo build --release",
        test_command="cargo test --lib",
    )

    assert result["build"]["passed"] is True
    assert result["test"]["passed"] is True
    assert result["test"]["summary"]["passed"] == 42
    call_args = [c[0][0] for c in mock_run.call_args_list]
    assert call_args == ["cargo build --release", "cargo test --lib"]


@patch("workers.tasks.build_verify.Path.is_dir")
def test_build_and_test_workspace_not_found(mock_isdir):
    from workers.tasks.build_verify import build_and_test

    mock_isdir.return_value = False

    try:
        build_and_test.run(workspace_path="/nonexistent")
        assert False, "Expected exception"
    except FileNotFoundError:
        pass


# ── orchestrate_pipeline now includes build_verify ──────────────────────


def test_orchestrate_pipeline_includes_build_verify():
    """orchestrate_pipeline must include build_verify step."""
    from workers.tasks.self_audit import orchestrate_pipeline

    result = orchestrate_pipeline.run(issue_data={"issue_id": "test-001"})
    assert "build_verify" in result["pipeline_steps"]
    build_idx = result["pipeline_steps"].index("build_verify")
    verify_idx = result["pipeline_steps"].index("verification")
    assert build_idx < verify_idx, "build_verify must run before verification"


def test_build_verify_registered_in_quality_test():
    """build_and_test should be discoverable by auto-discover."""
    import workers.tasks  # noqa: F401
    assert "workers.tasks.build_verify.build_and_test" in app.tasks
