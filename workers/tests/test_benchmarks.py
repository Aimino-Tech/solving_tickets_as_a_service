from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from workers.billing.cost_tracker import (
    CostEntry,
    CostSummary,
    build_cost_summary_line,
    format_cost_for_display,
    get_all_costs,
    get_cost,
    get_summary,
    record_cost,
)


class TestCostEntry:
    def test_minimal_entry(self) -> None:
        entry = CostEntry(run_id="run-001", model_name="test-model")
        assert entry.run_id == "run-001"
        assert entry.model_cost_cents == 0
        assert entry.total_cost_cents == 0

    def test_total_cost_auto_computed(self) -> None:
        entry = CostEntry(
            run_id="run-002", model_name="claude-sonnet",
            model_cost_cents=200, sandbox_cost_cents=50, overhead_cents=30,
        )
        assert entry.total_cost_cents == 280

    def test_total_cost_override(self) -> None:
        entry = CostEntry(
            run_id="run-003", model_name="gpt-5",
            model_cost_cents=300, sandbox_cost_cents=100, overhead_cents=50,
            total_cost_cents=500,
        )
        assert entry.total_cost_cents == 500

    def test_to_dict_roundtrip(self) -> None:
        original = CostEntry(
            run_id="run-004", model_name="test",
            model_cost_cents=150, sandbox_cost_cents=25, overhead_cents=10,
            total_cost_cents=185, duration_seconds=120,
            timestamp="2026-06-01T00:00:00+00:00",
        )
        restored = CostEntry.from_dict(original.to_dict())
        assert restored.run_id == original.run_id
        assert restored.total_cost_cents == original.total_cost_cents

    def test_from_dict_missing_field_defaults(self) -> None:
        entry = CostEntry.from_dict({"run_id": "run-005", "model_name": "test"})
        assert entry.run_id == "run-005"
        assert entry.model_cost_cents == 0


class TestCostPersistence:
    def test_record_cost_stores_entry(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake_redis = MagicMock()
        fake_redis.pipeline.return_value = fake_redis
        fake_redis.execute.return_value = [1, 200, 1]
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: fake_redis)

        entry = CostEntry(run_id="run-010", model_name="claude-sonnet",
                          model_cost_cents=200, sandbox_cost_cents=50,
                          total_cost_cents=250, duration_seconds=90)
        result = record_cost(entry)

        assert result is True
        fake_redis.set.assert_called_once()
        assert "syntaro:cost:run-010" in fake_redis.set.call_args[0][0]
        saved = json.loads(fake_redis.set.call_args[0][1])
        assert saved["total_cost_cents"] == 250

    def test_record_cost_redis_unavailable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: None)
        result = record_cost(CostEntry(run_id="run-011", model_name="test"))
        assert result is False

    def test_get_cost_returns_entry(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake_redis = MagicMock()
        fake_redis.get.return_value = json.dumps({
            "run_id": "run-012", "model_name": "gpt-4",
            "total_cost_cents": 370, "duration_seconds": 60,
            "timestamp": "2026-06-01T00:00:00+00:00",
        })
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: fake_redis)
        entry = get_cost("run-012")
        assert entry is not None
        assert entry.total_cost_cents == 370

    def test_get_cost_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake_redis = MagicMock()
        fake_redis.get.return_value = None
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: fake_redis)
        assert get_cost("run-nonexistent") is None

    def test_get_cost_redis_unavailable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: None)
        assert get_cost("run-013") is None

    def test_get_summary_returns_aggregate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake_redis = MagicMock()
        fake_redis.hgetall.return_value = {
            "total_runs": "10", "total_cost_cents": "3800",
            "last_updated": "2026-06-01T00:00:00+00:00",
        }
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: fake_redis)
        summary = get_summary()
        assert summary.total_runs == 10
        assert summary.total_cost_cents == 3800
        assert summary.avg_cost_cents == 380.0

    def test_get_summary_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake_redis = MagicMock()
        fake_redis.hgetall.return_value = {}
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: fake_redis)
        summary = get_summary()
        assert summary.total_runs == 0

    def test_get_summary_redis_unavailable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: None)
        assert get_summary().total_runs == 0

    def test_get_all_costs_scans_keys(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake_redis = MagicMock()
        fake_redis.scan.return_value = (0, ["syntaro:cost:run-020", "syntaro:cost:run-021"])
        fake_redis.get.side_effect = [
            json.dumps({"run_id": "run-020", "model_name": "test",
                        "total_cost_cents": 100, "duration_seconds": 30,
                        "timestamp": "2026-06-02T00:00:00+00:00"}),
            json.dumps({"run_id": "run-021", "model_name": "test",
                        "total_cost_cents": 200, "duration_seconds": 45,
                        "timestamp": "2026-06-01T00:00:00+00:00"}),
        ]
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: fake_redis)
        entries = get_all_costs()
        assert len(entries) == 2
        assert entries[0].run_id == "run-020"

    def test_get_all_costs_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake_redis = MagicMock()
        fake_redis.scan.return_value = (0, [])
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: fake_redis)
        assert get_all_costs() == []

    def test_record_cost_updates_aggregates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake_redis = MagicMock()
        fake_redis.pipeline.return_value = fake_redis
        fake_redis.execute.return_value = [1, 250, 1]
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", lambda: fake_redis)

        entry = CostEntry(run_id="run-030", model_name="claude-sonnet",
                          model_cost_cents=200, sandbox_cost_cents=50,
                          total_cost_cents=250)
        result = record_cost(entry)
        assert result is True
        fake_redis.hincrby.assert_any_call("syntaro:cost:aggregate", "total_runs", 1)
        fake_redis.hincrby.assert_any_call("syntaro:cost:aggregate", "total_cost_cents", 250)


class TestFormatting:
    def test_format_cost_dollars(self) -> None:
        assert format_cost_for_display(380) == "$3.80"
        assert format_cost_for_display(100) == "$1.00"
        assert format_cost_for_display(0) == "$0.00"

    def test_format_cost_cents(self) -> None:
        assert format_cost_for_display(50) == "¢50"
        assert format_cost_for_display(1) == "¢1"

    def test_build_cost_summary_line(self) -> None:
        line = build_cost_summary_line("run-040", 380, 0.92)
        assert "Verified fix" in line
        assert "$3.80" in line
        assert "92%" in line

    def test_cost_summary_defaults(self) -> None:
        s = CostSummary()
        assert s.total_runs == 0

    def test_cost_summary_to_dict(self) -> None:
        s = CostSummary(total_runs=10, total_cost_cents=3800, avg_cost_cents=380.0)
        d = s.to_dict()
        assert d["total_runs"] == 10
        assert json.dumps(d)


class TestEdgeCases:
    def test_zero_duration(self) -> None:
        entry = CostEntry(run_id="run-050", model_name="test", duration_seconds=0)
        assert entry.duration_seconds == 0

    def test_large_cost_values(self) -> None:
        entry = CostEntry(run_id="run-051", model_name="expensive",
                          model_cost_cents=100_000, sandbox_cost_cents=50_000,
                          total_cost_cents=150_000)
        assert format_cost_for_display(entry.total_cost_cents) == "$1500.00"

    def test_record_cost_failure_non_fatal(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def failing_get():
            raise Exception("Redis connection failed")
        monkeypatch.setattr("workers.billing.cost_tracker._get_redis", failing_get)
        result = record_cost(CostEntry(run_id="run-052", model_name="test"))
        assert result is False
