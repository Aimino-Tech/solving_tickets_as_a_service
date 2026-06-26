"""Tests for workers.support.escalation — auto-escalation on tenant degradation."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from workers.billing.sla import EscalationLevel, _clear_memory_store

from workers.support.escalation import (
    ESCALATION_CONSECUTIVE_FAILURES_THRESHOLD,
    ESCALATION_CRITICAL_ERROR_RATE,
    ESCALATION_CRITICAL_LATENCY_MS,
    ESCALATION_ERROR_RATE_THRESHOLD,
    ESCALATION_LATENCY_THRESHOLD_MS,
    ESCALATION_QUEUE_DEPTH_THRESHOLD,
    EscalationAction,
    EscalationTrigger,
    TenantDegradationLevel,
    TenantHealthMetric,
    TenantHealthSnapshot,
    acknowledge_escalation,
    check_tenant_health,
    escalate_tenant,
    run_escalation_checks,
    _clear_in_memory_state,
    _evaluate_metrics,
    _is_on_cooldown,
    _map_to_escalation_level,
    _set_cooldown,
)


@pytest.fixture(autouse=True)
def reset_state():
    """Reset in-memory state and SLA memory store before each test."""
    _clear_in_memory_state()
    _clear_memory_store()
    # Reset the SLA tracker singleton
    import workers.billing.sla as sla_module
    sla_module._tracker = None
    yield


# ===================================================================
# TenantDegradationLevel
# ===================================================================


class TestTenantDegradationLevel:
    def test_healthy_value(self):
        assert TenantDegradationLevel.HEALTHY.value == "HEALTHY"

    def test_degraded_value(self):
        assert TenantDegradationLevel.DEGRADED.value == "DEGRADED"

    def test_critical_value(self):
        assert TenantDegradationLevel.CRITICAL.value == "CRITICAL"


# ===================================================================
# EscalationTrigger
# ===================================================================


class TestEscalationTrigger:
    def test_values(self):
        assert EscalationTrigger.ERROR_RATE.value == "ERROR_RATE"
        assert EscalationTrigger.LATENCY.value == "LATENCY"
        assert EscalationTrigger.QUEUE_DEPTH.value == "QUEUE_DEPTH"
        assert EscalationTrigger.CONSECUTIVE_FAILURES.value == "CONSECUTIVE_FAILURES"
        assert EscalationTrigger.RESOURCE_USAGE.value == "RESOURCE_USAGE"
        assert EscalationTrigger.MANUAL.value == "MANUAL"


# ===================================================================
# TenantHealthMetric
# ===================================================================


class TestTenantHealthMetric:
    def test_to_dict_roundtrip(self):
        original = TenantHealthMetric(
            name="error_rate",
            value=0.08,
            threshold=0.05,
            unit="ratio",
            breached=True,
        )
        d = original.to_dict()
        restored = TenantHealthMetric.from_dict(d)
        assert restored.name == original.name
        assert restored.value == original.value
        assert restored.threshold == original.threshold
        assert restored.unit == original.unit
        assert restored.breached == original.breached

    def test_from_dict_empty(self):
        restored = TenantHealthMetric.from_dict({})
        assert restored.name == ""
        assert restored.value == 0.0
        assert restored.breached is False


# ===================================================================
# TenantHealthSnapshot
# ===================================================================


class TestTenantHealthSnapshot:
    def test_healthy_factory(self):
        snap = TenantHealthSnapshot.healthy("tenant-1")
        assert snap.tenant_id == "tenant-1"
        assert snap.level == TenantDegradationLevel.HEALTHY
        assert snap.error_rate == 0.0

    def test_summary_healthy(self):
        snap = TenantHealthSnapshot.healthy("tenant-x")
        summary = snap.summary()
        assert "[HEALTHY]" in summary
        assert "all metrics nominal" in summary

    def test_summary_degraded(self):
        snap = TenantHealthSnapshot(
            tenant_id="tenant-1",
            level=TenantDegradationLevel.DEGRADED,
            error_rate=0.08,
            p95_latency_ms=1500,
            queue_depth=50,
            triggers=[EscalationTrigger.ERROR_RATE],
        )
        summary = snap.summary()
        assert "[DEGRADED]" in summary
        assert "8.0%" in summary or "8.0" in summary
        assert "1500ms" in summary

    def test_summary_critical(self):
        snap = TenantHealthSnapshot(
            tenant_id="tenant-1",
            level=TenantDegradationLevel.CRITICAL,
            error_rate=0.20,
            triggers=[EscalationTrigger.ERROR_RATE],
        )
        summary = snap.summary()
        assert "[CRITICAL]" in summary

    def test_to_dict_roundtrip(self):
        snap = TenantHealthSnapshot(
            tenant_id="tenant-1",
            level=TenantDegradationLevel.DEGRADED,
            error_rate=0.08,
            p95_latency_ms=2500,
            queue_depth=120,
            consecutive_failures=3,
            metrics=[
                TenantHealthMetric(name="error_rate", value=0.08, threshold=0.05, unit="ratio", breached=True),
            ],
            checked_at="2026-06-26T12:00:00",
            triggers=[EscalationTrigger.ERROR_RATE, EscalationTrigger.LATENCY],
        )
        d = snap.to_dict()
        restored = TenantHealthSnapshot.from_dict(d)
        assert restored.tenant_id == snap.tenant_id
        assert restored.level == snap.level
        assert restored.error_rate == snap.error_rate
        assert restored.p95_latency_ms == snap.p95_latency_ms
        assert restored.queue_depth == snap.queue_depth
        assert restored.consecutive_failures == snap.consecutive_failures
        assert len(restored.triggers) == 2
        assert EscalationTrigger.ERROR_RATE in restored.triggers

    def test_from_dict_empty(self):
        restored = TenantHealthSnapshot.from_dict({})
        assert restored.tenant_id == ""
        assert restored.level == TenantDegradationLevel.HEALTHY

    def test_from_dict_invalid_level_falls_back(self):
        restored = TenantHealthSnapshot.from_dict({"level": "UNKNOWN"})
        assert restored.level == TenantDegradationLevel.HEALTHY


# ===================================================================
# EscalationAction
# ===================================================================


class TestEscalationAction:
    def test_fallback(self):
        fb = EscalationAction.fallback()
        assert fb.escalation_level == EscalationLevel.L1_AUTO
        assert "unexpected error" in fb.reason

    def test_to_dict_roundtrip(self):
        action = EscalationAction(
            tenant_id="tenant-1",
            escalation_level=EscalationLevel.L2_HUMAN,
            reason="error rate too high",
            trigger=EscalationTrigger.ERROR_RATE,
            degraded_at="2026-06-26T12:00:00",
            escalated_at="2026-06-26T12:01:00",
            acknowledged=False,
        )
        d = action.to_dict()
        restored = EscalationAction.from_dict(d)
        assert restored.tenant_id == action.tenant_id
        assert restored.escalation_level == action.escalation_level
        assert restored.reason == action.reason
        assert restored.trigger == action.trigger
        assert restored.escalated_at == action.escalated_at

    def test_from_dict_empty(self):
        restored = EscalationAction.from_dict({})
        assert restored.escalation_level == EscalationLevel.L1_AUTO
        assert restored.trigger == EscalationTrigger.MANUAL


# ===================================================================
# _evaluate_metrics
# ===================================================================


class TestEvaluateMetrics:
    def test_healthy_all_nominal(self):
        snap = _evaluate_metrics("t1", 0.01, 100, 5, 0)
        assert snap.level == TenantDegradationLevel.HEALTHY
        assert snap.triggers == []

    def test_degraded_high_error_rate(self):
        snap = _evaluate_metrics("t1", ESCALATION_ERROR_RATE_THRESHOLD + 0.01, 100, 0, 0)
        assert snap.level == TenantDegradationLevel.DEGRADED
        assert EscalationTrigger.ERROR_RATE in snap.triggers

    def test_degraded_high_latency(self):
        snap = _evaluate_metrics("t1", 0.01, ESCALATION_LATENCY_THRESHOLD_MS + 100, 0, 0)
        assert snap.level == TenantDegradationLevel.DEGRADED
        assert EscalationTrigger.LATENCY in snap.triggers

    def test_degraded_queue_depth(self):
        snap = _evaluate_metrics("t1", 0.01, 100, ESCALATION_QUEUE_DEPTH_THRESHOLD + 10, 0)
        assert snap.level == TenantDegradationLevel.DEGRADED
        assert EscalationTrigger.QUEUE_DEPTH in snap.triggers

    def test_degraded_consecutive_failures(self):
        snap = _evaluate_metrics("t1", 0.01, 100, 0, ESCALATION_CONSECUTIVE_FAILURES_THRESHOLD + 1)
        assert snap.level == TenantDegradationLevel.DEGRADED
        assert EscalationTrigger.CONSECUTIVE_FAILURES in snap.triggers

    def test_critical_error_rate(self):
        snap = _evaluate_metrics("t1", ESCALATION_CRITICAL_ERROR_RATE + 0.05, 100, 0, 0)
        assert snap.level == TenantDegradationLevel.CRITICAL
        assert EscalationTrigger.ERROR_RATE in snap.triggers

    def test_critical_latency(self):
        snap = _evaluate_metrics("t1", 0.01, ESCALATION_CRITICAL_LATENCY_MS + 100, 0, 0)
        assert snap.level == TenantDegradationLevel.CRITICAL
        assert EscalationTrigger.LATENCY in snap.triggers

    def test_critical_overrides_degraded(self):
        """CRITICAL takes precedence when both degraded and critical conditions are met."""
        snap = _evaluate_metrics("t1", ESCALATION_CRITICAL_ERROR_RATE + 0.05, ESCALATION_LATENCY_THRESHOLD_MS + 100, 0, 0)
        assert snap.level == TenantDegradationLevel.CRITICAL

    def test_zero_values_are_healthy(self):
        snap = _evaluate_metrics("t1", 0.0, 0.0, 0, 0)
        assert snap.level == TenantDegradationLevel.HEALTHY

    def test_all_metrics_present(self):
        snap = _evaluate_metrics("t1", 0.03, 500, 20, 2)
        assert len(snap.metrics) == 4
        names = {m.name for m in snap.metrics}
        assert names == {"error_rate", "p95_latency_ms", "queue_depth", "consecutive_failures"}

    def test_boundary_error_rate(self):
        """Exactly at threshold is not degraded."""
        snap = _evaluate_metrics("t1", ESCALATION_ERROR_RATE_THRESHOLD, 100, 0, 0)
        assert snap.level == TenantDegradationLevel.HEALTHY

    def test_just_above_error_rate_threshold(self):
        snap = _evaluate_metrics("t1", ESCALATION_ERROR_RATE_THRESHOLD + 0.0001, 100, 0, 0)
        assert snap.level == TenantDegradationLevel.DEGRADED


# ===================================================================
# _map_to_escalation_level
# ===================================================================


class TestMapToEscalationLevel:
    def test_healthy_returns_l1(self):
        assert _map_to_escalation_level(TenantDegradationLevel.HEALTHY, "free") == EscalationLevel.L1_AUTO

    def test_degraded_enterprise_returns_l3(self):
        assert _map_to_escalation_level(TenantDegradationLevel.DEGRADED, "enterprise") == EscalationLevel.L3_ENGINEERING

    def test_degraded_pro_returns_l2(self):
        assert _map_to_escalation_level(TenantDegradationLevel.DEGRADED, "pro") == EscalationLevel.L2_HUMAN

    def test_degraded_starter_returns_l2(self):
        assert _map_to_escalation_level(TenantDegradationLevel.DEGRADED, "starter") == EscalationLevel.L2_HUMAN

    def test_degraded_free_returns_l1(self):
        assert _map_to_escalation_level(TenantDegradationLevel.DEGRADED, "free") == EscalationLevel.L1_AUTO

    def test_critical_returns_l3_for_any_tier(self):
        assert _map_to_escalation_level(TenantDegradationLevel.CRITICAL, "free") == EscalationLevel.L3_ENGINEERING
        assert _map_to_escalation_level(TenantDegradationLevel.CRITICAL, "pro") == EscalationLevel.L3_ENGINEERING
        assert _map_to_escalation_level(TenantDegradationLevel.CRITICAL, "enterprise") == EscalationLevel.L3_ENGINEERING

    def test_unknown_tier_falls_back_to_free(self):
        assert _map_to_escalation_level(TenantDegradationLevel.DEGRADED, "platinum") == EscalationLevel.L1_AUTO


# ===================================================================
# check_tenant_health
# ===================================================================


class TestCheckTenantHealth:
    def test_empty_tenant_id_returns_healthy(self):
        snap = check_tenant_health("", 0.1, 100, 5, 2)
        assert snap.level == TenantDegradationLevel.HEALTHY

    def test_healthy_tenant(self):
        snap = check_tenant_health("tenant-ok", 0.01, 100, 5, 0)
        assert snap.level == TenantDegradationLevel.HEALTHY

    def test_degraded_tenant(self):
        snap = check_tenant_health("tenant-bad", 0.08, 100, 5, 0)
        assert snap.level == TenantDegradationLevel.DEGRADED
        assert snap.tenant_id == "tenant-bad"

    def test_critical_tenant(self):
        snap = check_tenant_health("tenant-critical", 0.20, 100, 5, 0)
        assert snap.level == TenantDegradationLevel.CRITICAL

    def test_returns_snapshot_with_checked_at(self):
        snap = check_tenant_health("t1", 0.01, 100, 0, 0)
        assert snap.checked_at != ""


# ===================================================================
# _is_on_cooldown / _set_cooldown
# ===================================================================


class TestCooldown:
    @patch("workers.support.escalation._get_redis")
    def test_no_cooldown_by_default(self, mock_get_redis):
        mock_get_redis.return_value = MagicMock()
        # Simulate no cooldown key exists
        mock_get_redis.return_value.get.return_value = None
        assert _is_on_cooldown("tenant-1") is False

    @patch("workers.support.escalation._get_redis")
    def test_cooldown_active(self, mock_get_redis):
        import time
        mock_get_redis.return_value = MagicMock()
        mock_get_redis.return_value.get.return_value = str(time.time())
        assert _is_on_cooldown("tenant-1") is True

    @patch("workers.support.escalation._get_redis")
    def test_cooldown_expired(self, mock_get_redis):
        mock_get_redis.return_value = MagicMock()
        # Cooldown set far in the past
        import time
        mock_get_redis.return_value.get.return_value = str(time.time() - 10000)
        assert _is_on_cooldown("tenant-1") is False

    @patch("workers.support.escalation._get_redis")
    def test_set_cooldown(self, mock_get_redis):
        mock_get_redis.return_value = MagicMock()
        _set_cooldown("tenant-1")
        mock_get_redis.return_value.setex.assert_called_once()

    @patch("workers.support.escalation._get_redis")
    def test_cooldown_redis_unavailable_falls_back_to_memory(self, mock_get_redis):
        mock_get_redis.return_value = None
        assert _is_on_cooldown("tenant-mem") is False
        _set_cooldown("tenant-mem")
        assert _is_on_cooldown("tenant-mem") is True


# ===================================================================
# escalate_tenant
# ===================================================================


class TestEscalateTenant:
    @patch("workers.support.escalation._get_redis")
    def test_empty_tenant_id_returns_fallback(self, mock_get_redis):
        mock_get_redis.return_value = None
        action = escalate_tenant("", "no tenant")
        assert action.escalation_level == EscalationLevel.L1_AUTO
        assert "unexpected error" in action.reason

    @patch("workers.support.escalation._get_redis")
    def test_escalate_unknown_tenant_to_free_tier(self, mock_get_redis):
        """Unknown tenant should resolve as free tier -> L1_AUTO."""
        mock_get_redis.return_value = MagicMock()
        mock_get_redis.return_value.get.return_value = None  # no cooldown

        action = escalate_tenant(
            "tenant-new",
            reason="high error rate",
            trigger=EscalationTrigger.ERROR_RATE,
        )
        # Free tier → L1_AUTO
        assert action.escalation_level == EscalationLevel.L1_AUTO
        assert action.reason == "high error rate"
        assert action.trigger == EscalationTrigger.ERROR_RATE

    @patch("workers.support.escalation._get_redis")
    @patch("workers.support.escalation.get_sla_tracker")
    def test_escalate_pro_tenant(self, mock_get_tracker, mock_get_redis):
        mock_get_redis.return_value = MagicMock()
        mock_get_redis.return_value.get.return_value = None  # no cooldown

        mock_tracker = MagicMock()
        mock_status = MagicMock(tier="pro")
        mock_tracker.get_tenant_status.return_value = mock_status
        mock_get_tracker.return_value = mock_tracker

        action = escalate_tenant(
            "tenant-pro",
            reason="error rate above threshold (8%)",
            trigger=EscalationTrigger.ERROR_RATE,
        )
        # Pro → L2_HUMAN
        assert action.escalation_level == EscalationLevel.L2_HUMAN

    @patch("workers.support.escalation._get_redis")
    @patch("workers.support.escalation.get_sla_tracker")
    def test_escalate_enterprise_tenant(self, mock_get_tracker, mock_get_redis):
        mock_get_redis.return_value = MagicMock()
        mock_get_redis.return_value.get.return_value = None

        mock_tracker = MagicMock()
        mock_status = MagicMock(tier="enterprise")
        mock_tracker.get_tenant_status.return_value = mock_status
        mock_get_tracker.return_value = mock_tracker

        action = escalate_tenant(
            "tenant-ent",
            reason="high latency",
            trigger=EscalationTrigger.LATENCY,
        )
        # Enterprise → L3_ENGINEERING
        assert action.escalation_level == EscalationLevel.L3_ENGINEERING

    @patch("workers.support.escalation._get_redis")
    def test_cooldown_skips_escalation(self, mock_get_redis):
        import time
        mock_redis = MagicMock()
        mock_redis.get.return_value = str(time.time())  # active cooldown
        mock_get_redis.return_value = mock_redis

        action = escalate_tenant("tenant-hot", "still failing")
        assert action.escalation_level == EscalationLevel.L1_AUTO
        assert "on cooldown" in action.reason

    @patch("workers.support.escalation._get_redis")
    def test_maps_degraded_trigger_correctly(self, mock_get_redis):
        mock_get_redis.return_value = MagicMock()
        mock_get_redis.return_value.get.return_value = None

        action = escalate_tenant(
            "t1",
            reason="queue depth critical",
            trigger=EscalationTrigger.QUEUE_DEPTH,
        )
        assert action.trigger == EscalationTrigger.QUEUE_DEPTH


# ===================================================================
# acknowledge_escalation
# ===================================================================


class TestAcknowledgeEscalation:
    @patch("workers.support.escalation._get_redis")
    def test_acknowledge_clears_cooldown(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        action = acknowledge_escalation("tenant-1")
        assert action.acknowledged is True
        assert action.tenant_id == "tenant-1"
        mock_redis.delete.assert_called_once()

    @patch("workers.support.escalation._get_redis")
    def test_acknowledge_empty_returns_fallback(self, mock_get_redis):
        mock_get_redis.return_value = MagicMock()
        action = acknowledge_escalation("")
        assert action.escalation_level == EscalationLevel.L1_AUTO
        assert "unexpected error" in action.reason


# ===================================================================
# run_escalation_checks
# ===================================================================


class TestRunEscalationChecks:
    @patch("workers.support.escalation._get_redis")
    @patch("workers.support.escalation.get_sla_tracker")
    def test_no_tenants_returns_empty(self, mock_get_tracker, mock_get_redis):
        mock_get_redis.return_value = None
        mock_tracker = MagicMock()
        mock_tracker.get_all_tenant_ids.return_value = []
        mock_get_tracker.return_value = mock_tracker

        actions = run_escalation_checks()
        assert actions == []

    @patch("workers.support.escalation._get_redis")
    @patch("workers.support.escalation.get_sla_tracker")
    def test_healthy_tenants_no_escalation(self, mock_get_tracker, mock_get_redis):
        mock_get_redis.return_value = MagicMock()
        mock_get_redis.return_value.get.return_value = None

        mock_tracker = MagicMock()
        mock_tracker.get_all_tenant_ids.return_value = ["t1", "t2"]

        # Both tenants have no breaches → healthy
        def tenant_status(tenant_id):
            return MagicMock(
                tier="free",
                total_tickets=5,
                response_breaches=0,
                resolution_breaches=0,
                active_tickets=0,
                current_escalations=0,
            )
        mock_tracker.get_tenant_status.side_effect = tenant_status
        mock_get_tracker.return_value = mock_tracker

        actions = run_escalation_checks()
        assert actions == []  # No escalations for healthy tenants

    @patch("workers.support.escalation._get_redis")
    @patch("workers.support.escalation.get_sla_tracker")
    def test_degraded_tenant_triggers_escalation(self, mock_get_tracker, mock_get_redis):
        mock_get_redis.return_value = MagicMock()
        mock_get_redis.return_value.get.return_value = None  # no cooldown
        mock_get_redis.return_value.setex.return_value = True

        mock_tracker = MagicMock()
        mock_tracker.get_all_tenant_ids.return_value = ["t1"]

        # Tenant with many breaches → degraded
        mock_tracker.get_tenant_status.return_value = MagicMock(
            tier="pro",
            total_tickets=10,
            response_breaches=5,
            resolution_breaches=3,
            active_tickets=8,
            current_escalations=2,
        )
        mock_get_tracker.return_value = mock_tracker

        actions = run_escalation_checks()
        assert len(actions) >= 1

    @patch("workers.support.escalation._get_redis")
    @patch("workers.support.escalation.get_sla_tracker")
    def test_tracker_error_returns_empty(self, mock_get_tracker, mock_get_redis):
        mock_get_redis.return_value = MagicMock()
        mock_tracker = MagicMock()
        mock_tracker.get_all_tenant_ids.side_effect = Exception("Redis down")
        mock_get_tracker.return_value = mock_tracker

        actions = run_escalation_checks()
        assert actions == []

    @patch("workers.support.escalation._get_redis")
    @patch("workers.support.escalation.get_sla_tracker")
    def test_individual_tenant_check_failure_handled(self, mock_get_tracker, mock_get_redis):
        mock_get_redis.return_value = None
        mock_tracker = MagicMock()
        mock_tracker.get_all_tenant_ids.return_value = ["t1"]
        mock_tracker.get_tenant_status.side_effect = Exception("bad tenant")
        mock_get_tracker.return_value = mock_tracker

        actions = run_escalation_checks()
        assert len(actions) == 1
        assert actions[0].tenant_id == "t1"
        assert len(actions[0].errors) >= 1


# ===================================================================
# TenantHealthMetric serialization tests
# ===================================================================


class TestMetricSerialization:
    def test_metric_with_zero_values(self):
        m = TenantHealthMetric(name="test", value=0.0, threshold=0.0, unit="", breached=False)
        d = m.to_dict()
        assert d["value"] == 0.0
        assert d["breached"] is False
        restored = TenantHealthMetric.from_dict(d)
        assert restored.value == 0.0


# ===================================================================
# Module imports and __all__ exports
# ===================================================================


class TestModuleExports:
    def test_module_imports(self):
        from workers.support import escalation as esc  # noqa: F401
        assert callable(esc.check_tenant_health)
        assert callable(esc.escalate_tenant)
        assert callable(esc.run_escalation_checks)
        assert callable(esc.acknowledge_escalation)

    def test_public_api_has_expected_symbols(self):
        expected = {
            "EscalationAction",
            "EscalationTrigger",
            "TenantDegradationLevel",
            "TenantHealthMetric",
            "TenantHealthSnapshot",
            "check_tenant_health",
            "escalate_tenant",
            "run_escalation_checks",
            "acknowledge_escalation",
        }
        from workers.support import escalation as esc
        public = {name for name in dir(esc) if not name.startswith("_")}
        for symbol in expected:
            assert hasattr(esc, symbol), f"Missing public symbol: {symbol}"

    def test_package_reexports(self):
        from workers.support import (
            EscalationAction,
            EscalationTrigger,
            TenantDegradationLevel,
            TenantHealthSnapshot,
            check_tenant_health,
            escalate_tenant,
            run_escalation_checks,
        )
        assert callable(check_tenant_health)
        assert callable(escalate_tenant)
