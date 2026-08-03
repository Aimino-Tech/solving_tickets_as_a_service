"""Admin actions audit trail - append-only JSON Lines log."""

from __future__ import annotations

import csv
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_LOG_PATH = os.getenv("ADMIN_AUDIT_LOG_PATH", "/tmp/syntaro-admin-audit.jsonl")


def log_admin_action(
    actor: str, action: str, resource: str,
    details: dict[str, Any] | None = None,
    *, log_path: str | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": uuid.uuid4().hex,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
        "action": action,
        "resource": resource,
        "details": details or {},
    }
    path = log_path or DEFAULT_LOG_PATH
    line = json.dumps(entry, sort_keys=True, default=str) + "\n"
    try:
        log_dir = os.path.dirname(path)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        with open(path, "a") as f:
            f.write(line)
    except OSError as exc:
        logger.error("Failed to write admin audit log to %s: %s", path, exc)
        return entry
    logger.debug("Admin audit - actor=%s action=%s resource=%s id=%s", actor, action, resource, entry["id"])
    return entry


def _read_log(log_path: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    try:
        with open(log_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    logger.warning("Skipping malformed admin audit log line")
    except FileNotFoundError:
        pass
    return entries


def query_admin_actions(
    *, actor: str | None = None, action: str | None = None,
    resource: str | None = None, start_date: str | None = None,
    end_date: str | None = None, limit: int = 100, offset: int = 0,
    log_path: str | None = None,
) -> list[dict[str, Any]]:
    path = log_path or DEFAULT_LOG_PATH
    entries = _read_log(path)
    filtered = []
    for entry in entries:
        if actor is not None and entry.get("actor") != actor:
            continue
        if action is not None and not entry.get("action", "").startswith(action):
            continue
        if resource is not None and not entry.get("resource", "").startswith(resource):
            continue
        if start_date is not None and entry.get("timestamp", "") < start_date:
            continue
        if end_date is not None and entry.get("timestamp", "") > end_date:
            continue
        filtered.append(entry)
    filtered.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    capped_limit = min(limit, 10_000)
    return filtered[offset:offset + capped_limit]


def count_admin_actions(*, actor=None, action=None, resource=None, start_date=None, end_date=None, log_path=None) -> int:
    return len(query_admin_actions(actor=actor, action=action, resource=resource, start_date=start_date, end_date=end_date, limit=999999, log_path=log_path))


EXPORT_FIELDS = ["id", "timestamp", "actor", "action", "resource", "details"]


def export_admin_actions_json(output_path, *, log_path=None, **filters) -> int:
    entries = query_admin_actions(limit=10_000, log_path=log_path, **filters)
    with open(output_path, "w") as f:
        json.dump(entries, f, indent=2, default=str)
    return len(entries)


def export_admin_actions_csv(output_path, *, log_path=None, **filters) -> int:
    entries = query_admin_actions(limit=10_000, log_path=log_path, **filters)
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=EXPORT_FIELDS)
        writer.writeheader()
        for entry in entries:
            row = {"id": entry.get("id",""), "timestamp": entry.get("timestamp",""), "actor": entry.get("actor",""), "action": entry.get("action",""), "resource": entry.get("resource",""), "details": json.dumps(entry.get("details",{}), sort_keys=True, default=str)}
            writer.writerow(row)
    return len(entries)


def clear_log(log_path=None):
    path = log_path or DEFAULT_LOG_PATH
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
