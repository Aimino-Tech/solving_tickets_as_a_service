"""Tests for research integration --- augment_plan, generate_search_queries, build_research_context."""

from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest

from workers.plan.research_integration import (
    generate_search_queries,
    augment_plan,
    build_research_context,
    _query_score,
)


class TestGenerateSearchQueries:
    def test_returns_empty_for_empty_body(self):
        assert generate_search_queries("") == []
        assert generate_search_queries("   ") == []
        assert generate_search_queries(None) == []

    def test_extracts_file_paths(self):
        queries = generate_search_queries(
            "The bug is in src/workers/triage.py and tests/test_triage.py"
        )
        assert any("src/workers/triage.py" in q for q in queries)
        assert any("tests/test_triage.py" in q for q in queries)

    def test_extracts_module_paths(self):
        queries = generate_search_queries(
            "Call workers.plan.research_engine.search_codebase directly"
        )
        assert any("workers.plan.research_engine" in q for q in queries)

    def test_extracts_error_types(self):
        queries = generate_search_queries("Raised a KeyError during lookup")
        assert any("KeyError" in q for q in queries)

    def test_extracts_capitalised_terms(self):
        queries = generate_search_queries(
            "The Redis connection to PostgreSQL via Docker Compose failed"
        )
        normalized = [q.lower() for q in queries]
        assert any("redis" in q for q in normalized)
        assert any("postgresql" in q for q in normalized)
        assert any("docker" in q for q in normalized)

    def test_extracts_quoted_strings(self):
        queries = generate_search_queries(
            'Got error "connection refused" when calling the API'
        )
        assert any("connection refused" in q for q in queries)

    def test_respects_max_queries(self):
        body = "src/a.py src/b.py src/c.py src/d.py src/e.py src/f.py"
        queries = generate_search_queries(body, max_queries=3)
        assert len(queries) <= 3

    def test_deduplicates_queries(self):
        body = "src/app.py has a bug in src/app.py"
        queries = generate_search_queries(body, max_queries=10)
        assert len([q for q in queries if q == "src/app.py"]) == 1


class TestAugmentPlan:
    def test_returns_steps_unchanged_structure(self):
        steps = [{"task": "Fix KeyError in src/worker.py", "done": False}]
        with patch("workers.plan.research_integration.search_codebase", return_value=[]), \
             patch("workers.plan.research_integration.search_web", return_value=[]):
            augmented = augment_plan("issue-1", steps)
        assert len(augmented) == 1
        assert augmented[0]["task"] == "Fix KeyError in src/worker.py"
        assert augmented[0]["done"] is False

    def test_adds_research_key_to_each_step(self):
        steps = [
            {"task": "Fix KeyError in src/worker.py", "done": False},
            {"task": "Add Redis cache", "done": False},
        ]
        with patch("workers.plan.research_integration.search_codebase", return_value=[]), \
             patch("workers.plan.research_integration.search_web", return_value=[]):
            augmented = augment_plan("issue-1", steps)
        for step in augmented:
            assert "research" in step
            assert "codebase_results" in step["research"]
            assert "web_results" in step["research"]

    def test_includes_codebase_results(self):
        steps = [{"task": "Fix KeyError in src/worker.py", "done": False}]
        fake_codebase = [
            {"file": "src/main.py", "line": 42, "content": "def bug(): pass"},
        ]
        with patch("workers.plan.research_integration.search_codebase", return_value=fake_codebase), \
             patch("workers.plan.research_integration.search_web", return_value=[]):
            augmented = augment_plan("issue-1", steps)
        assert len(augmented[0]["research"]["codebase_results"]) >= 1
        assert augmented[0]["research"]["codebase_results"][0]["file"] == "src/main.py"

    def test_includes_web_results(self):
        steps = [{"task": "Fix KeyError in src/worker.py", "done": False}]
        fake_web = [
            {"title": "Stack Overflow", "url": "https://example.com", "snippet": "Fix"},
        ]
        with patch("workers.plan.research_integration.search_codebase", return_value=[]), \
             patch("workers.plan.research_integration.search_web", return_value=fake_web):
            augmented = augment_plan("issue-1", steps)
        assert len(augmented[0]["research"]["web_results"]) >= 1
        assert augmented[0]["research"]["web_results"][0]["title"] == "Stack Overflow"

    def test_handles_empty_task_gracefully(self):
        steps = [{"not_a_task": "value"}]
        with patch("workers.plan.research_integration.search_codebase", return_value=[]), \
             patch("workers.plan.research_integration.search_web", return_value=[]):
            augmented = augment_plan("issue-1", steps)
        assert len(augmented) == 1
        assert augmented[0]["research"]["codebase_results"] == []
        assert augmented[0]["research"]["web_results"] == []

    def test_uses_issue_body_for_queries(self):
        steps = [{"task": "Investigate error", "done": False}]
        with patch("workers.plan.research_integration.search_codebase", return_value=[]) as mock_cb, \
             patch("workers.plan.research_integration.search_web", return_value=[]) as mock_web:
            augment_plan("issue-1", steps, issue_body="The KeyError in src/worker.py needs investigation")
            all_cb_calls = [c[0][0] for c in mock_cb.call_args_list]
            all_web_calls = [c[0][0] for c in mock_web.call_args_list]
            all_queries = set(all_cb_calls + all_web_calls)
            assert any("KeyError" in q for q in all_queries) or any(
                "src/worker.py" in q for q in all_queries
            )


class TestBuildResearchContext:
    def test_returns_empty_string_for_no_research(self):
        steps = [{"task": "Step one"}]
        assert build_research_context(steps) == ""

    def test_formats_codebase_results(self):
        steps = [{
            "task": "Fix bug",
            "research": {
                "codebase_results": [{"file": "src/main.py", "line": 10, "content": "def bug(): pass"}],
                "web_results": [],
            },
        }]
        output = build_research_context(steps)
        assert "Fix bug" in output
        assert "src/main.py:10" in output
        assert "def bug(): pass" in output

    def test_formats_web_results(self):
        steps = [{
            "task": "Research topic",
            "research": {
                "codebase_results": [],
                "web_results": [{"title": "Docs", "url": "https://docs.example.com", "snippet": "How to"}],
            },
        }]
        output = build_research_context(steps)
        assert "Research topic" in output
        assert "Docs" in output
        assert "docs.example.com" in output

    def test_truncates_when_exceeding_max_chars(self):
        steps = [{
            "task": "Long task",
            "research": {
                "codebase_results": [{"file": "a.py", "line": 1, "content": "x" * 500}],
                "web_results": [],
            },
        }]
        output = build_research_context(steps, max_chars=50)
        assert output.endswith("... (truncated)")

    def test_skips_steps_with_no_research_key(self):
        steps = [
            {"task": "No research"},
            {"task": "Has research", "research": {
                "codebase_results": [{"file": "a.py", "line": 1, "content": "x"}],
                "web_results": [],
            }},
        ]
        output = build_research_context(steps)
        assert "No research" not in output
        assert "Has research" in output

    def test_skips_steps_with_empty_research(self):
        steps = [{"task": "Empty research", "research": {"codebase_results": [], "web_results": []}}]
        output = build_research_context(steps)
        assert output == ""


class TestQueryScore:
    def test_prefers_shorter_queries(self):
        short_score = _query_score("redis")
        long_score = _query_score("how to configure redis in a containerised environment")
        assert short_score > long_score

    def test_returns_float(self):
        assert isinstance(_query_score("test"), float)
        assert isinstance(_query_score("test error handling"), float)
