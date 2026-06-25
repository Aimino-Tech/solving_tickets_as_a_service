"""
Tests for AIM-2022 Self-Healing Infrastructure.

Tests cover:
    1. heartbeat.py - worker heartbeat recording, dead worker detection
    2. circuit_breaker.py - state transitions, failure/success recording
    3. dlq_replay.py - retry counting, should_replay logic
    4. timeouts.py - per-task timeout lookups, validation
    5. cleanup.py - (basic integration tests)
    6. queue_drain.py - (basic integration tests)
"""

import calendar
import json
import time
from typing import Any, Generator
from unittest.mock import MagicMock, patch, PropertyMock

import pytest


# ═══════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════


@pytest.fixture(autouse=True)
def clear_redis_client() -> Generator[None, None, None]:
    """Clear Redis client caches between tests."""
    from workers.orchestrator import heartbeat, circuit_breaker, dlq_replay, queue_drain

    heartbeat._REDIS_CLIENT = None
    circuit_breaker._REDIS_CLIENT = None
    dlq_replay._REDIS_CLIENT = None
    yield


@pytest.fixture
def mock_redis() -> Generator[MagicMock, None, None]:
    """Mock Redis client for use in tests."""
    mock = MagicMock()
    mock.ping.return_value = True
    mock.get.return_value = None
    mock.set.return_value = True
    mock.expire.return_value = True
    mock.sadd.return_value = 1
    mock.srem.return_value = 1
    mock.smembers.return_value = set()
    mock.sismember.return_value = False
    mock.scard.return_value = 0
    mock.scan.return_value = (0, [])
    mock.llen.return_value = 0
    mock.incr.return_value = 1
    mock.delete.return_value = 1
    mock.hset.return_value = 1
    mock.hget.return_value = None
    mock.hkeys.return_value = []
    mock.hdel.return_value = 1

    with patch("redis.from_url", return_value=mock):
        yield mock


# ═══════════════════════════════════════════════════════════════════════
# Heartbeat Tests
# ═══════════════════════════════════════════════════════════════════════


