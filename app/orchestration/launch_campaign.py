from __future__ import annotations
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from app.common.config import settings

# Slack notification support (optional — gracefully no-ops when not configured)
try:
    from app.notifications.slack_notifier import (
        notify_campaign_status,
        notify_error,
    )
    _HAS_SLACK_NOTIFIER = True
except ImportError:
    _HAS_SLACK_NOTIFIER = False

    def notify_campaign_status(*args, **kwargs) -> bool:  # type: ignore
        return False

    def notify_error(*args, **kwargs) -> bool:  # type: ignore
        return False


CAMPAIGN_SCHEDULE: list[dict[str, Any]] = [
    {"day": 1, "title": "Launch Announcement", "platforms": ["devto", "x", "linkedin"],
     "topic": "Meet fast-html-mcp: A production-grade MCP server for fetching and processing web content"},
    {"day": 2, "title": "Technical Deep Dive", "platforms": ["reddit", "devto"],
     "topic": "Building a high-performance HTML-to-MCP server: architecture, challenges, and lessons learned"},
    {"day": 3, "title": "Community Engagement", "platforms": ["x", "linkedin", "reddit"],
     "topic": "How are you using MCP servers in production? Share your setup and we'll feature it"},
    {"day": 4, "title": "Showcase & Examples", "platforms": ["devto", "x", "producthunt"],
     "topic": "5 real-world use cases for fast-html-mcp: from web scraping to AI-powered content pipelines"},
    {"day": 5, "title": "Wrap-up & Learnings", "platforms": ["linkedin", "x", "hackernews"],
     "topic": "What we learned launching an open-source MCP server: metrics, feedback, and next steps"},
]

DAILY_CHECK_INTERVAL_HOURS = 2


def _log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat()}] {msg}", file=sys.stderr)


def get_campaign_state_path() -> Path:
    return Path(settings.engagement_db_path).parent.parent / "state" / "campaign_state.json"


def load_campaign_state() -> dict[str, Any]:
    path = get_campaign_state_path()
    if path.exists():
        return json.loads(path.read_text())
    return {"current_day": 1, "published": [], "started_at": None, "completed": False}


def save_campaign_state(state: dict[str, Any]) -> None:
    path = get_campaign_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2))


def get_day_plan(day: int) -> dict[str, Any] | None:
    for entry in CAMPAIGN_SCHEDULE:
        if entry["day"] == day:
            return entry
    return None


