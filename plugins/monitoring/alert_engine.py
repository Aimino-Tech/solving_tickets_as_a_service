import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from .monitor_store import MetricsStore

logger = logging.getLogger(__name__)

COOLDOWN_MINUTES = 5


class AlertEngine:
    def __init__(self, store: MetricsStore):
        self.store = store

    def evaluate(self) -> list[dict[str, Any]]:
        fired: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc)
        configs = self.store.get_alert_configs(enabled_only=True)

        for cfg in configs:
            try:
                cfg_name = cfg["name"]
                metric_name = cfg["metric_name"]
                condition = cfg["condition"]
                threshold = cfg["threshold"]
                duration = cfg["duration_seconds"]
                last_fired_str = cfg.get("last_fired_at")

                # Cooldown: skip if fired within last 5 minutes
                if last_fired_str:
                    try:
                        last_fired = datetime.fromisoformat(last_fired_str)
                        if last_fired.tzinfo is None:
                            last_fired = last_fired.replace(tzinfo=timezone.utc)
                        if now - last_fired < timedelta(minutes=COOLDOWN_MINUTES):
                            continue
                    except (ValueError, TypeError):
                        pass

                # Query metric values
                if duration > 0:
                    since = (now - timedelta(seconds=duration)).isoformat()
                    values = self.store.query_values(metric_name, since=since)
                else:
                    values = self.store.query_values(metric_name)

                if not values:
                    continue

                # Evaluate condition
                if duration > 0:
                    # Sustained window: ALL values must satisfy condition
                    all_satisfy = all(
                        self._check_condition(v["value"], condition, threshold)
                        for v in values
                    )
                    if not all_satisfy:
                        continue
                    current_value = values[0]["value"]
                else:
                    # Zero duration: check latest value only
                    latest = values[0]
                    if not self._check_condition(latest["value"], condition, threshold):
                        continue
                    current_value = latest["value"]

                fired_at = now.isoformat()
                self.store.update_last_fired(cfg_name, fired_at)

                fired.append({
                    "name": cfg_name,
                    "metric_name": metric_name,
                    "current_value": current_value,
                    "threshold": threshold,
                    "condition": condition,
                    "fired_at": fired_at,
                })
            except Exception:
                logger.exception("AlertEngine: error evaluating alert %s", cfg.get("name", "unknown"))
                continue

        return fired

    def safe_evaluate(self) -> list[dict[str, Any]]:
        try:
            return self.evaluate()
        except Exception:
            logger.exception("AlertEngine.safe_evaluate: unexpected error")
            return []

    def _check_condition(self, value: float, condition: str, threshold: float) -> bool:
        if condition == ">":
            return value > threshold
        elif condition == ">=":
            return value >= threshold
        elif condition == "<":
            return value < threshold
        elif condition == "<=":
            return value <= threshold
        elif condition == "==" or condition == "=":
            return value == threshold
        elif condition == "!=":
            return value != threshold
        else:
            logger.warning("AlertEngine: unknown condition '%s', treating as '>'", condition)
            return value > threshold
