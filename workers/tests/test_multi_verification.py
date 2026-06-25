"""Tests for multi_round_verify Celery task."""

import tempfile
from unittest.mock import patch

from workers.celery_app import app
from workers.tasks.multi_verification import (
    ROUND_LABELS,
    _check_ac_in_output,
    _resolve_workspace_path,
    multi_round_verify,
)


def test_multi_round_verify_registered():
    """multi_round_verify must be registered in Celery."""
    assert "workers.tasks.multi_verification.multi_round_verify" in app.tasks


def test_multi_round_verify_task_name():
    """Task name should match expected pattern."""
    task = app.tasks["workers.tasks.multi_verification.multi_round_verify"]
    assert task.name == "workers.tasks.multi_verification.multi_round_verify"


@patch("workers.tasks.multi_verification._run_test_command")
def test_multi_round_verify_all_pass(mock_run_test):
    """All 3 rounds pass when tests and ACs pass."""
    mock_run_test.return_value = {
        "passed": True,
        "output": "All tests passed. Login feature works correctly.",
        "exit_code": 0,
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        result = multi_round_verify.run(
            workspace_path=tmpdir,
            ac_list=["User can log in with valid credentials"],
            test_command="pytest",
        )

    assert result["passed"] is True
    assert result["score"] == 1.0
    assert len(result["rounds"]) == 3
    for round_data in result["rounds"]:
        assert round_data["verdict"] == "passed"


@patch("workers.tasks.multi_verification._run_test_command")
def test_multi_round_verify_fail_fast(mock_run_test):
    """Fail-fast: if round 1 fails, return immediately."""
    ac_text = "User can log in with valid credentials"
    mock_run_test.return_value = {
        "passed": False,
        "output": "Tests failed. Something broke.",
        "exit_code": 1,
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        result = multi_round_verify.run(
            workspace_path=tmpdir,
            ac_list=[ac_text],
            test_command="pytest",
        )

    assert result["passed"] is False
    assert result["score"] == 0.0
    assert len(result["rounds"]) == 1
    assert result["rounds"][0]["verdict"] == "failed"


@patch("workers.tasks.multi_verification._run_test_command")
def test_multi_round_verify_output_structure(mock_run_test):
    """Verify the return structure matches the expected schema."""
    mock_run_test.return_value = {
        "passed": True,
        "output": "Tests passed. Feature works.",
        "exit_code": 0,
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        result = multi_round_verify.run(
            workspace_path=tmpdir,
            ac_list=["Some acceptance criterion"],
            test_command="pytest",
        )

    assert "passed" in result
    assert "rounds" in result
    assert "score" in result
    assert isinstance(result["passed"], bool)
    assert isinstance(result["rounds"], list)
    assert isinstance(result["score"], float)

    if result["rounds"]:
        round_data = result["rounds"][0]
        assert "round" in round_data
        assert "verdict" in round_data
        assert "details" in round_data
        assert round_data["verdict"] in ("passed", "failed")
        details = round_data["details"]
        assert "prompt" in details
        assert "tests_passed" in details
        assert "ac_results" in details
        assert "ac_passed" in details
        assert "ac_failed" in details
        if details["ac_results"]:
            ac_result = details["ac_results"][0]
            assert "ac" in ac_result
            assert "met" in ac_result
            assert "evidence" in ac_result
            assert "prompt" in ac_result
            assert "strategy" in ac_result


@patch("workers.tasks.multi_verification._run_test_command")
def test_multi_round_verify_partial_ac_pass(mock_run_test):
    """When tests pass but ACs fail in a round, the round fails."""
    mock_run_test.return_value = {
        "passed": True,
        "output": "All tests passed.",
        "exit_code": 0,
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        result = multi_round_verify.run(
            workspace_path=tmpdir,
            ac_list=["The quantum flux capacitor recalibrates the tachyon emission"],
            test_command="pytest",
        )

    assert result["passed"] is False
    assert len(result["rounds"]) >= 1
    assert result["rounds"][0]["verdict"] == "failed"


def test_check_ac_in_output_match():
    """AC keywords found in output should return met=True."""
    ac = "User can log in with valid credentials"
    output = "Test passed: User can log in with valid credentials successfully"
    met, evidence = _check_ac_in_output(ac, output)
    assert met is True


def test_check_ac_in_output_no_match():
    """AC keywords not found in output should return met=False."""
    ac = "User can log in with valid credentials"
    output = "All tests passed"
    met, evidence = _check_ac_in_output(ac, output)
    assert met is False


def test_check_ac_in_output_short_ac():
    """Short ACs (few keywords) should fall back to exact phrase match."""
    ac = "Fix bug"
    output = "Fix bug completed"
    met, evidence = _check_ac_in_output(ac, output)
    assert met is True


def test_resolve_workspace_path_absolute():
    """Absolute paths should remain unchanged."""
    path = _resolve_workspace_path("/some/workspace")
    assert path == "/some/workspace"


def test_resolve_workspace_path_tilde():
    """Tilde paths should be expanded."""
    path = _resolve_workspace_path("~/workspace")
    assert path.startswith("/")
    assert "workspace" in path


def test_three_round_labels():
    """There should be exactly 3 distinct round labels."""
    assert len(ROUND_LABELS) == 3
    assert ROUND_LABELS[0] != ROUND_LABELS[1]
    assert ROUND_LABELS[1] != ROUND_LABELS[2]
    assert ROUND_LABELS[0] != ROUND_LABELS[2]


@patch("workers.tasks.multi_verification._run_test_command")
def test_multi_round_verify_round_labels_uniqueness(mock_run_test):
    """Each round should use a different label."""
    mock_run_test.return_value = {
        "passed": True,
        "output": "All tests passed. Everything works.",
        "exit_code": 0,
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        result = multi_round_verify.run(
            workspace_path=tmpdir,
            ac_list=["Everything works correctly"],
            test_command="pytest",
        )

    if result["passed"]:
        labels_used = [r["details"]["prompt"] for r in result["rounds"]]
        assert len(set(labels_used)) == 3


@patch("workers.tasks.multi_verification._run_test_command")
def test_multi_round_verify_score_range(mock_run_test):
    """Score should always be between 0.0 and 1.0."""
    mock_run_test.return_value = {
        "passed": True,
        "output": "Tests passed.",
        "exit_code": 0,
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        result = multi_round_verify.run(
            workspace_path=tmpdir,
            ac_list=["Everything works correctly"],
            test_command="pytest",
        )

    assert 0.0 <= result["score"] <= 1.0
    assert isinstance(result["score"], float)
