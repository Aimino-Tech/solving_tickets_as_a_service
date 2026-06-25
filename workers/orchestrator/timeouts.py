"""
Timeout Enforcement - per-task-type ``soft_time_limit`` and ``time_limit``.

Celery already supports ``task_soft_time_limit`` and ``task_time_limit`` at
the app level (set in ``celeryconfig.py``). This module adds **per-task-type**
overrides so that different task types can have different timeouts.

Design
------
    Celery's ``task_soft_time_limit`` and ``task_time_limit`` are config keys
    that set the default for all tasks. Per-task overrides are applied via
    the ``@app.task(soft_time_limit=N, time_limit=M)`` decorator or via
    ``task_routes`` / ``task_annotations``.

    This module exposes a function ``get_task_timeouts()`` that returns a dict
    of ``task_annotations`` suitable for merging directly into
    ``celeryconfig.py``.

Configuration (env vars)
------------------------
    Each task type has an optional env var override:

    ``TIMEOUT_TRIAGE_SOFT``  / ``TIMEOUT_TRIAGE_HARD``   (default: 120 / 150)
    ``TIMEOUT_AGENT_SOFT``   / ``TIMEOUT_AGENT_HARD``    (default: 580 / 600)
    ``TIMEOUT_SANDBOX_SOFT`` / ``TIMEOUT_SANDBOX_HARD``  (default: 300 / 330)
    ``TIMEOUT_VERIFY_SOFT``  / ``TIMEOUT_VERIFY_HARD``   (default: 300 / 330)
    ``TIMEOUT_PR_SOFT``      / ``TIMEOUT_PR_HARD``       (default: 120 / 150)
    ``TIMEOUT_NOTIFY_SOFT``  / ``TIMEOUT_NOTIFY_HARD``   (default: 60 / 90)
    ``TIMEOUT_PERIODIC_SOFT`` / ``TIMEOUT_PERIODIC_HARD`` (default: 120 / 150)
    ``TIMEOUT_SELF_AUDIT_SOFT`` / ``TIMEOUT_SELF_AUDIT_HARD`` (default: 300 / 330)
    ``TIMEOUT_LINEAR_POLL_SOFT`` / ``TIMEOUT_LINEAR_POLL_HARD`` (default: 60 / 90)
    ``TIMEOUT_CI_POLL_SOFT`` / ``TIMEOUT_CI_POLL_HARD``   (default: 120 / 150)
    ``TIMEOUT_SANDBOX_GC_SOFT`` / ``TIMEOUT_SANDBOX_GC_HARD`` (default: 120 / 150)
    ``TIMEOUT_ORCHESTRATOR_SOFT`` / ``TIMEOUT_ORCHESTRATOR_HARD`` (default: 120 / 150)
    ``TIMEOUT_QUALITY_SOFT`` / ``TIMEOUT_QUALITY_HARD``   (default: 120 / 150)
    ``TIMEOUT_DEFAULT_SOFT`` / ``TIMEOUT_DEFAULT_HARD``   (default: 580 / 600)
"""

from __future__ import annotations

import os
from typing import Any


# ---------------------------------------------------------------------------
# Timeout configuration per task type
# ---------------------------------------------------------------------------

