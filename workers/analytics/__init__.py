"""STAS Agent Performance Analytics (AIM-2002).

Per-run analytics tracking and daily aggregation for:
    - Fix success rate per model / task type
    - Cost per fix (model tokens, sandbox, overhead)
    - Duration per task type
    - Model comparison (pass rate vs cost)

Modules
-------
    tracker
        AnalyticsTracker -- record runs in Redis, sync daily to Postgres.
    reporter
        AnalyticsReporter -- aggregate queries for summary, by-model, by-task views.
"""

from workers.analytics.tracker import (
    AnalyticsTracker,
    AnalyticsRun,
    get_tracker,
    record_run,
    sync_to_postgres,
)
from workers.analytics.reporter import (
    AnalyticsReporter,
    DailySummary,
    ModelPerformance,
    TaskTypePerformance,
    get_reporter,
)

__all__ = [
    "AnalyticsTracker",
    "AnalyticsRun",
    "get_tracker",
    "record_run",
    "sync_to_postgres",
    "AnalyticsReporter",
    "DailySummary",
    "ModelPerformance",
    "TaskTypePerformance",
    "get_reporter",
]
