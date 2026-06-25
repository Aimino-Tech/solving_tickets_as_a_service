"""Tests for the runaway agent config and limit manager."""
from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest


# ---------------------------------------------------------------------------
# Config tests
# ---------------------------------------------------------------------------


class TestRunawayConfig:
    """Tests for workers.runaway.config module constants & get_runaway_config()."""

    def test_get_config_returns_dict(self):
        from workers.runaway.config import get_runaway_config

        cfg = get_runaway_config()
        assert isinstance(cfg, dict)
        assert "bullmq" in cfg
        assert "supervisor" in cfg
        assert "opentelemetry" in cfg
        assert "redis" in cfg

    def test_bullmq_defaults(self):
        from workers.runaway.config import get_runaway_config

        cfg = get_runaway_config()
        b = cfg["bullmq"]
        assert b["default_max_attempts"] == 5
        assert b["job_timeout_seconds"] == 600
        assert b["stalled_interval_seconds"] == 45
        assert b["worker_concurrency"] == 4
        assert b["drain_delay_seconds"] == 5

    def test_supervisor_defaults(self):
        from workers.runaway.config import get_runaway_config

        cfg = get_runaway_config()
        s = cfg["supervisor"]
        assert s["max_restarts"] == 3
        assert s["restart_window_seconds"] == 60
        assert s["restart_delay_seconds"] == 5
        assert s["priority_agent"] == 100
        assert s["priority_housekeeping"] == 200
        assert s["autostart"] is True

    def test_opentelemetry_defaults(self):
        from workers.runaway.config import get_runaway_config

        cfg = get_runaway_config()
        o = cfg["opentelemetry"]
        assert o["exporter_otlp_endpoint"] == ""
        assert o["service_name"] == "stas-runaway"
        assert o["traces_sampler_arg"] == 1.0
        assert o["span_name_runaway"] == "stas.runaway.execution"
        assert o["batch_max_queue_size"] == 2048
        assert o["batch_max_export_batch_size"] == 512
        assert o["batch_schedule_delay_ms"] == 5000

    def test_redis_ttl_defaults(self):
        from workers.runaway.config import get_runaway_config

        cfg = get_runaway_config()
        r = cfg["redis"]
        assert r["task_ttl_seconds"] == 7200
        assert r["label_ttl_seconds"] == 86400
        assert r["retry_ttl_seconds"] == 86400
        assert r["turn_lock_ttl_seconds"] == 3600
        assert r["cost_cap_ttl_seconds"] == 86400

    def test_env_overrides(self, monkeypatch):
        monkeypatch.setenv("STAS_BULLMQ_MAX_ATTEMPTS", "10")
        monkeypatch.setenv("STAS_SUPERVISOR_MAX_RESTARTS", "5")
        monkeypatch.setenv("STAS_REDIS_TASK_TTL_SECONDS", "3600")

        import importlib
        import workers.runaway.config as cfg_mod

        importlib.reload(cfg_mod)

        try:
            cfg = cfg_mod.get_runaway_config()
            assert cfg["bullmq"]["default_max_attempts"] == 10
            assert cfg["supervisor"]["max_restarts"] == 5
            assert cfg["redis"]["task_ttl_seconds"] == 3600
        finally:
            # Restore for other tests
            importlib.reload(cfg_mod)

    def test_supervisor_autostart_false(self, monkeypatch):
        monkeypatch.setenv("STAS_SUPERVISOR_AUTOSTART", "false")

        import importlib
        import workers.runaway.config as cfg_mod

        importlib.reload(cfg_mod)
        try:
            cfg = cfg_mod.get_runaway_config()
            assert cfg["supervisor"]["autostart"] is False
        finally:
            importlib.reload(cfg_mod)

    def test_modules_importable(self):
        from workers.runaway import config, limits

        assert config is not None
        assert limits is not None

    def test_otel_sampler_arg_float(self, monkeypatch):
        monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", "0.25")

        import importlib
        import workers.runaway.config as cfg_mod

        importlib.reload(cfg_mod)
        try:
            cfg = cfg_mod.get_runaway_config()
            assert cfg["opentelemetry"]["traces_sampler_arg"] == 0.25
        finally:
            importlib.reload(cfg_mod)


# ---------------------------------------------------------------------------
# LimitManager tests
# ---------------------------------------------------------------------------


def _make_mem_redis():
    """Return a MagicMock that behaves like a minimal in-memory Redis."""
    s: dict[str, str] = {}

    m = MagicMock()
    m.get.side_effect = lambda k: s.get(k)
    m.set.side_effect = lambda k, v: s.__setitem__(k, v)
    m.setex.side_effect = lambda k, t, v: s.__setitem__(k, v)
    m.delete.side_effect = lambda k: s.pop(k, None) is not None
    m.incr.side_effect = lambda k: _incr(s, k, 1)
    m.expire.return_value = True
    m.ping.return_value = True

    # set with nx=True, ex=ttl
    def _set_nx(key, value, **kw):
        if kw.get("nx") and key in s:
            return False
        s[key] = value
        return True

    m.set.side_effect = _set_nx
    return m


def _incr(store: dict, key: str, amount: int = 1) -> int:
    new_val = int(store.get(key, "0")) + amount
    store[key] = str(new_val)
    return new_val


@pytest.fixture
def lm():
    """LimitManager backed by a mock Redis client."""
    from workers.runaway.limits import LimitManager

    return LimitManager(redis_client=_make_mem_redis())