_TASK_TIMEOUTS: dict[str, tuple[int, int]] = {
    "workers.tasks.triage.": (
        int(os.getenv("TIMEOUT_TRIAGE_SOFT", "120")),
        int(os.getenv("TIMEOUT_TRIAGE_HARD", "150")),
    ),
    "workers.tasks.agent.": (
        int(os.getenv("TIMEOUT_AGENT_SOFT", "580")),
        int(os.getenv("TIMEOUT_AGENT_HARD", "600")),
    ),
    "workers.tasks.sandbox.": (
        int(os.getenv("TIMEOUT_SANDBOX_SOFT", "300")),
        int(os.getenv("TIMEOUT_SANDBOX_HARD", "330")),
    ),
    "workers.tasks.verification.": (
        int(os.getenv("TIMEOUT_VERIFY_SOFT", "300")),
        int(os.getenv("TIMEOUT_VERIFY_HARD", "330")),
    ),
    "workers.tasks.pr_creation.": (
        int(os.getenv("TIMEOUT_PR_SOFT", "120")),
        int(os.getenv("TIMEOUT_PR_HARD", "150")),
    ),
    "workers.tasks.notifications.": (
        int(os.getenv("TIMEOUT_NOTIFY_SOFT", "60")),
        int(os.getenv("TIMEOUT_NOTIFY_HARD", "90")),
    ),
    "workers.tasks.periodic.": (
        int(os.getenv("TIMEOUT_PERIODIC_SOFT", "120")),
        int(os.getenv("TIMEOUT_PERIODIC_HARD", "150")),
    ),
    "workers.tasks.self_audit.": (
        int(os.getenv("TIMEOUT_SELF_AUDIT_SOFT", "300")),
        int(os.getenv("TIMEOUT_SELF_AUDIT_HARD", "330")),
    ),
    "workers.tasks.linear_poll.": (
        int(os.getenv("TIMEOUT_LINEAR_POLL_SOFT", "60")),
        int(os.getenv("TIMEOUT_LINEAR_POLL_HARD", "90")),
    ),
    "workers.tasks.ci_polling.": (
        int(os.getenv("TIMEOUT_CI_POLL_SOFT", "120")),
        int(os.getenv("TIMEOUT_CI_POLL_HARD", "150")),
    ),
    "workers.tasks.sandbox_gc.": (
        int(os.getenv("TIMEOUT_SANDBOX_GC_SOFT", "120")),
        int(os.getenv("TIMEOUT_SANDBOX_GC_HARD", "150")),
    ),
    "workers.orchestrator.": (
        int(os.getenv("TIMEOUT_ORCHESTRATOR_SOFT", "120")),
        int(os.getenv("TIMEOUT_ORCHESTRATOR_HARD", "150")),
    ),
    "workers.quality.": (
        int(os.getenv("TIMEOUT_QUALITY_SOFT", "120")),
        int(os.getenv("TIMEOUT_QUALITY_HARD", "150")),
    ),
}

_DEFAULT_SOFT = int(os.getenv("TIMEOUT_DEFAULT_SOFT", "580"))
_DEFAULT_HARD = int(os.getenv("TIMEOUT_DEFAULT_HARD", "600"))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_timeout_for_task(task_name: str) -> tuple[int, int]:
    """Get the (soft, hard) timeout for a given Celery task name.

    Args:
        task_name: Fully-qualified Celery task name (e.g. workers.tasks.triage.triage_issue).

    Returns:
        ``(soft_time_limit, time_limit)`` tuple in seconds.
    """
    for prefix, (soft, hard) in _TASK_TIMEOUTS.items():
        if task_name.startswith(prefix):
            return soft, hard
    return _DEFAULT_SOFT, _DEFAULT_HARD


def get_task_annotations() -> dict[str, dict[str, Any]]:
    """Return a ``task_annotations`` dict for use in Celery config.

    This can be merged into ``celeryconfig.py``::

        from workers.orchestrator.timeouts import get_task_annotations
        task_annotations = get_task_annotations()

    Returns:
        A dict mapping task-name-prefix -> annotation dict with
        ``soft_time_limit`` and ``time_limit``.
    """
    annotations: dict[str, dict[str, Any]] = {}
    for prefix, (soft, hard) in _TASK_TIMEOUTS.items():
        annotations[prefix] = {
            "soft_time_limit": soft,
            "time_limit": hard,
        }
    return annotations


def validate_timeouts() -> list[str]:
    """Validate that all timeout configurations are sensible.

    Checks:
        - soft <= hard (soft should be less than hard)
        - All values are positive

    Returns:
        A list of warning/error messages (empty if all valid).
    """
    issues: list[str] = []
    for prefix, (soft, hard) in _TASK_TIMEOUTS.items():
        if soft <= 0:
            issues.append("Task prefix '%s': soft_time_limit=%d must be > 0" % (prefix, soft))
        if hard <= 0:
            issues.append("Task prefix '%s': time_limit=%d must be > 0" % (prefix, hard))
        if soft >= hard:
            issues.append(
                "Task prefix '%s': soft_time_limit=%d >= time_limit=%d "
                "(soft should be < hard to allow graceful timeout)" % (prefix, soft, hard)
            )
        grace = hard - soft
        if grace < 5:
            issues.append(
                "Task prefix '%s': soft->hard grace period is only %ds "
                "(recommended >= 10s for SoftTimeLimitSignals to work)" % (prefix, grace)
            )
    return issues
