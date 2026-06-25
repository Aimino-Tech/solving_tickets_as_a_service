"""Tests for the research engine --- search_codebase and search_web."""

from __future__ import annotations

import os
import tempfile
from unittest.mock import patch, MagicMock

import httpx
import pytest

from workers.plan.research_engine import (
    search_codebase,
    search_web,
    _is_git_repo,
    _extract_context,
)


class TestSearchCodebase:

    def test_returns_empty_when_path_is_not_a_directory(self):
        assert search_codebase("foo", repo_path="/nonexistent/path/xyz") == []

    def test_returns_empty_when_git_grep_finds_nothing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            os.system(f"git init {tmpdir} >/dev/null 2>&1")
            results = search_codebase("nonexistent_symbol", repo_path=tmpdir)
            assert results == []

    def test_finds_text_in_git_repo(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            os.system(f"git init {tmpdir} >/dev/null 2>&1")
            filepath = os.path.join(tmpdir, "hello.py")
            with open(filepath, "w") as f:
                f.write("def greet():\n    print('hello world')\n")
            os.system(f"git -C {tmpdir} add -A >/dev/null 2>&1")
            os.system(f"git -C {tmpdir} config user.email t@t.com >/dev/null 2>&1")
            os.system(f"git -C {tmpdir} config user.name T >/dev/null 2>&1")
            os.system(f"git -C {tmpdir} commit -m init >/dev/null 2>&1")
            results = search_codebase("greet", repo_path=tmpdir)
            assert len(results) >= 1
            assert results[0]["file"].endswith("hello.py")
            assert results[0]["line"] == 1

    def test_includes_content_and_context_by_default(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            os.system(f"git init {tmpdir} >/dev/null 2>&1")
            filepath = os.path.join(tmpdir, "app.py")
            with open(filepath, "w") as f:
                f.write("import os\nimport sys\n\ndef run():\n    pass\n")
            os.system(f"git -C {tmpdir} add -A >/dev/null 2>&1")
            os.system(f"git -C {tmpdir} config user.email t@t.com >/dev/null 2>&1")
            os.system(f"git -C {tmpdir} config user.name T >/dev/null 2>&1")
            os.system(f"git -C {tmpdir} commit -m init >/dev/null 2>&1")
            results = search_codebase("def run", repo_path=tmpdir)
            assert len(results) >= 1
            assert "content" in results[0]
            assert "context" in results[0]

    def test_fallback_grep_when_not_a_git_repo(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            filepath = os.path.join(tmpdir, "data.txt")
            with open(filepath, "w") as f:
                f.write("match this line\n")
            results = search_codebase("match", repo_path=tmpdir)
            assert len(results) >= 1
            assert "data.txt" in results[0]["file"]

    def test_honours_max_results(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            os.system(f"git init {tmpdir} >/dev/null 2>&1")
            for i in range(5):
                fp = os.path.join(tmpdir, f"f{i}.py")
                with open(fp, "w") as f:
                    f.write("common_token\n")
            os.system(f"git -C {tmpdir} add -A >/dev/null 2>&1")
            os.system(f"git -C {tmpdir} config user.email t@t.com >/dev/null 2>&1")
            os.system(f"git -C {tmpdir} config user.name T >/dev/null 2>&1")
            os.system(f"git -C {tmpdir} commit -m init >/dev/null 2>&1")
            results = search_codebase("common_token", repo_path=tmpdir, max_results=2)
            assert len(results) <= 2

    def test_returns_empty_list_when_no_matches(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            results = search_codebase("xyznonexistent", repo_path=tmpdir, max_results=5)
            assert results == []


class TestSearchWeb:

    def test_returns_empty_on_http_error(self):
        with patch("workers.plan.research_engine.httpx.Client") as mock_cls:
            mock_client = MagicMock()
            mock_cls.return_value.__enter__.return_value = mock_client
            mock_client.get.side_effect = httpx.HTTPStatusError(
                "404", request=MagicMock(), response=MagicMock()
            )
            results = search_web("test query")
            assert results == []

    def test_returns_empty_on_request_error(self):
        with patch("workers.plan.research_engine.httpx.Client") as mock_cls:
            mock_client = MagicMock()
            mock_cls.return_value.__enter__.return_value = mock_client
            mock_client.get.side_effect = httpx.RequestError("Connection failed")
            results = search_web("test query")
            assert results == []

    def test_parses_duckduckgo_abstract(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "AbstractText": "Python is a programming language.",
            "AbstractURL": "https://python.org",
            "Heading": "Python",
            "RelatedTopics": [],
        }
        with patch("workers.plan.research_engine.httpx.Client") as mock_cls:
            mock_client = MagicMock()
            mock_cls.return_value.__enter__.return_value = mock_client
            mock_client.get.return_value = mock_response
            results = search_web("python language", max_results=5)
            assert len(results) >= 1
            assert results[0]["title"] == "Python"
            assert results[0]["snippet"] == "Python is a programming language."

    def test_parses_duckduckgo_related_topics(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "AbstractText": "",
            "RelatedTopics": [
                {"Text": "FastAPI - A modern web framework", "FirstURL": "https://fastapi.tiangolo.com"},
                {"Text": "Flask - A micro web framework", "FirstURL": "https://flask.palletsprojects.com"},
            ],
        }
        with patch("workers.plan.research_engine.httpx.Client") as mock_cls:
            mock_client = MagicMock()
            mock_cls.return_value.__enter__.return_value = mock_client
            mock_client.get.return_value = mock_response
            results = search_web("python web framework", max_results=5)
            assert len(results) == 2
            assert results[0]["title"] == "FastAPI"
            assert results[1]["title"] == "Flask"

    def test_honours_max_results_from_related_topics(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "AbstractText": "",
            "RelatedTopics": [
                {"Text": "Result A", "FirstURL": "https://a.com"},
                {"Text": "Result B", "FirstURL": "https://b.com"},
                {"Text": "Result C", "FirstURL": "https://c.com"},
            ],
        }
        with patch("workers.plan.research_engine.httpx.Client") as mock_cls:
            mock_client = MagicMock()
            mock_cls.return_value.__enter__.return_value = mock_client
            mock_client.get.return_value = mock_response
            results = search_web("test", max_results=2)
            assert len(results) == 2

    def test_returns_empty_on_invalid_json(self):
        mock_response = MagicMock()
        mock_response.json.side_effect = ValueError("Invalid JSON")
        with patch("workers.plan.research_engine.httpx.Client") as mock_cls:
            mock_client = MagicMock()
            mock_cls.return_value.__enter__.return_value = mock_client
            mock_client.get.return_value = mock_response
            results = search_web("test")
            assert results == []


class TestIsGitRepo:
    def test_non_existent_path(self):
        assert _is_git_repo("/nonexistent/path") is False

    def test_regular_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            assert _is_git_repo(tmpdir) is False

    def test_git_repo(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            os.system(f"git init {tmpdir} >/dev/null 2>&1")
            assert _is_git_repo(tmpdir) is True


class TestExtractContext:
    def test_returns_none_for_missing_file(self):
        assert _extract_context("nope.py", 1, "/tmp") is None

    def test_returns_snippet(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            fp = os.path.join(tmpdir, "test.py")
            lines = [f"line {i}\n" for i in range(10)]
            with open(fp, "w") as f:
                f.writelines(lines)
            ctx = _extract_context(fp, 5, tmpdir)
            assert ctx is not None
            assert "line 4" in ctx
            assert "line 5" in ctx

    def test_clamps_at_file_boundaries(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            fp = os.path.join(tmpdir, "tiny.py")
            with open(fp, "w") as f:
                f.write("only one line\n")
            ctx = _extract_context(fp, 1, tmpdir)
            assert ctx is not None
            assert "only one line" in ctx
