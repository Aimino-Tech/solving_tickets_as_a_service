"""Tests for marketing alert rules and the evaluate-marketing-alerts cron script.

Tests cover:
    - ``MARKETING_ALERT_RULES`` data integrity (all 4 rules, required fields)
    - ``register_marketing_alerts()`` creation + idempotency + disabled-by-default
    - ``collect_marketing_metrics()`` with empty campaigns (via subprocess)
    - Script-level end-to-end execution with empty and breached data
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from plugins.monitoring.alert_rules import MARKETING_ALERT_RULES, register_marketing_alerts
from plugins.monitoring.monitor_store import MetricsStore


# ===========================================================================
#  Cleanup: MetricsStore caches connections in a class-level thread-local.
#  Without clearing it between tests, each new instance on the same thread
#  reuses the previous instance's connection (to a different DB path).
# ===========================================================================


@pytest.fixture(autouse=True)
def _clear_metrics_store_conn() -> None:
    """Clear the cached MetricsStore connection before each test.

    ``MetricsStore.conn`` is cached via a class-level ``threading.local()``
    so multiple instances on the same thread share connections.  This
    autouse fixture clears the cache so each test gets a fresh connection.
    """
    try:
        if hasattr(MetricsStore._local, "conn") and MetricsStore._local.conn is not None:
            MetricsStore._local.conn.close()
    except Exception:
        pass
    MetricsStore._local.conn = None


# ===========================================================================
#  Fixtures
# ===========================================================================


@pytest.fixture
def metrics_store(tmp_path: Path) -> MetricsStore:
    db_path = tmp_path / "test_metrics.db"
    return MetricsStore(db_path=str(db_path))


@pytest.fixture
def sample_rules() -> list[dict]:
    return list(MARKETING_ALERT_RULES)


# ===========================================================================
#  Helpers
# ===========================================================================


def _hermes_env(tmp_path: Path) -> dict[str, str]:
    """Build an env dict that points HERMES_HOME at *tmp_path*/.hermes."""
    hermes_home = tmp_path / ".hermes"
    hermes_home.mkdir(parents=True, exist_ok=True)
    return {
        "HERMES_HOME": str(hermes_home),
        "PATH": "/usr/bin:/bin",
        "HOME": str(tmp_path),
    }


def _metrics_db_path(tmp_path: Path) -> Path:
    """Return the path to metrics.db under a hermes-home created by _hermes_env."""
    return tmp_path / ".hermes" / "monitoring" / "metrics.db"


def _run_script(tmp_path: Path) -> subprocess.CompletedProcess:
    """Run evaluate-marketing-alerts.py in a subprocess and return the result."""
    script_path = Path(__file__).resolve().parents[2] / "scripts" / "evaluate-marketing-alerts.py"
    assert script_path.exists()
    env = _hermes_env(tmp_path)
    return subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        timeout=30,
        env=env,
        cwd=tmp_path,
    )


def _ensure_monitoring_dir(tmp_path: Path) -> Path:
    """Ensure the monitoring directory exists under the hermes home and return db path."""
    db_path = _metrics_db_path(tmp_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path


# ===========================================================================
#  Rule data integrity
# ===========================================================================


class TestMarketingAlertRules:

    def test_has_all_four_rules(self, sample_rules: list[dict]) -> None:
        assert len(sample_rules) == 4

    def test_expected_rule_names(self, sample_rules: list[dict]) -> None:
        names = {r["name"] for r in sample_rules}
        assert names == {"engagement_decline", "zero_activity_48h", "sheet_sync_failure", "funnel_dropoff"}

    def test_every_rule_has_required_fields(self, sample_rules: list[dict]) -> None:
        required = {"name", "metric_name", "condition", "threshold", "duration_seconds", "delivery", "enabled"}
        for rule in sample_rules:
            missing = required - set(rule.keys())
            assert not missing, f"Rule {rule['name']} missing fields: {missing}"

    def test_condition_is_valid(self, sample_rules: list[dict]) -> None:
        valid_conditions = {">", ">=", "<", "<=", "==", "!="}
        for rule in sample_rules:
            assert rule["condition"] in valid_conditions

    def test_threshold_is_numeric(self, sample_rules: list[dict]) -> None:
        for rule in sample_rules:
            assert isinstance(rule["threshold"], (int, float))

    def test_duration_seconds_is_nonnegative_int(self, sample_rules: list[dict]) -> None:
        for rule in sample_rules:
            assert isinstance(rule["duration_seconds"], int) and rule["duration_seconds"] >= 0

    def test_delivery_is_string(self, sample_rules: list[dict]) -> None:
        for rule in sample_rules:
            assert isinstance(rule["delivery"], str) and rule["delivery"]

    def test_enabled_is_bool(self, sample_rules: list[dict]) -> None:
        for rule in sample_rules:
            assert isinstance(rule["enabled"], bool)

    def test_funnel_dropoff_disabled_by_default(self, sample_rules: list[dict]) -> None:
        rule = next(r for r in sample_rules if r["name"] == "funnel_dropoff")
        assert rule["enabled"] is False

    def test_other_rules_enabled_by_default(self, sample_rules: list[dict]) -> None:
        for rule in sample_rules:
            if rule["name"] != "funnel_dropoff":
                assert rule["enabled"] is True

    def test_severity_is_present(self, sample_rules: list[dict]) -> None:
        for rule in sample_rules:
            assert "severity" in rule
            assert rule["severity"] in ("P1", "P2", "P3")

    def test_description_is_present(self, sample_rules: list[dict]) -> None:
        for rule in sample_rules:
            assert rule.get("description")


# ===========================================================================
#  register_marketing_alerts
# ===========================================================================


class TestRegisterMarketingAlerts:

    def test_creates_all_four_rules(self, metrics_store: MetricsStore) -> None:
        count = register_marketing_alerts(metrics_store)
        assert count == 4

        configs = metrics_store.get_alert_configs(enabled_only=False)
        assert len(configs) == 4
        names = {c["name"] for c in configs}
        assert names == {"engagement_decline", "zero_activity_48h", "sheet_sync_failure", "funnel_dropoff"}

    def test_idempotent(self, metrics_store: MetricsStore) -> None:
        register_marketing_alerts(metrics_store)
        count = register_marketing_alerts(metrics_store)
        assert count == 0

        configs = metrics_store.get_alert_configs(enabled_only=False)
        assert len(configs) == 4

    def test_funnel_dropoff_disabled_after_register(self, metrics_store: MetricsStore) -> None:
        register_marketing_alerts(metrics_store)
        alert = metrics_store.get_alert("funnel_dropoff")
        assert alert is not None
        assert alert["enabled"] == 0

    def test_other_rules_enabled(self, metrics_store: MetricsStore) -> None:
        register_marketing_alerts(metrics_store)
        for name in ("engagement_decline", "zero_activity_48h", "sheet_sync_failure"):
            alert = metrics_store.get_alert(name)
            assert alert is not None
            assert alert["enabled"] == 1

    def test_alert_config_fields_match_rules(self, metrics_store: MetricsStore) -> None:
        register_marketing_alerts(metrics_store)
        configs = metrics_store.get_alert_configs(enabled_only=False)
        config_map = {c["name"]: c for c in configs}

        for rule in MARKETING_ALERT_RULES:
            cfg = config_map[rule["name"]]
            assert cfg["metric_name"] == rule["metric_name"]
            assert cfg["condition"] == rule["condition"]
            assert cfg["threshold"] == rule["threshold"]
            assert cfg["duration_seconds"] == rule["duration_seconds"]
            assert cfg["delivery"] == rule["delivery"]


# ===========================================================================
#  Script end-to-end test (via subprocess)
# ===========================================================================


class TestEvaluateMarketingAlertsScript:
    """Verify the cron script runs cleanly and produces expected JSON output."""

    def test_script_runs_without_error_empty_data(self, tmp_path: Path) -> None:
        """Script produces valid JSON and reports no alerts with empty data."""
        result = _run_script(tmp_path)
        assert result.returncode == 0, f"stderr: {result.stderr}"

        data = json.loads(result.stdout)
        assert data["action"] == "evaluate-marketing-alerts"
        assert data["alerts_fired"] == 0
        assert data["wakeAgent"] is False
        assert "timestamp" in data

    def test_script_alerts_fire_with_breached_metrics(self, tmp_path: Path) -> None:
        """AlertEngine correctly detects breaches when metrics are recorded
        by the script itself during collect_marketing_metrics().

        This test registers alerts in the MetricsStore, then runs the script.
        The script records fresh metrics (all 0.0 for empty campaigns) and
        evaluates.  The ``zero_activity_48h`` alert (condition ``==`` 0,
        ``duration_seconds=0``) should fire because actions_48h will be 0.0.
        """
        db_path = _ensure_monitoring_dir(tmp_path)
        mstore = MetricsStore(db_path=str(db_path))
        register_marketing_alerts(mstore)

        result = _run_script(tmp_path)
        assert result.returncode == 0, f"stderr: {result.stderr}"

        data = json.loads(result.stdout)
        # The script records actions_48h=0.0 (empty campaigns) which triggers
        # zero_activity_48h (==0, immediate).  The engagement_decline alert
        # also fires (duration_seconds=86400, but the script records a single
        # data point which the engine evaluates against the full window).
        assert data["alerts_fired"] >= 1, (
            f"Expected at least 1 alert (zero_activity_48h: actions_48h=0.0), "
            f"got: {data}"
        )
        assert data["wakeAgent"] is True

        fired_names = {a["name"] for a in data.get("alerts", [])}
        assert "zero_activity_48h" in fired_names, (
            f"Expected zero_activity_48h in fired alerts: {fired_names}"
        )
