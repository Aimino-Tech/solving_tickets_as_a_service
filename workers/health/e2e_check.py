"""
E2E Health Check — Celery beat periodic task that validates the full pipeline.

Performs the following checks every 5 minutes:
  1. Broker connectivity  — can we connect to RabbitMQ?
  2. Backend connectivity  — can we connect to Redis?
  3. Celery worker ping   — can we send a task and get a response?
  4. HTTP health endpoints — are Express, Django, and agent-interface alive?
  5. Queue depths          — are critical queues accumulating messages?

Each check is independent; a failure in one does not prevent the others from
running.  The overall status is ``ok`` only when every check passes.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import time
from typing import Any, Optional

import httpx
import redis as _redis_mod
from celery import Celery, shared_task

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration  (all from environment with sensible defaults)
# ---------------------------------------------------------------------------

BROKER_URL = os.getenv("CELERY_BROKER_URL", os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672//"))
BACKEND_URL = os.getenv("CELERY_RESULT_BACKEND", os.getenv("REDIS_URL", "redis://localhost:6379/0"))
HEALTH_ENDPOINTS: list[dict[str, str]] = json.loads(
    os.getenv("E2E_HEALTH_ENDPOINTS",
        '[{"name":"express","url":"http://localhost:3000/health"},'
        '{"name":"django","url":"http://localhost:8000/health/"},'
        '{"name":"agent-interface","url":"http://localhost:8090/health"}]'))
RABBITMQ_API_URL = os.getenv("RABBITMQ_API_URL", "")
RABBITMQ_API_USER = os.getenv("RABBITMQ_API_USER", "guest")
RABBITMQ_API_PASS = os.getenv("RABBITMQ_API_PASS", "guest")
CRITICAL_QUEUES: list[str] = json.loads(
    os.getenv("E2E_CRITICAL_QUEUES",
        '["syntaro.agents.triage","syntaro.agents.dispatch","syntaro.agents.sandbox"]'))
MAX_QUEUE_DEPTH = int(os.getenv("E2E_MAX_QUEUE_DEPTH", "100"))
PING_TASK_TIMEOUT = int(os.getenv("E2E_PING_TASK_TIMEOUT", "15"))


def _check_broker(url: str) -> tuple[bool, Optional[str]]:
    if not url:
        return False, "no broker URL configured"
    try:
        app = Celery("syntaro-e2e-health", broker=url)
        conn = app.connection(timeout=5)
        conn.ensure_connection(max_retries=1)
        conn.release()
        return True, None
    except Exception as exc:
        return False, str(exc)


def _check_backend(url: str) -> tuple[bool, Optional[str]]:
    if not url:
        return False, "no backend URL configured"
    try:
        client = _redis_mod.from_url(url, socket_connect_timeout=5, socket_timeout=5)
        client.ping()
        client.close()
        return True, None
    except Exception as exc:
        return False, str(exc)


def _check_worker_ping(timeout: int = PING_TASK_TIMEOUT) -> tuple[bool, Optional[str]]:
    if not BROKER_URL or not BACKEND_URL:
        return False, "broker or backend URL not configured"
    try:
        app = Celery("syntaro-e2e-ping", broker=BROKER_URL, backend=BACKEND_URL)
        r = app.control.ping(timeout=timeout)
        if r:
            for entry in r:
                for _h, reply in entry.items():
                    if reply.get("ok") is True:
                        return True, None
                    return False, str(reply.get("status", "unknown"))
            return False, "no recognisable ping entries"
        return False, "no ping response (no reachable workers)"
    except Exception as exc:
        return False, str(exc)


def _check_http_endpoints(endpoints: list[dict[str, str]], timeout: float = 10.0) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for ep in endpoints:
        name = ep.get("name", "unknown")
        url = ep.get("url", "")
        if not url:
            results.append({"name": name, "status": "error", "detail": "no URL configured"})
            continue
        try:
            resp = httpx.get(url, timeout=timeout)
            ok = resp.status_code < 500
            results.append({"name": name, "status": "ok" if ok else "error", "detail": f"HTTP {resp.status_code}" if not ok else "ok"})
        except httpx.ConnectError:
            results.append({"name": name, "status": "error", "detail": "connection refused"})
        except httpx.TimeoutException:
            results.append({"name": name, "status": "error", "detail": "timeout"})
        except Exception as exc:
            results.append({"name": name, "status": "error", "detail": str(exc)})
    return results


def _check_queue_depths(api_url: str, queues: list[str], max_depth: int) -> list[dict[str, Any]]:
    if not api_url:
        return [{"note": "RabbitMQ Management API not configured -- queue depth check skipped"}]
    import httpx
    results: list[dict[str, Any]] = []
    for q in queues:
        try:
            resp = httpx.get(f"{api_url}/api/queues/%2F/{q}", auth=(RABBITMQ_API_USER, RABBITMQ_API_PASS), timeout=5)
            if resp.status_code == 404:
                results.append({"queue": q, "status": "skipped", "detail": "queue not found"})
                continue
            resp.raise_for_status()
            depth = resp.json().get("messages", 0)
            ok = depth <= max_depth
            results.append({"queue": q, "status": "ok" if ok else "critical", "messages": depth, "max_depth": max_depth, "detail": "" if ok else f"queue depth {depth} exceeds limit {max_depth}"})
        except Exception as exc:
            results.append({"queue": q, "status": "error", "detail": str(exc)})
    return results


@shared_task(bind=True, max_retries=2, default_retry_delay=30, autoretry_for=(Exception,), name="workers.health.e2e_check.run_e2e_health_check")
def run_e2e_health_check(self) -> dict:
    hostname = socket.gethostname()
    start = time.time()
    logger.info("E2E health check started -- hostname=%s", hostname)

    broker_ok, broker_err = _check_broker(BROKER_URL)
    broker_r = {"status": "ok" if broker_ok else "error", "detail": broker_err or ""}
    if not broker_ok:
        logger.error("E2E health: broker check failed -- %s", broker_err)

    backend_ok, backend_err = _check_backend(BACKEND_URL)
    backend_r = {"status": "ok" if backend_ok else "error", "detail": backend_err or ""}
    if not backend_ok:
        logger.error("E2E health: backend check failed -- %s", backend_err)

    ping_ok, ping_err = _check_worker_ping()
    ping_r = {"status": "ok" if ping_ok else "error", "detail": ping_err or ""}
    if not ping_ok:
        logger.error("E2E health: worker ping failed -- %s", ping_err)

    http_results = _check_http_endpoints(HEALTH_ENDPOINTS)
    http_ok = all(r["status"] == "ok" for r in http_results)
    http_r = {"status": "ok" if http_ok else "degraded", "endpoints": http_results}

    queue_results = _check_queue_depths(RABBITMQ_API_URL, CRITICAL_QUEUES, MAX_QUEUE_DEPTH)
    queue_ok = all(r.get("status", "ok") in ("ok", "skipped") for r in queue_results)

    overall_ok = broker_ok and backend_ok and ping_ok and http_ok and queue_ok
    overall_status = "ok" if overall_ok else "degraded" if (broker_ok or backend_ok or ping_ok) else "critical"
    elapsed = time.time() - start

    result = {"status": overall_status, "hostname": hostname, "elapsed_seconds": round(elapsed, 3),
              "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "checks": {"broker": broker_r, "backend": backend_r, "worker_ping": ping_r,
                         "http_endpoints": http_r, "queue_depths": {"status": "ok" if queue_ok else "degraded", "queues": queue_results}}}

    log_level = logger.error if overall_status != "ok" else logger.info
    log_level("E2E health check complete -- status=%s elapsed=%.3fs", overall_status, elapsed)
    return result