def post_to_devto(title: str, body: str, tags: list[str] | None = None) -> dict[str, Any]:
    api_key = os.getenv("DEVTO_API_KEY", "")
    if not api_key:
        return {"platform": "devto", "status": "skipped", "note": "DEVTO_API_KEY not set"}
    data = {
        "article": {
            "title": title,
            "body_markdown": body,
            "published": True,
            "tags": (tags or ["mcp", "opensource", "typescript", "webdev"])[:4],
        }
    }
    try:
        resp = httpx.post(
            "https://dev.to/api/articles",
            headers={"api-key": api_key, "Content-Type": "application/json"},
            json=data,
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
        _log(f"Dev.to: published '{title}' (ID: {result.get('id')})")
        return {"platform": "devto", "status": "published", "url": result.get("url"), "id": result.get("id")}
    except Exception as e:
        notify_error("Dev.to", str(e))
        return {"platform": "devto", "status": "error", "error": str(e)}


def post_to_x(title: str, body: str) -> dict[str, Any]:
    api_key = os.getenv("X_API_KEY", "")
    api_secret = os.getenv("X_API_KEY_SECRET", "")
    if not api_key:
        return {"platform": "x", "status": "skipped", "note": "X_API_KEY not set"}
    tweet = f"{title}\n\n{body[:200]}"
    from common.engagement_loop import safe_tweet  # type: ignore
    try:
        result = safe_tweet(tweet)
        _log(f"X: tweeted '{title[:50]}...'")
        return {"platform": "x", "status": "posted", "tweet_id": result}
    except Exception as e:
        notify_error("X (Twitter)", str(e))
        return {"platform": "x", "status": "error", "error": str(e)}


def post_to_linkedin(title: str, body: str) -> dict[str, Any]:
    token = os.getenv("LINKEDIN_ACCESS_TOKEN", "")
    user_urn = os.getenv("LINKEDIN_USER_URN", "")
    if not token or not user_urn:
        return {"platform": "linkedin", "status": "skipped", "note": "LinkedIn credentials not set"}
    from common.engagement_loop import safe_linkedin_post  # type: ignore
    try:
        result = safe_linkedin_post(f"{title}\n\n{body}")
        _log(f"LinkedIn: posted '{title[:50]}...'")
        return {"platform": "linkedin", "status": "posted", "result": result}
    except Exception as e:
        notify_error("LinkedIn", str(e))
        return {"platform": "linkedin", "status": "error", "error": str(e)}


def post_to_reddit(title: str, body: str) -> dict[str, Any]:
    from common.engagement_loop import safe_reddit_post  # type: ignore
    try:
        result = safe_reddit_post(title, body)
        _log(f"Reddit: posted '{title[:50]}...'")
        return {"platform": "reddit", "status": "posted", "result": result}
    except ImportError:
        pass
    client_id = os.getenv("REDDIT_CLIENT_ID", "")
    if not client_id:
        return {"platform": "reddit", "status": "skipped", "note": "REDDIT_CLIENT_ID not set"}
    return {"platform": "reddit", "status": "manual", "note": "Reddit posting requires interactive auth or pre-configured PRAW"}


def post_to_producthunt(title: str, body: str) -> dict[str, Any]:
    return {"platform": "producthunt", "status": "manual", "note": "Product Hunt requires manual launch via maker account at producthunt.com"}


def post_to_hackernews(title: str, body: str) -> dict[str, Any]:
    return {"platform": "hackernews", "status": "manual", "note": "HN requires manual submission via news.ycombinator.com/submit"}


PLATFORM_POSTERS = {
    "devto": post_to_devto,
    "x": post_to_x,
    "linkedin": post_to_linkedin,
    "reddit": post_to_reddit,
    "producthunt": post_to_producthunt,
    "hackernews": post_to_hackernews,
}


def execute_day(day: int) -> dict[str, Any]:
    plan = get_day_plan(day)
    if not plan:
        return {"day": day, "error": f"No plan for day {day}"}

    _log(f"=== Day {day}: {plan['title']} ===")
    results = []
    for platform in plan["platforms"]:
        poster = PLATFORM_POSTERS.get(platform)
        if poster:
            result = poster(plan["topic"], plan.get("body", plan["topic"]))
            results.append(result)
        else:
            results.append({"platform": platform, "status": "skipped", "note": f"No poster for {platform}"})

    # Send Slack notification for day execution results
    errors = [r for r in results if r.get("status") == "error"]
    published = [r for r in results if r.get("status") in ("published", "posted")]
    skipped = [r for r in results if r.get("status") == "skipped"]

    details = {
        "day": str(day),
        "published": str(len(published)),
        "errors": str(len(errors)),
        "skipped": str(len(skipped)),
    }

    if errors:
        # Send an error alert if any platform failed
        error_messages = "; ".join(
            f"{e['platform']}: {e.get('error', 'unknown error')}" for e in errors
        )
        notify_error(
            plan["title"],
            f"Errors during Day {day} execution: {error_messages}",
        )
    else:
        notify_campaign_status(
            plan["title"],
            f"Day {day} completed",
            details=details,
        )

    return {"day": day, "title": plan["title"], "results": results}


def check_and_advance() -> dict[str, Any]:
    state = load_campaign_state()
    now = datetime.now(timezone.utc)

    if state.get("completed"):
        return {"status": "completed", "message": "Campaign already completed"}

    if not state.get("started_at"):
        state["started_at"] = now.isoformat()
        state["current_day"] = 1
        save_campaign_state(state)
        _log("Campaign started!")
        result = execute_day(1)
        notify_campaign_status(
            "Campaign Launch",
            "started",
            details={"day": "1", "campaign": CAMPAIGN_SCHEDULE[0]["title"]},
        )
        return result

    started = datetime.fromisoformat(state["started_at"])
    elapsed_days = (now - started).days
    target_day = min(elapsed_days + 1, len(CAMPAIGN_SCHEDULE))
    current_day = state["current_day"]

    if target_day > current_day and current_day <= len(CAMPAIGN_SCHEDULE):
        for d in range(current_day, target_day):
            day_result = execute_day(d)
            state["published"].append(day_result)
            state["current_day"] = d + 1
        if state["current_day"] > len(CAMPAIGN_SCHEDULE):
            state["completed"] = True
            _log("Campaign complete!")
            notify_campaign_status(
                "Campaign Complete",
                "completed",
                details={"total_days": str(len(CAMPAIGN_SCHEDULE))},
            )
        save_campaign_state(state)
        return {"status": "advanced", "advanced_from": current_day, "advanced_to": state["current_day"], "completed": state["completed"]}

    return {"status": "waiting", "current_day": current_day, "next_day_at": (started + timedelta(days=current_day)).isoformat()}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="MCP Marketing Factory - Launch Campaign")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Show campaign state")
    sub.add_parser("advance", help="Check schedule and advance to next day if due")
    sub.add_parser("reset", help="Reset campaign state")

    p_day = sub.add_parser("day", help="Execute a specific day")
    p_day.add_argument("--day", type=int, required=True)

    p_schedule = sub.add_parser("schedule", help="Show full campaign schedule")

    args = parser.parse_args()

    if args.command == "status":
        state = load_campaign_state()
        print(json.dumps(state, indent=2))
    elif args.command == "advance":
        result = check_and_advance()
        print(json.dumps(result, indent=2))
    elif args.command == "reset":
        path = get_campaign_state_path()
        if path.exists():
            path.unlink()
        print(json.dumps({"status": "reset"}))
    elif args.command == "day":
        result = execute_day(args.day)
        print(json.dumps(result, indent=2))
    elif args.command == "schedule":
        print(json.dumps(CAMPAIGN_SCHEDULE, indent=2))
