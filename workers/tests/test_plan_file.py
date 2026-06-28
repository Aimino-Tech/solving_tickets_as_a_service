"""Comprehensive tests for plan-as-file persistence."""

import os
import tempfile

import pytest

from workers.plan import save_plan, read_plan


class TestSavePlan:
    """save_plan() writes plan.md with correct markdown format."""

    def test_saves_to_workspace_path_from_ctx(self):
        steps = [
            {"task": "Triage Issue", "done": False},
            {"task": "Create Workspace", "done": False},
            {"task": "Dispatch Agent", "done": False},
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            ctx = {"workspace_path": tmpdir}
            path = save_plan("issue-42", steps, ctx)

            expected = os.path.join(tmpdir, "plan.md")
            assert path == expected
            assert os.path.isfile(expected)

    def test_saves_to_cwd_when_no_workspace_path(self):
        steps = [{"task": "Only Step", "done": False}]
        with tempfile.TemporaryDirectory() as tmpdir:
            original_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)
                path = save_plan("issue-1", steps, ctx=None)

                expected = os.path.join(tmpdir, "plan.md")
                assert path == expected
                assert os.path.isfile(expected)
            finally:
                os.chdir(original_cwd)

    def test_content_format(self):
        steps = [
            {"task": "Triage Issue", "done": False},
            {"task": "Create Workspace", "done": False},
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            ctx = {"workspace_path": tmpdir}
            save_plan("issue-42", steps, ctx)

            with open(os.path.join(tmpdir, "plan.md"), "r") as f:
                content = f.read()

            assert "# Plan for issue-42" in content
            assert "- [ ] Triage Issue" in content
            assert "- [ ] Create Workspace" in content

    def test_completed_step_uses_x(self):
        steps = [
            {"task": "Done Task", "done": True},
            {"task": "Pending Task", "done": False},
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            ctx = {"workspace_path": tmpdir}
            save_plan("issue-1", steps, ctx)

            with open(os.path.join(tmpdir, "plan.md"), "r") as f:
                content = f.read()

            assert "- [x] Done Task" in content
            assert "- [ ] Pending Task" in content

    def test_default_done_is_false(self):
        steps = [{"task": "No Done Key"}]
        with tempfile.TemporaryDirectory() as tmpdir:
            ctx = {"workspace_path": tmpdir}
            save_plan("issue-1", steps, ctx)

            with open(os.path.join(tmpdir, "plan.md"), "r") as f:
                content = f.read()

            assert "- [ ] No Done Key" in content

    def test_unknown_step_fallback(self):
        steps = [{"not_a_task": "value"}]
        with tempfile.TemporaryDirectory() as tmpdir:
            ctx = {"workspace_path": tmpdir}
            save_plan("issue-1", steps, ctx)

            with open(os.path.join(tmpdir, "plan.md"), "r") as f:
                content = f.read()

            assert "- [ ] Unknown step" in content

    def test_empty_steps(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ctx = {"workspace_path": tmpdir}
            path = save_plan("issue-1", [], ctx)

            with open(path, "r") as f:
                content = f.read()

            # Should write heading but no checkbox lines
            assert "# Plan for issue-1" in content
            assert "- [" not in content

    def test_nonexistent_directory_raises(self):
        steps = [{"task": "Test", "done": False}]
        with pytest.raises(OSError):
            save_plan("issue-1", steps, {"workspace_path": "/nonexistent/path"})


class TestReadPlan:
    """read_plan() parses plan.md back into structured steps."""

    def test_reads_simple_plan(self):
        markdown = """# Plan for issue-42

- [ ] Triage Issue
- [ ] Create Workspace
- [x] Dispatch Agent
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_path = os.path.join(tmpdir, "plan.md")
            with open(plan_path, "w") as f:
                f.write(markdown)

            steps = read_plan(tmpdir)

            assert len(steps) == 3
            assert steps[0] == {"task": "Triage Issue", "done": False}
            assert steps[1] == {"task": "Create Workspace", "done": False}
            assert steps[2] == {"task": "Dispatch Agent", "done": True}

    def test_returns_empty_list_when_no_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            steps = read_plan(tmpdir)
            assert steps == []

    def test_returns_empty_list_when_empty_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_path = os.path.join(tmpdir, "plan.md")
            with open(plan_path, "w") as f:
                f.write("")

            steps = read_plan(tmpdir)
            assert steps == []

    def test_ignores_non_checkbox_lines(self):
        markdown = """# Plan

Some intro text

- [ ] Valid Step

> A quote
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            plan_path = os.path.join(tmpdir, "plan.md")
            with open(plan_path, "w") as f:
                f.write(markdown)

            steps = read_plan(tmpdir)
            assert len(steps) == 1
            assert steps[0] == {"task": "Valid Step", "done": False}

    def test_round_trip(self):
        original = [
            {"task": "Step One", "done": False},
            {"task": "Step Two", "done": True},
            {"task": "Step Three", "done": False},
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            ctx = {"workspace_path": tmpdir}
            save_plan("issue-99", original, ctx)

            loaded = read_plan(tmpdir)

            assert loaded == original

    def test_handles_tasks_with_colons_and_special_chars(self):
        steps = [
            {"task": "Install package: foo-bar", "done": False},
            {"task": "Fix /api/endpoint route", "done": True},
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            ctx = {"workspace_path": tmpdir}
            save_plan("issue-1", steps, ctx)

            loaded = read_plan(tmpdir)

            assert len(loaded) == 2
            assert loaded[0]["task"] == "Install package: foo-bar"
            assert loaded[1]["task"] == "Fix /api/endpoint route"
            assert loaded[1]["done"] is True

    def test_missing_file_does_not_raise(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            # No plan.md written
            steps = read_plan(tmpdir)
            assert steps == []


class TestEngineIntegration:
    """Integration-style tests verifying engine calls save_plan correctly."""

    def test_step_label_from_task_name(self):
        from workers.orchestrator.engine import _step_label

        cfg = {"task": "workers.tasks.triage.triage_issue"}
        assert _step_label(cfg) == "Triage Issue"

    def test_step_label_from_explicit_label(self):
        from workers.orchestrator.engine import _step_label

        cfg = {"task": "some.task", "label": "Custom Label"}
        assert _step_label(cfg) == "Custom Label"

    def test_step_label_fallback(self):
        from workers.orchestrator.engine import _step_label

        cfg = {}
        assert _step_label(cfg) == "Unknown"

    def test_step_label_agent_task(self):
        from workers.orchestrator.engine import _step_label

        cfg = {"task": "workers.tasks.agent.dispatch_opencode"}
        assert _step_label(cfg) == "Dispatch Opencode"

    @pytest.mark.skip("Requires full pipeline config to load")
    def test_start_pipeline_saves_plan(self):
        """Placeholder for end-to-end engine integration test."""
        pass
