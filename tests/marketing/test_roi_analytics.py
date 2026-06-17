"""Tests for ROIAnalyticsEngine — Wave 2.1 of the Marketing ROI Dashboard.

Covers compute_engagement_metrics, compute_funnel_rates, estimate_reach,
estimate_roi, and the full compute_campaign_performance pipeline.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from marketing.roi_arch import ROIAnalyticsEngine
from marketing.store import CampaignStore


@pytest.fixture
def store(tmp_path) -> CampaignStore:
    """Return a fresh CampaignStore backed by a temp SQLite database."""
    db_path = tmp_path / "test_roi.db"
    return CampaignStore(str(db_path))


@pytest.fixture
def engine() -> ROIAnalyticsEngine:
    """Return a fresh ROIAnalyticsEngine instance."""
    return ROIAnalyticsEngine()


def _insert_funnel_event(store: CampaignStore, campaign_id: str, **kwargs) -> int:
    """Helper to insert a funnel event with minimal boilerplate."""
    defaults = {
        "campaign_id": campaign_id,
        "platform": "reddit",
        "event_type": "awareness",
        "signal_direction": "neutral",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }
    defaults.update(kwargs)
    return store.insert_funnel_event(**defaults)


# ===================================================================
# compute_engagement_metrics
# ===================================================================


class TestComputeEngagementMetrics:
    def test_known_signal_distribution(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """Signal counts and ratios should match known distribution."""
        camp_id = store.create_campaign({"name": "signal-test"})
        _insert_funnel_event(store, camp_id, signal_direction="positive")
        _insert_funnel_event(store, camp_id, signal_direction="positive")
        _insert_funnel_event(store, camp_id, signal_direction="positive")
        _insert_funnel_event(store, camp_id, signal_direction="negative")
        _insert_funnel_event(store, camp_id, signal_direction="neutral")

        result = engine.compute_engagement_metrics(camp_id, store)

        assert result["total_signals"] == 5
        assert result["positive_count"] == 3
        assert result["negative_count"] == 1
        assert result["neutral_count"] == 1
        assert result["signal_ratio"] == pytest.approx(3.0 / 4.0)  # 3/(3+1) = 0.75

    def test_all_positive_signals(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """All positive signals should yield signal_ratio = 1.0."""
        camp_id = store.create_campaign({"name": "all-positive"})
        _insert_funnel_event(store, camp_id, signal_direction="positive")
        _insert_funnel_event(store, camp_id, signal_direction="positive")

        result = engine.compute_engagement_metrics(camp_id, store)
        assert result["signal_ratio"] == 1.0

    def test_all_negative_signals(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """All negative signals should yield signal_ratio = 0.0."""
        camp_id = store.create_campaign({"name": "all-negative"})
        _insert_funnel_event(store, camp_id, signal_direction="negative")

        result = engine.compute_engagement_metrics(camp_id, store)
        assert result["signal_ratio"] == 0.0

    def test_engagement_rate_computation(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """engagement_rate = engagement_count / awareness_count."""
        camp_id = store.create_campaign({"name": "engagement-rate"})
        _insert_funnel_event(store, camp_id, event_type="awareness")
        _insert_funnel_event(store, camp_id, event_type="awareness")
        _insert_funnel_event(store, camp_id, event_type="engagement")
        _insert_funnel_event(store, camp_id, event_type="engagement")
        _insert_funnel_event(store, camp_id, event_type="engagement")

        result = engine.compute_engagement_metrics(camp_id, store)
        assert result["engagement_rate"] == pytest.approx(3.0 / 2.0)  # 3/2 = 1.5

    def test_no_events_returns_zeros(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """No funnel events should return all zero values."""
        camp_id = store.create_campaign({"name": "no-events"})

        result = engine.compute_engagement_metrics(camp_id, store)

        assert result["total_signals"] == 0
        assert result["positive_count"] == 0
        assert result["negative_count"] == 0
        assert result["neutral_count"] == 0
        assert result["signal_ratio"] == 0.0
        assert result["engagement_rate"] == 0.0


# ===================================================================
# compute_funnel_rates
# ===================================================================


class TestComputeFunnelRates:
    def test_known_stage_counts(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """Stage counts should reflect the inserted funnel events."""
        camp_id = store.create_campaign({"name": "funnel-test"})
        _insert_funnel_event(store, camp_id, event_type="awareness")
        _insert_funnel_event(store, camp_id, event_type="awareness")
        _insert_funnel_event(store, camp_id, event_type="engagement")
        _insert_funnel_event(store, camp_id, event_type="interest")
        _insert_funnel_event(store, camp_id, event_type="conversion")

        result = engine.compute_funnel_rates(camp_id, store)

        assert result["awareness_count"] == 2
        assert result["engagement_count"] == 1
        assert result["interest_count"] == 1
        assert result["consideration_count"] == 0
        assert result["conversion_count"] == 1
        assert result["retention_count"] == 0

    def test_conversion_rates(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """Conversion rates between stages should be correct."""
        camp_id = store.create_campaign({"name": "conversion-rates"})
        _insert_funnel_event(store, camp_id, event_type="awareness")
        _insert_funnel_event(store, camp_id, event_type="awareness")
        _insert_funnel_event(store, camp_id, event_type="engagement")
        _insert_funnel_event(store, camp_id, event_type="interest")

        result = engine.compute_funnel_rates(camp_id, store)

        # awareness(2) → engagement(1): 1/2 = 0.5
        assert result["awareness_to_engagement"] == pytest.approx(0.5)
        # engagement(1) → interest(1): 1/1 = 1.0
        assert result["engagement_to_interest"] == pytest.approx(1.0)
        # interest(1) → consideration(0): 0/1 = 0.0
        assert result["interest_to_consideration"] == pytest.approx(0.0)
        # consideration(0) → conversion(0): 0.0 (div by zero)
        assert result["consideration_to_conversion"] == pytest.approx(0.0)

    def test_rate_capped_at_one(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """Conversion rate should never exceed 1.0."""
        camp_id = store.create_campaign({"name": "cap-test"})
        _insert_funnel_event(store, camp_id, event_type="awareness")
        _insert_funnel_event(store, camp_id, event_type="engagement")
        _insert_funnel_event(store, camp_id, event_type="engagement")

        result = engine.compute_funnel_rates(camp_id, store)

        # awareness(1) → engagement(2): min(1.0, 2/1) = 1.0
        assert result["awareness_to_engagement"] == pytest.approx(1.0)

    def test_no_events_returns_zeros(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """No funnel events should return all zero counts and rates."""
        camp_id = store.create_campaign({"name": "funnel-empty"})

        result = engine.compute_funnel_rates(camp_id, store)

        for stage in engine.FUNNEL_ORDER:
            assert result[f"{stage}_count"] == 0


# ===================================================================
# estimate_reach
# ===================================================================


class TestEstimateReach:
    def test_estimate_with_known_signals(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """Reach = positive*100 + neutral*50."""
        camp_id = store.create_campaign({"name": "reach-test"})
        _insert_funnel_event(store, camp_id, signal_direction="positive")
        _insert_funnel_event(store, camp_id, signal_direction="positive")
        _insert_funnel_event(store, camp_id, signal_direction="positive")
        _insert_funnel_event(store, camp_id, signal_direction="neutral")
        _insert_funnel_event(store, camp_id, signal_direction="negative")

        reach = engine.estimate_reach(camp_id, store)

        assert reach == (3 * 100) + (1 * 50)  # 350

    def test_no_events_returns_zero(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """No funnel events should return zero reach."""
        camp_id = store.create_campaign({"name": "reach-empty"})

        reach = engine.estimate_reach(camp_id, store)
        assert reach == 0


# ===================================================================
# estimate_roi
# ===================================================================


class TestEstimateROI:
    def test_with_conversions(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """With conversions, confidence should be medium."""
        camp_id = store.create_campaign({"name": "roi-with-conversions"})
        _insert_funnel_event(store, camp_id, event_type="engagement")
        _insert_funnel_event(store, camp_id, event_type="engagement")
        _insert_funnel_event(store, camp_id, event_type="conversion")

        result = engine.estimate_roi(camp_id, store)

        assert result["conversion_count"] == 1
        assert result["engagement_to_conversion_rate"] == pytest.approx(0.5)
        assert result["roi_estimated"] > 0.0  # attribution now computes real value
        assert result["confidence"] == "medium"

    def test_no_conversions(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """Without conversions, confidence should be low."""
        camp_id = store.create_campaign({"name": "roi-no-conversions"})
        _insert_funnel_event(store, camp_id, event_type="awareness")
        _insert_funnel_event(store, camp_id, event_type="engagement")

        result = engine.estimate_roi(camp_id, store)

        assert result["conversion_count"] == 0
        assert result["engagement_to_conversion_rate"] == 0.0
        assert result["confidence"] == "low"

    def test_no_events(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """No events should return zeros and low confidence."""
        camp_id = store.create_campaign({"name": "roi-empty"})

        result = engine.estimate_roi(camp_id, store)

        assert result["conversion_count"] == 0
        assert result["engagement_to_conversion_rate"] == 0.0
        assert result["roi_estimated"] == 0.0
        assert result["confidence"] == "low"


# ===================================================================
# compute_campaign_performance — full pipeline
# ===================================================================


class TestComputeCampaignPerformance:
    def test_full_pipeline(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """Full pipeline should produce correct aggregated metrics."""
        camp_id = store.create_campaign({"name": "pipeline-test"})
        # Awareness
        _insert_funnel_event(store, camp_id, event_type="awareness", signal_direction="positive")
        _insert_funnel_event(store, camp_id, event_type="awareness", signal_direction="positive")
        # Engagement
        _insert_funnel_event(store, camp_id, event_type="engagement", signal_direction="positive")
        # Interest
        _insert_funnel_event(store, camp_id, event_type="interest", signal_direction="neutral")
        # Conversion
        _insert_funnel_event(store, camp_id, event_type="conversion", signal_direction="positive")

        result = engine.compute_campaign_performance(camp_id, store)

        assert result is not None
        assert result["campaign_id"] == camp_id
        assert result["computed_at"] is not None

        # Funnel counts
        assert result["awareness_count"] == 2
        assert result["engagement_count"] == 1
        assert result["interest_count"] == 1
        assert result["consideration_count"] == 0
        assert result["conversion_count"] == 1
        assert result["retention_count"] == 0

        # Conversion rates
        assert result["awareness_to_engagement"] == pytest.approx(0.5)
        assert result["engagement_to_interest"] == pytest.approx(1.0)
        assert result["conversion_to_retention"] == pytest.approx(0.0)

        # Engagement metrics
        assert result["total_signals"] == 5
        assert result["positive_signals"] == 4
        assert result["negative_signals"] == 0
        assert result["neutral_count"] == 1
        assert result["signal_ratio"] == pytest.approx(1.0)
        assert result["estimated_reach"] == (4 * 100) + (1 * 50)

        # Quality score
        assert isinstance(result["quality_score"], (int, float))
        assert result["quality_score"] >= 0

    def test_campaign_not_found_returns_none(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """Querying a non-existent campaign should return None."""
        result = engine.compute_campaign_performance("missing-campaign", store)
        assert result is None

    def test_no_data_returns_zeros(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """Campaign with no actions/funnel events should return zeroed dict."""
        camp_id = store.create_campaign({"name": "zero-data"})

        result = engine.compute_campaign_performance(camp_id, store)

        assert result is not None
        assert result["awareness_count"] == 0
        assert result["engagement_count"] == 0
        assert result["total_signals"] == 0
        assert result["signal_ratio"] == 0.0
        assert result["engagement_rate"] == 0.0
        assert result["estimated_reach"] == 0
        assert result["quality_score"] == 15  # baseline with no campaign json data

    def test_single_action_edge_case(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """Single event should not cause division-by-zero errors."""
        camp_id = store.create_campaign({"name": "single-action"})
        _insert_funnel_event(store, camp_id, event_type="awareness", signal_direction="neutral")

        result = engine.compute_campaign_performance(camp_id, store)

        assert result is not None
        assert result["awareness_count"] == 1
        assert result["engagement_rate"] == 0.0  # no engagement events
        assert result["signal_ratio"] == 0.0  # positive 0, negative 0 → total=0
        assert result["estimated_reach"] == 50  # neutral counted
        assert result["total_signals"] == 1

    def test_persists_to_database(
        self, engine: ROIAnalyticsEngine, store: CampaignStore,
    ) -> None:
        """compute_campaign_performance should persist results to DB."""
        camp_id = store.create_campaign({"name": "persist-test"})
        _insert_funnel_event(store, camp_id, event_type="awareness", signal_direction="positive")

        result = engine.compute_campaign_performance(camp_id, store)

        # Verify persisted
        rows = store.get_campaign_performance(camp_id)
        assert len(rows) >= 1
        latest = rows[0]
        assert latest["campaign_id"] == camp_id
        assert latest["awareness_count"] == 1
        assert latest["total_signals"] == 1


# ===================================================================
# compute_conversion_rate — static utility
# ===================================================================


class TestComputeConversionRate:
    def test_basic_rate(self, engine: ROIAnalyticsEngine) -> None:
        """Standard conversion between two stages."""
        stage_counts = {"awareness": 10, "engagement": 5}
        rate = ROIAnalyticsEngine.compute_conversion_rate(1, 2, stage_counts)
        assert rate == pytest.approx(0.5)

    def test_full_conversion(self, engine: ROIAnalyticsEngine) -> None:
        """When next stage exceeds previous, rate caps at 1.0."""
        stage_counts = {"awareness": 3, "engagement": 7}
        rate = ROIAnalyticsEngine.compute_conversion_rate(1, 2, stage_counts)
        assert rate == pytest.approx(1.0)

    def test_zero_prev_stage(self, engine: ROIAnalyticsEngine) -> None:
        """Zero events in the previous stage should return 0.0."""
        stage_counts = {"awareness": 0, "engagement": 5}
        rate = ROIAnalyticsEngine.compute_conversion_rate(1, 2, stage_counts)
        assert rate == pytest.approx(0.0)
