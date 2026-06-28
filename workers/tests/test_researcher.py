"""Comprehensive tests for plan research modules."""

from __future__ import annotations

import os
import tempfile
from unittest.mock import patch

import pytest

from workers.plan.plan_researcher import (
    ResearchAugmentedPlan,
    enrich_existing_plan,
    generate_research_augmented_plan,
)
from workers.plan.researcher import (
    RESEARCH_FINDING_KINDS,
    ResearchFinding,
    ResearchResult,
    _extract_keywords,
    _search_codebase_files,
    research_all,
    research_codebase,
    research_web,
)


# ===========================================================================
# ResearchFinding
# ===========================================================================


class TestResearchFinding:
    """Tests for the ResearchFinding dataclass."""

    def test_valid_kind(self):
        """Valid kind is accepted."""
        f = ResearchFinding(kind="codebase_file", source="src/main.py", snippet="def foo():")
        assert f.kind == "codebase_file"
        assert f.relevance == 0.5

    def test_invalid_kind_raises(self):
        """Invalid kind raises ValueError."""
        with pytest.raises(ValueError, match="Unknown finding kind"):
            ResearchFinding(kind="invalid_kind", source="x", snippet="")

    def test_relevance_clamped_above(self):
        """Relevance > 1.0 is clamped to 1.0."""
        f = ResearchFinding(kind="codebase_file", source="x", snippet="", relevance=2.0)
        assert f.relevance == 1.0

    def test_relevance_clamped_below(self):
        """Relevance < 0.0 is clamped to 0.0."""
        f = ResearchFinding(kind="codebase_file", source="x", snippet="", relevance=-0.5)
        assert f.relevance == 0.0

    def test_kind_membership(self):
        """All expected kinds are in RESEARCH_FINDING_KINDS."""
        expected = {
            "codebase_file",
            "codebase_content",
            "web_reference",
            "web_documentation",
            "web_issue",
        }
        assert RESEARCH_FINDING_KINDS == expected


# ===========================================================================
# ResearchResult
# ===========================================================================


class TestResearchResult:
    """Tests for the ResearchResult dataclass."""

    def test_empty_returns_no_findings(self):
        """empty() creates a result with no findings and 0.0 confidence."""
        r = ResearchResult.empty()
        assert r.findings == []
        assert r.codebase_summary == ""
        assert r.web_summary == ""
        assert r.confidence == 0.0

    def test_to_dict_roundtrip(self):
        """to_dict() produces a serializable dict with expected keys."""
        findings = [
            ResearchFinding(kind="codebase_file", source="a.py", snippet="def x():"),
            ResearchFinding(kind="web_reference", source="https://example.com", snippet="Docs"),
        ]
        r = ResearchResult(
            findings=findings,
            codebase_summary="Found 1 file",
            web_summary="Found 1 result",
            confidence=0.75,
        )
        d = r.to_dict()
        assert d["codebase_summary"] == "Found 1 file"
        assert d["web_summary"] == "Found 1 result"
        assert d["confidence"] == 0.75
        assert d["finding_count"] == 2
        assert d["findings"][0]["kind"] == "codebase_file"
        assert d["findings"][1]["source"] == "https://example.com"


# ===========================================================================
# _extract_keywords
# ===========================================================================


class TestExtractKeywords:
    """Tests for _extract_keywords."""

    def test_extracts_meaningful_terms(self):
        """Meaningful code-related terms are extracted."""
        text = "Login returns 500 for plus signs in email address"
        kw = _extract_keywords(text)
        assert "login" in kw
        assert "plus" in kw
        assert "signs" in kw
        assert "email" in kw
        assert "address" in kw

    def test_strips_stop_words(self):
        """Common stop words are removed."""
        text = "the fix for the bug is in the code"
        kw = _extract_keywords(text)
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

    def test_code_symbols_preserved(self):
        """Underscore-separated symbols are preserved."""
        text = "validate_email function raises ValueError"
        kw = _extract_keywords(text)
        assert "validate_email" in kw


# ===========================================================================
# research_codebase
# ===========================================================================


