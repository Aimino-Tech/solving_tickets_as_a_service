import json
import os
import sys
import tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from app.common.db import get_repository

API_HOST = os.getenv("ENGAGEMENT_API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("ENGAGEMENT_API_PORT", "9100"))
API_KEY = os.getenv("ENGAGEMENT_API_KEY", "")
API_DB_PATH = os.getenv("ENGAGEMENT_API_DB_PATH", "")
EXPORT_DIR = os.getenv("ENGAGEMENT_EXPORT_DIR", tempfile.gettempdir())


def _get_db_path() -> str:
    return API_DB_PATH or os.getenv("ENGAGEMENT_DB_PATH", "")


def query_engagements(params: dict) -> dict:
    repo = get_repository(_get_db_path() or None)
    try:
        parts = ["SELECT * FROM engagements WHERE 1=1"]
        bind = []
        if params.get("platform"):
            parts.append("AND platform = ?")
            bind.append(params["platform"])
        if params.get("engagement_type"):
            parts.append("AND engagement_type = ?")
            bind.append(params["engagement_type"])
        if params.get("status"):
            parts.append("AND status = ?")
            bind.append(params["status"])
        if params.get("since"):
            parts.append("AND created_at >= ?")
            bind.append(params["since"])
        if params.get("until"):
            parts.append("AND created_at <= ?")
            bind.append(params["until"])
        limit = min(int(params.get("limit", 50)), 1000)
        parts.append("ORDER BY created_at DESC LIMIT ?")
        bind.append(limit)
        result = repo.conn.execute(" ".join(parts), bind).fetchdf()
        rows = json.loads(result.to_json(orient="records"))
        return {"success": True, "count": len(rows), "data": rows}
    except Exception as e:
        print(f"Query error: {e}", file=sys.stderr)
        return {"success": False, "error": str(e)}


def _safe_export_path(output_path: str) -> str:
    allowed = os.path.abspath(EXPORT_DIR)
    resolved = os.path.abspath(output_path)
    if os.path.commonpath([resolved, allowed]) != allowed:
        raise ValueError(f"output path must be under {allowed}")
    return resolved


def export_engagements(params: dict) -> dict:
    repo = get_repository(_get_db_path() or None)
    try:
        output_path = params.get("output")
        if not output_path:
            fd, output_path = tempfile.mkstemp(suffix=".csv")
            os.close(fd)
        else:
            output_path = _safe_export_path(output_path)
        df = repo.conn.execute("SELECT * FROM engagements").fetchdf()
        df.to_csv(output_path, index=False)
        return {"success": True, "exported_to": output_path, "row_count": len(df)}
    except Exception as e:
        print(f"Export error: {e}", file=sys.stderr)
        return {"success": False, "error": "internal error"}


ROUTES = {
    "/api/engagements/query": ("GET", lambda p: query_engagements(p)),
    "/api/engagements/export": ("GET", lambda p: export_engagements(p)),
}


class EngagementAPIHandler(BaseHTTPRequestHandler):
    def _check_auth(self, params: dict) -> bool:
        if not API_KEY:
            return True
        if params.get("api_key") == API_KEY:
            return True
        auth_header = self.headers.get("X-API-Key", "")
        return auth_header == API_KEY

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        params = {k: v[0] for k, v in query.items()}
        if not self._check_auth(params):
            self._json(403, {"success": False, "error": "unauthorized"})
            return
        route = ROUTES.get(parsed.path)
        if route is None:
            self._json(404, {"success": False, "error": "not found"})
            return
        _, handler = route
        try:
            result = handler(params)
            self._json(200, result)
        except Exception as e:
            print(f"API error: {e}", file=sys.stderr)
            self._json(500, {"success": False, "error": "internal error"})

    def _json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        print(f"[engagement_api] {args}", file=sys.stderr)


def serve():
    server = HTTPServer((API_HOST, API_PORT), EngagementAPIHandler)
    print(f"Engagement API listening on {API_HOST}:{API_PORT}", file=sys.stderr)
    print(f"  GET /api/engagements/query  — query engagements", file=sys.stderr)
    print(f"  GET /api/engagements/export — export to CSV", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.", file=sys.stderr)
        server.server_close()


if __name__ == "__main__":
    serve()
