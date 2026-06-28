"""Tests for multi-round verification (workers/tasks/multi_verification.py)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def sample_ac_list() -> list[str]:
    return [
        "Fix login button color to #4A90D9",
        "Add hover state with opacity 0.8",
        "Ensure responsive layout on mobile",
    ]


@pytest.fixture
def sample_test_command() -> str:
    return "pytest tests/test_login.py"


# ── Tests: _build_variations ─────────────────────────────────────────────────


class TestBuildVariations:
    """``_build_variations`` returns 3 distinct prompt strings."""

    def test_returns_three_variations(self, sample_ac_list, sample_test_command):
        from workers.tasks.multi_verification import _build_variations

        variations = _build_variations(sample_ac_list, sample_test_command)
        assert len(variations) == 3

    def test_variations_are_distinct(self, sample_ac_list, sample_test_command):
        from workers.tasks.multi_verification import _build_variations

        variations = _build_variations(sample_ac_list, sample_test_command)
        assert variations[0] != variations[1]
        assert variations[1] != variations[2]
        assert variations[0] != variations[2]

    def test_each_variation_contains_ac(self, sample_ac_list, sample_test_command):
        from workers.tasks.multi_verification import _build_variations

        variations = _build_variations(sample_ac_list, sample_test_command)
        for var in variations:
            for ac in sample_ac_list:
                assert ac in var

    def test_each_variation_contains_test_command(self, sample_ac_list, sample_test_command):
        from workers.tasks.multi_verification import _build_variations

        variations = _build_variations(sample_ac_list, sample_test_command)
        for var in variations:
            assert sample_test_command in var

    def test_different_prompt_prefixes(self, sample_ac_list, sample_test_command):
        from workers.tasks.multi_verification import _build_variations

        variations = _build_variations(sample_ac_list, sample_test_command)
        assert variations[0].startswith("Verify ALL")
        assert variations[1].startswith("Check if every")
        assert variations[2].startswith("Prove each")

    def test_different_command_prefixes(self, sample_ac_list, sample_test_command):
        from workers.tasks.multi_verification import _build_variations

        variations = _build_variations(sample_ac_list, sample_test_command)
        assert "Run:" in variations[0]
        assert "Test command:" in variations[1]
        assert "Execute:" in variations[2]


# ── Tests: _extract_test_command ──────────────────────────────────────────────


class TestExtractTestCommand:
    """``_extract_test_command`` extracts the test command from prompts."""

    def test_extracts_run_prefix(self):
        from workers.tasks.multi_verification import _extract_test_command

        cmd = _extract_test_command(
            "Verify ALL acceptance criteria are met:\n- AC1\nRun: pytest tests/",
        )
        assert cmd == "pytest tests/"

    def test_extracts_test_command_prefix(self):
        from workers.tasks.multi_verification import _extract_test_command

        cmd = _extract_test_command(
            "Check if every AC is met:\n- AC1\nTest command: npm test",
        )
        assert cmd == "npm test"

    def test_extracts_execute_prefix(self):
        from workers.tasks.multi_verification import _extract_test_command

        cmd = _extract_test_command(
            "Prove each AC is met:\n- AC1\nExecute: cargo test",
        )
        assert cmd == "cargo test"

    def test_returns_empty_when_no_command(self):
        from workers.tasks.multi_verification import _extract_test_command

        cmd = _extract_test_command("Just a plain prompt with no command marker")
        assert cmd == ""

    def test_strips_whitespace(self):
        from workers.tasks.multi_verification import _extract_test_command

        cmd = _extract_test_command("Run:   pytest tests/ --verbose  ")
        assert cmd == "pytest tests/ --verbose"


# ── Tests: run_verification_round ─────────────────────────────────────────────


class TestRunVerificationRound:
    """``run_verification_round`` executes a single round and returns results."""

    @patch("workers.tasks.multi_verification.subprocess.run")
    def test_returns_passed_when_command_succeeds(self, mock_run, tmp_path):
        from workers.tasks.multi_verification import run_verification_round

        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "All tests passed!"
        mock_run.return_value.stderr = ""

        prompt = "Verify ACs:\n- Fix button\nRun: pytest"
        result = run_verification_round(str(tmp_path), prompt, round_number=1)

        assert result["passed"] is True
        assert result["exit_code"] == 0
        assert result["prompt_snippet"] == prompt[:120]
        assert "duration_ms" in result

    @patch("workers.tasks.multi_verification.subprocess.run")
    def test_returns_failed_when_command_fails(self, mock_run, tmp_path):
        from workers.tasks.multi_verification import run_verification_round

        mock_run.return_value.returncode = 1
        mock_run.return_value.stdout = "FAILED test_login.py"
        mock_run.return_value.stderr = ""

        prompt = "Check ACs:\n- Fix button\nTest command: pytest"
        result = run_verification_round(str(tmp_path), prompt)

        assert result["passed"] is False
        assert result["exit_code"] == 1

    @patch("workers.tasks.multi_verification.subprocess.run")
    def test_includes_output_in_result(self, mock_run, tmp_path):
        from workers.tasks.multi_verification import run_verification_round

        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "3 passed, 0 failed"
        mock_run.return_value.stderr = ""

        prompt = "Verify ACs:\n- Fix button\nRun: pytest"
        result = run_verification_round(str(tmp_path), prompt)

        assert "3 passed" in result["output"]

    @patch("workers.tasks.multi_verification.subprocess.run")
    def test_merges_stderr_into_output(self, mock_run, tmp_path):
        from workers.tasks.multi_verification import run_verification_round

        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "Test output"
        mock_run.return_value.stderr = "Warning: deprecated API used"

        prompt = "Verify ACs:\n- Fix button\nRun: pytest"
        result = run_verification_round(str(tmp_path), prompt)

        assert "Test output" in result["output"]
        assert "Warning" in result["output"]

    @patch("workers.tasks.multi_verification.subprocess.run")
    def test_passes_when_no_command_in_prompt(self, mock_run, tmp_path):
        from workers.tasks.multi_verification import run_verification_round

        result = run_verification_round(str(tmp_path), "Just a description with no command")

        assert result["passed"] is True
        assert result["exit_code"] == 0
        assert "No test command found" in result["output"]
        # subprocess should NOT be called
        mock_run.assert_not_called()

    @patch("workers.tasks.multi_verification.subprocess.run")
    def test_each_call_is_fresh_subprocess(self, mock_run, tmp_path):
        from workers.tasks.multi_verification import run_verification_round

        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "ok"
        mock_run.return_value.stderr = ""

        prompt = "Run: pytest"
        run_verification_round(str(tmp_path), prompt, round_number=1)
        run_verification_round(str(tmp_path), prompt, round_number=2)

        # Two calls should mean two separate subprocess.run invocations
        assert mock_run.call_count == 2

    @patch("workers.tasks.multi_verification.subprocess.run")
    def test_truncates_long_output(self, mock_run, tmp_path):
        from workers.tasks.multi_verification import run_verification_round

        # Generate output with more than 100 lines
        long_output = "\n".join(f"line {i}" for i in range(200))
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = long_output
        mock_run.return_value.stderr = ""

        prompt = "Run: pytest"
        result = run_verification_round(str(tmp_path), prompt)

        lines = result["output"].splitlines()
        assert len(lines) <= 100

    @patch("workers.tasks.multi_verification.subprocess.run")
    def test_handles_command_timeout(self, mock_run, tmp_path):
        from workers.tasks.multi_verification import run_verification_round

        from subprocess import TimeoutExpired

        mock_run.side_effect = TimeoutExpired("pytest", 600)

        prompt = "Run: pytest"
        result = run_verification_round(str(tmp_path), prompt)

        assert result["passed"] is False
        assert "TIMEOUT" in result["output"]
        assert result["exit_code"] == -1

    @patch("workers.tasks.multi_verification.subprocess.run")
    def test_round_number_appears_in_logs(self, mock_run, tmp_path, caplog):
        import logging

        from workers.tasks.multi_verification import run_verification_round

        caplog.set_level(logging.INFO)
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "ok"
        mock_run.return_value.stderr = ""

        prompt = "Run: pytest"
        run_verification_round(str(tmp_path), prompt, round_number=3)

        # The "round" field in the JSON log should be 3
        assert any('"round": 3' in record.getMessage() for record in caplog.records)


# ── Tests: multi_round_verify (Celery task) ────────────────────────────────────


class TestMultiRoundVerify:
    """High-level Celery task tests."""

    @patch("workers.tasks.multi_verification.run_verification_round")
    def test_all_three_rounds_run_when_all_pass(self, mock_round, sample_ac_list):
        """When all 3 rounds pass, ``passed`` is True and score is 1.0."""
        mock_round.return_value = {
            "passed": True,
            "output": "All tests passed",
            "exit_code": 0,
            "duration_ms": 100,
            "prompt_snippet": "...",
        }

        from workers.tasks.multi_verification import multi_round_verify

        result = multi_round_verify.run("/fake/ws", sample_ac_list, "pytest")

        assert result["passed"] is True
        assert result["score"] == 1.0
        assert len(result["rounds"]) == 3
        assert mock_round.call_count == 3

    @patch("workers.tasks.multi_verification.run_verification_round")
    def test_fails_fast_on_first_failure(self, mock_round, sample_ac_list):
        """When round 1 fails, the task returns immediately with partial score."""
        mock_round.return_value = {
            "passed": False,
            "output": "Tests failed",
            "exit_code": 1,
            "duration_ms": 50,
            "prompt_snippet": "...",
        }

        from workers.tasks.multi_verification import multi_round_verify

        result = multi_round_verify.run("/fake/ws", sample_ac_list, "pytest")

        assert result["passed"] is False
        assert result["score"] == 0.0
        assert len(result["rounds"]) == 1
        # Only 1 round should have run (fail-fast)
        assert mock_round.call_count == 1

    @patch("workers.tasks.multi_verification.run_verification_round")
    def test_fails_fast_on_second_failure(self, mock_round, sample_ac_list):
        """When round 2 fails, the task returns with score 1/3."""
        # Round 1 passes, round 2 fails
        mock_round.side_effect = [
            {
                "passed": True,
                "output": "Passed",
                "exit_code": 0,
                "duration_ms": 50,
                "prompt_snippet": "...",
            },
            {
                "passed": False,
                "output": "Failed",
                "exit_code": 1,
                "duration_ms": 50,
                "prompt_snippet": "...",
            },
        ]

        from workers.tasks.multi_verification import multi_round_verify

        result = multi_round_verify.run("/fake/ws", sample_ac_list, "pytest")

        assert result["passed"] is False
        assert result["score"] == pytest.approx(1.0 / 3.0)
        assert len(result["rounds"]) == 2
        assert mock_round.call_count == 2

    @patch("workers.tasks.multi_verification.run_verification_round")
    def test_score_calculation_one_of_three(self, mock_round, sample_ac_list):
        """Only round 1 passes — score should be 1/3."""
        mock_round.side_effect = [
            {"passed": True, "output": "ok", "exit_code": 0, "duration_ms": 10, "prompt_snippet": "..."},
            {"passed": False, "output": "fail", "exit_code": 1, "duration_ms": 10, "prompt_snippet": "..."},
        ]

        from workers.tasks.multi_verification import multi_round_verify

        result = multi_round_verify.run("/fake/ws", sample_ac_list, "pytest")
        assert result["score"] == pytest.approx(1.0 / 3.0)

    @patch("workers.tasks.multi_verification.run_verification_round")
    def test_score_calculation_two_of_three(self, mock_round, sample_ac_list):
        """First two pass, third fails — score should be 2/3."""
        mock_round.side_effect = [
            {"passed": True, "output": "ok", "exit_code": 0, "duration_ms": 10, "prompt_snippet": "..."},
            {"passed": True, "output": "ok", "exit_code": 0, "duration_ms": 10, "prompt_snippet": "..."},
            {"passed": False, "output": "fail", "exit_code": 1, "duration_ms": 10, "prompt_snippet": "..."},
        ]

        from workers.tasks.multi_verification import multi_round_verify

        result = multi_round_verify.run("/fake/ws", sample_ac_list, "pytest")
        assert result["score"] == pytest.approx(2.0 / 3.0)

    @patch("workers.tasks.multi_verification.run_verification_round")
    def test_each_round_receives_different_prompt(self, mock_round, sample_ac_list):
        """Each round call should receive a different prompt variation."""
        mock_round.return_value = {
            "passed": True,
            "output": "ok",
            "exit_code": 0,
            "duration_ms": 10,
            "prompt_snippet": "...",
        }

        from workers.tasks.multi_verification import multi_round_verify

        multi_round_verify.run("/fake/ws", sample_ac_list, "pytest")

        # Verify that each call has a different prompt (second positional arg)
        prompts = [call.args[1] for call in mock_round.call_args_list]
        assert len(set(prompts)) == 3  # All 3 prompts are unique

    @patch("workers.tasks.multi_verification.run_verification_round")
    def test_result_contains_all_round_details(self, mock_round, sample_ac_list):
        """Each round result includes round number, passed, output, etc."""
        mock_round.return_value = {
            "passed": True,
            "output": "All good",
            "exit_code": 0,
            "duration_ms": 100,
            "prompt_snippet": "Verify ALL...",
        }

        from workers.tasks.multi_verification import multi_round_verify

        result = multi_round_verify.run("/fake/ws", sample_ac_list, "pytest")

        for round_data in result["rounds"]:
            assert "round" in round_data
            assert round_data["round"] in (1, 2, 3)
            assert "passed" in round_data
            assert "output" in round_data
            assert "exit_code" in round_data
            assert "duration_ms" in round_data
            assert "prompt_snippet" in round_data

    @patch("workers.tasks.multi_verification.run_verification_round")
    def test_task_is_registered(self, mock_round, sample_ac_list):
        """The task must be registered in the Celery app."""
        from workers.celery_app import app

        assert "workers.tasks.multi_verification.multi_round_verify" in app.tasks

    def test_empty_ac_list(self):
        """Empty AC list still builds 3 variations with just the test command."""
        from workers.tasks.multi_verification import _build_variations

        variations = _build_variations([], "pytest")
        assert len(variations) == 3
        for var in variations:
            assert "pytest" in var

    @patch("workers.tasks.multi_verification.run_verification_round")
    def test_empty_ac_list_still_runs_rounds(self, mock_round):
        """Even with empty AC list, 3 rounds still run."""
        mock_round.return_value = {
            "passed": True,
            "output": "ok",
            "exit_code": 0,
            "duration_ms": 10,
            "prompt_snippet": "...",
        }

        from workers.tasks.multi_verification import multi_round_verify

        result = multi_round_verify.run("/fake/ws", [], "pytest")
        assert result["passed"] is True
        assert len(result["rounds"]) == 3

    @patch("workers.tasks.multi_verification.run_verification_round")
    def test_workspace_path_passed_to_each_round(self, mock_round):
        """Each round receives the same workspace_path."""
        mock_round.return_value = {
            "passed": True,
            "output": "ok",
            "exit_code": 0,
            "duration_ms": 10,
            "prompt_snippet": "...",
        }

        from workers.tasks.multi_verification import multi_round_verify

        multi_round_verify.run("/specific/workspace", ["AC1"], "pytest")

        for call in mock_round.call_args_list:
            assert call.args[0] == "/specific/workspace"
