"""
Healthcheck module for Celery worker.

Provides a lightweight HTTP healthcheck endpoint using Python's stdlib,
so no additional dependencies are required. Run alongside the Celery worker
via the entrypoint script to expose /health and /healthz on a configurable port.

Usage:
    python -m workers.health

Environment:
    HEALTH_PORT    — Port to listen on (default: 8080)
    HEALTH_BIND    — Bind address (default: 0.0.0.0)
"""

import json
import logging
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

logger = logging.getLogger(__name__)


class HealthHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler that responds to /health and /healthz."""

    def do_GET(self):
        if self.path in ("/health", "/healthz"):
            body = json.dumps({"status": "ok", "service": "stas-celery-worker"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        logger.debug("Healthcheck HTTP — %s", format % args)


def serve_healthcheck():
    """Start the healthcheck HTTP server (blocking)."""
    port = int(os.getenv("HEALTH_PORT", "8080"))
    bind = os.getenv("HEALTH_BIND", "0.0.0.0")
    server = HTTPServer((bind, port), HealthHandler)
    logger.info("Healthcheck server listening on %s:%s", bind, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Healthcheck server shutting down")
        server.server_close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    serve_healthcheck()
