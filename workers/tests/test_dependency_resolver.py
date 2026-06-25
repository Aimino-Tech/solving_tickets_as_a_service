"""Tests for the dependency resolution Celery task."""

from unittest.mock import MagicMock, patch

import pytest

from workers.tasks.dependency_resolver import resolve_dependencies


class TestResolveDependencies:
    """Tests for ``resolve_dependencies`` Celery task."""

    def test_no_blockers(self):
        """When an issue has no blockers, decision is 'dispatch'."""
        result = resolve_dependencies.run(issue_id="linear-issue-1")
        assert result["issue_id"] == "linear-issue-1"
        assert result["blocked"] is False
        assert result["blockers"] == []
        assert result["decision"] == "dispatch"

    def test_no_linear_key_returns_empty(self):
        """When LINEAR_API_KEY is unset, get_blockers returns empty gracefully."""
        result = resolve_dependencies.run(issue_id="linear-issue-abc")
        assert result["blocked"] is False
        assert result["decision"] == "dispatch"

    @patch("workers.tasks.dependency_resolver.LinearClient")
    def test_all_blockers_in_terminal_state(self, mock_client_class):
        """When all blockers are Done/Verified/Canceled, decision is 'dispatch'."""
        mock_client = MagicMock()
        mock_client.get_blockers.return_value = [
            {"id": "blocker-1", "title": "Setup DB", "status": "Done"},
            {"id": "blocker-2", "title": "Write API", "status": "Verified"},
            {"id": "blocker-3", "title": "Fix bug", "status": "Canceled"},
        ]
        mock_client_class.return_value = mock_client

        result = resolve_dependencies.run(issue_id="linear-issue-1")

        assert result["issue_id"] == "linear-issue-1"
        assert result["blocked"] is False
        assert len(result["blockers"]) == 3
        assert result["decision"] == "dispatch"
        mock_client.post_comment.assert_not_called()

    @patch("workers.tasks.dependency_resolver.LinearClient")
    def test_unresolved_blockers_returns_skip(self, mock_client_class):
        """When blockers are active (Todo/In Progress), decision is 'skip'."""
        mock_client = MagicMock()
        mock_client.get_blockers.return_value = [
            {"id": "blocker-1", "title": "Setup DB", "status": "Todo"},
            {"id": "blocker-2", "title": "Write API", "status": "In Progress"},
        ]
        mock_client_class.return_value = mock_client

        result = resolve_dependencies.run(issue_id="linear-issue-2")

        assert result["issue_id"] == "linear-issue-2"
        assert result["blocked"] is True
        assert len(result["blockers"]) == 2
        assert result["decision"] == "skip"
        # Should have posted comments for each blocker
        assert mock_client.post_comment.call_count == 2

    @patch("workers.tasks.dependency_resolver.LinearClient")
    def test_mixed_blockers(self, mock_client_class):
        """Mixed terminal + non-terminal blockers results in 'skip'."""
        mock_client = MagicMock()
        mock_client.get_blockers.return_value = [
            {"id": "blocker-1", "title": "Setup DB", "status": "Done"},
            {"id": "blocker-2", "title": "Write API", "status": "In Progress"},
        ]
        mock_client_class.return_value = mock_client

        result = resolve_dependencies.run(issue_id="linear-issue-3")

        assert result["blocked"] is True
        assert result["decision"] == "skip"
        # Only unresolved blockers returned
        assert len(result["blockers"]) == 1
        assert result["blockers"][0]["id"] == "blocker-2"
        assert mock_client.post_comment.call_count == 1

    @patch("workers.tasks.dependency_resolver.LinearClient")
    def test_api_error_fails_open(self, mock_client_class):
        """When Linear API is unreachable, fail open with decision='dispatch'."""
        mock_client = MagicMock()
        mock_client.get_blockers.side_effect = Exception("Connection refused")
        mock_client_class.return_value = mock_client

        result = resolve_dependencies.run(issue_id="linear-issue-4")

        assert result["issue_id"] == "linear-issue-4"
        assert result["blocked"] is False
        assert result["blockers"] == []
        assert result["decision"] == "dispatch"

    @patch("workers.tasks.dependency_resolver.LinearClient")
    def test_post_comment_failure_does_not_block_decision(self, mock_client_class):
        """If posting a comment fails, the task still returns 'skip'."""
        mock_client = MagicMock()
        mock_client.get_blockers.return_value = [
            {"id": "blocker-1", "title": "Setup DB", "status": "Todo"},
        ]
        # post_comment raises an exception
        mock_client.post_comment.side_effect = Exception("Comment failed")
        mock_client_class.return_value = mock_client

        result = resolve_dependencies.run(issue_id="linear-issue-5")

        assert result["blocked"] is True
        assert result["decision"] == "skip"
        # Comment was attempted (exception caught internally by LinearClient)
        mock_client.post_comment.assert_called_once()

    @patch("workers.tasks.dependency_resolver.LinearClient")
    def test_existing_blockers_resolved_then_dispatch(self, mock_client_class):
        """All blockers in terminal state returns blocked=False, dispatch."""
        mock_client = MagicMock()
        mock_client.get_blockers.return_value = [
            {"id": "blocker-1", "title": "Auth module", "status": "Verified"},
        ]
        mock_client_class.return_value = mock_client

        result = resolve_dependencies.run(issue_id="linear-issue-6")

        assert result["blocked"] is False
        assert result["decision"] == "dispatch"
        assert len(result["blockers"]) == 1

    @patch("workers.tasks.dependency_resolver.LinearClient")
    def test_unknown_status_treated_as_active(self, mock_client_class):
        """Unknown/None status should be treated as unresolved (active)."""
        mock_client = MagicMock()
        mock_client.get_blockers.return_value = [
            {"id": "blocker-1", "title": "Unknown state issue", "status": "Unknown"},
            {"id": "blocker-2", "title": "Null state issue", "status": None},
        ]
        mock_client_class.return_value = mock_client

        result = resolve_dependencies.run(issue_id="linear-issue-7")

        assert result["blocked"] is True
        assert result["decision"] == "skip"
        assert len(result["blockers"]) == 2
        assert mock_client.post_comment.call_count == 2
