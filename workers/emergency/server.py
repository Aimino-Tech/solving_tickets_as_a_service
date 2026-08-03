"""
Emergency Stop HTTP API — remote control for the global deadman switch.

Follows the same pattern as ``workers/pause_server.py``.

Endpoints
---------
- ``POST /api/emergency-stop``        — activate the kill switch
- ``POST /api/emergency-stop/resume``  — deactivate the kill switch
- ``GET  /api/emergency-stop/status``  — return current state
- ``GET  /health``                     — liveness
"""

from __future__ import annotations

import json
import logging
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import urlparse

from workers.audit.admin_trail import log_admin_action
from workers.emergency.stop import AGENT_QUEUES, HOLD_QUEUE, get_emergency_stop

logger = logging.getLogger(__name__)

EMERGENCY_API_PORT = int(os.getenv("EMERGENCY_API_PORT", "8083"))


def _move_pending_to_hold(app: Any) -> dict[str, int]:
    """Drain pending messages from agent queues and republish to the hold queue.

    Uses kombu consumer/producer directly.  Returns a dict of
    ``{queue_name: messages_moved}``.
    """
    from kombu import Connection, Exchange, Producer, Queue as KombuQueue

    broker_url = os.getenv(
        "CELERY_BROKER_URL",
        os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672//"),
    )
    exchange = Exchange("syntaro", type="direct")
    moved: dict[str, int] = {}

    try:
        with Connection(broker_url) as conn:
            producer = Producer(conn, exchange=exchange, routing_key=HOLD_QUEUE)

            for qname in AGENT_QUEUES:
                source = KombuQueue(qname, exchange=exchange, routing_key=qname)
                count = 0
                with conn.Consumer(
                    source,
                    callbacks=[lambda _body, _msg: None],  # manual fetch below
                    accept=["json"],
                    auto_declare=True,
                ) as consumer:
                    # Drain available messages
                    while True:
                        msg = consumer.fetch(timeout=1.0)
                        if msg is None:
                            break
                        try:
                            producer.publish(
                                msg.payload,
                                routing_key=HOLD_QUEUE,
                                headers={
                                    **(msg.headers or {}),
                                    "x-original-queue": qname,
                                    "x-emergency-hold": "true",
                                },
                                retry=True,
                            )
                            msg.ack()
                            count += 1
                        except Exception as exc:
                            logger.error(
                                "Failed to move message from %s to hold: %s",
                                qname,
                                exc,
                            )
                            msg.reject()
                if count:
                    logger.warning("Moved %d messages from %s → %s", count, qname, HOLD_QUEUE)
                moved[qname] = count

    except Exception as exc:
        logger.error("Failed to drain agent queues: %s", exc)
        moved["_error"] = str(exc)

    return moved


def _revoke_active_tasks(app: Any) -> list[dict[str, Any]]:
    """Revoke all currently-running agent tasks with ``terminate=True``.

    Returns a list of revoked task info dicts.
    """
    revoked: list[dict[str, Any]] = []

    try:
        inspect = app.control.inspect()
        active = inspect.active() or {}

        for worker_host, tasks in active.items():
            for task in tasks:
                task_name = task.get("name", "")
                task_id = task.get("id", "")

                if not any(task_name.startswith(p) for p in (
                    "workers.tasks.triage.",
                    "workers.tasks.agent.",
                    "workers.tasks.sandbox.",
                    "workers.tasks.verification.",
                    "workers.tasks.pr_creation.",
                    "workers.tasks.notifications.",
                    "workers.tasks.linear_poll.",
                    "workers.tasks.pipeline_orchestrator.",
                )):
                    continue

                app.control.revoke(task_id, terminate=True)
                logger.warning(
                    "Revoked task=%s task_id=%s on worker=%s",
                    task_name,
                    task_id,
                    worker_host,
                )
                revoked.append({
                    "task_id": task_id,
                    "task_name": task_name,
                    "worker": worker_host,
                })
    except Exception as exc:
        logger.error("Failed to revoke active tasks: %s", exc)

    return revoked


def _activate_emergency(app: Any, reason: str = "") -> dict[str, Any]:
    """Activate emergency stop, revoke tasks, and move pending to hold."""
    stop = get_emergency_stop()
    state = stop.activate(reason=reason)

    revoked = _revoke_active_tasks(app)
    moved = _move_pending_to_hold(app)

    state["revoked_tasks"] = revoked
    state["moved_to_hold"] = moved

    return state


def _deactivate_emergency() -> dict[str, Any]:
    """Deactivate emergency stop."""
    return get_emergency_stop().deactivate()


# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------


class EmergencyStopAPIHandler(BaseHTTPRequestHandler):
    """HTTP handler for emergency stop REST API."""

    es = get_emergency_stop()

    def do_GET(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        try:
            if path == "/health":
                self._respond(200, {"status": "ok", "service": "emergency-stop"})
            elif path == "/api/emergency-stop/status":
                state = self.es.read_state()
                self._respond(200, state)
            else:
                self._respond(404, {"error": "Not found"})
        except Exception as exc:
            logger.error("GET %s: %s", self.path, exc)
            self._respond(500, {"error": "Internal error"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        body = self._read_body()
        try:
            if path == "/api/emergency-stop":
                reason = body.get("reason", "")
                from workers.celery_app import app as celery_app

                state = _activate_emergency(celery_app, reason=reason)
                log_admin_action(
                    actor="api",
                    action="emergency.activate",
                    resource="system",
                    details={"reason": reason},
                )
                self._respond(200, state)
            elif path == "/api/emergency-stop/resume":
                state = _deactivate_emergency()
                log_admin_action(
                    actor="api",
                    action="emergency.deactivate",
                    resource="system",
                    details={},
                )
                self._respond(200, state)
            else:
                self._respond(404, {"error": "Not found"})
        except Exception as exc:
            logger.error("POST %s: %s", self.path, exc)
            self._respond(500, {"error": "Internal error"})

    def _read_body(self) -> dict[str, Any]:
        cl = int(self.headers.get("Content-Length", 0))
        if cl == 0:
            return {}
        try:
            return json.loads(self.rfile.read(cl))
        except Exception:
            return {}

    def _respond(self, code: int, body: dict[str, Any]) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, indent=2, default=str).encode("utf-8"))

    def log_message(self, fmt: str, *args) -> None:
        logger.debug("Emergency API " + fmt % args)


def start_emergency_server(port: int = EMERGENCY_API_PORT) -> None:
    """Start the emergency stop HTTP API server (blocking)."""
    s = HTTPServer(("0.0.0.0", port), EmergencyStopAPIHandler)
    logger.info("Emergency stop API on :%d", port)
    try:
        s.serve_forever()
    except KeyboardInterrupt:
        s.shutdown()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    start_emergency_server()
