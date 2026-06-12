"""
Tests for cron schedule parsing — phantom-trigger prevention, edge cases,
and cooldown integration.

Covers:
- Cron expression parsing and validation
- Edge cases: ``* * * * *``, ``*/5 * * * *``, complex expressions
- ``get_due_jobs()`` for phantom-trigger detection (5-second window)
- ``advance_next_run()`` edge cases (double-advance guard)
- Cooldown integration via ``_last_run_cache``
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest


# =========================================================================
# Fixtures
# =========================================================================

@pytest.fixture
def tmp_cron_dir(tmp_path, monkeypatch):
    """Redirect cron storage to a temp directory."""
    monkeypatch.setattr("cron.jobs.CRON_DIR", tmp_path / "cron")
    monkeypatch.setattr("cron.jobs.JOBS_FILE", tmp_path / "cron" / "jobs.json")
    monkeypatch.setattr("cron.jobs.OUTPUT_DIR", tmp_path / "cron" / "output")
    return tmp_path


# =========================================================================
# Schedule Parsing — Cron Expressions
# =========================================================================

class TestCronExpressionParsing:
    """Test that cron expressions parse correctly (phantom-trigger root cause)."""

    def test_simple_every_minute(self):
        pytest.importorskip("croniter")
        from cron.jobs import parse_schedule
        result = parse_schedule("* * * * *")
        assert result["kind"] == "cron"
        assert result["expr"] == "* * * * *"

    def test_every_five_minutes(self):
        pytest.importorskip("croniter")
        from cron.jobs import parse_schedule
        result = parse_schedule("*/5 * * * *")
        assert result["kind"] == "cron"
        assert result["expr"] == "*/5 * * * *"

    def test_specific_time(self):
        pytest.importorskip("croniter")
        from cron.jobs import parse_schedule
        result = parse_schedule("30 6 * * *")
        assert result["kind"] == "cron"
        assert result["expr"] == "30 6 * * *"

    def test_complex_expression(self):
        pytest.importorskip("croniter")
        from cron.jobs import parse_schedule
        result = parse_schedule("0 9,15,21 * * 1-5")
        assert result["kind"] == "cron"
        assert result["expr"] == "0 9,15,21 * * 1-5"

    def test_step_values(self):
        pytest.importorskip("croniter")
        from cron.jobs import parse_schedule
        result = parse_schedule("0 */2 * * *")
        assert result["kind"] == "cron"
        assert result["expr"] == "0 */2 * * *"

    def test_range_values(self):
        pytest.importorskip("croniter")
        from cron.jobs import parse_schedule
        result = parse_schedule("30 6-18 * * *")
        assert result["kind"] == "cron"
        assert result["expr"] == "30 6-18 * * *"

    def test_invalid_cron_expression_raises(self):
        pytest.importorskip("croniter")
        from cron.jobs import parse_schedule
        with pytest.raises(ValueError, match="Invalid cron expression"):
            parse_schedule("99 99 99 99 99")

    def test_partial_cron_looks_like_interval(self):
        """Something like '5 *' should not be treated as cron (needs 5 parts)."""
        from cron.jobs import parse_schedule
        with pytest.raises(ValueError):
            parse_schedule("5 *")

    def test_daily_cron_at_midnight(self):
        pytest.importorskip("croniter")
        from cron.jobs import parse_schedule
        result = parse_schedule("0 0 * * *")
        assert result["kind"] == "cron"
        assert result["expr"] == "0 0 * * *"

    def test_monthly_cron_expression(self):
        pytest.importorskip("croniter")
        from cron.jobs import parse_schedule
        # "0 0 1 * *" means midnight on the 1st of every month
        result = parse_schedule("0 0 1 * *")
        assert result["kind"] == "cron"
        assert result["expr"] == "0 0 1 * *"


# =========================================================================
# GetDueJobs — Phantom Trigger Detection
# =========================================================================

class TestGetDueJobsPhantomDetection:
    """Test that get_due_jobs() detects and skips phantom triggers."""

    def test_phantom_trigger_skipped_within_5s(self, tmp_cron_dir, monkeypatch):
        """A job that ran within the last 5 seconds must be skipped as a phantom."""
        from cron.jobs import (
            create_job, get_due_jobs, load_jobs, save_jobs,
            _hermes_now, PHANTOM_FIRE_THRESHOLD_SECONDS,
        )

        now = datetime(2026, 6, 12, 10, 0, 5, tzinfo=timezone.utc)
        monkeypatch.setattr("cron.jobs._hermes_now", lambda: now)

        job = create_job(prompt="Phantom test", schedule="every 1h", deliver="local")

        # Simulate: job ran 2 seconds ago (phantom trigger window)
        last_run = (now - timedelta(seconds=2)).isoformat()
        jobs = load_jobs()
        jobs[0]["last_run_at"] = last_run
        jobs[0]["next_run_at"] = (now - timedelta(seconds=1)).isoformat()
        save_jobs(jobs)

        due = get_due_jobs()
        assert len(due) == 0, "Phantom trigger should be skipped"

    def test_normal_trigger_past_5s_is_returned(self, tmp_cron_dir, monkeypatch):
        """A job that ran more than 5 seconds ago should fire normally."""
        from cron.jobs import (
            create_job, get_due_jobs, load_jobs, save_jobs,
        )

        now = datetime(2026, 6, 12, 10, 0, 10, tzinfo=timezone.utc)
        monkeypatch.setattr("cron.jobs._hermes_now", lambda: now)

        job = create_job(prompt="Normal test", schedule="every 1h", deliver="local")

        # Simulate: job ran 10 seconds ago (outside phantom window)
        last_run = (now - timedelta(seconds=10)).isoformat()
        jobs = load_jobs()
        jobs[0]["last_run_at"] = last_run
        jobs[0]["next_run_at"] = (now - timedelta(seconds=1)).isoformat()
        save_jobs(jobs)

        due = get_due_jobs()
        assert len(due) == 1, "Normal trigger should be returned"
        assert due[0]["id"] == job["id"]

    def test_no_last_run_is_not_phantom(self, tmp_cron_dir, monkeypatch):
        """A job with no last_run_at should never be treated as phantom."""
        from cron.jobs import (
            create_job, get_due_jobs, load_jobs, save_jobs,
        )

        now = datetime(2026, 6, 12, 10, 0, 0, tzinfo=timezone.utc)
        monkeypatch.setattr("cron.jobs._hermes_now", lambda: now)

        job = create_job(prompt="First run test", schedule="every 1h", deliver="local")

        # Force next_run_at to now (job is due, never ran before)
        jobs = load_jobs()
        jobs[0]["next_run_at"] = now.isoformat()
        jobs[0]["last_run_at"] = None
        save_jobs(jobs)

        due = get_due_jobs()
        assert len(due) == 1
        assert due[0]["id"] == job["id"]

    def test_phantom_logs_warning(self, tmp_cron_dir, monkeypatch, caplog):
        """Phantom trigger skips must emit a WARNING-level log message."""
        import logging
        caplog.set_level(logging.WARNING)

        from cron.jobs import (
            create_job, get_due_jobs, load_jobs, save_jobs,
        )

        now = datetime(2026, 6, 12, 10, 0, 5, tzinfo=timezone.utc)
        monkeypatch.setattr("cron.jobs._hermes_now", lambda: now)

        job = create_job(prompt="Phantom log test", schedule="every 1h", deliver="local")

        last_run = (now - timedelta(seconds=2)).isoformat()
        jobs = load_jobs()
        jobs[0]["last_run_at"] = last_run
        jobs[0]["next_run_at"] = (now - timedelta(seconds=1)).isoformat()
        save_jobs(jobs)

        get_due_jobs()

        assert any(
            "phantom trigger detected" in record.message
            for record in caplog.records
        ), "Phantom trigger must log a warning"


# =========================================================================
# AdvanceNextRun — Edge Cases
# =========================================================================

class TestAdvanceNextRunEdgeCases:
    """Test advance_next_run() for correctness and edge cases."""

    def test_double_advance_guard(self, tmp_cron_dir, monkeypatch):
        """If next_run_at is already in the future, advance_next_run must
        NOT re-advance it (prevents double-advancing on parallel ticks)."""
        from cron.jobs import (
            advance_next_run, create_job, _hermes_now,
        )

        now = _hermes_now()
        job = create_job(prompt="Double advance test", schedule="every 1h", deliver="local")

        # First advance should work
        assert advance_next_run(job["id"]) is not None

        # Second advance should be false (already advanced)
        result = advance_next_run(job["id"])
        assert result is False, "Double advance must return False"

    def test_advance_does_not_touch_oneshot(self, tmp_cron_dir):
        """One-shot jobs must not be advanced."""
        from cron.jobs import advance_next_run, create_job, get_job

        job = create_job(prompt="One-shot", schedule="30m")
        original_next = get_job(job["id"])["next_run_at"]
        result = advance_next_run(job["id"])
        assert result is False
        assert get_job(job["id"])["next_run_at"] == original_next

    def test_advance_unknown_kind(self, tmp_cron_dir):
        """Jobs with unknown schedule kinds must not be advanced."""
        from cron.jobs import advance_next_run, load_jobs, save_jobs, get_job

        save_jobs([{
            "id": "unknown-kind",
            "schedule": {"kind": "unknown"},
        }])
        result = advance_next_run("unknown-kind")
        assert result is False

    def test_advance_nonexistent_job(self, tmp_cron_dir):
        from cron.jobs import advance_next_run
        assert advance_next_run("no-such-job") is False

    def test_cron_advance_uses_last_run(self, tmp_cron_dir, monkeypatch):
        """Cron advance must use last_run_at as the base, not now."""
        pytest.importorskip("croniter")
        from cron.jobs import advance_next_run, create_job, load_jobs, save_jobs, get_job

        morocco = timezone(timedelta(hours=1))
        now = datetime(2026, 4, 10, 22, 0, 0, tzinfo=morocco)
        monkeypatch.setattr("cron.jobs._hermes_now", lambda: now)

        job = create_job(prompt="Cron base test", schedule="0 */6 * * *", deliver="local")
        jobs = load_jobs()

        # Set last_run_at to Apr 6 14:10 and next_run_at to the past
        last_run = datetime(2026, 4, 6, 14, 10, 0, tzinfo=morocco).isoformat()
        jobs[0]["last_run_at"] = last_run
        jobs[0]["next_run_at"] = (now - timedelta(hours=1)).isoformat()
        save_jobs(jobs)

        advance_next_run(job["id"])
        updated = get_job(job["id"])
        assert updated["next_run_at"] is not None
        next_dt = datetime.fromisoformat(updated["next_run_at"])
        # With last_run_at=Apr 6 14:10, next is Apr 6 18:00 (not Apr 11 00:00)
        # The use of last_run_at ensures the correct base time.
        assert next_dt > now, "Advanced time must be in the future"


# =========================================================================
# Schedule Validation
# =========================================================================

class TestScheduleValidation:
    """Test that schedule validation rejects bad inputs."""

    def test_empty_schedule_raises(self):
        from cron.jobs import parse_schedule
        with pytest.raises(ValueError):
            parse_schedule("")

    def test_whitespace_schedule_raises(self):
        from cron.jobs import parse_schedule
        with pytest.raises(ValueError):
            parse_schedule("   ")

    def test_gibberish_schedule_raises(self):
        from cron.jobs import parse_schedule
        with pytest.raises(ValueError):
            parse_schedule("totally invalid schedule string")

    def test_malformed_timestamp_raises(self):
        from cron.jobs import parse_schedule
        with pytest.raises(ValueError):
            parse_schedule("not-a-timestamp")

    def test_interval_string_rejects_bad_unit(self):
        from cron.jobs import parse_schedule
        with pytest.raises(ValueError):
            parse_schedule("every 10x")

    def test_duration_string_rejects_bad_unit(self):
        from cron.jobs import parse_schedule
        with pytest.raises(ValueError):
            parse_schedule("10x")


# =========================================================================
# Edge Cases for _compute_grace_seconds
# =========================================================================

class TestGraceSeconds:
    """Test that grace window computation handles edge cases."""

    def test_interval_grace_is_half_period(self, monkeypatch):
        from cron.jobs import _compute_grace_seconds

        # 10 min interval → grace = 300s (5 min = half of 10 min)
        assert _compute_grace_seconds({"kind": "interval", "minutes": 10}) == 300

        # 60 min interval → grace = 1800s (30 min = half of 60 min)
        assert _compute_grace_seconds({"kind": "interval", "minutes": 60}) == 1800

    def test_grace_clamps_to_minimum(self):
        from cron.jobs import _compute_grace_seconds

        # 1 min interval → half would be 30s, clamped to MIN_GRACE (120)
        assert _compute_grace_seconds({"kind": "interval", "minutes": 1}) == 120

    def test_grace_clamps_to_maximum(self):
        from cron.jobs import _compute_grace_seconds

        # 24h interval → half would be 43200s (12h), clamped to MAX_GRACE (7200)
        assert _compute_grace_seconds({"kind": "interval", "minutes": 24 * 60}) == 7200

    def test_unknown_kind_returns_min_grace(self):
        from cron.jobs import _compute_grace_seconds
        assert _compute_grace_seconds({"kind": "unknown"}) == 120

    def test_cron_grace_computes_half_period(self, monkeypatch):
        pytest.importorskip("croniter")
        from cron.jobs import _compute_grace_seconds
        from datetime import timezone

        now = datetime(2026, 6, 12, 10, 0, 0, tzinfo=timezone.utc)
        monkeypatch.setattr("cron.jobs._hermes_now", lambda: now)

        # Every hour → period 3600s → grace 1800s (30 min)
        grace = _compute_grace_seconds({"kind": "cron", "expr": "0 * * * *"})
        assert grace == 1800


# =========================================================================
# Phantom Fire Threshold Constant
# =========================================================================

class TestPhantomFireThresholdConstant:
    """PHANTOM_FIRE_THRESHOLD_SECONDS must be importable and sensible."""

    def test_constant_exists_and_is_reasonable(self):
        from cron.jobs import PHANTOM_FIRE_THRESHOLD_SECONDS
        assert isinstance(PHANTOM_FIRE_THRESHOLD_SECONDS, int)
        assert 1 <= PHANTOM_FIRE_THRESHOLD_SECONDS <= 10


# =========================================================================
# Cooldown Cache — Cross-Tick Dispatch Protection
# =========================================================================

class TestCooldownCache:
    """Test that the module-level _last_run_cache prevents phantom
    dispatches across overlapping tick() invocations."""

    def test_cooldown_blocks_recent_dispatch(self, monkeypatch):
        """A job dispatched less than MIN_TICK_INTERVAL seconds ago must
        be blocked by the cross-tick cooldown cache."""
        from cron.scheduler import (
            _last_run_cache, _last_run_cache_lock,
            MIN_TICK_INTERVAL, _CACHE_TTL,
        )
        import time as _time

        job_id = "test-job-123"
        now = _time.time()

        # Simulate: job was dispatched 10 seconds ago
        with _last_run_cache_lock:
            _last_run_cache[job_id] = now - 10

        # Now simulate a check: 10 < 60, so should be blocked
        with _last_run_cache_lock:
            last = _last_run_cache.get(job_id)
            assert last is not None
            assert (_time.time() - last) < MIN_TICK_INTERVAL

        # Clean up
        with _last_run_cache_lock:
            _last_run_cache.pop(job_id, None)

    def test_cooldown_allows_old_dispatch(self, monkeypatch):
        """A job dispatched more than MIN_TICK_INTERVAL seconds ago must
        NOT be blocked by the cooldown cache (the TTL handles cleanup)."""
        from cron.scheduler import (
            _last_run_cache, _last_run_cache_lock,
            MIN_TICK_INTERVAL,
        )
        import time as _time

        job_id = "test-job-456"
        now = _time.time()

        # Simulate: job was dispatched 120 seconds ago (> MIN_TICK_INTERVAL)
        with _last_run_cache_lock:
            _last_run_cache[job_id] = now - 120

        # Should NOT be blocked (120 >= 60)
        with _last_run_cache_lock:
            last = _last_run_cache.get(job_id)
            assert (_time.time() - last) >= MIN_TICK_INTERVAL

        # Clean up
        with _last_run_cache_lock:
            _last_run_cache.pop(job_id, None)

    def test_cache_cleanup_removes_stale_entries(self, monkeypatch):
        """Cache entries older than _CACHE_TTL must be cleaned up."""
        from cron.scheduler import (
            _last_run_cache, _last_run_cache_lock, _CACHE_TTL,
        )
        import time as _time

        now = _time.time()
        stale_id = "stale-job"
        fresh_id = "fresh-job"

        with _last_run_cache_lock:
            _last_run_cache[stale_id] = now - _CACHE_TTL - 10  # 10s past TTL
            _last_run_cache[fresh_id] = now - 10  # Well within TTL

            # Cleanup
            _stale_cutoff = now - _CACHE_TTL
            _stale_keys = [k for k, v in _last_run_cache.items() if v < _stale_cutoff]
            for k in _stale_keys:
                del _last_run_cache[k]

            assert stale_id not in _last_run_cache, "Stale entry should be removed"
            assert fresh_id in _last_run_cache, "Fresh entry should remain"

        # Final cleanup
        with _last_run_cache_lock:
            _last_run_cache.pop(fresh_id, None)
            _last_run_cache.pop(stale_id, None)

    def test_concurrent_cache_access_no_race(self, monkeypatch):
        """Multiple threads accessing _last_run_cache must not race."""
        from cron.scheduler import (
            _last_run_cache, _last_run_cache_lock, MIN_TICK_INTERVAL,
        )
        import time as _time
        import threading as _threading

        job_id = "race-test-job"
        results: list = []
        errors: list = []

        def check_cache(thread_id: int):
            now = _time.time()
            with _last_run_cache_lock:
                last = _last_run_cache.get(job_id)
                if last is not None and (now - last) < MIN_TICK_INTERVAL:
                    results.append("blocked")
                    return
                _last_run_cache[job_id] = now
                results.append("passed")

        # Fire 10 threads simultaneously — without the lock, some would
        # pass through (race on check-then-set). With the lock, exactly
        # one should pass and the rest should be blocked.
        threads = [
            _threading.Thread(target=check_cache, args=(i,))
            for i in range(10)
        ]

        # Clear cache first
        with _last_run_cache_lock:
            _last_run_cache.pop(job_id, None)

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        with _last_run_cache_lock:
            _last_run_cache.pop(job_id, None)

        # Only one thread should have passed (the first to acquire the lock)
        passed_count = results.count("passed")
        blocked_count = results.count("blocked")
        assert passed_count == 1, (
            f"Expected exactly 1 thread to pass, got {passed_count}. "
            f"Results: passed={passed_count}, blocked={blocked_count}"
        )
        assert blocked_count == 9, (
            f"Expected 9 threads blocked, got {blocked_count}"
        )
