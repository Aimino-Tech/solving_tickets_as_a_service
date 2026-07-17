"""
Guardrail metrics: Prometheus counters for guardrail failures.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any

logger = logging.getLogger(__name__)

_gauges: dict[str, dict[str, float]] = {}
_counters: dict[str, dict[str, float | int]] = {}
_lock = threading.Lock()


def record_counter(name: str, value: float | int = 1, **labels: str) -> None:
    with _lock:
        label_key = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        if name not in _counters:
            _counters[name] = {}
        _counters[name][label_key] = _counters[name].get(label_key, 0) + value


def render_metrics() -> str:
    lines: list[str] = []
    with _lock:
        for name, labels_map in _counters.items():
            lines.append(f"# HELP {name} {name}")
            lines.append(f"# TYPE {name} counter")
            for label_key, value in labels_map.items():
                if label_key:
                    lines.append(f"{name}{{{label_key}}} {value}")
                else:
                    lines.append(f"{name} {value}")
    return "\n".join(lines) + "\n"


STRICT_MODE = os.environ.get("GUARDRAIL_STRICT_MODE", "false").lower() == "true"
