"""Comprehensive tests for research mandate module."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import httpx

import pytest

from workers.plan.research_mandate import (
    SOURCE_KINDS,
    ResearchMandate,
    ResearchSource,
    _build_search_queries,
    _extract_keywords,
    execute_mandate,
    search_github_code,
    search_github_issues,
    search_oss_documentation,
)


# ===========================================================================
# ResearchSource
# ===========================================================================


class TestResearchSource:
    """Tests for the ResearchSource dataclass."""

    def test_valid_kind(self):
        """Valid kind is accepted."""
        s = ResearchSource(kind="github_issue", url="https://github.com/a/b/issues/1", title="Bug")
        assert s.kind == "github_issue"
        assert s.relevance == 0.5

    def test_invalid_kind_raises(self):
        """Invalid kind raises ValueError."""
        with pytest.raises(ValueError, match="Unknown source kind"):
            ResearchSource(kind="invalid_kind", url="x", title="")

    def test_relevance_clamped_above(self):
        """Relevance > 1.0 is clamped to 1.0."""
        s = ResearchSource(kind="github_issue", url="x", title="t", relevance=2.0)
        assert s.relevance == 1.0

    def test_relevance_clamped_below(self):
        """Relevance < 0.0 is clamped to 0.0."""
        s = ResearchSource(kind="github_issue", url="x", title="t", relevance=-0.5)
        assert s.relevance == 0.0

    def test_to_dict(self):
        """to_dict() produces a serializable dict."""
        s = ResearchSource(
            kind="github_pr",
            url="https://github.com/a/b/pull/42",
            title="Fix login",
            summary="Fixes the login crash",
            relevance=0.8,
        )
        d = s.to_dict()
        assert d["kind"] == "github_pr"
        assert d["url"] == "https://github.com/a/b/pull/42"
        assert d["title"] == "Fix login"
        assert d["summary"] == "Fixes the login crash"
        assert d["relevance"] == 0.8

    def test_kind_membership(self):
        """All expected kinds are in SOURCE_KINDS."""
        expected = {
            "github_issue",
            "github_pr",
            "github_code",
            "oss_documentation",
            "oss_repo",
            "web_reference",
        }
        assert SOURCE_KINDS == expected


# ===========================================================================
# ResearchMandate
# ===========================================================================


class TestResearchMandate:
    """Tests for the ResearchMandate dataclass."""

    def test_empty_returns_no_sources(self):
        """empty() creates a mandate with no sources and 0.0 confidence."""
        m = ResearchMandate.empty()
        assert m.sources == []
        assert m.summary == ""
        assert m.confidence == 0.0

    def test_empty_with_title(self):
        """empty() preserves the provided title."""
        m = ResearchMandate.empty(issue_title="Test issue")
        assert m.issue_title == "Test issue"

    def test_to_dict_roundtrip(self):
        """to_dict() produces expected keys."""
        sources = [
            ResearchSource(kind="github_issue", url="https://github.com/a/b/issues/1", title="Bug A"),
            ResearchSource(kind="oss_documentation", url="https://docs.example.com", title="Docs"),
        ]
        m = ResearchMandate(
            issue_title="Test",
            sources=sources,
            summary="Found 2 sources",
            confidence=0.75,
        )
        d = m.to_dict()
        assert d["issue_title"] == "Test"
        assert d["summary"] == "Found 2 sources"
        assert d["confidence"] == 0.75
        assert d["source_count"] == 2
        assert d["sources"][0]["kind"] == "github_issue"
        assert d["sources"][1]["url"] == "https://docs.example.com"
        assert "created_at" in d


# ===========================================================================
# _extract_keywords
# ===========================================================================


class TestExtractKeywords:
    """Tests for _extract_keywords."""

    def test_extracts_meaningful_terms(self):
        """Meaningful code-related terms are extracted."""
        kw = _extract_keywords("Login returns 500 for emails with plus sign")
        assert "login" in kw
        assert "emails" in kw
        assert "plus" in kw
        assert "sign" in kw

    def test_strips_stop_words(self):
        """Common stop words are removed."""
        kw = _extract_keywords("the fix for the bug is in the code")
        assert "the" not in kw
        assert "for" not in kw

    def test_empty_text_returns_empty_list(self):
        """Empty input returns empty list."""
        assert _extract_keywords("") == []

    def test_short_tokens_removed(self):
        """Tokens shorter than 3 characters are removed."""
        kw = _extract_keywords("a is in on at")
        assert all(len(k) >= 3 for k in kw)

    def test_max_keywords_capped(self):
        """At most 10 keywords are returned."""
        text = "one two three four five six seven eight nine ten eleven twelve"
        kw = _extract_keywords(text)
        assert len(kw) <= 10


# ===========================================================================
# _build_search_queries
# ===========================================================================


class TestBuildSearchQueries:
    """Tests for _build_search_queries."""

    def test_builds_primary_query(self):
        """A primary query is built from keywords."""
        queries = _build_search_queries("Login crash", "Email with plus sign fails")
        assert len(queries) >= 1
        assert all(isinstance(q, str) for q in queries)

    def test_empty_input_returns_empty(self):
        """Empty title and body returns empty list."""
        assert _build_search_queries("", "") == []

    def test_error_text_adds_fix_queries(self):
        """Error-related text adds 'fix' and 'how to fix' queries."""
        queries = _build_search_queries("App crashes", "500 error on login")
        error_queries = [q for q in queries if q.startswith("fix") or q.startswith("how")]
        assert len(error_queries) >= 1

    def test_python_keyword_adds_python_query(self):
        """Python-related terms add a Python-specific query."""
        queries = _build_search_queries("Django auth fails", "login broken")
        python_queries = [q for q in queries if q.startswith("python")]
        assert len(python_queries) >= 1

    def test_typescript_keyword_adds_query(self):
        """TypeScript-related terms add a TypeScript-specific query."""
        queries = _build_search_queries("React component broken", "useState error")
        ts_queries = [q for q in queries if q.startswith("typescript")]
        assert len(ts_queries) >= 1

    def test_golang_keyword_adds_query(self):
        """Go-related terms add a Go-specific query."""
        queries = _build_search_queries("Gin server panic", "nil pointer")
        go_queries = [q for q in queries if q.startswith("golang")]
        assert len(go_queries) >= 1

    def test_rust_keyword_adds_query(self):
        """Rust-related terms add a Rust-specific query."""
        queries = _build_search_queries("Cargo build fails", "borrow checker")
        rust_queries = [q for q in queries if q.startswith("rust")]
        assert len(rust_queries) >= 1


# ===========================================================================
# search_github_issues
# ===========================================================================


class TestSearchGitHubIssues:
    """Tests for search_github_issues."""

    @pytest.mark.asyncio
    async def test_returns_empty_on_http_error(self):
        """HTTP errors return empty list."""
        with patch("httpx.AsyncClient.get") as mock_get:
            mock_get.side_effect = httpx.HTTPError("Connection error")
            result = await search_github_issues("test query")
            assert result == []

    @pytest.mark.asyncio
    async def test_parses_issue_items(self):
        """Items from GitHub API are parsed into ResearchSource."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "items": [
                {
                    "html_url": "https://github.com/owner/repo/issues/1",
                    "title": "Bug: login crashes",
                    "body": "When email has plus sign the app crashes",
                },
                {
                    "html_url": "https://github.com/owner/repo/pull/42",
                    "title": "Fix login crash",
                    "body": "Fixed the email validation",
                },
            ]
        }

        with patch("httpx.AsyncClient.get", return_value=mock_response):
            result = await search_github_issues("login crash", repo="owner/repo")
            assert len(result) == 2
            assert result[0].kind == "github_issue"
            assert result[0].title == "Bug: login crashes"
            assert result[1].kind == "github_pr"
            assert result[1].title == "Fix login crash"

    @pytest.mark.asyncio
    async def test_respects_max_results(self):
        """Max results limit is respected."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "items": [
                {"html_url": f"https://github.com/a/b/issues/{i}", "title": f"Issue {i}", "body": ""}
                for i in range(20)
            ]
        }

        with patch("httpx.AsyncClient.get", return_value=mock_response):
            result = await search_github_issues("test", max_results=3)
            assert len(result) <= 3

    @pytest.mark.asyncio
    async def test_empty_response_handled(self):
        """Empty items list returns empty sources."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"items": []}

        with patch("httpx.AsyncClient.get", return_value=mock_response):
            result = await search_github_issues("test")
            assert result == []


