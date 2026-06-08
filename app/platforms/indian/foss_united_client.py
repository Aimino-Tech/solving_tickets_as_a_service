import json
import os
import sys
from pathlib import Path
from typing import Optional

import httpx

FOSS_UNITED_BASE = "https://platform.fossunited.org"
API_KEY = os.getenv("FOSS_UNITED_API_KEY", "")


def _headers() -> dict:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Token {API_KEY}"
    return headers


def _client() -> httpx.Client:
    return httpx.Client(headers=_headers(), timeout=30)


def _log_engagement(platform: str, action: str, status: str, metadata: dict = None):
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
        from indian_engagement_logger import log_event
        log_event(platform=platform, action=action, status=status, metadata=metadata or {})
    except Exception as e:
        print(f"[WARN] Engag. log failed: {e}", file=sys.stderr)


def _frappe_api(resource: str, params: dict = None) -> dict:
    url = f"{FOSS_UNITED_BASE}/api/resource/{resource}"
    with _client() as client:
        resp = client.get(url, params=params or {})
        resp.raise_for_status()
        return resp.json()


def list_chapters() -> list[dict]:
    data = _frappe_api("Chapter", {"fields": '["name", "title", "city", "state", "is_active"]', "limit_page_length": 100})
    chapters = data.get("data", [])
    _log_engagement("foss_united", "list_chapters", "success", {"count": len(chapters)})
    return chapters


def list_events(limit: int = 50) -> list[dict]:
    data = _frappe_api("FOSS Chapter Event", {
        "fields": '["name", "title", "event_type", "event_start_date", "event_end_date", "chapter", "status", "venue_city"]',
        "limit_page_length": min(limit, 200),
        "order_by": "event_start_date desc",
    })
    events = data.get("data", [])
    _log_engagement("foss_united", "list_events", "success", {"count": len(events)})
    return events


def get_event(event_name: str) -> Optional[dict]:
    data = _frappe_api(f"FOSS Chapter Event/{event_name}")
    _log_engagement("foss_united", "get_event", "success", {"event_name": event_name})
    return data.get("data")


def get_user_profile(user_id: str) -> Optional[dict]:
    data = _frappe_api(f"User/{user_id}", {"fields": '["name", "full_name", "email", "username", "bio"]'})
    _log_engagement("foss_united", "get_user_profile", "success", {"user_id": user_id})
    return data.get("data")


def list_proposals(event_name: str) -> list[dict]:
    data = _frappe_api("FOSS Event Proposal", {
        "fields": '["name", "title", "proposal_type", "status", "submitted_by"]',
        "filters": json.dumps([["event", "=", event_name]]),
        "limit_page_length": 100,
    })
    proposals = data.get("data", [])
    _log_engagement("foss_united", "list_proposals", "success", {"event": event_name, "count": len(proposals)})
    return proposals


def list_attendees(event_name: str) -> list[dict]:
    data = _frappe_api("FOSS Event Registration", {
        "fields": '["name", "full_name", "email", "status"]',
        "filters": json.dumps([["event", "=", event_name]]),
        "limit_page_length": 200,
    })
    return data.get("data", [])


def upcoming_events(days: int = 90) -> list[dict]:
    all_events = list_events(limit=200)
    from datetime import datetime, timezone, timedelta
    cutoff = datetime.now(timezone.utc) + timedelta(days=days)
    upcoming = []
    for event in all_events:
        start = event.get("event_start_date")
        if start:
            try:
                start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
                if start_dt > datetime.now(timezone.utc) and start_dt < cutoff:
                    upcoming.append(event)
            except (ValueError, AttributeError):
                pass
    return upcoming


def indiafoss_2026_info() -> dict:
    events = list_events(limit=200)
    indiafoss = [e for e in events if "indiafoss" in e.get("title", "").lower() or "indiafoss" in e.get("event_type", "").lower()]
    if indiafoss:
        return indiafoss[0]
    return {"info": "IndiaFOSS 2026 scheduled Sep 26-27. Check platform.fossunited.org for updates."}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="FOSS United Frappe API client")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("chapters", help="List all chapters")
    sub.add_parser("events", help="List all events")
    sub.add_parser("upcoming", help="List upcoming events")
    sub.add_parser("indiafoss", help="Get IndiaFOSS 2026 info")

    p_event = sub.add_parser("event", help="Get event details")
    p_event.add_argument("event_name")

    p_proposals = sub.add_parser("proposals", help="List proposals for an event")
    p_proposals.add_argument("event_name")

    p_profile = sub.add_parser("profile", help="Get user profile")
    p_profile.add_argument("user_id")

    args = parser.parse_args()

    if args.command == "chapters":
        print(json.dumps(list_chapters(), indent=2))
    elif args.command == "events":
        print(json.dumps(list_events(), indent=2))
    elif args.command == "upcoming":
        print(json.dumps(upcoming_events(), indent=2))
    elif args.command == "indiafoss":
        print(json.dumps(indiafoss_2026_info(), indent=2))
    elif args.command == "event":
        print(json.dumps(get_event(args.event_name), indent=2))
    elif args.command == "proposals":
        print(json.dumps(list_proposals(args.event_name), indent=2))
    elif args.command == "profile":
        print(json.dumps(get_user_profile(args.user_id), indent=2))
