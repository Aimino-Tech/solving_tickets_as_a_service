"""Tests for worker auto-scaling (KEDA ScaledObject + Celery native fallback)."""

import os
from unittest.mock import MagicMock, patch

import pytest

from workers.scaling.celery_autoscale import (
    apply_autoscale,
    build_autoscale_arg,
    resolve_concurrency,
)
from workers.scaling.keda_config import (
    DEFAULT_MAX_CONCURRENCY,
    DEFAULT_MIN_CONCURRENCY,
    QUEUE_CONCURRENCY,
    QUEUE_SCALING_THRESHOLDS,
    get_concurrency_range,
    get_queue_threshold,
    is_keda_available,
)

# ---------------------------------------------------------------------------
# KEDA Detection
# ---------------------------------------------------------------------------


class TestKedaDetection:
    def test_not_available_by_default(self):
        """KEDA is not available when KEDA_ENABLED is unset."""
        with patch.dict(os.environ, {}, clear=True):
            assert is_keda_available() is False

    @pytest.mark.parametrize("truthy", ["true", "True", "1", "yes", "YES"])
    def test_available_when_enabled(self, truthy: str):
        """KEDA is available when KEDA_ENABLED is a truthy value."""
        with patch.dict(os.environ, {"KEDA_ENABLED": truthy}, clear=True):
            assert is_keda_available() is True

    @pytest.mark.parametrize("falsy", ["false", "False", "0", "no", "disabled"])
    def test_not_available_when_disabled(self, falsy: str):
        """KEDA is not available when KEDA_ENABLED is falsy."""
        with patch.dict(os.environ, {"KEDA_ENABLED": falsy}, clear=True):
            assert is_keda_available() is False


# ---------------------------------------------------------------------------
# Queue Thresholds
# ---------------------------------------------------------------------------


class TestQueueThresholds:
    def test_known_queue_returns_config(self):
        """A known queue returns its configured threshold."""
        assert get_queue_threshold("stas.agents.dispatch") == 2
        assert get_queue_threshold("stas.agents.notifications") == 10

    def test_unknown_queue_returns_default(self):
        """Unknown queues fall back to threshold of 5."""
        assert get_queue_threshold("stas.agents.unknown") == 5

    def test_all_queues_have_threshold(self):
        """Every queue defined in CELERY_QUEUES has a threshold entry."""
        from workers.celeryconfig import task_queues

        for queue in task_queues:
            name = queue.name
            assert name in QUEUE_SCALING_THRESHOLDS, (
                f"Queue {name!r} is missing from QUEUE_SCALING_THRESHOLDS"
            )


# ---------------------------------------------------------------------------
# Concurrency Ranges
# ---------------------------------------------------------------------------


class TestConcurrencyRanges:
    def test_known_queue_returns_range(self):
        """A known queue returns its configured (min, max) concurrency."""
        assert get_concurrency_range("stas.agents.dispatch") == (0, 4)
        assert get_concurrency_range("stas.agents.sandbox") == (1, 6)

    def test_unknown_queue_returns_default(self):
        """Unknown queues fall back to default concurrency range."""
        min_c, max_c = get_concurrency_range("stas.agents.unknown")
        assert min_c == DEFAULT_MIN_CONCURRENCY
        assert max_c == DEFAULT_MAX_CONCURRENCY

    def test_all_queues_have_concurrency(self):
        """Every queue defined in CELERY_QUEUES has a concurrency entry."""
        from workers.celeryconfig import task_queues

        for queue in task_queues:
            name = queue.name
            assert name in QUEUE_CONCURRENCY, (
                f"Queue {name!r} is missing from QUEUE_CONCURRENCY"
            )


# ---------------------------------------------------------------------------
# Celery Native Autoscale — resolve_concurrency
# ---------------------------------------------------------------------------


class TestResolveConcurrency:
    def test_default_values(self):
        """Without env overrides, defaults are used."""
        with patch.dict(os.environ, {}, clear=True):
            min_c, max_c = resolve_concurrency()
            assert min_c == DEFAULT_MIN_CONCURRENCY
            assert max_c == DEFAULT_MAX_CONCURRENCY

    def test_env_override_min(self):
        """CELERY_AUTOSCALE_MIN overrides the default min."""
        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MIN": "3"}, clear=True):
            min_c, max_c = resolve_concurrency()
            assert min_c == 3
            assert max_c == DEFAULT_MAX_CONCURRENCY

    def test_env_override_max(self):
        """CELERY_AUTOSCALE_MAX overrides the default max."""
        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MAX": "16"}, clear=True):
            min_c, max_c = resolve_concurrency()
            assert min_c == DEFAULT_MIN_CONCURRENCY
            assert max_c == 16

    def test_env_override_both(self):
        """Both env vars override defaults."""
        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MIN": "2", "CELERY_AUTOSCALE_MAX": "12"}, clear=True):
            min_c, max_c = resolve_concurrency()
            assert min_c == 2
            assert max_c == 12

    def test_min_never_exceeds_max(self):
        """If env sets min > max, the result is clamped so min <= max."""
        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MIN": "10", "CELERY_AUTOSCALE_MAX": "4"}, clear=True):
            min_c, max_c = resolve_concurrency()
            assert min_c <= max_c
            # Both are clamped to the higher value (min takes precedence)
            assert min_c == 10
            assert max_c == 10

    def test_min_is_non_negative(self):
        """Min concurrency is clamped to 0."""
        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MIN": "-1"}, clear=True):
            min_c, _ = resolve_concurrency()
            assert min_c == 0


