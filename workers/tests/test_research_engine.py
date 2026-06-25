"""Tests for research_engine."""
import os, tempfile
from unittest.mock import patch, MagicMock
import httpx
from workers.plan.research_engine import search_codebase, search_web, _is_git_repo, _extract_context

class TestSearchCodebase:
    def test_empty_path(self):
        assert search_codebase("x", repo_path="/nope") == []
    def test_git_finds_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.system(f"git init {tmp} >/dev/null 2>&1")
            assert search_codebase("x", repo_path=tmp) == []
    def test_git_finds_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.system(f"git init {tmp} >/dev/null 2>&1")
            with open(os.path.join(tmp, "a.py"), "w") as f:
                f.write("def foo(): pass\n")
            os.system(f"git -C {tmp} add -A >/dev/null 2>&1")
            os.system(f"git -C {tmp} config user.email t@t.com >/dev/null 2>&1")
            os.system(f"git -C {tmp} config user.name T >/dev/null 2>&1")
            os.system(f"git -C {tmp} commit -m init >/dev/null 2>&1")
            r = search_codebase("foo", repo_path=tmp)
            assert len(r) >= 1
            assert "a.py" in r[0]["file"]
    def test_has_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.system(f"git init {tmp} >/dev/null 2>&1")
            with open(os.path.join(tmp, "a.py"), "w") as f:
                f.write("def run(): pass\n")
            os.system(f"git -C {tmp} add -A >/dev/null 2>&1")
            os.system(f"git -C {tmp} config user.email t@t.com >/dev/null 2>&1")
            os.system(f"git -C {tmp} config user.name T >/dev/null 2>&1")
            os.system(f"git -C {tmp} commit -m init >/dev/null 2>&1")
            r = search_codebase("def run", repo_path=tmp)
            assert len(r) >= 1 and "content" in r[0]
    def test_fallback_grep(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "d.txt"), "w") as f:
                f.write("match\n")
            r = search_codebase("match", repo_path=tmp)
            assert len(r) >= 1

class TestSearchWeb:
    def test_returns_empty_on_http_error(self):
        with patch("workers.plan.research_engine.httpx.Client") as mc:
            mc.return_value.__enter__.return_value.get.side_effect = httpx.HTTPStatusError("x", request=MagicMock(), response=MagicMock())
            assert search_web("q") == []
    def test_parses_ddg_abstract(self):
        resp = MagicMock()
        resp.json.return_value = {"AbstractText": "Python is a language.", "AbstractURL": "https://python.org", "Heading": "Python", "RelatedTopics": []}
        with patch("workers.plan.research_engine.httpx.Client") as mc:
            mc.return_value.__enter__.return_value.get.return_value = resp
            r = search_web("python")
            assert len(r) >= 1 and r[0]["title"] == "Python"
    def test_parses_topics(self):
        resp = MagicMock()
        resp.json.return_value = {"AbstractText": "", "RelatedTopics": [{"Text": "FastAPI - framework", "FirstURL": "https://fastapi.tiangolo.com"}]}
        with patch("workers.plan.research_engine.httpx.Client") as mc:
            mc.return_value.__enter__.return_value.get.return_value = resp
            r = search_web("fastapi")
            assert len(r) == 1

class TestIsGitRepo:
    def test_nonexistent(self): assert _is_git_repo("/nope") is False
    def test_regular_dir(self):
        with tempfile.TemporaryDirectory() as tmp: assert _is_git_repo(tmp) is False
    def test_git_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.system(f"git init {tmp} >/dev/null 2>&1")
            assert _is_git_repo(tmp) is True

class TestExtractContext:
    def test_missing_file(self): assert _extract_context("nope.py", 1, "/tmp") is None
