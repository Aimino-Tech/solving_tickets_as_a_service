from __future__ import annotations
from pathlib import Path
import tempfile
from unittest.mock import patch, MagicMock
from app.platforms.linkedin.post import parse_post_file, cmd_post, cmd_list


class TestParsePostFile:
    def test_basic_post(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("Excited to share our new MCP server!\n\nCheck it out at https://example.com")
            path = f.name
        try:
            result = parse_post_file(path)
            assert "Excited to share" in result
            assert "https://example.com" in result
        finally:
            Path(path).unlink()

    def test_strips_frontmatter_and_separator(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("# My Post Title\n\nBody text here\n---\nMore content after separator")
            path = f.name
        try:
            result = parse_post_file(path)
            assert "My Post" not in result
            assert "Body text here" in result
            assert "More content after" not in result
        finally:
            Path(path).unlink()


class TestCmdPost:
    def test_dry_run(self, capsys):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("Dry run test post")
            path = f.name
        try:
            args = MagicMock()
            args.file = path
            args.dry_run = True
            args.article_url = None
            args.visibility = "PUBLIC"
            cmd_post(args)
            captured = capsys.readouterr().out
            assert "[DRY RUN]" in captured
            assert "Dry run test post" in captured
        finally:
            Path(path).unlink()

    @patch("linkedin.post.LinkedInAPIClient")
    def test_post_creates_record(self, mock_client_class):
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_record = MagicMock()
        mock_record.id = "test-123"
        mock_record.status = "pending_approval"
        mock_client.post_content.return_value = mock_record

        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("Real post content")
            path = f.name
        try:
            args = MagicMock()
            args.file = path
            args.dry_run = False
            args.article_url = None
            args.visibility = "PUBLIC"
            cmd_post(args)
            mock_client.post_content.assert_called_once_with(
                commentary="Real post content",
                visibility="PUBLIC",
                article_url=None,
            )
        finally:
            Path(path).unlink()


class TestCmdList:
    @patch("linkedin.post.get_repository")
    def test_list_no_records(self, mock_repo_class, capsys):
        mock_repo = MagicMock()
        mock_repo_class.return_value = mock_repo
        mock_repo.query.return_value = []
        args = MagicMock()
        args.status = "pending_approval"
        cmd_list(args)
        captured = capsys.readouterr().out
        assert "No LinkedIn posts" in captured

    @patch("linkedin.post.get_repository")
    def test_list_with_records(self, mock_repo_class, capsys):
        mock_repo = MagicMock()
        mock_repo_class.return_value = mock_repo
        mock_record = MagicMock()
        mock_record.id = "rec-001"
        mock_record.status = "pending_approval"
        mock_record.content = "Check out our MCP tools!"
        mock_repo.query.return_value = [mock_record]
        args = MagicMock()
        args.status = "pending_approval"
        cmd_list(args)
        captured = capsys.readouterr().out
        assert "rec-001" in captured
        assert "pending_approval" in captured