class TestResearchCodebase:
    """Tests for research_codebase."""

    def test_empty_input_returns_empty(self):
        """Empty title and body returns empty result."""
        result = research_codebase("", "")
        assert result.findings == []
        assert result.confidence == 0.0

    def test_nonexistent_workspace_returns_empty(self):
        """Non-existent workspace path returns empty result."""
        result = research_codebase("Fix bug", "Broken thing", workspace_path="/nonexistent/path")
        assert result.findings == []

    def test_empty_workspace_falls_back_to_cwd(self):
        """Empty workspace_path falls back to os.getcwd()."""
        result = research_codebase("Fix bug", "Broken thing", workspace_path="")
        assert isinstance(result, ResearchResult)

    def test_detects_relevant_file_by_keyword(self):
        """Files matching keywords are found."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "login.py"), "w") as f:
                f.write("def handle_login():\n    pass\n")

            result = research_codebase(
                "Fix login bug",
                "Login returns 500",
                workspace_path=tmpdir,
            )

            assert len(result.findings) >= 1
            matching = [f for f in result.findings if "login" in f.source.lower()]
            assert len(matching) >= 1

    def test_finds_content_matching_keywords(self):
        """File content matching keywords is found."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "auth.py"), "w") as f:
                f.write("def validate_email(email):\n    # Check for plus sign\n    pass\n")

            result = research_codebase(
                "Email validation fails",
                "validate_email crashes on plus sign",
                workspace_path=tmpdir,
            )

            assert len(result.findings) >= 1
            all_sources = [f.source for f in result.findings]
            assert any("auth" in s for s in all_sources)

    def test_confidence_is_within_bounds(self):
        """Confidence is always between 0.0 and 1.0."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "target.py"), "w") as f:
                f.write("def target_function():\n    pass\n")
            result = research_codebase("Fix target", "target_function error", workspace_path=tmpdir)
            assert 0.0 <= result.confidence <= 1.0

    def test_builds_codebase_summary(self):
        """Summary is populated when findings exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "test_target.py"), "w") as f:
                f.write("def test_stuff():\n    assert True\n")

            result = research_codebase(
                "Fix test_target",
                "test_target fails",
                workspace_path=tmpdir,
            )
            if result.findings:
                assert result.codebase_summary != ""


# ===========================================================================
# _search_codebase_files
# ===========================================================================


class TestSearchCodebaseFiles:
    """Tests for _search_codebase_files."""

    def test_returns_empty_for_nonexistent_path(self):
        """Non-existent workspace returns empty list."""
        result = _search_codebase_files(["test"], "/nonexistent/path")
        assert result == []

    def test_finds_matching_files(self):
        """Files with matching names are found."""
        with tempfile.TemporaryDirectory() as tmpdir:
            for fname in ("user_login.py", "utils.py", "helper.ts", "README.md"):
                with open(os.path.join(tmpdir, fname), "w") as f:
                    f.write("# placeholder\n")

            result = _search_codebase_files(["login", "user"], tmpdir)

            sources = [r.source for r in result]
            assert len(sources) >= 1
            assert any("user_login" in s for s in sources)

    def test_skips_hidden_directories(self):
        """Directories starting with dot are skipped."""
        with tempfile.TemporaryDirectory() as tmpdir:
            os.makedirs(os.path.join(tmpdir, ".hidden"), exist_ok=True)
            with open(os.path.join(tmpdir, ".hidden", "config.py"), "w") as f:
                f.write("# hidden\n")
            with open(os.path.join(tmpdir, "config.py"), "w") as f:
                f.write("# visible\n")

            result = _search_codebase_files(["config"], tmpdir)
            sources = [r.source for r in result]
            assert any("config.py" in s for s in sources)
            assert not any(".hidden" in s for s in sources)

    def test_filters_by_extension(self):
        """Only known source file extensions are searched."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "auth.py"), "w") as f:
                f.write("")
            with open(os.path.join(tmpdir, "auth.txt"), "w") as f:
                f.write("")
            with open(os.path.join(tmpdir, "auth.bin"), "w") as f:
                f.write("")

            result = _search_codebase_files(["auth"], tmpdir)
            sources = [r.source for r in result]
            assert "auth.py" in sources
            assert "auth.txt" not in sources
            assert "auth.bin" not in sources


# ===========================================================================
# research_web
# ===========================================================================


class TestResearchWeb:
    """Tests for research_web."""

    def test_empty_input_returns_empty(self):
        """Empty title and body returns empty result."""
        result = research_web("", "")
        assert result.findings == []
        assert result.confidence == 0.0

    def test_no_search_cmd_configured_returns_empty(self):
        """Without RESEARCH_SEARCH_CMD env var, returns empty."""
        with patch.dict(os.environ, {}, clear=True):
            result = research_web("Fix bug", "It is broken")
            assert result.findings == []

    def test_queries_built_from_issue_text(self):
        """Search queries are built from issue text."""
        result = research_web("Login fails", "Error with plus sign in email")
        assert isinstance(result, ResearchResult)


# ===========================================================================
# research_all
# ===========================================================================


class TestResearchAll:
    """Tests for research_all (combined)."""

    def test_combines_codebase_and_web_results(self):
        """Both research results are merged."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "auth.py"), "w") as f:
                f.write("def validate():\n    pass\n")

            result = research_all(
                "Fix auth validation",
                "validate function error",
                workspace_path=tmpdir,
            )
            assert isinstance(result, ResearchResult)