class TestHeartbeat:
    def test_record_heartbeat(self, mock_redis: MagicMock) -> None:
        """Test that record_heartbeat stores a timestamp in Redis."""
        from workers.orchestrator.heartbeat import record_heartbeat

        record_heartbeat("worker1@host1")

        mock_redis.set.assert_called_once()
        key = mock_redis.set.call_args[0][0]
        assert key.startswith("stas:heartbeat:")
        assert "worker1@host1" in key
        mock_redis.expire.assert_called_once()

    def test_get_last_heartbeat_exists(self, mock_redis: MagicMock) -> None:
        """Test get_last_heartbeat returns timestamp when key exists."""
        from workers.orchestrator.heartbeat import get_last_heartbeat

        mock_redis.get.return_value = "2024-01-01T00:00:00Z"
        result = get_last_heartbeat("worker1@host1")
        assert result == "2024-01-01T00:00:00Z"

    def test_get_last_heartbeat_missing(self, mock_redis: MagicMock) -> None:
        """Test get_last_heartbeat returns None when key missing."""
        from workers.orchestrator.heartbeat import get_last_heartbeat

        mock_redis.get.return_value = None
        result = get_last_heartbeat("worker1@host1")
        assert result is None

    def test_find_dead_workers(self, mock_redis: MagicMock) -> None:
        """Test find_dead_workers detects stale heartbeats."""
        from workers.orchestrator.heartbeat import find_dead_workers, _REDIS_HB_PREFIX

        # Use calendar.timegm to get UTC-based timestamp that is 120s in the past
        old_ts_seconds = time.time() - 120
        old_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(old_ts_seconds))
        mock_redis.scan.return_value = (0, [_REDIS_HB_PREFIX + "dead_worker@host"])
        mock_redis.get.return_value = old_ts

        dead = find_dead_workers()
        assert len(dead) == 1
        assert dead[0]["hostname"] == "dead_worker@host"
        assert dead[0]["seconds_since_heartbeat"] >= 60

    def test_find_dead_workers_none(self, mock_redis: MagicMock) -> None:
        """Test find_dead_workers returns empty when all workers are alive."""
        from workers.orchestrator.heartbeat import find_dead_workers, _REDIS_HB_PREFIX, _parse_heartbeat_ts

        # Use a recent timestamp that is definitely not stale
        recent_ts_seconds = time.time() - 5  # 5 seconds ago
        recent_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(recent_ts_seconds))
        mock_redis.scan.return_value = (0, [_REDIS_HB_PREFIX + "alive_worker@host"])
        mock_redis.get.return_value = recent_ts

        dead = find_dead_workers()
        assert len(dead) == 0

    def test_mark_and_is_dead(self, mock_redis: MagicMock) -> None:
        """Test mark_worker_dead and is_worker_dead."""
        from workers.orchestrator.heartbeat import mark_worker_dead, is_worker_dead

        mock_redis.sismember.return_value = True

        mark_worker_dead("dead_worker@host")
        mock_redis.sadd.assert_called_once()
        mock_redis.expire.assert_called_once()

        assert is_worker_dead("dead_worker@host") is True

    def test_on_worker_heartbeat_records_and_unmarks(self, mock_redis: MagicMock) -> None:
        """Test on_worker_heartbeat records heartbeat and unmarks dead workers."""
        from workers.orchestrator.heartbeat import on_worker_heartbeat

        mock_redis.sismember.return_value = True  # Worker was marked dead

        on_worker_heartbeat({"hostname": "recovered_worker@host"})

        # Should have recorded heartbeat and unmarked dead
        mock_redis.set.assert_called_once()
        mock_redis.srem.assert_called_once_with("stas:heartbeat:dead_workers", "recovered_worker@host")

    def test_degraded_no_redis(self) -> None:
        """Test find_dead_workers returns empty when Redis is unavailable."""
        from workers.orchestrator.heartbeat import find_dead_workers

        dead = find_dead_workers()
        assert dead == []


# ═══════════════════════════════════════════════════════════════════════
# Circuit Breaker Tests
# ═══════════════════════════════════════════════════════════════════════


