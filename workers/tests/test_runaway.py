"""Tests for the runaway agent protection."""
from __future__ import annotations
import time
from unittest.mock import MagicMock
import pytest

def _mem_redis():
    s, c = {}, {}
    m = MagicMock()
    m.get.side_effect = lambda k: s.get(k)
    m.set.side_effect = lambda k, v: s.__setitem__(k, v)
    m.setex.side_effect = lambda k, _, v: s.__setitem__(k, v)
    m.delete.side_effect = lambda k: s.pop(k, None) is not None
    m.incr.side_effect = lambda k: s.update({k: str(int(s.get(k, 0)) + 1)}) or int(s[k])
    m.incrby.side_effect = lambda k, a: s.update({k: str(int(s.get(k, 0)) + a)}) or int(s[k])
    m.incrbyfloat.side_effect = lambda k, a: s.update({k: str(float(s.get(k, 0.0)) + a)}) or s[k]
    m.expire.return_value = True
    m.ping.return_value = True
    return m

@pytest.fixture
def g():
    from workers.runaway.guard import RunawayGuard
    return RunawayGuard(redis_client=_mem_redis())

class TestGuard:
    def test_mark_start_and_elapsed(self, g):
        g.mark_start("t1"); assert g.get_elapsed("t1") is not None

    def test_elapsed_unknown(self, g):
        assert g.get_elapsed("x") is None

    def test_mark_complete_clears(self, g):
        g.mark_start("t1"); assert g.get_elapsed("t1") is not None
        g.mark_complete("t1"); assert g.get_elapsed("t1") is None

    def test_timeout_not_exceeded(self, g):
        g.mark_start("t1"); x, r = g.check_timeout("t1", "test", (), {})
        assert x is False

    def test_timeout_exceeded(self, g, monkeypatch):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_TIMEOUT_SECONDS", 1)
        g._redis_set("syntaro:runaway:t1", str(int(time.time()) - 100))
        x, r = g.check_timeout("t1", "test", (), {}); assert x is True

    def test_timeout_labels(self, g, monkeypatch, mocker):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_TIMEOUT_SECONDS", 1)
        ml = mocker.patch("workers.runaway.guard._label_github_issue")
        g._redis_set("syntaro:runaway:t1", str(int(time.time()) - 100))
        g.check_timeout("t1", "test", (), {"repo_full_name": "o/r", "issue_number": 1})
        ml.assert_called_once_with("o/r", 1)

    def test_deduplicate_label(self, g, monkeypatch):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_TIMEOUT_SECONDS", 1)
        g._redis_set("syntaro:runaway:t1", str(int(time.time()) - 100))
        g.check_timeout("t1", "test", (), {"repo_full_name": "o/r", "issue_number": 1})
        assert g._redis_get("syntaro:runaway:labeled:o/r/1") == "1"
        g.check_timeout("t1", "test", (), {"repo_full_name": "o/r", "issue_number": 1})
        assert g._redis_get("syntaro:runaway:labeled:o/r/1") == "1"

    def test_track_tokens(self, g):
        assert g.track_tokens("t1", 150) == 150
        assert g.track_tokens("t1", 50) == 200

    def test_tokens_unknown(self, g): assert g.get_tokens("x") == 0

    def test_token_limit_exceeded(self, g, monkeypatch):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_MAX_TOKENS", 100)
        g.track_tokens("t1", 200); x, r = g.check_token_limit("t1", "test", (), {})
        assert x is True

    def test_token_limit_not_exceeded(self, g):
        g.track_tokens("t1", 50); x, r = g.check_token_limit("t1", "test", (), {})
        assert x is False

    def test_track_cost(self, g):
        assert g.track_cost("t1", 0.05) == 0.05
        assert g.track_cost("t1", 0.03) == 0.08

    def test_cost_unknown(self, g): assert g.get_cost("x") == 0.0

    def test_cost_limit_exceeded(self, g, monkeypatch):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_MAX_COST", "0.1")
        g.track_cost("t1", 5.0); x, r = g.check_cost_limit("t1", "test", (), {})
        assert x is True

    def test_retries(self, g):
        assert g.get_retry_count("s1") == 0
        assert g.increment_retry("s1") == 1
        assert g.increment_retry("s1") == 2
        g.reset_retries("s1"); assert g.get_retry_count("s1") == 0

    def test_retry_limit_exceeded(self, g):
        for _ in range(3): g.increment_retry("s1")
        x, r = g.check_retries("s1", "test", (), {}, max_retries=3)
        assert x is True

    def test_retry_limit_not_exceeded(self, g):
        g.increment_retry("s1"); x, r = g.check_retries("s1", "test", (), {})
        assert x is False

    def test_check_all_timeout_first(self, g, monkeypatch):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_TIMEOUT_SECONDS", 1)
        g._redis_set("syntaro:runaway:t1", str(int(time.time()) - 100))
        g.track_tokens("t1", 999999)
        x, r = g.check_all("t1", "test", (), {}); assert x is True

    def test_check_all_token_limit(self, g, monkeypatch):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_MAX_TOKENS", 100)
        g.mark_start("t1"); g.track_tokens("t1", 500)
        x, r = g.check_all("t1", "test", (), {}); assert x is True

    def test_check_all_passes(self, g):
        g.mark_start("t1"); g.track_tokens("t1", 100); g.track_cost("t1", 0.01)
        x, r = g.check_all("t1", "test", (), {}); assert x is False

    def test_tier_default(self, g): assert g.get_tier(None) == "free"
    def test_tier_env(self, g, monkeypatch):
        monkeypatch.setenv("SYNTARO_DEFAULT_TIER", "pro"); assert g.get_tier() == "pro"

    def test_tier_limits(self, g, monkeypatch):
        monkeypatch.setenv("SYNTARO_RUNAWAY_TIER_LIMITS", "free=300,50000,5.0;pro=600,100000,10.0")
        import importlib, workers.runaway.guard as gg
        importlib.reload(gg)
        g2 = gg.RunawayGuard(redis_client=_mem_redis())
        assert g2.get_limits_for_tier("free")["timeout_seconds"] == 300
        assert g2.get_limits_for_tier("free")["max_cost"] == 5.0
        assert g2.get_limits_for_tier("pro")["timeout_seconds"] == 600

    def test_redis_basic(self):
        from workers.runaway.guard import RunawayGuard
        mr = _mem_redis(); gg = RunawayGuard(redis_client=mr)
        gg.mark_start("x")
        assert mr.setex.called
        gg.track_tokens("x", 100); gg.track_cost("x", 0.05)
        gg.mark_complete("x"); assert mr.delete.call_count >= 2

    def test_extract_repo(self):
        from workers.runaway.guard import _extract_repo_and_issue as f
        assert f((), {"repo_full_name": "o/r", "issue_number": 7}) == ("o/r", 7)
        assert f((), {"issue_context": {"repo_full_name": "o/p", "issue_number": 3}}) == ("o/p", 3)
        assert f(({"repo_full_name": "o/r", "issue_number": 99},), {}) == ("o/r", 99)
        assert f((), {}) == (None, None)

    def test_label_github(self, mocker):
        from workers.runaway.guard import _label_github_issue
        mc = MagicMock()
        mocker.patch("workers.github.client.GitHubClient", return_value=mc)
        assert _label_github_issue("o/r", 42) is True
        mc._request.assert_called_once_with("POST", "/repos/o/r/issues/42/labels", json_body={"labels": ["syntaro:timeout"]})

    def test_label_github_fail(self, mocker):
        from workers.runaway.guard import _label_github_issue
        mc = MagicMock(); mc._request.side_effect = Exception("err")
        mocker.patch("workers.github.client.GitHubClient", return_value=mc)
        assert _label_github_issue("o/r", 42) is False


