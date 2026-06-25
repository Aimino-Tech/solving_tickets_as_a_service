"""
Graceful shutdown handler for Celery workers.

On SIGTERM:
1. Stop accepting new tasks
2. Wait for in-flight tasks to complete (up to grace period based on task type)
3. Tasks exceeding grace period → worker forced shutdown → messages re-queued via acks_late
4. Second SIGTERM → immediate forceful exit

Usage:
    from workers.shutdown import GracefulShutdownHandler
    handler = GracefulShutdownHandler().install(app)
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ── Grace Period Configuration ──────────────────────────────────────────
# Task name prefix → max seconds to wait for completion during shutdown.
# Agent/sandbox tasks can run for minutes; notifications finish in seconds.

GRACE_PERIODS: dict[str, int] = {
    "workers.tasks.agent.": 300,           # Agent dispatch: 5 min
    "workers.tasks.sandbox.": 300,         # Sandbox lifecycle: 5 min
    "workers.tasks.verification.": 120,    # Test verification: 2 min
    "workers.tasks.triage.": 60,           # Issue triage: 1 min
    "workers.tasks.pr_creation.": 60,      # PR creation: 1 min
    "workers.tasks.notifications.": 30,    # Notifications/webhook: 30 s
    "workers.tasks.periodic.": 30,         # Periodic beat tasks: 30 s
}

DEFAULT_GRACE_PERIOD: int = 30  # fallback for unlisted tasks

def _env_grace_period() -> int:
    """Read ``WORKER_GRACE_PERIOD_SECONDS`` at call time so tests can
    override it via ``patch.dict(os.environ, ...)``."""
    raw = os.getenv("WORKER_GRACE_PERIOD_SECONDS", "0")
    try:
        return int(raw)
    except ValueError:
        return 0


def get_grace_period(task_name: str) -> int:
    """Resolve the grace period for *task_name* based on its prefix match.

    An explicit ``WORKER_GRACE_PERIOD_SECONDS`` environment variable takes
    precedence over all per-task defaults.
    """
    env_val = _env_grace_period()
    if env_val > 0:
        return env_val
    for prefix, period in GRACE_PERIODS.items():
        if task_name.startswith(prefix):
            return period
    return DEFAULT_GRACE_PERIOD


class GracefulShutdownHandler:
    """Singleton that manages controlled worker shutdown with task drain.

    Lifecycle
    ---------
    1. :meth:`install` — connect Celery signals (prerun/postrun) and install
       the SIGTERM handler during ``worker_ready``.
    2. SIGTERM → :meth:`_handle_sigterm` sets a shutdown flag, logs state,
       and spawns a daemon drain thread.
    3. The drain thread polls in-flight tasks once per second.  When all
       complete (or the grace period expires) it exits the process.
       A second SIGTERM causes an immediate ``sys.exit(1)``.

    Task tracking is lock-protected and safe from concurrent worker processes
    (Celery prefork model means each process has its own Python interpreter,
    so per-process state is naturally isolated).
    """

    _instance: Optional["GracefulShutdownHandler"] = None
    _lock: threading.Lock

    def __new__(cls, *args: object, **kwargs: object) -> "GracefulShutdownHandler":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, app: object = None) -> None:
        if getattr(self, "_initialized", False):
            return
        self._initialized = True

        self._shutdown_requested = False
        self._in_flight: dict[str, tuple[str, float]] = {}  # task_id → (name, start)
        self._lock = threading.Lock()
        self._start_time: Optional[float] = None
        self._app = app
        self._original_sigterm: object = None

    # ── Public API ────────────────────────────────────────────────────

    def install(self, app: object) -> "GracefulShutdownHandler":
        """Wire the handler into the Celery *app*.

        Connects to four Celery signals:
        - ``worker_ready`` — install the SIGTERM handler
        - ``worker_shutdown`` — log remaining in-flight tasks
        - ``task_prerun`` — track task start
        - ``task_postrun`` — track task completion
        """
        self._app = app

        # Lazy-import to avoid import-time dependency on Celery signal module
        from celery.signals import (
            task_postrun,
            task_prerun,
            worker_ready,
            worker_shutdown,
        )

        @worker_ready.connect
        def _on_worker_ready(**kwargs: object) -> None:
            self._install_signal_handlers()
            logger.info(
                "Worker ready — graceful shutdown handler active, "
                "in-flight tasks will be tracked for drain on SIGTERM"
            )

        @worker_shutdown.connect
        def _on_worker_shutdown(**kwargs: object) -> None:
            remaining = self.in_flight_count()
            if remaining > 0:
                logger.warning(
                    "Worker shutdown with %d in-flight tasks — "
                    "they will be re-queued via acks_late",
                    remaining,
                )
            else:
                logger.info("Worker shutdown clean — no in-flight tasks")

        @task_prerun.connect
        def _on_task_prerun(task_id: str = "", task: object = None, **kwargs: object) -> None:
            task_name = getattr(task, "name", "unknown")
            if self._shutdown_requested:
                logger.warning(
                    "Task %s (%s) started AFTER shutdown request — "
                    "it will be tracked for drain",
                    task_id,
                    task_name,
                )
            self._track_start(task_id, task_name)

        @task_postrun.connect
        def _on_task_postrun(task_id: str = "", **kwargs: object) -> None:
            self._track_end(task_id)
            if self._shutdown_requested:
                remaining = self.in_flight_count()
                logger.info(
                    "Task completed during drain — %d tasks remaining",
                    remaining,
                )

        logger.info("GracefulShutdownHandler installed — task tracking active")
        return self

    @property
    def is_shutting_down(self) -> bool:
        """``True`` once a shutdown (SIGTERM) has been requested."""
        return self._shutdown_requested

    def in_flight_count(self) -> int:
        """Return the number of currently tracked in-flight tasks."""
        with self._lock:
            return len(self._in_flight)

    # ── Internal signal handling ──────────────────────────────────────

    def _install_signal_handlers(self) -> None:
        """Replace the default SIGTERM handler with a managed version."""
        self._original_sigterm = signal.signal(signal.SIGTERM, self._handle_sigterm)
        logger.debug("SIGTERM handler installed — shutdown will drain in-flight tasks")

    def _handle_sigterm(self, signum: int, _frame: object) -> None:
        """React to SIGTERM: flag shutdown, log state, start drain loop.

        On the *second* SIGTERM, exit immediately.
        """
        if self._shutdown_requested:
            count = self.in_flight_count()
            logger.warning(
                "Second SIGTERM received — forcing immediate shutdown "
                "(%d in-flight tasks will be re-queued)",
                count,
            )
            sys.exit(1)
            return  # not reached

        self._shutdown_requested = True
        self._start_time = time.monotonic()

        with self._lock:
            snapshot = dict(self._in_flight)

        if snapshot:
            logger.info(
                "SIGTERM received — stopping task acceptance. "
                "%d in-flight tasks to drain: %s",
                len(snapshot),
                list(snapshot.keys()),
            )
        else:
            logger.info(
                "SIGTERM received — no in-flight tasks, shutting down cleanly"
            )
            sys.exit(0)
            return

        threading.Thread(
            target=self._drain_loop,
            name="shutdown-drain",
            daemon=True,
        ).start()

    def _drain_loop(self) -> None:
        """Poll in-flight tasks and escalate on grace-period expiry."""
        assert self._start_time is not None

        # Use the longest grace period among active tasks
        max_grace = DEFAULT_GRACE_PERIOD
        with self._lock:
            for task_name, _start in self._in_flight.values():
                max_grace = max(max_grace, get_grace_period(task_name))

        deadline = self._start_time + max_grace
        logger.info(
            "Drain loop started — grace period=%ds, deadline=%s",
            max_grace,
            time.strftime("%H:%M:%S", time.localtime(deadline)),
        )

        while time.monotonic() < deadline:
            if self.in_flight_count() == 0:
                elapsed = time.monotonic() - self._start_time
                logger.info(
                    "All tasks completed in %.1fs — shutting down cleanly",
                    elapsed,
                )
                sys.exit(0)
                return

            elapsed = time.monotonic() - self._start_time
            with self._lock:
                task_info = [
                    f"{tid}({name})"
                    for tid, (name, _st) in self._in_flight.items()
                ]
            logger.info(
                "Draining — %d tasks remaining after %.1f/%ds: %s",
                len(task_info),
                elapsed,
                max_grace,
                task_info,
            )
            time.sleep(1)

        # ── Grace period expired ──────────────────────────────────────
        with self._lock:
            stale = dict(self._in_flight)
        logger.warning(
            "Grace period (%ds) expired — %d tasks still running: %s. "
            "Forcing shutdown — tasks will be re-queued via acks_late",
            max_grace,
            len(stale),
            list(stale.keys()),
        )
        sys.exit(1)

    def _track_start(self, task_id: str, task_name: str) -> None:
        """Register a task as in-flight."""
        with self._lock:
            self._in_flight[task_id] = (task_name, time.monotonic())

    def _track_end(self, task_id: str) -> None:
        """Unregister a completed task."""
        with self._lock:
            self._in_flight.pop(task_id, None)