class TestCircuitBreaker:
    def test_initial_state_closed(self, mock_redis: MagicMock) -> None:
        """Test that a new task type starts in CLOSED state."""
        from workers.orchestrator.circuit_breaker import get_state

        state = get_state("test_task")
        assert state == "CLOSED"

    def test_record_failure_opens_at_threshold(self, mock_redis: MagicMock) -> None:
        """Test that recording threshold failures opens the circuit."""
        from workers.orchestrator.circuit_breaker import record_failure, _THRESHOLD

        mock_redis.get.side_effect = lambda k: b"CLOSED" if k.endswith(":state") else None
        mock_redis.incr.return_value = _THRESHOLD  # Hit threshold

        result = record_failure("test_task")
        assert result["state"] == "OPEN"
        assert result["failure_count"] == _THRESHOLD

    def test_record_success_closes_half_open(self, mock_redis: MagicMock) -> None:
        """Test that a success in HALF_OPEN closes the circuit."""
        from workers.orchestrator.circuit_breaker import record_success

        def mock_get(key: str) -> Any:
            if key.endswith(":state"):
                return "HALF_OPEN"
            return None

        mock_redis.get = mock_get

        result = record_success("test_task")
        assert result["state"] == "CLOSED"

    def test_check_circuit_blocks_when_open(self, mock_redis: MagicMock) -> None:
        """Test check_circuit returns allowed=False when circuit is OPEN."""
        from workers.orchestrator.circuit_breaker import check_circuit

        def mock_get(key: str) -> Any:
            if key.endswith(":state"):
                return "OPEN"
            if key.endswith(":opened_at"):
                return str(time.time() - 10)  # opened 10s ago (< 60s threshold)
            return None

        mock_redis.get = mock_get

        allowed, reason = check_circuit("test_task")
        assert allowed is False
        assert "OPEN" in reason

    def test_check_circuit_allows_when_closed(self, mock_redis: MagicMock) -> None:
        """Test check_circuit returns allowed=True when circuit is CLOSED."""
        from workers.orchestrator.circuit_breaker import check_circuit

        mock_redis.get.return_value = "CLOSED"

        allowed, reason = check_circuit("test_task")
        assert allowed is True

    def test_get_all_circuits(self, mock_redis: MagicMock) -> None:
        """Test get_all_circuits returns current state of all circuits."""
        from workers.orchestrator.circuit_breaker import get_all_circuits, _REDIS_PREFIX

        mock_redis.scan.return_value = (0, [_REDIS_PREFIX + "task_a:state"])
        mock_redis.get.side_effect = lambda k: {
            _REDIS_PREFIX + "task_a:state": "OPEN",
            _REDIS_PREFIX + "task_a:failure_count": "3",
            _REDIS_PREFIX + "task_a:opened_at": str(time.time()),
        }.get(k, None)

        circuits = get_all_circuits()
        assert "task_a" in circuits
        assert circuits["task_a"]["state"] == "OPEN"
        assert circuits["task_a"]["failure_count"] == 3

    def test_reset_circuit(self, mock_redis: MagicMock) -> None:
        """Test reset_circuit clears all circuit state."""
        from workers.orchestrator.circuit_breaker import reset_circuit

        result = reset_circuit("test_task")
        assert result is True
        # delete() is called with *keys_to_delete, so 1 call with 5 args
        assert mock_redis.delete.call_count >= 1
        # The call should have multiple key args
        call_args = mock_redis.delete.call_args[0]
        assert len(call_args) >= 4

    def test_check_circuit_half_open_allows(self, mock_redis: MagicMock) -> None:
        """Test check_circuit allows a limited number of tests in HALF_OPEN."""
        from workers.orchestrator.circuit_breaker import check_circuit

        def mock_get(key: str) -> Any:
            if key.endswith(":state"):
                return "HALF_OPEN"
            if key.endswith(":half_open_tests"):
                return "0"  # No tests used yet
            return None

        mock_redis.get = mock_get

        allowed, reason = check_circuit("test_task")
        assert allowed is True
        assert reason == "half_open_test"

    def test_check_circuit_half_open_blocks_after_limit(self, mock_redis: MagicMock) -> None:
        """Test check_circuit blocks after max half-open test attempts."""
        from workers.orchestrator.circuit_breaker import check_circuit

        def mock_get(key: str) -> Any:
            if key.endswith(":state"):
                return "HALF_OPEN"
            if key.endswith(":half_open_tests"):
                return "1"  # Already used 1 test
            return None

        mock_redis.get = mock_get

        allowed, reason = check_circuit("test_task")
        assert allowed is False
        assert "1/1" in reason


# ═══════════════════════════════════════════════════════════════════════
# DLQ Replay Tests
# ═══════════════════════════════════════════════════════════════════════


