"""Tests for research_integration."""
from unittest.mock import patch
from workers.plan.research_integration import generate_search_queries, augment_plan, build_research_context, _query_score

class TestGenerateSearchQueries:
    def test_empty(self): assert generate_search_queries("") == []
    def test_file_paths(self):
        q = generate_search_queries("bug in src/worker.py")
        assert any("src/worker.py" in x for x in q)
    def test_error_types(self):
        q = generate_search_queries("Raised KeyError")
        assert any("KeyError" in x for x in q)
    def test_known_terms(self):
        q = generate_search_queries("Redis connection failed")
        assert any("redis" in x.lower() for x in q)
    def test_quoted(self):
        q = generate_search_queries('error "not found"')
        assert any("not found" in x for x in q)
    def test_max_queries(self):
        q = generate_search_queries("src/a.py src/b.py src/c.py src/d.py", max_queries=2)
        assert len(q) <= 2
    def test_dedup(self):
        q = generate_search_queries("src/a.py bug in src/a.py", max_queries=10)
        assert sum(1 for x in q if x == "src/a.py") == 1

class TestAugmentPlan:
    def test_unchanged_structure(self):
        with patch("workers.plan.research_integration.search_codebase", return_value=[]), patch("workers.plan.research_integration.search_web", return_value=[]):
            a = augment_plan("i1", [{"task": "Fix KeyError in src/x.py", "done": False}])
            assert a[0]["task"] == "Fix KeyError in src/x.py"
    def test_adds_research_key(self):
        with patch("workers.plan.research_integration.search_codebase", return_value=[]), patch("workers.plan.research_integration.search_web", return_value=[]):
            a = augment_plan("i1", [{"task": "Fix KeyError in src/x.py"}])
            assert "research" in a[0]
    def test_includes_codebase_results(self):
        with patch("workers.plan.research_integration.search_codebase", return_value=[{"file": "m.py", "line": 1}]), patch("workers.plan.research_integration.search_web", return_value=[]):
            a = augment_plan("i1", [{"task": "Fix KeyError in src/x.py"}])
            assert len(a[0]["research"]["codebase_results"]) >= 1
    def test_includes_web_results(self):
        with patch("workers.plan.research_integration.search_codebase", return_value=[]), patch("workers.plan.research_integration.search_web", return_value=[{"title": "SO"}]):
            a = augment_plan("i1", [{"task": "Fix KeyError in src/x.py"}])
            assert len(a[0]["research"]["web_results"]) >= 1
    def test_empty_task_graceful(self):
        with patch("workers.plan.research_integration.search_codebase", return_value=[]), patch("workers.plan.research_integration.search_web", return_value=[]):
            a = augment_plan("i1", [{"not_a_task": "v"}])
            assert a[0]["research"]["codebase_results"] == []

class TestBuildResearchContext:
    def test_no_research(self): assert build_research_context([{"task": "x"}]) == ""
    def test_formats_codebase(self):
        s = [{"task": "Fix", "research": {"codebase_results": [{"file": "m.py", "line": 1, "content": "x"}], "web_results": []}}]
        o = build_research_context(s)
        assert "Fix" in o and "m.py:1" in o
    def test_formats_web(self):
        s = [{"task": "Docs", "research": {"codebase_results": [], "web_results": [{"title": "Docs", "url": "https://d.e", "snippet": "how"}]}}]
        o = build_research_context(s)
        assert "Docs" in o and "d.e" in o
    def test_truncates(self):
        s = [{"task": "L", "research": {"codebase_results": [{"file": "a.py", "line": 1, "content": "x"*500}], "web_results": []}}]
        assert build_research_context(s, max_chars=50).endswith("... (truncated)")
    def test_skips_no_research_key(self):
        s = [{"task": "No"}, {"task": "Yes", "research": {"codebase_results": [{"file": "a.py", "line": 1, "content": "x"}], "web_results": []}}]
        o = build_research_context(s)
        assert "No" not in o

class TestQueryScore:
    def test_shorter_preferred(self):
        assert _query_score("redis") > _query_score("how to configure redis in a containerised environment")
