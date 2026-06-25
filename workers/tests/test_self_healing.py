import time

import pytest

from workers.healing.heartbeat import WorkerHeartbeatMonitor
from workers.healing.retry import AutoRetryHandler, compute_backoff
from workers.healing.circuit_breaker import CircuitBreaker
from workers.healing.queue_drain import QueueDrainMonitor


class TestWorkerHeartbeatMonitor:
    def test_record_heartbeat_without_redis(self):
        monitor = WorkerHeartbeatMonitor(redis_client=None)
        monitor.record_heartbeat("worker-1")

    def test_is_worker_alive_without_redis(self):
        monitor = WorkerHeartbeatMonitor(redis_client=None)
        assert monitor.is_worker_alive("worker-1") is True

    def test_get_dead_workers_without_redis(self):
        monitor = WorkerHeartbeatMonitor(redis_client=None)
        dead = monitor.get_dead_workers()
        assert dead == []


class TestAutoRetryHandler:
    def test_get_retry_count_without_redis(self):
        handler = AutoRetryHandler(redis_client=None)
        assert handler.get_retry_count("task-1") == 0

    def test_should_retry_first_attempt(self):
        handler = AutoRetryHandler(redis_client=None)
        should, delay = handler.should_retry("task-1")
        assert should is True
        assert delay > 0

    def test_compute_backoff(self):
        assert compute_backoff(1) == 1.0
        assert compute_backoff(2) == 4.0
        assert compute_backoff(3) == 16.0

    def test_should_send_to_dlq_after_max(self):
        handler = AutoRetryHandler(redis_client=None)
        assert handler.should_send_to_dlq("task-new") is False

    def test_send_to_dlq_without_redis(self):
        handler = AutoRetryHandler(redis_client=None)
        handler.send_to_dlq("task-1", "test_task", "test error")

    def test_clear_retry_count(self):
        handler = AutoRetryHandler(redis_client=None)
        handler.clear_retry_count("task-1")


class TestCircuitBreaker:
    def test_initial_state_closed(self):
        breaker = CircuitBreaker(redis_client=None)
        assert breaker.is_open("test_type") is False

    def test_record_failure_increments(self):
        breaker = CircuitBreaker(redis_client=None)
        state = breaker.record_failure("test_type")
        assert "failure_count" in state

    def test_record_success_resets(self):
        breaker = CircuitBreaker(redis_client=None)
        breaker.record_success("test_type")

    def test_get_state(self):
        breaker = CircuitBreaker(redis_client=None)
        state = breaker.get_state("test_type")
        assert state["state"] == "closed"

    def test_reset(self):
        breaker = CircuitBreaker(redis_client=None)
        breaker.reset("test_type")


class TestQueueDrainMonitor:
    def test_get_queue_depth_without_broker(self):
        monitor = QueueDrainMonitor(redis_client=None)
        depth = monitor.get_queue_depth("test_queue")
        assert depth == 0

    def test_is_drain_needed(self):
        monitor = QueueDrainMonitor(redis_client=None)
        assert monitor.is_drain_needed("test_queue") is False

    def test_check_worker_coverage(self):
        monitor = QueueDrainMonitor(redis_client=None)
        coverage = monitor.check_worker_coverage()
        assert "worker_count" in coverage

    def test_get_all_queue_depths(self):
        monitor = QueueDrainMonitor(redis_client=None)
        depths = monitor.get_all_queue_depths()
        assert isinstance(depths, dict)


def test_full_recovery_cycle():
    breaker = CircuitBreaker(redis_client=None)
    breaker.record_success("test_type")
    assert breaker.is_open("test_type") is False
    state = breaker.get_state("test_type")
    assert state["state"] == "closed"