class TestDLQReplay:
    def test_get_retry_count_from_headers(self) -> None:
        """Test get_retry_count reads from headers."""
        from workers.orchestrator.dlq_replay import get_retry_count

        headers = {"retry_count": 2}
        count = get_retry_count(headers, {})
        assert count == 2

    def test_get_retry_count_default(self, mock_redis: MagicMock) -> None:
        """Test get_retry_count returns 0 when no retry info exists."""
        from workers.orchestrator.dlq_replay import get_retry_count

        headers = {}
        count = get_retry_count(headers, {})
        assert count == 0

    def test_get_retry_count_from_redis(self, mock_redis: MagicMock) -> None:
        """Test get_retry_count falls back to Redis when no header."""
        from workers.orchestrator.dlq_replay import get_retry_count

        mock_redis.get.return_value = "3"
        headers = {"id": "msg-123"}
        count = get_retry_count(headers, {})
        assert count == 3

    def test_should_replay_true(self) -> None:
        """Test should_replay returns True for messages under max retries."""
        from workers.orchestrator.dlq_replay import should_replay, _MAX_RETRIES

        headers = {"retry_count": _MAX_RETRIES - 1}
        should, reason = should_replay(headers, {})
        assert should is True
        assert reason == ""

    def test_should_replay_false(self) -> None:
        """Test should_replay returns False for messages at max retries."""
        from workers.orchestrator.dlq_replay import should_replay, _MAX_RETRIES

        headers = {"retry_count": _MAX_RETRIES}
        should, reason = should_replay(headers, {})
        assert should is False
        assert "max_retries" in reason

    def test_compute_delay_exponential(self) -> None:
        """Test compute_delay uses exponential backoff."""
        from workers.orchestrator.dlq_replay import compute_delay, _RETRY_BACKOFF_BASE_S

        assert compute_delay(1) == _RETRY_BACKOFF_BASE_S
        assert compute_delay(2) == _RETRY_BACKOFF_BASE_S * 2
        assert compute_delay(3) == _RETRY_BACKOFF_BASE_S * 4

    def test_mark_permanently_failed(self, mock_redis: MagicMock) -> None:
        """Test mark_permanently_failed adds to Redis set."""
        from workers.orchestrator.dlq_replay import mark_permanently_failed

        headers = {"id": "failed-msg-001"}
        mark_permanently_failed(headers, {"data": "test"})

        mock_redis.sadd.assert_called_once()
        mock_redis.expire.assert_called_once()

    def test_set_retry_count(self, mock_redis: MagicMock) -> None:
        """Test set_retry_count persists to headers and Redis."""
        from workers.orchestrator.dlq_replay import set_retry_count

        headers = {"id": "msg-001"}
        set_retry_count(headers, {}, 2)

        assert headers["retry_count"] == 2
        mock_redis.set.assert_called_once()
        # set is called with ex=86400 as a keyword arg, not expire()
        call_kwargs = mock_redis.set.call_args[1]
        assert "ex" in call_kwargs
        assert call_kwargs["ex"] == 86400

    def test_should_replay_with_redis(self, mock_redis: MagicMock) -> None:
        """Test should_replay reads from Redis for retry count."""
        from workers.orchestrator.dlq_replay import should_replay, _MAX_RETRIES

        mock_redis.get.return_value = str(_MAX_RETRIES - 1)
        should, reason = should_replay({"id": "msg-001"}, {})
        assert should is True

        mock_redis.get.return_value = str(_MAX_RETRIES)
        should, reason = should_replay({"id": "msg-002"}, {})
        assert should is False


# ═══════════════════════════════════════════════════════════════════════
# Timeouts Tests
# ═══════════════════════════════════════════════════════════════════════


class TestTimeouts:
    def test_get_timeout_for_task_known(self) -> None:
        """Test get_timeout_for_task returns configured timeouts for known tasks."""
        from workers.orchestrator.timeouts import get_timeout_for_task

        soft, hard = get_timeout_for_task("workers.tasks.triage.triage_issue")
        assert soft == 120
        assert hard == 150

        soft, hard = get_timeout_for_task("workers.tasks.agent.dispatch_opencode")
        assert soft == 580
        assert hard == 600

    def test_get_timeout_for_task_unknown(self) -> None:
        """Test get_timeout_for_task returns defaults for unknown tasks."""
        from workers.orchestrator.timeouts import get_timeout_for_task

        soft, hard = get_timeout_for_task("unknown.task.name")
        assert soft == 580
        assert hard == 600

    def test_get_task_annotations(self) -> None:
        """Test get_task_annotations returns expected annotation dict."""
        from workers.orchestrator.timeouts import get_task_annotations

        annotations = get_task_annotations()
        assert "workers.tasks.triage." in annotations
        assert annotations["workers.tasks.triage."]["soft_time_limit"] == 120
        assert annotations["workers.tasks.triage."]["time_limit"] == 150
        assert "workers.tasks.agent." in annotations

    def test_validate_timeouts_valid(self) -> None:
        """Test validate_timeouts returns no issues for valid config."""
        from workers.orchestrator.timeouts import validate_timeouts

        issues = validate_timeouts()
        timeout_issues = [i for i in issues if "must be > 0" in i or "should be < hard" in i]
        assert len(timeout_issues) == 0

    def test_get_timeout_for_task_prefix_matching(self) -> None:
        """Test that task prefix matching works correctly."""
        from workers.orchestrator.timeouts import get_timeout_for_task

        soft, hard = get_timeout_for_task("workers.orchestrator.rework.rework_loop")
        assert soft == 120
        assert hard == 150

        soft, hard = get_timeout_for_task("workers.tasks.periodic.self_healing_heartbeat_check")
        assert soft == 120
        assert hard == 150


