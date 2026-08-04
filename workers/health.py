#!/usr/bin/env python3
"""
SYNTARO Worker Health Check — HTTP health endpoint for Celery workers.

This script runs a lightweight HTTP server on port 8080 that serves:
  - GET /health  — overall worker health (checks broker and backend connectivity)
  - GET /health/ready — readiness check (same as health, for k8s probes)

The Docker HEALTHCHECK and k8s probes use this endpoint to verify the
worker is alive and connected to the message broker and result backend.

Usage:
    python3 health.py          # starts server on 0.0.0.0:8080
    python3 health.py --check  # one-shot check (exit 0=healthy, 1=unhealthy)
"""

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional

import redis
from celery import Celery

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HEALTH_PORT = int(os.getenv('WORKER_HEALTH_PORT', '8080'))
BROKER_URL = os.getenv(
    'CELERY_BROKER_URL',
    os.getenv('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672//'),
)
BACKEND_URL = os.getenv(
    'CELERY_RESULT_BACKEND',
    os.getenv('REDIS_URL', 'redis://localhost:6379/0'),
)

# ---------------------------------------------------------------------------
# Health check logic
# ---------------------------------------------------------------------------

class HealthStatus:
    """Collects and serializes health check results."""

    def __init__(self) -> None:
        self.status: str = 'ok'
        self.checks: dict[str, dict] = {}
        self.start_time: float = time.time()

    def add_check(self, name: str, ok: bool, detail: Optional[str] = None) -> None:
        self.checks[name] = {
            'status': 'ok' if ok else 'error',
            'detail': detail or '',
        }
        if not ok and self.status == 'ok':
            self.status = 'error'

    def to_dict(self) -> dict:
        return {
            'status': self.status,
            'uptime': time.time() - self.start_time,
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'checks': self.checks,
        }


def check_broker(url: str) -> tuple[bool, Optional[str]]:
    """Check connectivity to the Celery message broker (RabbitMQ)."""
    try:
        app = Celery('syntaro-health', broker=url)
        conn = app.connection(timeout=5)
        conn.ensure_connection(max_retries=1)
        conn.release()
        return True, None
    except Exception as exc:
        return False, str(exc)


def check_backend(url: str) -> tuple[bool, Optional[str]]:
    """Check connectivity to the Celery result backend (Redis)."""
    try:
        client = redis.from_url(url, socket_connect_timeout=5, socket_timeout=5)
        client.ping()
        client.close()
        return True, None
    except Exception as exc:
        return False, str(exc)


def run_health_check() -> HealthStatus:
    """Run all health checks and return aggregated status."""
    status = HealthStatus()

    broker_ok, broker_err = check_broker(BROKER_URL)
    status.add_check('broker', broker_ok, broker_err)

    backend_ok, backend_err = check_backend(BACKEND_URL)
    status.add_check('backend', backend_ok, backend_err)

    return status


def is_healthy() -> bool:
    """One-shot check: returns True if all subsystems are healthy."""
    status = run_health_check()
    return status.status == 'ok'


# ---------------------------------------------------------------------------
# HTTP Server
# ---------------------------------------------------------------------------

class HealthHandler(BaseHTTPRequestHandler):
    """HTTP request handler for health check endpoints."""

    def _respond(self, status_code: int, body: dict) -> None:
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.end_headers()
        self.wfile.write(json.dumps(body).encode('utf-8'))

    def do_GET(self) -> None:
        status = run_health_check()
        body = status.to_dict()

        if self.path == '/health/ready':
            pass
        elif self.path != '/health':
            self._respond(404, {'error': 'Not found', 'path': self.path})
            return

        status_code = 200 if status.status == 'ok' else 503
        self._respond(status_code, body)

    def log_message(self, _format: str, *_args) -> None:
        pass


def start_health_server(port: int = HEALTH_PORT) -> None:
    """Start a lightweight HTTP server for health checks."""
    server = HTTPServer(('0.0.0.0', port), HealthHandler)
    print(f'Health check server listening on 0.0.0.0:{port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if '--check' in sys.argv:
        sys.exit(0 if is_healthy() else 1)
    else:
        start_health_server()
