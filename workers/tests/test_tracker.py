"""Tests for Linear tracker integration — client, state machine, routing, poll."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


# ── State Machine ──────────────────────────────────────────────────────────


class TestStateMachine:
    def test_next_state_advances_through_pipeline(self):
        from workers.tracker.state_machine import next_state

        assert next_state("Backlog") == "Todo"
        assert next_state("Todo") == "In Progress"
        assert next_state("In Progress") == "Human Review"
        assert next_state("Human Review") == "In Review"
        assert next_state("In Review") == "Merge Queue"
        assert next_state("Merge Queue") == "Merging"
        assert next_state("Merging") == "Verified"

    def test_next_state_rework(self):
        from workers.tracker.state_machine import next_state

        assert next_state("In Progress", pipeline_result="rework") == "Rework"

    def test_next_state_fail_returns_none(self):
        from workers.tracker.state_machine import next_state

        assert next_state("In Progress", pipeline_result="fail") is None

    def test_next_state_unknown_returns_none(self):
        from workers.tracker.state_machine import next_state

        assert next_state("UnknownState") is None

    def test_is_terminal(self):
        from workers.tracker.state_machine import is_terminal

        assert is_terminal("Done") is True
        assert is_terminal("Cancelled") is True
        assert is_terminal("Verified") is True
        assert is_terminal("In Progress") is False

    def test_is_active(self):
        from workers.tracker.state_machine import is_active

        assert is_active("Todo") is True
        assert is_active("In Progress") is True
        assert is_active("Human Review") is True
        assert is_active("Done") is False
        assert is_active("Backlog") is False

    def test_previous_state(self):
        from workers.tracker.state_machine import previous_state

        assert previous_state("Todo") == "Backlog"
        assert previous_state("In Progress") == "Todo"
        assert previous_state("Done") is None


# ── Routing ────────────────────────────────────────────────────────────────


class TestRouting:
    def test_classify_pipeline_default(self):
        from workers.tracker.routing import classify_pipeline

        assert classify_pipeline([]) == "default_pipeline"
        assert classify_pipeline(None) == "default_pipeline"

    def test_classify_pipeline_fix(self):
        from workers.tracker.routing import classify_pipeline

        labels = [{"name": "stas:fix"}]
        assert classify_pipeline(labels) == "default_pipeline"

    def test_classify_pipeline_feature(self):
        from workers.tracker.routing import classify_pipeline

        labels = [{"name": "bug"}, {"name": "stas:feature"}]
        assert classify_pipeline(labels) == "feature_pipeline"

    def test_classify_pipeline_research(self):
        from workers.tracker.routing import classify_pipeline

        labels = [{"name": "stas:research"}]
        assert classify_pipeline(labels) == "research_pipeline"

    def test_get_pipeline_stages(self):
        from workers.tracker.routing import get_pipeline_stages

        assert get_pipeline_stages("default_pipeline") == ["triage", "agent", "verify", "self_audit", "review", "pr"]
        assert get_pipeline_stages("research_pipeline") == ["agent", "report"]

    def test_should_skip_stage(self):
        from workers.tracker.routing import should_skip_stage

        assert should_skip_stage("verify", "research_pipeline") is True
        assert should_skip_stage("agent", "research_pipeline") is False
        assert should_skip_stage("verify", "default_pipeline") is False

    def test_extract_label_names_graphql(self):
        from workers.tracker.routing import extract_label_names

        issue = {"labels": {"nodes": [{"name": "stas:fix"}, {"name": "bug"}]}}
        assert extract_label_names(issue) == ["stas:fix", "bug"]

    def test_extract_label_names_flat(self):
        from workers.tracker.routing import extract_label_names

        issue = {"labels": ["stas:fix", "bug"]}
        assert extract_label_names(issue) == ["stas:fix", "bug"]


# ── Linear Client ─────────────────────────────────────────────────────────


class TestLinearClient:
    @patch("workers.linear.client.httpx.Client")
    def test_client_initialization(self, mock_client_class):
        from workers.linear.client import LinearClient

        client = LinearClient(api_key="lin_test_key")
        assert client.api_key == "lin_test_key"
        mock_client_class.assert_called_once()

    @patch("workers.linear.client.httpx.Client")
    def test_get_issues_by_state(self, mock_client_class):
        from workers.linear.client import LinearClient

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "data": {
                "issues": {
                    "nodes": [
                        {"id": "1", "identifier": "PROJ-1", "title": "Test", "state": {"id": "s1", "name": "Todo"}},
                    ]
                }
            }
        }
        mock_response.headers = {"x-ratelimit-remaining": "199", "x-ratelimit-reset": "0"}
        mock_client_instance = MagicMock()
        mock_client_instance.post.return_value = mock_response
        mock_client_class.return_value = mock_client_instance

        client = LinearClient(api_key="lin_test_key")
        issues = client.get_issues_by_state(["Todo"], limit=10)

        assert len(issues) == 1
        assert issues[0]["identifier"] == "PROJ-1"
        mock_client_instance.post.assert_called_once()

    @patch("workers.linear.client.httpx.Client")
    def test_transition_issue(self, mock_client_class):
        from workers.linear.client import LinearClient

        mock_state_response = MagicMock()
        mock_state_response.json.return_value = {
            "data": {"workflowStates": {"nodes": [{"id": "state_123"}]}}
        }
        mock_state_response.headers = {"x-ratelimit-remaining": "199", "x-ratelimit-reset": "0"}

        mock_transition_response = MagicMock()
        mock_transition_response.json.return_value = {
            "data": {"issueUpdate": {"success": True, "issue": {"id": "issue_1", "identifier": "PROJ-1"}}}
        }
        mock_transition_response.headers = {"x-ratelimit-remaining": "198", "x-ratelimit-reset": "0"}

        mock_client_instance = MagicMock()
        mock_client_instance.post.side_effect = [mock_state_response, mock_transition_response]
        mock_client_class.return_value = mock_client_instance

        client = LinearClient(api_key="lin_test_key")
        result = client.transition_issue("issue_1", "In Progress")

        assert result["success"] is True
        assert mock_client_instance.post.call_count == 2

    @patch("workers.linear.client.httpx.Client")
    def test_post_comment(self, mock_client_class):
        from workers.linear.client import LinearClient

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "data": {"commentCreate": {"success": True, "comment": {"id": "comment_1"}}}
        }
        mock_response.headers = {"x-ratelimit-remaining": "199", "x-ratelimit-reset": "0"}
        mock_client_instance = MagicMock()
        mock_client_instance.post.return_value = mock_response
        mock_client_class.return_value = mock_client_instance

        client = LinearClient(api_key="lin_test_key")
        result = client.post_comment("issue_1", "Working on it")

        assert result["success"] is True
        assert result["comment"]["id"] == "comment_1"

    def test_get_client_singleton(self):
        from workers.linear.client import get_client, _client_instance

        _client_instance = None
        with patch("workers.linear.client.LinearClient") as mock_linear:
            client = get_client()
            mock_linear.assert_called_once()


# ── Poll Task ──────────────────────────────────────────────────────────────


class TestPollTask:
    @patch("workers.tasks.linear_poll._get_redis")
    @patch("workers.tasks.linear_poll.get_client")
    def test_poll_active_issues(self, mock_get_client, mock_redis):
        from workers.tasks.linear_poll import poll_active_issues

        mock_linear = MagicMock()
        mock_linear.get_issues_by_state.return_value = [
            {
                "id": "issue_1",
                "identifier": "PROJ-1",
                "title": "Test issue",
                "description": "A test issue",
                "labels": {"nodes": [{"name": "stas:fix"}]},
                "url": "https://linear.app/project/PROJ-1",
            },
        ]
        mock_get_client.return_value = mock_linear

        mock_redis_instance = MagicMock()
        mock_redis_instance.sismember.return_value = False
        mock_redis.return_value = mock_redis_instance

        result = poll_active_issues.run()

        assert result["status"] == "completed"
        assert result["dispatched"] == 1
        assert result["skipped"] == 0
        mock_linear.get_issues_by_state.assert_called_once()

    @patch("workers.tasks.linear_poll._get_redis")
    @patch("workers.tasks.linear_poll.get_client")
    def test_poll_skips_tracked(self, mock_get_client, mock_redis):
        from workers.tasks.linear_poll import poll_active_issues

        mock_linear = MagicMock()
        mock_linear.get_issues_by_state.return_value = [
            {"id": "issue_1", "identifier": "PROJ-1", "title": "Test", "labels": {"nodes": []}},
        ]
        mock_get_client.return_value = mock_linear

        mock_redis_instance = MagicMock()
        mock_redis_instance.sismember.return_value = True
        mock_redis.return_value = mock_redis_instance

        result = poll_active_issues.run()

        assert result["dispatched"] == 0
        assert result["skipped"] == 1

    def test_is_already_tracked_no_redis(self):
        from workers.tasks.linear_poll import is_already_tracked

        with patch("workers.tasks.linear_poll._get_redis", return_value=None):
            assert is_already_tracked("issue_1") is False
