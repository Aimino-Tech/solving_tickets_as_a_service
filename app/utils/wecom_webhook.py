import hashlib
import json
import os
import sys
import xml.etree.ElementTree as ET
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from app.common.db import get_repository
from app.common.config import get_env
from app.common.models import EngagementRecord

WECOM_ENCODING_AES_KEY = get_env("WECOM_ENCODING_AES_KEY", "")
WECOM_CORP_ID = get_env("WECOM_CORP_ID", "")

WEBHOOK_HOST = get_env("WECOM_WEBHOOK_HOST", "0.0.0.0")
WEBHOOK_PORT = int(get_env("WECOM_WEBHOOK_PORT", "9000"))
WECOM_DB_PATH = get_env("WECOM_WEBHOOK_DB_PATH", "")


def _verify_url(msg_signature: str, timestamp: str, nonce: str, echostr: str) -> str | None:
    token = os.getenv("WECOM_WEBHOOK_TOKEN", "")
    if not token:
        return None
    parts = sorted([token, timestamp, nonce])
    signature = hashlib.sha1("".join(parts).encode()).hexdigest()
    if signature == msg_signature:
        return echostr
    return None


def _parse_xml(body: bytes) -> dict[str, Any]:
    root = ET.fromstring(body)
    return {child.tag: child.text for child in root}


def _get_db_path() -> str:
    return WECOM_DB_PATH or os.getenv("ENGAGEMENT_DB_PATH", "")


def _log_webhook_event(event_type: str, payload: dict[str, Any], status: str = "received"):
    repo = get_repository(_get_db_path() or None)
    record = EngagementRecord(
        platform="wecom",
        engagement_type=f"webhook_{event_type}",
        content=json.dumps(payload, ensure_ascii=False),
        status=status,
        metadata={"source": "wecom_webhook", "event_type": event_type},
    )
    try:
        repo.log_engagement(record)
    except Exception as e:
        print(f"Failed to log webhook event: {e}", file=sys.stderr)


def _verify_post(query: dict[str, list[str]]) -> bool:
    msg_signature = query.get("msg_signature", [None])[0]
    timestamp = query.get("timestamp", [None])[0]
    nonce = query.get("nonce", [None])[0]
    if msg_signature and timestamp and nonce:
        return _verify_url(msg_signature, timestamp, nonce, "") is not None
    return not os.getenv("WECOM_WEBHOOK_TOKEN", "")


def handle_message(body: bytes, query: dict[str, list[str]]) -> dict[str, Any]:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = _parse_xml(body)
    _log_webhook_event("message", data)
    return {"errcode": 0, "errmsg": "ok", "type": "message"}


def handle_event(body: bytes, query: dict[str, list[str]]) -> dict[str, Any]:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = _parse_xml(body)
    _log_webhook_event("event", data)
    event_type = data.get("Event", data.get("event", "unknown"))
    return {"errcode": 0, "errmsg": "ok", "type": "event", "event": event_type}


def handle_status(body: bytes, query: dict[str, list[str]]) -> dict[str, Any]:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = _parse_xml(body)
    _log_webhook_event("status", data)
    return {"errcode": 0, "errmsg": "ok", "type": "status"}


ROUTES = {
    "/webhook/wecom/message": ("POST", handle_message),
    "/webhook/wecom/event": ("POST", handle_event),
    "/webhook/wecom/status": ("POST", handle_status),
}


class WebhookHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        msg_signature = query.get("msg_signature", [None])[0]
        timestamp = query.get("timestamp", [None])[0]
        nonce = query.get("nonce", [None])[0]
        echostr = query.get("echostr", [None])[0]
        if msg_signature and timestamp and nonce and echostr:
            result = _verify_url(msg_signature, timestamp, nonce, echostr)
            if result:
                self._respond(200, "text/plain", result)
                return
        self._respond(200, "application/json", json.dumps({"errcode": 0, "errmsg": "ok"}))

    def do_POST(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if not _verify_post(query):
            self._respond(403, "application/json", json.dumps({"errcode": 403, "errmsg": "invalid signature"}))
            return
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        route = ROUTES.get(parsed.path)
        if route is None:
            self._respond(404, "application/json", json.dumps({"errcode": 404, "errmsg": "not found"}))
            return
        _, handler = route
        try:
            result = handler(body, query)
            self._respond(200, "application/json", json.dumps(result))
        except Exception as e:
            print(f"Webhook error: {e}", file=sys.stderr)
            self._respond(500, "application/json", json.dumps({"errcode": 500, "errmsg": "internal error"}))

    def _respond(self, status: int, content_type: str, content: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(content.encode())

    def log_message(self, format, *args):
        print(f"[wecom_webhook] {args}", file=sys.stderr)


def serve():
    server = HTTPServer((WEBHOOK_HOST, WEBHOOK_PORT), WebhookHandler)
    print(f"WeCom webhook listening on {WEBHOOK_HOST}:{WEBHOOK_PORT}", file=sys.stderr)
    print(f"  POST /webhook/wecom/message  — receive messages", file=sys.stderr)
    print(f"  POST /webhook/wecom/event    — receive events", file=sys.stderr)
    print(f"  POST /webhook/wecom/status   — receive status notifications", file=sys.stderr)
    print(f"  GET  /*                      — URL verification (echostr)", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.", file=sys.stderr)
        server.server_close()


if __name__ == "__main__":
    serve()
