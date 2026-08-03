"""
Tests for per-tier SLA priority queues (AIM-2019).

Covers:
    workers.orchestrator.sla_priority — Tier-to-queue mapping, priority
    resolution, reverse lookup, Celery router, and dispatch convenience
    wrapper.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from workers.orchestrator.sla_priority import (
    SLA_TIER_PRIORITY_MAP,
    SLA_TIER_QUEUE_MAP,
    TIER_QUEUES,
    TIER_ROUTES,
    SlaPriorityRouter,
    apply_sla_priority,
    priority_for_tier,
    queue_for_tier,
    resolve_queue,
    resolve_tier,
    tier_for_queue,
)


# ===========================================================================
# Queue resolution
# ===========================================================================


class TestQueueForTier:
    """``queue_for_tier()`` returns the correct Celery queue per tier."""

    @pytest.mark.parametrize("tier,expected", [
        ("enterprise", "syntaro.sla.enterprise"),
        ("team", "syntaro.sla.team"),
        ("solo", "syntaro.sla.solo"),
        ("free", "syntaro.sla.free"),
    ])
    def test_known_tier(self, tier: str, expected: str) -> None:
        assert queue_for_tier(tier) == expected

    def test_unknown_tier_falls_back_to_free(self) -> None:
        assert queue_for_tier("platinum") == "syntaro.sla.free"

    def test_case_insensitive(self) -> None:
        assert queue_for_tier("ENTERPRISE") == "syntaro.sla.enterprise"
        assert queue_for_tier("Team") == "syntaro.sla.team"

    def test_whitespace_stripped(self) -> None:
        assert queue_for_tier("  free  ") == "syntaro.sla.free"


# ===========================================================================
# Priority resolution
# ===========================================================================


class TestPriorityForTier:
    """``priority_for_tier()`` returns the correct Celery priority (0–255)."""

    @pytest.mark.parametrize("tier,expected", [
        ("enterprise", 9),
        ("team", 6),
        ("solo", 3),
        ("free", 0),
    ])
    def test_known_tier(self, tier: str, expected: int) -> None:
        assert priority_for_tier(tier) == expected

    def test_unknown_tier_returns_zero(self) -> None:
        assert priority_for_tier("platinum") == 0

    def test_priority_hierarchy(self) -> None:
        """Enterprise > team > solo > free."""
        assert priority_for_tier("enterprise") > priority_for_tier("team")
        assert priority_for_tier("team") > priority_for_tier("solo")
        assert priority_for_tier("solo") > priority_for_tier("free")


# ===========================================================================
# Reverse lookup
# ===========================================================================


class TestTierForQueue:
    """``tier_for_queue()`` reverse-maps queue → tier."""

    @pytest.mark.parametrize("queue_name,expected", [
        ("syntaro.sla.enterprise", "enterprise"),
        ("syntaro.sla.team", "team"),
        ("syntaro.sla.solo", "solo"),
        ("syntaro.sla.free", "free"),
    ])
    def test_known_queue(self, queue_name: str, expected: str) -> None:
        assert tier_for_queue(queue_name) == expected

    def test_unknown_queue(self) -> None:
        assert tier_for_queue("syntaro.agents.triage") is None


# ===========================================================================
# Tier resolution
# ===========================================================================


class TestResolveTier:
    """``resolve_tier()`` normalises a tier string."""

    @pytest.mark.parametrize("raw,expected", [
        ("enterprise", "enterprise"),
        ("ENTERPRISE", "enterprise"),
        ("Team", "team"),
        ("  free  ", "free"),
        (None, "free"),
        ("platinum", "free"),
        ("", "free"),
    ])
    def test_resolve(self, raw: str | None, expected: str) -> None:
        assert resolve_tier(raw) == expected


class TestResolveQueue:
    """``resolve_queue()`` combines tier resolution + queue lookup."""

    def test_with_tier(self) -> None:
        assert resolve_queue("tenant-1", "enterprise") == "syntaro.sla.enterprise"

    def test_without_tier_defaults_free(self) -> None:
        assert resolve_queue("tenant-1") == "syntaro.sla.free"


# ===========================================================================
# Convenience maps
# ===========================================================================


class TestConvenienceMaps:
    """``SLA_TIER_QUEUE_MAP`` and ``SLA_TIER_PRIORITY_MAP`` contain all tiers."""

    def test_queue_map_keys(self) -> None:
        assert set(SLA_TIER_QUEUE_MAP.keys()) == {"enterprise", "team", "solo", "free"}

    def test_queue_map_values(self) -> None:
        assert SLA_TIER_QUEUE_MAP["enterprise"] == "syntaro.sla.enterprise"
        assert SLA_TIER_QUEUE_MAP["free"] == "syntaro.sla.free"

    def test_priority_map_keys(self) -> None:
        assert set(SLA_TIER_PRIORITY_MAP.keys()) == {"enterprise", "team", "solo", "free"}

    def test_priority_map_values(self) -> None:
        assert SLA_TIER_PRIORITY_MAP["enterprise"] == 9
        assert SLA_TIER_PRIORITY_MAP["free"] == 0


# ===========================================================================
# TIER_QUEUES / TIER_ROUTES constants
# ===========================================================================


class TestTierQueues:
    """``TIER_QUEUES`` produces four ``kombu.Queue`` objects."""

    def test_length(self) -> None:
        assert len(TIER_QUEUES) == 4

    def test_all_are_queue_instances(self) -> None:
        from kombu import Queue
        for q in TIER_QUEUES:
            assert isinstance(q, Queue)

    def test_queue_names(self) -> None:
        names = {q.name for q in TIER_QUEUES}
        assert names == {
            "syntaro.sla.enterprise",
            "syntaro.sla.team",
            "syntaro.sla.solo",
            "syntaro.sla.free",
        }

    def test_routing_keys(self) -> None:
        for q in TIER_QUEUES:
            assert q.routing_key == q.name


class TestTierRoutes:
    """``TIER_ROUTES`` contains default route entries."""

    def test_non_empty(self) -> None:
        assert len(TIER_ROUTES) > 0

    def test_agent_tasks_route_to_free_default(self) -> None:
        assert "workers.tasks.agent.*" in TIER_ROUTES
        assert TIER_ROUTES["workers.tasks.agent.*"]["queue"] == "syntaro.sla.free"


# ===========================================================================
# SlaPriorityRouter
# ===========================================================================


class TestSlaPriorityRouter:
    """``SlaPriorityRouter`` returns the correct route for tiered tasks."""

    def _router(self) -> SlaPriorityRouter:
        return SlaPriorityRouter()

    def test_no_tier_returns_none(self) -> None:
        result = self._router().route_for_task(
            "workers.tasks.agent.fix", (), {}, {},
        )
        assert result is None

    def test_empty_kwargs_returns_none(self) -> None:
        result = self._router().route_for_task(
            "workers.tasks.agent.fix", (), None, {},
        )
        assert result is None

    def test_tier_kwarg_routes_correctly(self) -> None:
        result = self._router().route_for_task(
            "workers.tasks.agent.fix", (), {"tier": "enterprise"}, {},
        )
        assert result is not None
        assert result["queue"] == "syntaro.sla.enterprise"
        assert result["priority"] == 9

    def test_free_tier(self) -> None:
        result = self._router().route_for_task(
            "workers.tasks.agent.fix", (), {"tier": "free"}, {},
        )
        assert result is not None
        assert result["queue"] == "syntaro.sla.free"
        assert result["priority"] == 0

    def test_unknown_tier_falls_back(self) -> None:
        result = self._router().route_for_task(
            "workers.tasks.agent.fix", (), {"tier": "platinum"}, {},
        )
        assert result is not None
        assert result["queue"] == "syntaro.sla.free"
        assert result["priority"] == 0

    def test_non_string_tier_ignored(self) -> None:
        result = self._router().route_for_task(
            "workers.tasks.agent.fix", (), {"tier": 42}, {},
        )
        assert result is None


# ===========================================================================
# apply_sla_priority convenience wrapper
# ===========================================================================


class TestApplySlaPriority:
    """``apply_sla_priority()`` calls ``apply_async`` with right args."""

    def test_sets_queue_and_priority(self) -> None:
        mock_task = MagicMock()
        mock_task.apply_async.return_value = "async_result"

        result = apply_sla_priority(mock_task, "enterprise", args=("issue-1",))

        mock_task.apply_async.assert_called_once()
        _call_kwargs = mock_task.apply_async.call_args.kwargs
        assert _call_kwargs.get("queue") == "syntaro.sla.enterprise"
        assert _call_kwargs.get("priority") == 9
        assert _call_kwargs.get("args") == ("issue-1",)
        assert result == "async_result"

    def test_free_tier(self) -> None:
        mock_task = MagicMock()

        apply_sla_priority(mock_task, "free", kwargs={"key": "val"})

        mock_task.apply_async.assert_called_once()
        _call_kwargs = mock_task.apply_async.call_args.kwargs
        assert _call_kwargs.get("queue") == "syntaro.sla.free"
        assert _call_kwargs.get("priority") == 0

    def test_unknown_tier_defaults_free(self) -> None:
        mock_task = MagicMock()

        apply_sla_priority(mock_task, "platinum")

        mock_task.apply_async.assert_called_once()
        _call_kwargs = mock_task.apply_async.call_args.kwargs
        assert _call_kwargs.get("queue") == "syntaro.sla.free"
        assert _call_kwargs.get("priority") == 0

    @staticmethod
    def test_explicit_options_not_overwritten() -> None:
        """Caller-provided queue/priority are left intact."""
        mock_task = MagicMock()

        apply_sla_priority(mock_task, "free", queue="custom.queue", priority=255)

        mock_task.apply_async.assert_called_once()
        _call_kwargs = mock_task.apply_async.call_args.kwargs
        # Explicit options should NOT be overwritten by the wrapper
        assert _call_kwargs.get("queue") == "custom.queue"
        assert _call_kwargs.get("priority") == 255
