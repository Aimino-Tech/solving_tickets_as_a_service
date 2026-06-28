"""Tests for graceful worker shutdown and task drain."""

import os
from unittest.mock import patch

from workers.celery_app import app
from workers.shutdown.handler import (
    DEFAULT_GRACE_PERIOD,
    GRACE_PERIODS,
    GracefulShutdownHandler,
    get_grace_period,
)


# ── Grace Period Resolution ───────────────────────────────────────────


def test_get_grace_period_agent_task():
    """Agent dispatch tasks get 300s grace period."""
    assert get_grace_period("workers.tasks.agent.dispatch_opencode") == 300


def test_get_grace_period_sandbox_task():
    """Sandbox lifecycle tasks get 300s grace period."""
    assert get_grace_period("workers.tasks.sandbox.boot_sandbox") == 300


def test_get_grace_period_verification_task():
    """Verification tasks get 120s grace period."""
    assert get_grace_period("workers.tasks.verification.run_verification") == 120


def test_get_grace_period_triage_task():
    """Triage tasks get 60s grace period."""
    assert get_grace_period("workers.tasks.triage.triage_issue") == 60


def test_get_grace_period_pr_creation_task():
    """PR creation tasks get 60s grace period."""
    assert get_grace_period("workers.tasks.pr_creation.create_pull_request") == 60


def test_get_grace_period_notification_task():
    """Notification tasks get 30s grace period."""
    assert get_grace_period("workers.tasks.notifications.send_notification") == 30


def test_get_grace_period_periodic_task():
    """Periodic tasks get 30s grace period."""
    assert get_grace_period("workers.tasks.periodic.queue_health_check") == 30


def test_get_grace_period_unknown_task():
    """Unknown task prefixes get the default 30s grace period."""
    assert get_grace_period("workers.tasks.unknown.custom_task") == DEFAULT_GRACE_PERIOD


def test_get_grace_period_env_override():
    """WORKER_GRACE_PERIOD_SECONDS env var overrides all per-task defaults."""
    with patch.dict(os.environ, {"WORKER_GRACE_PERIOD_SECONDS": "600"}):
        # Re-import to pick up the env override
        import importlib
        from workers import shutdown as shutdown_module

        importlib.reload(shutdown_module)

        from workers.shutdown.handler import get_grace_period as gp

        assert gp("workers.tasks.agent.dispatch_opencode") == 600
        assert gp("workers.tasks.notifications.send_notification") == 600
        assert gp("workers.tasks.unknown.foo") == 600


# ── GracefulShutdownHandler Tracking ──────────────────────────────────


def test_handler_singleton():
    """GracefulShutdownHandler is a singleton."""
    h1 = GracefulShutdownHandler()
    h2 = GracefulShutdownHandler()
    assert h1 is h2


def test_handler_initial_state():
    """Handler starts with no shutdown request and zero in-flight tasks."""
    handler = GracefulShutdownHandler()
    # Reset for a clean test
    handler._initialized = False
    handler.__init__()

    assert not handler.is_shutting_down
    assert handler.in_flight_count() == 0


def test_track_task_start_and_end():
    """Tracking a task increases the count; ending it decreases."""
    handler = GracefulShutdownHandler()
    handler._initialized = False
    handler.__init__()

    handler._track_start("task-1", "workers.tasks.agent.dispatch_opencode")
    assert handler.in_flight_count() == 1

    handler._track_start("task-2", "workers.tasks.triage.triage_issue")
    assert handler.in_flight_count() == 2

    handler._track_end("task-1")
    assert handler.in_flight_count() == 1

    handler._track_end("task-2")
    assert handler.in_flight_count() == 0


def test_track_end_unknown_task_is_noop():
    """Calling track_end for an unknown task does not raise."""
    handler = GracefulShutdownHandler()
    handler._initialized = False
    handler.__init__()

    # Should not raise
    handler._track_end("nonexistent-task")
    assert handler.in_flight_count() == 0


def test_in_flight_count_concurrent_safe():
    """Multiple start/end operations produce correct counts."""
    handler = GracefulShutdownHandler()
    handler._initialized = False
    handler.__init__()

    ids = [f"task-{i}" for i in range(10)]
    for tid in ids:
        handler._track_start(tid, "workers.tasks.agent.test")

    assert handler.in_flight_count() == 10

    for tid in ids[:5]:
        handler._track_end(tid)

    assert handler.in_flight_count() == 5

    for tid in ids[5:]:
        handler._track_end(tid)

    assert handler.in_flight_count() == 0


# ── Celery App Configuration ──────────────────────────────────────────


def test_task_acks_late_is_set():
    """Celery app has task_acks_late=True for safe re-queue on worker loss."""
    assert app.conf.task_acks_late is True


def test_task_reject_on_worker_lost_is_set():
    """Celery app has task_reject_on_worker_lost=True."""
    assert app.conf.task_reject_on_worker_lost is True


def test_worker_cancel_long_running_tasks_on_connection_loss():
    """Celery app cancels long-running tasks on broker connection loss."""
    assert app.conf.worker_cancel_long_running_tasks_on_connection_loss is True


def test_grace_periods_cover_all_registered_tasks():
    """Every registered task has a corresponding grace period entry.

    This ensures we don't add a new task module and forget to add its
    grace period. Periodic/celery-beat tasks use the 'workers.tasks.periodic.'
    prefix.
    """
    known_prefixes = set(GRACE_PERIODS.keys())
    uncovered = []

    for task_name in app.tasks:
        # Skip internal Celery tasks (celery.*, etc.)
        if not task_name.startswith("workers."):
            continue
        # Skip the ping task (workers.celery_app.ping)
        if task_name == "workers.celery_app.ping":
            continue
        if not any(task_name.startswith(p) for p in known_prefixes):
            uncovered.append(task_name)

    assert not uncovered, f"Tasks without grace period coverage: {uncovered}"


# ── Module Import / Integrity ─────────────────────────────────────────


def test_shutdown_handler_importable():
    """GracefulShutdownHandler is importable from workers.shutdown."""
    from workers.shutdown import GracefulShutdownHandler as GSH

    assert GSH is GracefulShutdownHandler