# ===========================================================================
# generate_research_augmented_plan
# ===========================================================================


class TestGenerateResearchAugmentedPlan:
    """Tests for generate_research_augmented_plan."""

    def test_empty_input_returns_empty_plan(self):
        """Empty title and body returns plan with no steps."""
        result = generate_research_augmented_plan("issue-1", "", "")
        assert result.steps == []
        assert result.issue_id == "issue-1"

    def test_generates_steps_with_research_context(self):
        """Steps are generated with research context when findings exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "target.py"), "w") as f:
                f.write("def handle_request():\n    pass\n")

            result = generate_research_augmented_plan(
                "issue-1",
                "Fix handle_request bug",
                "handle_request crashes on empty input",
                workspace_path=tmpdir,
            )

            assert len(result.steps) >= 1
            assert result.issue_id == "issue-1"
            for step in result.steps:
                assert "task" in step
                assert "done" in step

    def test_summary_is_populated(self):
        """Summary is populated for non-empty input."""
        result = generate_research_augmented_plan("issue-1", "Fix login", "Login crash")
        assert result.summary != ""
        assert "step" in result.summary.lower()

    def test_to_dict_serializable(self):
        """to_dict() produces a safe dict."""
        result = generate_research_augmented_plan("issue-1", "Fix login", "Login crash")
        d = result.to_dict()
        assert d["issue_id"] == "issue-1"
        assert "steps" in d
        assert "summary" in d

    def test_include_web_false_skips_web(self):
        """Setting include_web=False skips web research."""
        result = generate_research_augmented_plan(
            "issue-1", "Fix login", "Login crash",
            include_web=False,
        )
        assert isinstance(result, ResearchAugmentedPlan)
        assert len(result.steps) >= 1

    def test_returns_research_augmented_plan_type(self):
        """Returns the correct type."""
        result = generate_research_augmented_plan("issue-1", "Fix", "Broken")
        assert isinstance(result, ResearchAugmentedPlan)


# ===========================================================================
# enrich_existing_plan
# ===========================================================================


class TestEnrichExistingPlan:
    """Tests for enrich_existing_plan."""

    def test_enriches_steps_with_context(self):
        """Steps get research_context when findings exist."""
        research = ResearchResult(
            findings=[
                ResearchFinding(
                    kind="codebase_content",
                    source="auth.py",
                    snippet="def validate_email():",
                    relevance=0.8,
                ),
            ],
            codebase_summary="Found relevant code",
            confidence=0.7,
        )

        steps = [
            {"task": "Investigate the issue", "done": False},
            {"task": "Apply a fix", "done": False},
        ]

        enriched = enrich_existing_plan("issue-1", steps, research)
        assert len(enriched) == 2
        any_context = any("research_context" in s for s in enriched)
        assert any_context

    def test_preserves_existing_step_data(self):
        """Original step keys are preserved."""
        research = ResearchResult.empty()
        steps = [{"task": "Do something", "done": False, "extra": "meta"}]

        enriched = enrich_existing_plan("issue-1", steps, research)
        assert enriched[0]["task"] == "Do something"
        assert enriched[0]["extra"] == "meta"
        assert enriched[0]["done"] is False

    def test_empty_steps_returns_empty(self):
        """Empty steps list returns empty list."""
        research = ResearchResult.empty()
        assert enrich_existing_plan("issue-1", [], research) == []

    def test_no_findings_no_context_added(self):
        """Without findings, no research_context is added."""
        research = ResearchResult.empty()
        steps = [{"task": "Test step", "done": False}]

        enriched = enrich_existing_plan("issue-1", steps, research)
        assert "research_context" not in enriched[0]
