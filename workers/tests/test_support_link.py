"""Tests for workers.integrations.support_link -- Jira <-> PR bi-directional linking."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from workers.integrations.support_link import (
    JIRA_ISSUE_KEY_PATTERN,
    LinkResult,
    _build_jira_section,
    _extract_jira_keys,
    _post_jira_comment,
    link_pr_to_jira,
)


# ===================================================================
# extract_jira_keys
# ===================================================================


class TestExtractJiraKeys:
    def test_single_key(self):
        assert _extract_jira_keys("PROJ-123") == ["PROJ-123"]

    def test_multiple_keys(self):
        assert _extract_jira_keys("PROJ-123 and STAS-42") == [
            "PROJ-123",
            "STAS-42",
        ]

    def test_key_with_underscore(self):
        assert _extract_jira_keys("TEAM_NAME-7 is fixed") == ["TEAM_NAME-7"]

    def test_no_key(self):
        assert _extract_jira_keys("No issue here") == []

    def test_empty_string(self):
        assert _extract_jira_keys("") == []

    def test_none(self):
        assert _extract_jira_keys(None) == []

    def test_lowercase_prefix_not_matched(self):
        """Only uppercase prefixes should match per Jira conventions."""
        assert _extract_jira_keys("proj-123") == []

    def test_key_in_middle_of_text(self):
        assert _extract_jira_keys("Fix for ABC-99 in the login module") == [
            "ABC-99",
        ]

    def test_key_at_start_of_line(self):
        assert _extract_jira_keys("PROJ-1: Fix the thing") == ["PROJ-1"]

    def test_numeric_only_not_matched(self):
        assert _extract_jira_keys("issue 12345") == []

    def test_deduplicates(self):
        """Extract returns duplicates since regex findall is used."""
        keys = _extract_jira_keys("PROJ-1 and PROJ-1 again")
        assert keys == ["PROJ-1", "PROJ-1"]

    def test_pattern_matches_proj_123(self):
        assert JIRA_ISSUE_KEY_PATTERN.fullmatch("PROJ-123")
        assert JIRA_ISSUE_KEY_PATTERN.fullmatch("STAS-1")
        assert JIRA_ISSUE_KEY_PATTERN.fullmatch("TEAM_NAME-9999")

    def test_pattern_rejects_lowercase(self):
        assert not JIRA_ISSUE_KEY_PATTERN.fullmatch("proj-123")
        assert not JIRA_ISSUE_KEY_PATTERN.fullmatch("123")

    def test_pattern_rejects_no_number(self):
        assert not JIRA_ISSUE_KEY_PATTERN.fullmatch("PROJ-")


# ===================================================================
# build_jira_section
# ===================================================================


class TestBuildJiraSection:
    def test_single_key(self):
        section = _build_jira_section(["PROJ-123"])
        assert "PROJ-123" in section
        assert "/browse/PROJ-123" in section

    def test_multiple_keys(self):
        section = _build_jira_section(["ABC-1", "DEF-2"])
        assert "ABC-1" in section
        assert "DEF-2" in section

    def test_contains_markdown_heading(self):
        section = _build_jira_section(["PROJ-1"])
        assert "###" in section
        assert "Jira Issues" in section

    def test_link_format(self):
        section = _build_jira_section(["PROJ-1"])
        assert "[PROJ-1]" in section


# ===================================================================
# post_jira_comment (unit tests with mocked httpx)
# ===================================================================


class TestPostJiraComment:
    @patch("workers.integrations.support_link.httpx.Client")
    def test_posts_comment_success(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "id": "12345",
            "self": "https://jira/rest/api/3/issue/PROJ-123/comment/12345",
        }
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        auth = httpx.BasicAuth("user@example.com", "token")
        result = _post_jira_comment(
            "PROJ-123", "Fix login", "https://github.com/o/r/pull/42", auth,
        )

        assert result["id"] == "12345"
        mock_client.post.assert_called_once()

        call_args = mock_client.post.call_args
        url = call_args[0][0]
        assert "PROJ-123" in url
        assert "comment" in url
        payload = call_args[1]["json"]
        assert payload["body"]["type"] == "doc"
        text = payload["body"]["content"][0]["content"][0]["text"]
        assert "Pull Request linked to this issue" in text
        assert "Fix login" in text
        assert "https://github.com/o/r/pull/42" in text

    @patch("workers.integrations.support_link.httpx.Client")
    def test_raises_on_http_error(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "404 Not Found",
            request=MagicMock(),
            response=MagicMock(status_code=404),
        )
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        auth = httpx.BasicAuth("user@example.com", "token")
        with pytest.raises(httpx.HTTPStatusError):
            _post_jira_comment("PROJ-999", "Test", "https://pr.url", auth)


# ===================================================================
# link_pr_to_jira (integration-style tests with mocked Jira API)
# ===================================================================


class TestLinkPrToJira:
    def test_no_jira_keys_found(self):
        result = link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/1",
            pr_title="Simple fix",
            pr_body="No references here",
            branch_name="fix/something",
        )
        assert isinstance(result, LinkResult)
        assert result.jira_issue_keys == []
        assert result.comments_posted == []
        assert result.errors == []
        assert result.jira_links_appended is False
        assert result.updated_pr_body == "No references here"

    def test_empty_inputs(self):
        result = link_pr_to_jira(pr_url="https://github.com/o/r/pull/1")
        assert result.jira_issue_keys == []
        assert result.jira_links_appended is False

    def test_extracts_from_title(self):
        result = link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/2",
            pr_title="[PROJ-456] Fix login bug",
            branch_name="fix/something",
        )
        assert "PROJ-456" in result.jira_issue_keys

    def test_extracts_from_branch_name(self):
        result = link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/3",
            pr_title="General fix",
            branch_name="feature/STAS-42-implement",
        )
        assert "STAS-42" in result.jira_issue_keys

    def test_extracts_from_body(self):
        result = link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/4",
            pr_title="Fix",
            pr_body="Closes OPS-7 and resolves INFRA-88",
        )
        assert "OPS-7" in result.jira_issue_keys
        assert "INFRA-88" in result.jira_issue_keys

    def test_deduplicates_keys(self):
        result = link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/5",
            pr_title="PROJ-1: fix",
            pr_body="Also see PROJ-1",
            branch_name="fix/PROJ-1",
        )
        assert result.jira_issue_keys == ["PROJ-1"]

    def test_multiple_unique_keys(self):
        result = link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/6",
            pr_title="ABC-1 and DEF-2",
            pr_body="Also XYZ-3",
        )
        assert result.jira_issue_keys == ["ABC-1", "DEF-2", "XYZ-3"]

    def test_appends_jira_section_to_body(self):
        result = link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/7",
            pr_title="PROJ-789: fix",
            pr_body="Some description here.",
        )
        assert result.jira_links_appended is True
        assert "PROJ-789" in result.updated_pr_body
        assert "/browse/PROJ-789" in result.updated_pr_body
        assert "### Jira Issues" in result.updated_pr_body

    def test_does_not_duplicate_jira_section(self):
        existing_body = (
            "Some description.\n\n"
            "### Jira Issues\n\n"
            "- [PROJ-1](https://domain/browse/PROJ-1)"
        )
        result = link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/8",
            pr_title="PROJ-1: fix",
            pr_body=existing_body,
        )
        assert result.jira_links_appended is False
        assert result.updated_pr_body == existing_body

    def test_skips_jira_comment_when_no_creds(self, monkeypatch: pytest.MonkeyPatch):
        import workers.integrations.support_link as sl

        monkeypatch.setattr(sl, "JIRA_EMAIL", "")
        monkeypatch.setattr(sl, "JIRA_API_TOKEN", "")

        result = sl.link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/9",
            pr_title="PROJ-123: fix",
        )
        assert result.jira_issue_keys == ["PROJ-123"]
        assert result.comments_posted == []
        assert any("credentials" in err.lower() for err in result.errors)
        assert result.jira_links_appended is True

    def test_posts_comment_for_each_key(self, monkeypatch):
        import workers.integrations.support_link as sl

        monkeypatch.setattr(sl, "JIRA_EMAIL", "user@example.com")
        monkeypatch.setattr(sl, "JIRA_API_TOKEN", "token123")
        monkeypatch.setattr(sl, "JIRA_API_BASE", "https://test-domain.atlassian.net")

        with patch.object(sl, "_post_jira_comment") as mock_post:
            mock_post.side_effect = [
                {"id": "c1", "self": ""},
                {"id": "c2", "self": ""},
            ]
            result = sl.link_pr_to_jira(
                pr_url="https://github.com/o/r/pull/10",
                pr_title="ABC-1 and DEF-2: fixes",
            )
        assert mock_post.call_count == 2
        assert len(result.comments_posted) == 2
        assert result.comments_posted[0]["issue_key"] == "ABC-1"
        assert result.comments_posted[1]["issue_key"] == "DEF-2"

    def test_handles_comment_failure_gracefully(self, monkeypatch):
        import workers.integrations.support_link as sl

        monkeypatch.setattr(sl, "JIRA_EMAIL", "user@example.com")
        monkeypatch.setattr(sl, "JIRA_API_TOKEN", "token123")

        with patch.object(sl, "_post_jira_comment") as mock_post:
            mock_post.side_effect = httpx.HTTPStatusError(
                "403 Forbidden",
                request=MagicMock(),
                response=MagicMock(status_code=403),
            )
            result = sl.link_pr_to_jira(
                pr_url="https://github.com/o/r/pull/11",
                pr_title="PROJ-1: fix",
            )

        assert result.comments_posted == []
        assert len(result.errors) == 1
        assert "PROJ-1" in result.errors[0]
        assert result.jira_links_appended is True

    def test_link_result_immutability_pattern(self):
        """LinkResult should work as a regular dataclass."""
        r = LinkResult(pr_url="url", pr_title="title")
        assert r.pr_url == "url"
        assert r.pr_title == "title"
        assert r.jira_issue_keys == []
        assert r.comments_posted == []
        assert r.errors == []


# ===================================================================
# Full pipeline integration (mocked Jira API)
# ===================================================================


class TestFullPipeline:
    @patch("workers.integrations.support_link.httpx.Client")
    def test_happy_path(self, mock_client_cls, monkeypatch):
        import workers.integrations.support_link as sl

        monkeypatch.setattr(sl, "JIRA_EMAIL", "user@example.com")
        monkeypatch.setattr(sl, "JIRA_API_TOKEN", "tk_123")
        monkeypatch.setattr(sl, "JIRA_API_BASE", "https://test-domain.atlassian.net")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"id": "100", "self": ""}
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        result = sl.link_pr_to_jira(
            pr_url="https://github.com/owner/repo/pull/42",
            pr_title="[STAS-77] Add Jira linking",
            pr_body="Implements bi-directional linking",
            branch_name="feature/STAS-77-jira-link",
        )

        assert result.jira_issue_keys == ["STAS-77"]
        assert len(result.comments_posted) == 1
        assert result.comments_posted[0]["issue_key"] == "STAS-77"
        assert result.comments_posted[0]["comment_id"] == "100"
        assert result.jira_links_appended is True
        assert "STAS-77" in result.updated_pr_body
        assert "test-domain.atlassian.net" in result.updated_pr_body

        call_url = mock_client.post.call_args[0][0]
        assert "STAS-77" in call_url
        assert "comment" in call_url

    @patch("workers.integrations.support_link.httpx.Client")
    def test_jira_api_error_non_fatal(self, mock_client_cls, monkeypatch):
        import workers.integrations.support_link as sl

        monkeypatch.setattr(sl, "JIRA_EMAIL", "user@test.com")
        monkeypatch.setattr(sl, "JIRA_API_TOKEN", "tk_999")

        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500 Server Error",
            request=MagicMock(),
            response=MagicMock(status_code=500),
        )
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        result = sl.link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/1",
            pr_title="PROJ-1: fix",
        )

        assert len(result.errors) == 1
        assert "500" in result.errors[0] or "PROJ-1" in result.errors[0]
        assert result.jira_links_appended is True

    def test_no_creds_still_updates_pr_body(self, monkeypatch):
        import workers.integrations.support_link as sl

        monkeypatch.setattr(sl, "JIRA_EMAIL", "")
        monkeypatch.setattr(sl, "JIRA_API_TOKEN", "")

        result = sl.link_pr_to_jira(
            pr_url="https://github.com/o/r/pull/99",
            pr_title="PROJ-999: No creds",
            pr_body="Some body",
        )

        assert result.jira_issue_keys == ["PROJ-999"]
        assert result.jira_links_appended is True
        assert "PROJ-999" in result.updated_pr_body
        assert result.errors != []
