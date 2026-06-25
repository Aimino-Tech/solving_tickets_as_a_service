from __future__ import annotations
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import urlparse
from workers.dispatch.pause import get_pause_manager

logger = logging.getLogger(__name__)
PAUSE_API_PORT = int(os.getenv("PAUSE_API_PORT", "8081"))

class PauseAPIHandler(BaseHTTPRequestHandler):
    pm = get_pause_manager()

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/")
        try:
            if path == "/health":
                self._respond(200, {"status": "ok", "service": "pause-api"})
            elif path == "/api/projects/paused":
                paused = self.pm.list_paused()
                self._respond(200, {"paused": paused, "count": len(paused)})
            elif path == "/api/projects":
                projects = self.pm.list_all()
                self._respond(200, {"projects": projects, "count": len(projects)})
            elif path.startswith("/api/projects/") and path.endswith("/status"):
                slug = path[len("/api/projects/"):-len("/status")]
                self._respond(200, self.pm.get_status(slug))
            else:
                self._respond(404, {"error": "Not found"})
        except Exception as exc:
            logger.error("GET %s: %s", self.path, exc)
            self._respond(500, {"error": "Internal error"})

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/")
        body = self._read_body()
        try:
            if path.startswith("/api/projects/") and path.endswith("/pause"):
                slug = path[len("/api/projects/"):-len("/pause")]
                state = self.pm.pause(slug, paused_by=body.get("paused_by", "api"))
                self._respond(200, state)
            elif path.startswith("/api/projects/") and path.endswith("/resume"):
                slug = path[len("/api/projects/"):-len("/resume")]
                state = self.pm.resume(slug, resumed_by=body.get("resumed_by", "api"))
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

    def log_message(self, fmt, *args):
        logger.debug("Pause API " + fmt % args)


def start_pause_server(port: int = PAUSE_API_PORT) -> None:
    s = HTTPServer(("0.0.0.0", port), PauseAPIHandler)
    logger.info("Pause API on :%d", port)
    try:
        s.serve_forever()
    except KeyboardInterrupt:
        s.shutdown()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    start_pause_server()
