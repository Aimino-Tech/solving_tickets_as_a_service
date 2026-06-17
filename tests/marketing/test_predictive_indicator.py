"""Tests for PredictiveIndicator — Wave 3.2 of the Marketing ROI Dashboard.

Covers all five methods: moving_average, exponential_smoothing, linear_trend,
detect_anomaly, and the full forecast_engagement pipeline.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from marketing.roi_arch import PredictiveIndicator
from marketing.store import CampaignStore


# ═══════════════════════════════════════════════════════════════════════════════
# moving_average
# ═══════════════════════════════════════════════════════════════════════════════


class TestMovingAverage:
    def test_known_values(self) -> None:
        """Standard centered moving average with window=3.

        Interior points use a symmetric window; edge points use whatever
        elements are available (shrinking on the unavailable side).
        """
        series = [10, 12, 15, 14, 18, 20, 22]
        result = PredictiveIndicator.moving_average(series, window=3)
        expected = [11.0, 12.33, 13.67, 15.67, 17.33, 20.0, 21.0]
        assert len(result) == len(series)
        for r, e in zip(result, expected):
            assert r == pytest.approx(e, abs=0.01)

    def test_window_larger_than_series(self) -> None:
        """When window exceeds series length, series is returned unchanged."""
        series = [5, 10]
        result = PredictiveIndicator.moving_average(series, window=7)
        assert result == [5, 10]

    def test_empty_series(self) -> None:
        """Empty series returns an empty list."""
        assert PredictiveIndicator.moving_average([], window=3) == []

    def test_window_default(self) -> None:
        """Default window should be 7."""
        series = [1.0] * 10
        result = PredictiveIndicator.moving_average(series)
        assert len(result) == 10
        assert all(v == 1.0 for v in result)

    def test_single_element(self) -> None:
        """Single-element series is returned as-is (shorter than any window)."""
        result = PredictiveIndicator.moving_average([42.0], window=3)
        assert result == [42.0]


# ═══════════════════════════════════════════════════════════════════════════════
# exponential_smoothing
# ═══════════════════════════════════════════════════════════════════════════════


class TestExponentialSmoothing:
    def test_known_values(self) -> None:
        """Exponential smoothing with alpha=0.3 reproduces known output."""
        series = [10, 12, 15, 14, 18]
        result = PredictiveIndicator.exponential_smoothing(series, alpha=0.3)
        # result[0] = 10.0
        # result[1] = 0.3*12 + 0.7*10.0 = 3.6 + 7.0 = 10.6
        # result[2] = 0.3*15 + 0.7*10.6 = 4.5 + 7.42 = 11.92
        # result[3] = 0.3*14 + 0.7*11.92 = 4.2 + 8.344 = 12.544 → 12.54
        # result[4] = 0.3*18 + 0.7*12.544 = 5.4 + 8.7808 = 14.1808 → 14.18
        expected = [10.0, 10.6, 11.92, 12.54, 14.18]
        assert len(result) == len(series)
        for r, e in zip(result, expected):
            assert r == pytest.approx(e, abs=0.01)

    def test_empty_series(self) -> None:
        """Empty series returns an empty list."""
        assert PredictiveIndicator.exponential_smoothing([]) == []

    def test_single_element(self) -> None:
        """Single-element returns [value]."""
        assert PredictiveIndicator.exponential_smoothing([7.5]) == [7.5]

    def test_all_identical(self) -> None:
        """Identical values produce the same value throughout."""
        result = PredictiveIndicator.exponential_smoothing([5.0, 5.0, 5.0])
        assert all(v == 5.0 for v in result)

    def test_alpha_one(self) -> None:
        """alpha=1.0 = no smoothing (result = raw series)."""
        series = [10, 12, 15]
        result = PredictiveIndicator.exponential_smoothing(series, alpha=1.0)
        assert result == [10.0, 12.0, 15.0]

    def test_alpha_zero(self) -> None:
        """alpha=0.0 = flat line at first value."""
        series = [10, 20, 30]
        result = PredictiveIndicator.exponential_smoothing(series, alpha=0.0)
        assert result == [10.0, 10.0, 10.0]


# ═══════════════════════════════════════════════════════════════════════════════
# linear_trend
# ═══════════════════════════════════════════════════════════════════════════════


class TestLinearTrend:
    def test_increasing_data(self) -> None:
        """Perfectly linear increasing data → slope=2, r_squared=1."""
        series = [1.0, 3.0, 5.0, 7.0, 9.0]
        result = PredictiveIndicator.linear_trend(series)
        assert result["slope"] == pytest.approx(2.0, abs=0.01)
        assert result["direction"] == "increasing"
        assert result["r_squared"] == pytest.approx(1.0, abs=0.01)

    def test_decreasing_data(self) -> None:
        """Perfectly linear decreasing data → slope=-3, r_squared=1."""
        series = [15.0, 12.0, 9.0, 6.0, 3.0]
        result = PredictiveIndicator.linear_trend(series)
        assert result["slope"] == pytest.approx(-3.0, abs=0.01)
        assert result["direction"] == "decreasing"
        assert result["r_squared"] == pytest.approx(1.0, abs=0.01)

    def test_stable_data(self) -> None:
        """Flat data → slope near 0, direction='stable'."""
        series = [5.0, 5.0, 5.0, 5.0]
        result = PredictiveIndicator.linear_trend(series)
        assert abs(result["slope"]) < 0.001
        assert result["direction"] == "stable"

    def test_fewer_than_two_points(self) -> None:
        """Single point returns default values with 'stable' direction."""
        result = PredictiveIndicator.linear_trend([42.0])
        assert result["slope"] == 0.0
        assert result["intercept"] == 42.0
        assert result["r_squared"] == 0.0
        assert result["direction"] == "stable"

    def test_empty_series(self) -> None:
        """Empty series returns defaults with intercept 0."""
        result = PredictiveIndicator.linear_trend([])
        assert result["slope"] == 0.0
        assert result["intercept"] == 0.0
        assert result["r_squared"] == 0.0
        assert result["direction"] == "stable"

    def test_slight_positive_slope_below_threshold(self) -> None:
        """Slope under 0.01 should be 'stable'."""
        series = [1.0, 1.005, 1.01, 1.015]
        result = PredictiveIndicator.linear_trend(series)
        assert result["direction"] == "stable"


# ═══════════════════════════════════════════════════════════════════════════════
# detect_anomaly
# ═══════════════════════════════════════════════════════════════════════════════


class TestDetectAnomaly:
    def test_known_anomalous_point(self) -> None:
        """A point far from the mean should be flagged."""
        series = [10, 12, 11, 13, 10, 12, 100, 11, 12, 10]
        result = PredictiveIndicator.detect_anomaly(series, threshold=2.0)
        assert 6 in result  # index 6 = 100

    def test_no_anomalies_uniform_data(self) -> None:
        """Uniform (std=0) data should return no anomalies."""
        series = [5.0, 5.0, 5.0, 5.0, 5.0]
        result = PredictiveIndicator.detect_anomaly(series)
        assert result == []

    def test_fewer_than_three_points(self) -> None:
        """Less than 3 data points returns empty list."""
        assert PredictiveIndicator.detect_anomaly([1.0, 2.0]) == []
        assert PredictiveIndicator.detect_anomaly([1.0]) == []
        assert PredictiveIndicator.detect_anomaly([]) == []

    def test_no_anomalies_with_normal_data(self) -> None:
        """Normally distributed data within threshold."""
        series = [10, 11, 10, 12, 11, 10, 11, 12, 10, 11]
        result = PredictiveIndicator.detect_anomaly(series, threshold=3.0)
        assert result == []

    def test_lower_threshold_captures_more(self) -> None:
        """Lower threshold should detect smaller deviations."""
        series = [10, 10, 10, 13, 10, 10]
        # With threshold=1.0, the 13 should be an anomaly
        result = PredictiveIndicator.detect_anomaly(series, threshold=1.0)
        assert 3 in result


# ═══════════════════════════════════════════════════════════════════════════════
# forecast_engagement
# ═══════════════════════════════════════════════════════════════════════════════


def _insert_funnel_event(
    store: CampaignStore,
    campaign_id: str,
    **kwargs: object,
) -> int:
    """Insert a funnel event with minimal boilerplate."""
    defaults: dict[str, object] = {
        "campaign_id": campaign_id,
        "platform": "reddit",
        "event_type": "awareness",
        "signal_direction": "neutral",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }
    defaults.update(kwargs)
    return store.insert_funnel_event(**defaults)


class TestForecastEngagement:
    def test_known_campaign_data(self, tmp_path: object) -> None:
        """Forecast with a known set of daily events produces expected structure."""
        db = tmp_path / "test_forecast.db"  # type: ignore[operator]
        store = CampaignStore(str(db))
        store.execute_schema_extensions()

        camp_id = store.create_campaign({"name": "forecast-test"})

        now = datetime.now(timezone.utc)
        # Insert 10 days of consistent engagement data
        for day_offset in range(10):
            day = now - timedelta(days=9 - day_offset)
            day_str = day.isoformat()
            # 2 awareness events + 1 engagement event each day
            _insert_funnel_event(
                store, camp_id,
                event_type="awareness",
                occurred_at=day_str,
            )
            _insert_funnel_event(
                store, camp_id,
                event_type="awareness",
                occurred_at=day_str,
            )
            _insert_funnel_event(
                store, camp_id,
                event_type="engagement",
                occurred_at=day_str,
            )

        result = PredictiveIndicator.forecast_engagement(camp_id, days=5, store=store)

        # Structure checks
        assert result["campaign_id"] == camp_id
        assert "generated_at" in result
        assert "historical" in result
        assert "forecast" in result
        assert "trend" in result
        assert "anomalies" in result

        # Historical data
        assert len(result["historical"]["dates"]) == 10
        assert len(result["historical"]["engagement_rates"]) == 10
        assert len(result["historical"]["smoothed_rates"]) == 10

        # Each day: 1 engagement / 2 awareness = 0.5
        for rate in result["historical"]["engagement_rates"]:
            assert rate == pytest.approx(0.5, abs=0.01)

        # Forecast data
        assert len(result["forecast"]["dates"]) == 5
        assert len(result["forecast"]["trend_forecast"]) == 5
        assert len(result["forecast"]["smoothed_forecast"]) == 5

        # Trend should be stable (flat data)
        assert result["trend"]["direction"] in ("stable", "increasing")
        assert "r_squared" in result["trend"]

        # No anomalies in perfectly uniform data
        assert result["anomalies"]["indices"] == []

    def test_no_data_campaign(self, tmp_path: object) -> None:
        """Campaign with no funnel events returns error dict with low confidence."""
        db = tmp_path / "test_no_data.db"  # type: ignore[operator]
        store = CampaignStore(str(db))
        store.execute_schema_extensions()

        camp_id = store.create_campaign({"name": "no-data"})

        result = PredictiveIndicator.forecast_engagement(camp_id, store=store)

        assert "error" in result
        assert result["campaign_id"] == camp_id
        assert result["confidence"] == "low"

    def test_store_none(self) -> None:
        """Passing store=None gracefully returns an error dict."""
        result = PredictiveIndicator.forecast_engagement("NONE", store=None)
        assert "error" in result
        assert result["confidence"] == "low"

    def test_forecast_with_anomaly(self, tmp_path: object) -> None:
        """An anomalous spike in engagement is detected in the results."""
        db = tmp_path / "test_anomaly.db"  # type: ignore[operator]
        store = CampaignStore(str(db))
        store.execute_schema_extensions()

        camp_id = store.create_campaign({"name": "anomaly-test"})

        now = datetime.now(timezone.utc)
        # 7 normal days
        for day_offset in range(7):
            day = now - timedelta(days=6 - day_offset)
            _insert_funnel_event(
                store, camp_id,
                event_type="awareness",
                occurred_at=day.isoformat(),
            )
            _insert_funnel_event(
                store, camp_id,
                event_type="engagement",
                occurred_at=day.isoformat(),
            )

        # 1 anomalous day: big spike in engagement
        anom_day = now - timedelta(days=7)
        _insert_funnel_event(
            store, camp_id,
            event_type="awareness",
            occurred_at=anom_day.isoformat(),
        )
        for _ in range(50):
            _insert_funnel_event(
                store, camp_id,
                event_type="engagement",
                occurred_at=anom_day.isoformat(),
            )

        result = PredictiveIndicator.forecast_engagement(camp_id, days=3, store=store)

        # Should have detected anomalies
        assert len(result["anomalies"]["indices"]) > 0
        assert len(result["anomalies"]["dates"]) > 0
        assert len(result["anomalies"]["values"]) > 0

    def test_confidence_levels(self, tmp_path: object) -> None:
        """Confidence should be 'low' for <7 data points."""
        db = tmp_path / "test_confidence.db"  # type: ignore[operator]
        store = CampaignStore(str(db))
        store.execute_schema_extensions()

        camp_id = store.create_campaign({"name": "confidence-test"})
        now = datetime.now(timezone.utc)

        # Only 3 days of data → low confidence (< 7)
        for day_offset in range(3):
            day = now - timedelta(days=2 - day_offset)
            _insert_funnel_event(
                store, camp_id,
                event_type="awareness",
                occurred_at=day.isoformat(),
            )
            _insert_funnel_event(
                store, camp_id,
                event_type="engagement",
                occurred_at=day.isoformat(),
            )

        result = PredictiveIndicator.forecast_engagement(camp_id, store=store)
        assert result["confidence"] == "low"
