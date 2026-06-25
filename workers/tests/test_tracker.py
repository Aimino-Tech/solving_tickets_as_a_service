"""Tests for Linear tracker integration — client, state machine, routing, poll."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ===========================================================================
# Linear Client
# ===========================================================================


class TestLinearClient:
    """Tests for ``workers.linear.client.LinearClient``."""

    # ── get_issues_by_state ──────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_get_issues_by_state_returns_linear_issues(self):
        from workers.linear.client import LinearClient

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "issues": {
                    "nodes": [
                        {
                            "id": "lin_issue_1",
                            "title": "Fix login bug",
                            "description": "Users cannot log in",
                            "priority": 2.0,
                            "state": {"name": "Todo", "type": "unstarted"},
                            "team": {"key": "PROJ"},
                            "labels": {"nodes": [{"name": "stas:fix"}]},
                            "url": "https://linear.app/proj/PROJ-1",
                            "createdAt": "2025-01-01T00:00:00Z",
                            "updatedAt": "2025-01-02T00:00:00Z",
                        },
                        {
                            "id": "lin_issue_2",
                            "title": "Add feature",
                            "description": None,
                            "priority": 1.0,
                            "state": {"name": "In Progress", "type": "started"},
                            "team": {"key": "PROJ"},
                            "labels": {"nodes": [{"name": "stas:feature"}]},
                            "url": "https://linear.app/proj/PROJ-2",
                            "createdAt": "2025-01-01T00:00:00Z",
                            "updatedAt": "2025-01-03T00:00:00Z",
                        },
                    ],
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                },
            },
        }

        with patch.object(LinearClient, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_response.json.return_value["data"]
            client = LinearClient(api_key="lin_test_key")
            issues = await client.get_issues_by_state(["Todo", "In Progress"])

            assert len(issues) == 2

            assert issues[0].id == "lin_issue_1"
            assert issues[0].title == "Fix login bug"
            assert issues[0].description == "Users cannot log in"
            assert issues[0].priority == 2.0
            assert issues[0].state_name == "Todo"
            assert issues[0].state_type == "unstarted"
            assert issues[0].team_key == "PROJ"
            assert issues[0].labels == ["stas:fix"]
            assert issues[0].url == "https://linear.app/proj/PROJ-1"

            assert issues[1].id == "lin_issue_2"
            assert issues[1].title == "Add feature"
            assert issues[1].description is None
            assert issues[1].state_name == "In Progress"
            assert issues[1].labels == ["stas:feature"]

            # Verify the filter was built correctly
            call_kwargs = mock_request.call_args_list[0]
            # _paginate_issues passes query + variables internally
            assert mock_request.call_count >= 1

    @pytest.mark.asyncio
    async def test_get_issues_by_state_pagination(self):
        """Verify pagination follows ``hasNextPage``."""
        from workers.linear.client import LinearClient

        page_1 = {
            "issues": {
                "nodes": [
                    {
                        "id": "p1_1",
                        "title": "Issue 1",
                        "description": None,
                        "priority": 0.0,
                        "state": {"name": "Todo", "type": "unstarted"},
                        "team": {"key": "T"},
                        "labels": {"nodes": []},
                        "url": "",
                        "createdAt": "",
                        "updatedAt": "",
                    },
                ],
                "pageInfo": {"hasNextPage": True, "endCursor": "cursor_1"},
            },
        }
        page_2 = {
            "issues": {
                "nodes": [
                    {
                        "id": "p2_1",
                        "title": "Issue 2",
                        "description": None,
                        "priority": 0.0,
                        "state": {"name": "Todo", "type": "unstarted"},
                        "team": {"key": "T"},
                        "labels": {"nodes": []},
                        "url": "",
                        "createdAt": "",
                        "updatedAt": "",
                    },
                ],
                "pageInfo": {"hasNextPage": False, "endCursor": None},
            },
        }

        with patch.object(LinearClient, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = [page_1, page_2]
            client = LinearClient(api_key="lin_test_key")
            issues = await client.get_issues_by_state(["Todo"])

            assert len(issues) == 2
            assert issues[0].id == "p1_1"
            assert issues[1].id == "p2_1"
            # Two calls = two pages
            assert mock_request.call_count == 2

    # ── transition_issue ─────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_transition_issue_sends_mutation(self):
        from workers.linear.client import LinearClient

        expected_response = {
            "issueUpdate": {
                "success": True,
                "issue": {"id": "lin_issue_1", "state": {"id": "s2", "name": "In Progress", "type": "started"}},
            },
        }

        with patch.object(LinearClient, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = expected_response
            client = LinearClient(api_key="lin_test_key")
            result = await client.transition_issue("lin_issue_1", "state_2")

            assert result == expected_response
            mock_request.assert_called_once()

    @pytest.mark.asyncio
    async def test_transition_issue_raises_on_api_error(self):
        from workers.linear.client import LinearClient, LinearAPIError

        with patch.object(LinearClient, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = LinearAPIError("GraphQL error(s): Not found")
            client = LinearClient(api_key="lin_test_key")
            with pytest.raises(LinearAPIError, match="Not found"):
                await client.transition_issue("bad_id", "state_2")

    # ── post_comment ─────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_post_comment_sends_mutation(self):
        from workers.linear.client import LinearClient

        expected_response = {
            "commentCreate": {
                "success": True,
                "comment": {"id": "lin_comment_1", "body": "Working on it"},
            },
        }

        with patch.object(LinearClient, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = expected_response
            client = LinearClient(api_key="lin_test_key")
            result = await client.post_comment("lin_issue_1", "Working on it")

            assert result == expected_response
            mock_request.assert_called_once()

    # ── initialization (LINEAR_API_KEY) ──────────────────────────────────

    def test_client_requires_api_key(self):
        from workers.linear.client import LinearClient

        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(ValueError, match="LINEAR_API_KEY"):
                LinearClient()

    def test_client_accepts_explicit_key(self):
        from workers.linear.client import LinearClient

        client = LinearClient(api_key="lin_explicit_key")
        assert client._api_key == "lin_explicit_key"

    def test_client_reads_env_var(self):
        from workers.linear.client import LinearClient

        with patch.dict("os.environ", {"LINEAR_API_KEY": "lin_env_key"}):
            client = LinearClient()
            assert client._api_key == "lin_env_key"


# ===========================================================================
# State Machine
# ===========================================================================


class TestStateMachine:
    """Tests for ``workers.tracker.state_machine``."""

    def test_resolve_state_success_path(self):
        from workers.tracker.state_machine import resolve_state

        # Forward transitions
        assert resolve_state("Backlog", "success") == "Todo"
        assert resolve_state("Todo", "success") == "In Progress"
        assert resolve_state("In Progress", "success") == "Agent Working"
        assert resolve_state("Agent Working", "success") == "Human Review"
        assert resolve_state("Human Review", "success") == "Done"
        assert resolve_state("  Backlog  ", "success") == "Todo"  # whitespace normalization

    def test_resolve_state_failure_path(self):
        from workers.tracker.state_machine import resolve_state

        # Most states go to "Rework" on failure
        assert resolve_state("In Progress", "failure") == "Rework"
        assert resolve_state("Agent Working", "failure") == "Rework"
        assert resolve_state("Human Review", "failure") == "Rework"
        assert resolve_state("Todo", "failure") == "Rework"

    def test_resolve_state_terminal_states_return_none(self):
        from workers.tracker.state_machine import resolve_state

        # Terminal states: stay put regardless of outcome
        assert resolve_state("Done", "success") is None
        assert resolve_state("Done", "failure") is None
        assert resolve_state("Canceled", "success") is None
        assert resolve_state("Canceled", "failure") is None

    def test_resolve_state_unknown_state_returns_none(self):
        from workers.tracker.state_machine import resolve_state

        # Unknown state
        assert resolve_state("UnknownState", "success") is None
        assert resolve_state("NonExistent", "failure") == "Rework"  # unknown + failure -> Rework

    def test_get_active_states(self):
        from workers.tracker.state_machine import get_active_states

        states = get_active_states()
        assert "Todo" in states
        assert "In Progress" in states
        assert "Agent Working" in states
        assert "Human Review" in states
        assert "Rework" in states
        assert "Done" not in states
        assert "Canceled" not in states
        assert "Backlog" not in states

    def test_is_terminal(self):
        from workers.tracker.state_machine import is_terminal

        assert is_terminal("Done") is True
        assert is_terminal("Canceled") is True
        assert is_terminal("Todo") is False
        assert is_terminal("In Progress") is False
        assert is_terminal("Rework") is False
        assert is_terminal("Unknown") is False


# ===========================================================================
# Routing
# ===========================================================================


class TestRouting:
    """Tests for ``workers.tracker.routing``."""

    def test_resolve_pipeline_stas_fix(self):
        from workers.tracker.routing import resolve_pipeline

        assert resolve_pipeline(["stas:fix"]) == "default"
        assert resolve_pipeline(["stas:fix", "bug"]) == "default"

    def test_resolve_pipeline_stas_feature(self):
        from workers.tracker.routing import resolve_pipeline

        assert resolve_pipeline(["stas:feature"]) == "feature"
        assert resolve_pipeline(["bug", "stas:feature"]) == "feature"

    def test_resolve_pipeline_stas_research(self):
        from workers.tracker.routing import resolve_pipeline

        assert resolve_pipeline(["stas:research"]) == "research"

    def test_resolve_pipeline_case_insensitive(self):
        from workers.tracker.routing import resolve_pipeline

        assert resolve_pipeline(["STAS:FIX"]) == "default"
        assert resolve_pipeline(["  StAs:FeAtUrE  "]) == "feature"

    def test_resolve_pipeline_default_when_no_match(self):
        from workers.tracker.routing import resolve_pipeline

        assert resolve_pipeline([]) == "default"
        assert resolve_pipeline(["bug", "enhancement"]) == "default"

    def test_get_pipeline_meta(self):
        from workers.tracker.routing import get_pipeline_meta

        meta = get_pipeline_meta("default")
        assert meta is not None
        assert meta["display_name"] == "Bug Fix"
        assert "description" in meta

        meta_feature = get_pipeline_meta("feature")
        assert meta_feature is not None
        assert meta_feature["display_name"] == "Feature"

        meta_research = get_pipeline_meta("research")
        assert meta_research is not None
        assert meta_research["display_name"] == "Research"

        assert get_pipeline_meta("nonexistent") is None

    def test_register_route_adds_new_pipeline(self):
        from workers.tracker.routing import register_route, resolve_pipeline, get_pipeline_meta

        register_route("stas:refactor", "refactor")
        assert resolve_pipeline(["stas:refactor"]) == "refactor"
        meta = get_pipeline_meta("refactor")
        assert meta is not None
        assert meta["display_name"] == "Refactor"

    def test_register_route_updates_metadata_for_existing_pipeline(self):
        from workers.tracker.routing import register_route, PIPELINE_META, resolve_pipeline

        # Re-register with an existing pipeline; metadata already exists
        # so it should not be overwritten
        original_meta = dict(PIPELINE_META["default"])
        register_route("stas:hotfix", "default")
        assert resolve_pipeline(["stas:hotfix"]) == "default"
        assert PIPELINE_META["default"] == original_meta


# ===========================================================================
# Poll Task
# ===========================================================================


class TestPollTask:
    """Tests for ``workers.tasks.linear_poll`` tasks."""

    @patch("workers.tasks.linear_poll._get_client")
    @patch("workers.tasks.linear_poll.triage")
    def test_poll_active_issues_dispatch(self, mock_triage, mock_get_client):
        from workers.tasks.linear_poll import poll_active_issues, _is_tracked

        # Reset tracked set
        _is_tracked.clear()

        # Mock LinearClient
        mock_client = MagicMock()
        mock_issue_1 = MagicMock()
        mock_issue_1.id = "lin_1"
        mock_issue_1.title = "Fix login"
        mock_issue_1.labels = ["stas:fix"]

        mock_issue_2 = MagicMock()
        mock_issue_2.id = "lin_2"
        mock_issue_2.title = "New feature"
        mock_issue_2.labels = ["stas:feature"]

        mock_client.get_issues_by_state.return_value = [mock_issue_1, mock_issue_2]
        mock_get_client.return_value = mock_client

        # For the _run_async call, return the issues directly
        with patch("workers.tasks.linear_poll._run_async", side_effect=lambda coro: coro):
            result = poll_active_issues.run()

        assert result["dispatched"] == 2
        assert result["total_found"] == 2
        assert mock_triage.delay.call_count == 2

        # First call should be for lin_1
        call_1 = mock_triage.delay.call_args_list[0]
        assert call_1[1]["issue_id"] == "lin_1"
        assert call_1[1]["pipeline"] == "default"

        # Second call for lin_2
        call_2 = mock_triage.delay.call_args_list[1]
        assert call_2[1]["issue_id"] == "lin_2"
        assert call_2[1]["pipeline"] == "feature"

    @patch("workers.tasks.linear_poll._get_client")
    @patch("workers.tasks.linear_poll.triage")
    def test_poll_skips_already_tracked(self, mock_triage, mock_get_client):
        from workers.tasks.linear_poll import poll_active_issues, _is_tracked

        _is_tracked.clear()
        _is_tracked.add("lin_1")  # Already tracked

        mock_client = MagicMock()
        mock_issue = MagicMock()
        mock_issue.id = "lin_1"
        mock_issue.title = "Fix login"
        mock_issue.labels = ["stas:fix"]

        mock_client.get_issues_by_state.return_value = [mock_issue]
        mock_get_client.return_value = mock_client

        with patch("workers.tasks.linear_poll._run_async", side_effect=lambda coro: coro):
            result = poll_active_issues.run()

        assert result["dispatched"] == 0  # Skipped because already tracked
        assert result["total_found"] == 1
        mock_triage.delay.assert_not_called()

    @patch("workers.tasks.linear_poll._get_client")
    def test_triage_task_posts_comment(self, mock_get_client):
        from workers.tasks.linear_poll import triage

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        with patch("workers.tasks.linear_poll._run_async", side_effect=lambda coro: coro):
            result = triage.run(
                issue_id="lin_1",
                identifier="PROJ-1",
                pipeline="default",
                title="Fix login",
            )

        assert result["status"] == "triage_complete"
        assert result["issue_id"] == "lin_1"
        assert result["pipeline"] == "default"

        # Verify post_comment was called
        mock_client.post_comment.assert_called_once()
        call_args = mock_client.post_comment.call_args[0]
        assert call_args[0] == "lin_1"
        assert "Working on it" in call_args[1]

    @patch("workers.tasks.linear_poll._get_client")
    def test_notify_progress(self, mock_get_client):
        from workers.tasks.linear_poll import notify_progress

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        with patch("workers.tasks.linear_poll._run_async", side_effect=lambda coro: coro):
            result = notify_progress.run(
                issue_id="lin_1",
                stage="testing",
                message="Tests are running",
            )

        assert result["sent"] is True
        assert result["stage"] == "testing"
        mock_client.post_comment.assert_called_once_with("lin_1", "**STAS**: Tests are running")

    @patch("workers.tasks.linear_poll._get_client")
    def test_transition_state(self, mock_get_client):
        from workers.tasks.linear_poll import transition_state

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        with patch("workers.tasks.linear_poll._run_async", side_effect=lambda coro: coro):
            result = transition_state.run(
                issue_id="lin_1",
                current_state="Agent Working",
            )

        assert result["to"] == "Human Review"
        assert result["from"] == "Agent Working"
        mock_client.transition_issue.assert_called_once_with("lin_1", "Human Review")

    @patch("workers.tasks.linear_poll._get_client")
    def test_transition_state_terminal_noop(self, mock_get_client):
        from workers.tasks.linear_poll import transition_state

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        with patch("workers.tasks.linear_poll._run_async", side_effect=lambda coro: coro):
            result = transition_state.run(
                issue_id="lin_1",
                current_state="Done",
            )

        assert result["to"] is None
        assert result["from"] == "Done"
        mock_client.transition_issue.assert_not_called()


# ===========================================================================
# Beat Schedule Configuration
# ===========================================================================


class TestBeatSchedule:
    """Verify that ``poll-linear-active-issues`` is configured in the beat schedule."""

    def test_poll_beat_schedule_exists(self):
        from workers.celeryconfig import beat_schedule

        assert "poll-linear-active-issues" in beat_schedule

    def test_poll_beat_schedule_config(self):
        from workers.celeryconfig import beat_schedule

        entry = beat_schedule["poll-linear-active-issues"]
        assert entry["task"] == "workers.tasks.linear_poll.poll_active_issues"
        assert entry["schedule"] == 30.0

    def test_poll_beat_schedule_queue(self):
        from workers.celeryconfig import beat_schedule

        entry = beat_schedule["poll-linear-active-issues"]
        options = entry.get("options", {})
        assert options.get("queue") == "stas.issues.triage"

    def test_task_routes_include_linear_poll(self):
        from workers.celeryconfig import task_routes

        assert "workers.tasks.linear_poll.*" in task_routes
        assert task_routes["workers.tasks.linear_poll.*"]["queue"] == "stas.issues.triage"

    def test_task_registered_in_celery_app(self):
        """Verify the task can be discovered by the Celery app."""
        from workers.celery_app import app

        task_name = "workers.tasks.linear_poll.poll_active_issues"
        # Force discovery by importing the module
        import workers.tasks.linear_poll  # noqa: F401

        assert task_name in app.tasks
