"""
Celery app configuration for STAS.

Integrates with the existing workers.tasks modules and adds Django management
commands as Celery tasks. The app auto-discovers tasks from all installed
Django apps and the workers.tasks package.
"""
from __future__ import absolute_import, unicode_literals

import os
import sys
import logging

from celery import Celery

logger = logging.getLogger(__name__)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "stas.settings")

# Ensure project root is on sys.path so workers package is importable
_project_root = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

app = Celery("stas")

# Load config from Django settings (CELERY_ namespace)
app.config_from_object("django.conf:settings", namespace="CELERY")

# Disable remote control since RabbitMQ 4.x removed transient_nonexcl_queues pidbox queues
app.conf.worker_enable_remote_control = False

# Auto-discover tasks from installed apps + workers module
app.autodiscover_tasks(
    packages=[
        "webhooks",
        "agents",
        "billing",
        "api",
    ],
    force=True,
)

# Explicitly register workers.tasks modules
app.autodiscover_tasks(["workers.tasks"], force=True)


@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    """Configure periodic/scheduled tasks if needed."""
    logger.info(
        "STAS Celery app configured — broker=%s backend=%s",
        app.conf.broker_url,
        app.conf.result_backend,
    )
