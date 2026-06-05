"""
STAS Celery Application — Entry point for all background workers.

This module creates the Celery app instance and configures it with:
  - RabbitMQ as the message broker
  - Redis as the result backend
  - Auto-discovery of task modules from the tasks/ directory
  - Production-ready configuration (acks_late, prefetch, etc.)

Usage:
    celery -A celery_app worker -l info -Q stas.agents.triage,stas.agents.dispatch
    celery -A celery_app beat -l info
"""

import os
from celery import Celery

# ---------------------------------------------------------------------------
# Celery App
# ---------------------------------------------------------------------------

app = Celery(
    'stas',
    broker=os.getenv(
        'CELERY_BROKER_URL',
        os.getenv('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672//'),
    ),
    backend=os.getenv(
        'CELERY_RESULT_BACKEND',
        os.getenv('REDIS_URL', 'redis://localhost:6379/0'),
    ),
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

app.conf.update(
    # Queue definitions
    task_queues={
        'stas.agents.triage': {},
        'stas.agents.dispatch': {},
        'stas.agents.sandbox': {},
        'stas.agents.verification': {},
        'stas.agents.pr_creation': {},
        'stas.agents.notifications': {},
    },
    # Routing — tasks declare their own queue via @app.task(queue=...)
    task_default_queue='stas.agents.dispatch',
    task_default_exchange='stas',
    task_default_routing_key='stas.default',
    # Prefetch — one task at a time per worker process for fair dispatch
    worker_prefetch_multiplier=1,
    # Acknowledge late — only ack after task completes (not when received)
    task_acks_late=True,
    # Reject on worker loss — requeue if worker crashes mid-task
    task_reject_on_worker_lost=True,
    # Track started state for visibility
    task_track_started=True,
    # Serialization
    task_serializer='json',
    result_serializer='json',
    accept_content=['json'],
    # Time limits — soft kills after warning, hard kills after deadline
    task_soft_time_limit=int(os.getenv('TASK_SOFT_TIME_LIMIT', '300')),   # 5 min
    task_time_limit=int(os.getenv('TASK_TIME_LIMIT', '600')),             # 10 min
    # Result expiration — clean up after 24 hours
    result_expires=86_400,
    # Beat schedule (if any periodic tasks are needed)
    beat_schedule={},
    # Logging
    worker_hijack_root_logger=False,
    worker_log_format='[%(asctime)s: %(levelname)s/%(processName)s] %(message)s',
    worker_task_log_format='[%(asctime)s: %(levelname)s/%(processName)s] [%(task_name)s(%(task_id)s)] %(message)s',
)

# ---------------------------------------------------------------------------
# Auto-discover tasks
# ---------------------------------------------------------------------------

app.autodiscover_tasks(['tasks'], force=True)
