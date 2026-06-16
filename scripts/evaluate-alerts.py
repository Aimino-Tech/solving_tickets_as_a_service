#!/usr/bin/env python3
import json
import sys
from pathlib import Path

# Resolve hermes project root
_script = Path(__file__).resolve().parent
_candidates = [
    _script.parent,                               # scripts/.. = repo root
    Path.cwd(),                                     # wherever cron runs from
    Path.home() / ".hermes" / "src",                # editable install
]
for p in _candidates:
    if (p / "plugins" / "monitoring" / "monitor_store.py").exists():
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))
        break

from plugins.monitoring.monitor_store import MetricsStore
from plugins.monitoring.alert_engine import AlertEngine


def main() -> None:
    store = MetricsStore()
    engine = AlertEngine(store)
    fired = engine.safe_evaluate()
    if fired:
        print(json.dumps({"wakeAgent": True, "alerts": fired}))
    else:
        print(json.dumps({"wakeAgent": False}))


if __name__ == "__main__":
    main()
