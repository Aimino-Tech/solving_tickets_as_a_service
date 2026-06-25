import os
import tempfile
import time

import pytest

from workers.emergency.stop import EmergencyStop, EMERGENCY_LOCK_FILE


def test_emergency_stop_not_active_by_default():
    stop = EmergencyStop()
    assert stop.is_active() is False


def test_activate_sets_lock_file():
    stop = EmergencyStop()
    stop.activate("Security test")
    try:
        assert os.path.isfile(EMERGENCY_LOCK_FILE)
        assert stop.is_active() is True
    finally:
        stop.deactivate()


def test_deactivate_clears_lock_file():
    stop = EmergencyStop()
    stop.activate("Test")
    stop.deactivate()
    assert os.path.isfile(EMERGENCY_LOCK_FILE) is False
    assert stop.is_active() is False


def test_activate_returns_status():
    stop = EmergencyStop()
    result = stop.activate("Security incident")
    try:
        assert result["active"] is True
        assert result["reason"] == "Security incident"
        assert "timestamp" in result
    finally:
        stop.deactivate()


def test_deactivate_returns_status():
    stop = EmergencyStop()
    stop.activate("Test")
    result = stop.deactivate()
    assert result["active"] is False


def test_get_status_when_active():
    stop = EmergencyStop()
    stop.activate("Production issue")
    try:
        status = stop.get_status()
        assert status["active"] is True
        assert "reason" in status
    finally:
        stop.deactivate()


def test_get_status_when_inactive():
    stop = EmergencyStop()
    status = stop.get_status()
    assert status["active"] is False


def test_activate_reason_is_stored():
    stop = EmergencyStop()
    stop.activate("Security incident - all agents stopped at 14:30 UTC")
    try:
        status = stop.get_status()
        assert "Security incident" in status["reason"]
    finally:
        stop.deactivate()


def test_double_activate_no_error():
    stop = EmergencyStop()
    stop.activate("First")
    try:
        stop.activate("Second")
        status = stop.get_status()
        assert status["reason"] == "Second"
    finally:
        stop.deactivate()


def test_lock_file_content():
    stop = EmergencyStop()
    reason = "Test reason"
    stop.activate(reason)
    try:
        with open(EMERGENCY_LOCK_FILE) as f:
            content = f.read().strip()
        lines = content.split("\n")
        assert lines[0] == reason
        assert float(lines[1]) > 0
    finally:
        stop.deactivate()


def test_file_fallback_when_no_redis():
    stop = EmergencyStop(redis_client=None)
    assert stop.is_active() is False
    stop.activate("No redis test")
    try:
        assert stop.is_active() is True
    finally:
        stop.deactivate()


def test_route_to_hold_task():
    from workers.tasks.emergency import route_to_hold
    result = route_to_hold("test_task", {"key": "value"})
    assert result["status"] == "held"
    assert result["task_name"] == "test_task"


def test_emergency_stop_status_task():
    from workers.tasks.emergency import emergency_stop_status
    stop = EmergencyStop()
    stop.activate("Status test")
    try:
        result = emergency_stop_status()
        assert result["active"] is True
        assert "reason" in result
    finally:
        stop.deactivate()
