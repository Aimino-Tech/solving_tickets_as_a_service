import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

HASGEEK_BASE = "https://hasgeek.com"
KNOWN_CONFERENCES = [
    {"name": "Rootconf", "url": "https://hasgeek.com/rootconf/", "focus": "Infra/DevOps"},
    {"name": "The Fifth Elephant", "url": "https://hasgeek.com/the-fifthelephant/", "focus": "Data/ML"},
    {"name": "JSFoo", "url": "https://hasgeek.com/jsfoo/", "focus": "JS/Web"},
]


def _log_engagement(platform: str, action: str, status: str, metadata: dict = None):
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
        from indian_engagement_logger import log_event
        log_event(platform=platform, action=action, status=status, metadata=metadata or {})
    except Exception as e:
        print(f"[WARN] Engag. log failed: {e}", file=sys.stderr)


def check_cfp_status() -> list[dict]:
    results = []
    for conf in KNOWN_CONFERENCES:
        results.append({
            "conference": conf["name"],
            "url": conf["url"],
            "focus": conf["focus"],
            "status": "manual_check_required",
            "note": "HasGeek does not expose a public CFP API. Visually check the conference page for CFP announcements.",
            "last_checked": datetime.now(timezone.utc).isoformat(),
        })
    _log_engagement("hasgeek", "check_cfp", "success", {"conferences_checked": len(results)})
    return results


def check_homepage_for_cfps() -> list[dict]:
    results = []
    for conf in KNOWN_CONFERENCES:
        try:
            with httpx.Client(timeout=15) as client:
                resp = client.get(conf["url"])
                text = resp.text.lower()
                has_cfp = "cfp" in text or "call for proposals" in text or "proposals" in text
                results.append({
                    "conference": conf["name"],
                    "status": "cfp_open_mentioned" if has_cfp else "no_cfp_detected",
                    "note": "Keyword-based detection on homepage. Manual verification recommended.",
                })
        except Exception as e:
            results.append({
                "conference": conf["name"],
                "status": "check_failed",
                "note": str(e),
            })
    _log_engagement("hasgeek", "check_homepage", "success", {"results": len(results)})
    return results


def list_known_conferences() -> list[dict]:
    return KNOWN_CONFERENCES


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="HasGeek CFP monitor")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Check CFP status for all conferences")
    sub.add_parser("check-homepages", help="Check conference homepages for CFP mentions")
    sub.add_parser("list", help="List known HasGeek conferences")

    args = parser.parse_args()

    if args.command == "status":
        print(json.dumps(check_cfp_status(), indent=2))
    elif args.command == "check-homepages":
        print(json.dumps(check_homepage_for_cfps(), indent=2))
    elif args.command == "list":
        print(json.dumps(list_known_conferences(), indent=2))