class TestMiddleware:
    def test_is_agent_task(self):
        from workers.runaway.middleware import _is_agent_task as f
        assert f("workers.tasks.agent.dispatch_opencode") is True
        assert f("workers.celery_app.ping") is False

    def test_blocks_timeout(self, mocker):
        from celery.exceptions import Ignore
        from workers.runaway.middleware import _check_runaway_before_task
        mg = MagicMock(); mg.get_elapsed.return_value = None; mg.check_all.return_value = (True, "timeout")
        mocker.patch("workers.runaway.middleware._get_guard", return_value=mg)
        t = MagicMock(); t.name = "workers.tasks.agent.dispatch_opencode"
        with pytest.raises(Ignore): _check_runaway_before_task("tid", t, (), {}, signal_kwargs={})

    def test_allows_within_limits(self, mocker):
        from workers.runaway.middleware import _check_runaway_before_task
        mg = MagicMock(); mg.get_elapsed.return_value = None; mg.check_all.return_value = (False, "")
        mocker.patch("workers.runaway.middleware._get_guard", return_value=mg)
        t = MagicMock(); t.name = "workers.tasks.agent.dispatch_opencode"
        _check_runaway_before_task("tid", t, (), {}, signal_kwargs={})

    def test_allows_periodic(self, mocker):
        from workers.runaway.middleware import _check_runaway_before_task
        mg = mocker.patch("workers.runaway.middleware._get_guard")
        t = MagicMock(); t.name = "workers.celery_app.ping"
        _check_runaway_before_task("tid", t, (), {}, signal_kwargs={})
        mg.assert_not_called()

    def test_cleanup_success(self, mocker):
        from workers.runaway.middleware import _cleanup_after_task
        mg = MagicMock(); mocker.patch("workers.runaway.middleware._get_guard", return_value=mg)
        t = MagicMock(); t.name = "workers.tasks.agent.dispatch_opencode"
        _cleanup_after_task("tid", t, "SUCCESS", signal_kwargs={})
        mg.mark_complete.assert_called_once_with("tid")

    def test_no_cleanup_on_failure(self, mocker):
        from workers.runaway.middleware import _cleanup_after_task
        mg = MagicMock(); mocker.patch("workers.runaway.middleware._get_guard", return_value=mg)
        t = MagicMock(); t.name = "workers.tasks.agent.dispatch_opencode"
        _cleanup_after_task("tid", t, "FAILURE", signal_kwargs={})
        mg.mark_complete.assert_not_called()

    def test_connect(self):
        from workers.runaway.middleware import connect_runaway_middleware
        connect_runaway_middleware()

    def test_modules_importable(self):
        from workers.runaway import guard, middleware
        assert guard is not None and middleware is not None

    def test_singleton(self):
        from workers.runaway.guard import get_runaway_guard
        assert get_runaway_guard() is get_runaway_guard()
