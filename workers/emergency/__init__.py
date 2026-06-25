"""
STAS Emergency Kill Switch — Python worker module.

This module provides Celery worker-side support for the emergency stop
mechanism. When the kill switch is activated, Celery workers check the
status before executing tasks and refuse to start new ones.

Components:
    - EmergencyStop  — Redis + file-backed status check (mirrors TS version)
    - middleware     — Celery signal handler (task_prerun) that checks stop
    - revoke         — Force-revoke all running agent tasks

Usage:
    from workers.emergency import EmergencyStop, emergency_prerun, revoke_all_agent_tasks

    # Check if stop is active
    if EmergencyStop.check():
        print("Emergency stop is active")

    # Connect signal handler (usually in celery_app.py)
    from celery import signals
    signals.task_prerun.connect(emergency_prerun)
"""

from workers.emergency.stop import EmergencyStop
from workers.emergency.middleware import emergency_prerun
from workers.emergency.revoke import revoke_all_agent_tasks

__all__ = [
    "EmergencyStop",
    "emergency_prerun",
    "revoke_all_agent_tasks",
]