@pytest.fixture
def lm_no_redis():
    """LimitManager in local-only mode."""
    from workers.runaway.limits import LimitManager

    return LimitManager(redis_enabled=False)


class TestLimitManager:
    def test_acquire_timeout_lock(self, lm):
        assert lm.acquire_timeout_lock("t1") is True
        assert lm.is_timeout_locked("t1") is True

    def test_timeout_lock_dedup(self, lm):
        assert lm.acquire_timeout_lock("t1") is True
        assert lm.acquire_timeout_lock("t1") is False  # already locked

    def test_release_timeout_lock(self, lm):
        lm.acquire_timeout_lock("t1")
        lm.release_timeout_lock("t1")
        assert lm.is_timeout_locked("t1") is False

    def test_increment_turn(self, lm):
        assert lm.increment_turn("s1") == 1
        assert lm.increment_turn("s1") == 2
        assert lm.get_turn_count("s1") == 2

    def test_turn_count_default(self, lm):
        assert lm.get_turn_count("unknown") == 0

    def test_reset_turns(self, lm):
        lm.increment_turn("s1")
        lm.increment_turn("s1")
        lm.reset_turns("s1")
        assert lm.get_turn_count("s1") == 0

    def test_check_turn_limit_not_exceeded(self, lm):
        lm.increment_turn("s1")
        exceeded, reason = lm.check_turn_limit("s1")
        assert exceeded is False
        assert reason == ""

    def test_check_turn_limit_exceeded(self, lm):
        lm._max_turns = 2
        lm.increment_turn("s1")
        lm.increment_turn("s1")
        exceeded, reason = lm.check_turn_limit("s1")
        assert exceeded is True
        assert "exceeded max turns" in reason
        assert "2 >= 2" in reason

    def test_check_turn_limit_with_context(self, lm):
        lm._max_turns = 1
        lm.increment_turn("s1")
        exceeded, reason = lm.check_turn_limit("s1", context="high_cost_session")
        assert exceeded is True
        assert "high_cost_session" in reason

    def test_max_turns_property(self, lm):
        assert lm.max_turns == 25
        lm._max_turns = 10
        assert lm.max_turns == 10

    def test_is_cost_capped(self, lm):
        assert lm.is_cost_capped("t1", 5.0, 10.0) is False
        assert lm.is_cost_capped("t1", 12.0, 10.0) is True

    def test_acquire_cost_kill_lock(self, lm):
        assert lm.acquire_cost_kill_lock("t1") is True
        assert lm.acquire_cost_kill_lock("t1") is False  # dedup

    def test_release_cost_kill_lock(self, lm):
        lm.acquire_cost_kill_lock("t1")
        lm.release_cost_kill_lock("t1")
        assert lm.acquire_cost_kill_lock("t1") is True

    def test_trigger_cost_kill_acquires_lock(self, lm):
        assert lm.trigger_cost_kill("t1", reason="budget_exhausted") is True

    def test_trigger_cost_kill_dedup(self, lm):
        assert lm.trigger_cost_kill("t1") is True
        assert lm.trigger_cost_kill("t1") is False  # second caller no-ops

    def test_auto_kill_record(self, lm):
        lm.increment_turn("s1")
        kill = lm.auto_kill("s1", reason="max_turns_exceeded")
        assert kill["session_id"] == "s1"
        assert kill["reason"] == "max_turns_exceeded"
        assert kill["turn_count"] == 1
        assert "timestamp_iso" in kill

    def test_auto_kill_default_reason(self, lm):
        kill = lm.auto_kill("s2")
        assert kill["reason"] == "auto_kill"

    def test_cleanup_session(self, lm):
        lm.increment_turn("s1")
        lm.acquire_timeout_lock("t1")
        lm.trigger_cost_kill("t1")
        lm.cleanup_session("s1")
        assert lm.get_turn_count("s1") == 0

    def test_local_fallback(self, lm_no_redis):
        lm_no_redis.acquire_timeout_lock("t1")
        assert lm_no_redis.is_timeout_locked("t1") is True

    def test_local_turn_tracking(self, lm_no_redis):
        assert lm_no_redis.increment_turn("s1") == 1
        assert lm_no_redis.increment_turn("s1") == 2
        assert lm_no_redis.get_turn_count("s1") == 2

    def test_local_cost_kill(self, lm_no_redis):
        assert lm_no_redis.trigger_cost_kill("t1") is True
        assert lm_no_redis.trigger_cost_kill("t1") is False

    def test_local_cleanup(self, lm_no_redis):
        lm_no_redis.increment_turn("s1")
        lm_no_redis.cleanup_session("s1")
        assert lm_no_redis.get_turn_count("s1") == 0

    def test_redis_not_imported_graceful(self):
        """LimitManager should not crash if redis is not installed."""
        import importlib

        # Simulate redis not being available by patching
        import workers.runaway.limits as limits_mod

        original = limits_mod.__dict__.get("_redis_mod", None)
        try:
            lm = limits_mod.LimitManager(redis_enabled=False)
            assert lm.increment_turn("s1") == 1
            assert lm.trigger_cost_kill("t1") is True
        finally:
            pass

    def test_custom_max_turns(self):
        from workers.runaway.limits import LimitManager

        lm = LimitManager(redis_client=_make_mem_redis(), max_turns=5)
        assert lm.max_turns == 5
        for _ in range(5):
            lm.increment_turn("s1")
        exceeded, _ = lm.check_turn_limit("s1")
        assert exceeded is True