# ===========================================================================
# search_github_code
# ===========================================================================


class TestSearchGitHubCode:
    """Tests for search_github_code."""

    @pytest.mark.asyncio
    async def test_returns_empty_without_token(self):
        """Without GITHUB_TOKEN, returns empty list."""
        with patch.dict(os.environ, {}, clear=True):
            result = await search_github_code("test query")
            assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_http_error(self):
        """HTTP errors return empty list."""
        with patch.dict(os.environ, {"GITHUB_TOKEN": "test-token"}):
            with patch("httpx.AsyncClient.get") as mock_get:
                mock_get.side_effect = httpx.HTTPError("Connection error")
                result = await search_github_code("test query")
                assert result == []

    @pytest.mark.asyncio
    async def test_parses_code_items(self):
        """Items from GitHub code search are parsed correctly."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "items": [
                {
                    "path": "src/auth/login.py",
                    "html_url": "https://github.com/owner/repo/blob/main/src/auth/login.py",
                    "repository": {"full_name": "owner/repo"},
                },
            ]
        }

        with patch.dict(os.environ, {"GITHUB_TOKEN": "test-token"}):
            with patch("httpx.AsyncClient.get", return_value=mock_response):
                result = await search_github_code("login")
                assert len(result) == 1
                assert result[0].kind == "github_code"
                assert "login.py" in result[0].title


# ===========================================================================
# search_oss_documentation
# ===========================================================================


class TestSearchOSSDocumentation:
    """Tests for search_oss_documentation."""

    @pytest.mark.asyncio
    async def test_returns_empty_on_http_error(self):
        """HTTP errors return empty list."""
        with patch("httpx.AsyncClient.get") as mock_get:
            mock_get.side_effect = httpx.HTTPError("Connection error")
            result = await search_oss_documentation("test")
            assert result == []

    @pytest.mark.asyncio
    async def test_parses_abstract_and_topics(self):
        """Abstract and related topics from DuckDuckGo are parsed."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "AbstractText": "Python validation library documentation",
            "AbstractURL": "https://docs.python.org/3/library/validation.html",
            "Heading": "Python Validation",
            "RelatedTopics": [
                {
                    "Text": "Pydantic - Data validation using Python type annotations",
                    "FirstURL": "https://docs.pydantic.dev/latest/",
                },
            ],
        }

        with patch("httpx.AsyncClient.get", return_value=mock_response):
            result = await search_oss_documentation("python validation")
            assert len(result) >= 1
            kinds = {r.kind for r in result}
            assert "oss_documentation" in kinds

    @pytest.mark.asyncio
    async def test_deduplicates_by_url(self):
        """Duplicate URLs are not included."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "AbstractText": "Docs",
            "AbstractURL": "https://docs.example.com",
            "Heading": "Docs",
            "RelatedTopics": [
                {
                    "Text": "More docs",
                    "FirstURL": "https://docs.example.com",
                },
            ],
        }

        with patch("httpx.AsyncClient.get", return_value=mock_response):
            result = await search_oss_documentation("test")
            assert len(result) == 1


# ===========================================================================
# execute_mandate (sync wrapper)
# ===========================================================================


class TestExecuteMandate:
    """Tests for execute_mandate (sync wrapper)."""

    def test_empty_input_returns_empty_mandate(self):
        """Empty title and body returns empty mandate."""
        m = execute_mandate("", "")
        assert m.sources == []
        assert m.confidence == 0.0

    def test_returns_mandate_with_findings(self):
        """Returns a ResearchMandate with sources found."""
        # Mock all async calls to return empty lists
        with patch("workers.plan.research_mandate.search_github_issues", return_value=[]):
            with patch("workers.plan.research_mandate.search_github_code", return_value=[]):
                with patch("workers.plan.research_mandate.search_oss_documentation", return_value=[]):
                    m = execute_mandate(
                        "Login crash",
                        "Email with plus sign crashes",
                        repo="owner/repo",
                    )
                    assert isinstance(m, ResearchMandate)
                    assert m.issue_title == "Login crash"

    def test_execute_mandate_aggregates_sources(self):
        """Multiple search sources are aggregated into one mandate."""
        mock_issues = [
            ResearchSource(kind="github_issue", url="https://github.com/a/b/issues/1", title="Bug"),
        ]
        mock_code = [
            ResearchSource(kind="github_code", url="https://github.com/a/b/blob/main/x.py", title="x.py"),
        ]
        mock_oss = [
            ResearchSource(kind="oss_documentation", url="https://docs.example.com", title="Docs"),
        ]

        with patch("workers.plan.research_mandate.search_github_issues", return_value=mock_issues):
            with patch("workers.plan.research_mandate.search_github_code", return_value=mock_code):
                with patch("workers.plan.research_mandate.search_oss_documentation", return_value=mock_oss):
                    m = execute_mandate("Fix login", "Login broken", repo="owner/repo")

                    assert len(m.sources) == 3
                    assert m.confidence > 0.0
                    assert m.summary != ""

    def test_deduplicates_by_url(self):
        """Duplicate URLs across sources are deduplicated."""
        src = ResearchSource(kind="github_issue", url="https://github.com/a/b/issues/1", title="Same")
        with patch("workers.plan.research_mandate.search_github_issues", return_value=[src]):
            with patch("workers.plan.research_mandate.search_github_code", return_value=[src]):
                with patch("workers.plan.research_mandate.search_oss_documentation", return_value=[]):
                    m = execute_mandate("Fix", "Broken", repo="a/b")
                    assert len(m.sources) == 1

    def test_to_dict_on_mandate(self):
        """execute_mandate result is dict-serializable."""
        with patch("workers.plan.research_mandate.search_github_issues", return_value=[]):
            with patch("workers.plan.research_mandate.search_github_code", return_value=[]):
                with patch("workers.plan.research_mandate.search_oss_documentation", return_value=[]):
                    m = execute_mandate("Test", "Thing", repo="a/b")
                    d = m.to_dict()
                    assert d["issue_title"] == "Test"
                    assert "sources" in d
                    assert "confidence" in d
                    assert "summary" in d
                    assert "source_count" in d