# ═══════════════════════════════════════════════════════════════════════
# Cleanup Tests
# ═══════════════════════════════════════════════════════════════════════


class TestCleanup:
    def test_revoke_dead_worker_no_tasks(self) -> None:
        """Test revoke_dead_worker_tasks returns 0 when no tasks found."""
        from workers.orchestrator.cleanup import revoke_dead_worker_tasks

        with patch("workers.orchestrator.cleanup.current_app") as mock_app:
            mock_inspect = MagicMock()
            mock_app.control.inspect.return_value = mock_inspect
            mock_inspect.active.return_value = {}
            mock_inspect.reserved.return_value = {}

            count = revoke_dead_worker_tasks("nonexistent_worker@host")
            assert count == 0

    def test_revoke_dead_worker_with_tasks(self) -> None:
        """Test revoke_dead_worker_tasks revokes active and reserved tasks."""
        from workers.orchestrator.cleanup import revoke_dead_worker_tasks

        with patch("workers.orchestrator.cleanup.current_app") as mock_app:
            mock_inspect = MagicMock()
            mock_app.control.inspect.return_value = mock_inspect
            mock_inspect.active.return_value = {
                "dead_worker@host": [
                    {"id": "task-1", "name": "test_task"},
                    {"id": "task-2", "name": "test_task"},
                ]
            }
            mock_inspect.reserved.return_value = {
                "dead_worker@host": [
                    {"id": "task-3", "name": "test_task"},
                ]
            }

            count = revoke_dead_worker_tasks("dead_worker@host")
            assert count == 3
            mock_app.control.revoke.assert_called_once()
            task_ids = mock_app.control.revoke.call_args[0][0]
            assert "task-1" in task_ids
            assert "task-2" in task_ids
            assert "task-3" in task_ids


# ═══════════════════════════════════════════════════════════════════════
# Queue Drain Tests
# ═══════════════════════════════════════════════════════════════════════


class TestQueueDrain:
    def test_get_queue_depth_via_redis(self, mock_redis: MagicMock) -> None:
        """Test get_queue_depth falls back to Redis when RabbitMQ API unavailable."""
        from workers.orchestrator.queue_drain import get_queue_depth

        mock_redis.llen.return_value = 5

        with patch("workers.orchestrator.queue_drain._get_rabbitmq_depth", return_value=None):
            depth = get_queue_depth("test_queue")
            assert depth == 5

    def test_check_queue_drain_no_alerts(self, mock_redis: MagicMock) -> None:
        """Test check_queue_drain returns no alerts for empty queues."""
        from workers.orchestrator.queue_drain import check_queue_drain

        mock_redis.llen.return_value = 0
        with patch("workers.orchestrator.queue_drain._get_rabbitmq_depth", return_value=0):
            result = check_queue_drain()
            assert len(result["alerts"]) == 0

    def test_queue_drain_queues_key(self) -> None:
        """Test check_queue_drain result has the 'queues' key."""
        from workers.orchestrator.queue_drain import check_queue_drain
        with patch("workers.orchestrator.queue_drain._get_rabbitmq_depth", return_value=0):
            result = check_queue_drain()
            assert "queues" in result
