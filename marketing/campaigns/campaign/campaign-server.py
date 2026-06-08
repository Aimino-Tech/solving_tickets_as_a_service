#!/usr/bin/env python3
import json
import os
import re
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import datetime
from pathlib import Path

SERVE_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
TASKS_FILE = os.path.join(SERVE_DIR, 'campaign', 'openclaw-tasks.json')

# Script is at marketing/campaigns/campaign/campaign-server.py
# PROJECT_ROOT  = openclaw/  (3 levels up)
# TRACKING_DIR  = sibling of openclaw/ at Documents/fast-html-mcp-server-marketing
PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
TRACKING_DIR = os.path.normpath(os.path.join(PROJECT_ROOT, '..', 'fast-html-mcp-server-marketing'))

sys.path.insert(0, SERVE_DIR)


class Handler(SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SERVE_DIR, **kwargs)

    def do_OPTIONS(self):
        self._cors_headers()
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]  # strip cache-busting query params
        if path == '/api/tracking':
            self._handle_get_tracking()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/submit-task':
            self._handle_submit_task()
        elif self.path == '/api/execute-item':
            self._handle_execute_item()
        else:
            self.send_error(404)

    def _handle_submit_task(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._json_response(400, {'ok': False, 'error': 'Invalid JSON'})
            return

        if not data.get('id') or not data.get('plan'):
            self._json_response(400, {'ok': False, 'error': 'Missing id or plan'})
            return

        data['_received'] = datetime.utcnow().isoformat() + 'Z'

        tasks = []
        if os.path.exists(TASKS_FILE):
            try:
                with open(TASKS_FILE) as f:
                    tasks = json.load(f)
            except json.JSONDecodeError:
                tasks = []

        tasks.append(data)

        with open(TASKS_FILE, 'w') as f:
            json.dump(tasks, f, indent=2, default=str)

        print(f'[task] Received plan for {data["id"]}: {data["plan"][:60]}…')
        self._json_response(200, {'ok': True})

    def _handle_execute_item(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._json_response(400, {'ok': False, 'error': 'Invalid JSON'})
            return

        item_id = data.get('id', '')
        platform = data.get('platform', '')
        action = data.get('action', '')
        content = data.get('content', '')
        url = data.get('url', '')

        print(f'[execute] Request: id={item_id} platform={platform} action={action}')

        if platform == 'hackernews' and action == 'comment':
            match = re.search(r'id=(\d+)', url)
            if not match:
                self._json_response(400, {
                    'ok': False,
                    'error': f'Could not extract story ID from URL: {url}',
                })
                return
            story_id = match.group(1)

            try:
                from scripts.engagement.hn_engage import HNEngager
                engager = HNEngager()
                engager.reply_to_story(story_id, content)
                print(f'[execute] ✅ HN comment posted on story {story_id} (item {item_id})')
                self._json_response(200, {
                    'ok': True,
                    'message': f'Comment posted on HN story {story_id}',
                })
            except Exception as e:
                print(f'[execute] ❌ Failed: {e}')
                self._json_response(500, {
                    'ok': False,
                    'error': str(e),
                })
        else:
            print(f'[execute] ⚠️ No handler for {platform}/{action} (item {item_id})')
            self._json_response(200, {
                'ok': True,
                'message': f'No automated action for {platform}/{action}',
            })

    def _handle_get_tracking(self):
        """Serve tracking data from fast-html-mcp-server-marketing/ as JSON."""
        data = {
            "engagements": [],
            "leads": [],
            "campaign_tasks": [],
            "metrics": [],
            "directory_submissions": [],
            "orchestration_cycles": [],
            "stats": {},
        }

        subdir_map = {
            "engagements": "engagements",
            "leads": "leads",
            "campaign-tasks": "campaign_tasks",
            "metrics": "metrics",
            "directory-submissions": "directory_submissions",
            "orchestration-cycles": "orchestration_cycles",
        }

        total = 0
        if os.path.isdir(TRACKING_DIR):
            for subdir, key in subdir_map.items():
                dirpath = os.path.join(TRACKING_DIR, subdir)
                if not os.path.isdir(dirpath):
                    continue
                files = sorted(os.listdir(dirpath))
                records = []
                for fname in files:
                    if not fname.endswith(".json"):
                        continue
                    fpath = os.path.join(dirpath, fname)
                    try:
                        with open(fpath) as f:
                            records.append(json.load(f))
                    except (json.JSONDecodeError, OSError):
                        pass
                data[key] = records
                total += len(records)

        data["stats"] = {
            "total_records": total,
            "engagement_count": len(data["engagements"]),
            "lead_count": len(data["leads"]),
            "campaign_task_count": len(data["campaign_tasks"]),
            "metrics_count": len(data["metrics"]),
            "directory_submission_count": len(data["directory_submissions"]),
            "orchestration_cycle_count": len(data["orchestration_cycles"]),
        }

        self._json_response(200, {"ok": True, "data": data})

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json_response(self, status, payload):
        self.send_response(status)
        self._cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    server = HTTPServer(('0.0.0.0', port), Handler)
    print(f'Campaign server at http://localhost:{port}')
    print(f'Serving: {SERVE_DIR}')
    print(f'Tasks -> {TASKS_FILE}')
    server.serve_forever()