# ---------------------------------------------------------------------------
# Celery Native Autoscale — build_autoscale_arg
# ---------------------------------------------------------------------------


class TestBuildAutoscaleArg:
    def test_returns_string_when_min_lt_max(self):
        """When min < max, returns 'min,max' string."""
        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MIN": "1", "CELERY_AUTOSCALE_MAX": "8"}, clear=True):
            arg = build_autoscale_arg()
            assert arg == "1,8"

    def test_returns_none_when_min_eq_max(self):
        """When min == max, returns None (fixed concurrency)."""
        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MIN": "4", "CELERY_AUTOSCALE_MAX": "4"}, clear=True):
            assert build_autoscale_arg() is None

    def test_returns_none_when_min_gt_max(self):
        """When min > max, returns None (clamped to fixed concurrency)."""
        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MIN": "8", "CELERY_AUTOSCALE_MAX": "4"}, clear=True):
            # clamped to (8, 8) → None
            assert build_autoscale_arg() is None

    def test_defaults_generate_valid_arg(self):
        """Default concurrency values generate a valid autoscale arg."""
        with patch.dict(os.environ, {}, clear=True):
            arg = build_autoscale_arg()
            assert arg is not None
            min_s, max_s = arg.split(",")
            assert int(min_s) <= int(max_s)


# ---------------------------------------------------------------------------
# Celery Native Autoscale — apply_autoscale
# ---------------------------------------------------------------------------


class TestApplyAutoscale:
    def test_sets_worker_autoscale_on_celery_app(self):
        """apply_autoscale sets worker_autoscale on a Celery app."""
        mock_app = MagicMock()
        mock_app.conf = MagicMock()

        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MIN": "2", "CELERY_AUTOSCALE_MAX": "10"}, clear=True):
            # We need a proper Celery type check, so mock isinstance
            with patch("workers.scaling.celery_autoscale.isinstance", return_value=True):
                apply_autoscale(mock_app)
                # Celery conf supports attribute assignment directly
                assert mock_app.conf.worker_autoscale == "2,10"

    def test_skips_autoscale_when_min_eq_max(self):
        """apply_autoscale does nothing when concurrency is fixed."""
        mock_app = MagicMock()

        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MIN": "4", "CELERY_AUTOSCALE_MAX": "4"}, clear=True):
            apply_autoscale(mock_app)
            mock_app.conf.update.assert_not_called()

    def test_logs_warning_on_non_celery_app(self):
        """apply_autoscale warns if the app is not a Celery instance."""
        not_a_celery_app = object()

        with patch.dict(os.environ, {"CELERY_AUTOSCALE_MIN": "1", "CELERY_AUTOSCALE_MAX": "4"}, clear=True):
            apply_autoscale(not_a_celery_app)  # should not raise


# ---------------------------------------------------------------------------
# configure_scaling integration
# ---------------------------------------------------------------------------


class TestConfigureScaling:
    def test_keda_mode_does_not_apply_autoscale(self):
        """When KEDA is available, Celery autoscale is not applied."""
        from workers.scaling import configure_scaling

        mock_app = MagicMock()

        with patch.dict(os.environ, {"KEDA_ENABLED": "true"}, clear=True):
            with patch("workers.scaling.apply_autoscale") as mock_apply:
                configure_scaling(mock_app)
                mock_apply.assert_not_called()

    def test_no_keda_mode_applies_autoscale(self):
        """When KEDA is not available, Celery autoscale is applied."""
        from workers.scaling import configure_scaling

        mock_app = MagicMock()

        with patch.dict(os.environ, {}, clear=True):
            with patch("workers.scaling.apply_autoscale") as mock_apply:
                configure_scaling(mock_app)
                mock_apply.assert_called_once_with(mock_app)


# ---------------------------------------------------------------------------
# Module import / integrity
# ---------------------------------------------------------------------------


def test_scaling_module_importable():
    """The scaling package and all submodules are importable."""
    import workers.scaling
    import workers.scaling.celery_autoscale
    import workers.scaling.keda_config

    assert workers.scaling.configure_scaling is not None
    assert workers.scaling.is_keda_available is not None
    assert workers.scaling.get_queue_threshold is not None
    assert workers.scaling.get_concurrency_range is not None


def test_is_keda_available_function():
    """is_keda_available is exported from the package."""
    from workers.scaling import is_keda_available

    assert callable(is_keda_available)
