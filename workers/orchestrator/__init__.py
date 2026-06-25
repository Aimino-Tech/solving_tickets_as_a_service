"""
STAS Pipeline Orchestrator — manages agent pipelines, concurrency, rework,
and self-healing infrastructure (AIM-2022).

Modules
-------
    engine
        PipelineEngine — start, cancel, and query pipeline runs.
    pipelines
        Pipeline stage definitions and task mappings.
    concurrency
        AgentConcurrencyLimiter — Redis-backed concurrency limit.
    workspace
        Workspace management (clone, cleanup).
    rework
        Rework loop — re-dispatches agents with accumulated feedback.
    heartbeat
        Worker heartbeat monitoring — detects dead workers.
    dlq_replay
        DLQ auto-replay — re-routes messages from retry exchange.
    timeouts
        Per-task-type timeout enforcement.
    cleanup
        Dead worker cleanup — revokes tasks for dead workers.
    circuit_breaker
        Circuit breaker — pauses task types after N consecutive failures.
    queue_drain
        Queue drain monitor — alerts on backed-up queues.
"""

from workers.orchestrator.engine import PipelineEngine, get_engine
from workers.orchestrator.pipelines import PIPELINES, STAGE_TASKS, get_pipeline, get_stage_task
from workers.orchestrator.concurrency import AgentConcurrencyLimiter, get_limiter
from workers.orchestrator.workspace import sanitize, create_workspace, cleanup_workspace

# Self-healing infrastructure (AIM-2022)
from workers.orchestrator.heartbeat import (
    record_heartbeat,
    find_dead_workers,
    mark_worker_dead,
    is_worker_dead,
    get_dead_workers,
    start_heartbeat_monitor,
    stop_heartbeat_monitor,
    on_worker_heartbeat,
    on_worker_online,
    on_worker_offline,
)

from workers.orchestrator.dlq_replay import (
    DLQRetryConsumer,
    start_dlq_retry_consumer,
    replay_message,
    get_retry_count,
    should_replay,
)

from workers.orchestrator.timeouts import (
    get_timeout_for_task,
    get_task_annotations,
    validate_timeouts,
)

from workers.orchestrator.cleanup import (
    revoke_dead_worker_tasks,
    cleanup_all_dead_workers,
)

from workers.orchestrator.circuit_breaker import (
    check_circuit,
    record_failure,
    record_success,
    get_state,
    get_all_circuits,
    reset_circuit,
    CLOSED,
    OPEN,
    HALF_OPEN,
)

from workers.orchestrator.queue_drain import (
    check_queue_drain,
    check_queue_drain_task,
    get_queue_depth,
)

__all__ = [
    # Core orchestration
    "PipelineEngine",
    "get_engine",
    "PIPELINES",
    "STAGE_TASKS",
    "get_pipeline",
    "get_stage_task",
    "AgentConcurrencyLimiter",
    "get_limiter",
    "sanitize",
    "create_workspace",
    "cleanup_workspace",
    # Self-healing: heartbeat
    "record_heartbeat",
    "find_dead_workers",
    "mark_worker_dead",
    "is_worker_dead",
    "get_dead_workers",
    "start_heartbeat_monitor",
    "stop_heartbeat_monitor",
    "on_worker_heartbeat",
    "on_worker_online",
    "on_worker_offline",
    # Self-healing: DLQ replay
    "DLQRetryConsumer",
    "start_dlq_retry_consumer",
    "replay_message",
    "get_retry_count",
    "should_replay",
    # Self-healing: timeouts
    "get_timeout_for_task",
    "get_task_annotations",
    "validate_timeouts",
    # Self-healing: cleanup
    "revoke_dead_worker_tasks",
    "cleanup_all_dead_workers",
    # Self-healing: circuit breaker
    "check_circuit",
    "record_failure",
    "record_success",
    "get_state",
    "get_all_circuits",
    "reset_circuit",
    "CLOSED",
    "OPEN",
    "HALF_OPEN",
    # Self-healing: queue drain
    "check_queue_drain",
    "check_queue_drain_task",
    "get_queue_depth",
]
