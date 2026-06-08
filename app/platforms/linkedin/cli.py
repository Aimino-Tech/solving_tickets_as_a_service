#!/usr/bin/env python3
from __future__ import annotations
import argparse
import sys
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.config import settings
from app.common.db import get_repository
from app.common.ai_drafting import draft_content
from app.common.models import DraftRequest
from app.platforms.linkedin.api import LinkedInAPIClient
from app.platforms.linkedin.browser import LinkedInBrowserClient


def cmd_post(args: argparse.Namespace) -> None:
    client = LinkedInAPIClient()
    if args.draft:
        draft = draft_content(DraftRequest(
            platform="linkedin",
            topic=args.text,
            engagement_type="post",
        ))
        content = draft.content
        print(f"[Draft] {content}\n")
    else:
        content = args.text

    record = client.post_content(commentary=content)
    print(f"Engagement logged: {record.id} (status: {record.status})")

    if record.status == "pending_approval":
        print(f"Pending approval. Run: python -m app.platforms.linkedin.cli approve {record.id}")
    elif record.status == "sent":
        print(f"Posted successfully to LinkedIn.")
    elif record.status == "rate_limited":
        print(f"Rate limited. Try again later.")


def cmd_dm(args: argparse.Namespace) -> None:
    with LinkedInBrowserClient(headless=args.headless) as client:
        if args.draft:
            draft = draft_content(DraftRequest(
                platform="linkedin",
                topic=args.message,
                engagement_type="dm",
                target=args.target,
            ))
            message = draft.content
            print(f"[Draft] {message}\n")
        else:
            message = args.message

        record = client.send_dm(args.target, message)
        print(f"DM logged: {record.id} (status: {record.status})")


def cmd_connect(args: argparse.Namespace) -> None:
    with LinkedInBrowserClient(headless=args.headless) as client:
        note = args.note or ""
        record = client.send_connection_request(args.target, note)
        print(f"Connection request logged: {record.id} (status: {record.status})")


def cmd_approve(args: argparse.Namespace) -> None:
    client = LinkedInAPIClient()
    record = client.approve_and_send(args.id, approved_by=args.approved_by or "operator")
    print(f"Engagement {record.id}: status={record.status}")


def cmd_list(args: argparse.Namespace) -> None:
    repo = get_repository()
    records = repo.query(
        platform="linkedin",
        status=args.status,
        limit=args.limit,
    )
    for r in records:
        print(f"{r.id[:8]} | {r.engagement_type:20s} | {r.status:20s} | {r.created_at[:19]}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="linkedin-engage", description="LinkedIn engagement automation")
    sub = parser.add_subparsers(dest="command", required=True)

    p_post = sub.add_parser("post", help="Post content to LinkedIn")
    p_post.add_argument("text", help="Post text or topic (with --draft)")
    p_post.add_argument("--draft", action="store_true", help="AI-draft the content")
    p_post.set_defaults(func=cmd_post)

    p_dm = sub.add_parser("dm", help="Send LinkedIn DM via browser")
    p_dm.add_argument("target", help="Profile URL")
    p_dm.add_argument("message", help="DM text or topic (with --draft)")
    p_dm.add_argument("--draft", action="store_true", help="AI-draft the message")
    p_dm.add_argument("--headless", action="store_true", help="Run browser headless")
    p_dm.set_defaults(func=cmd_dm)

    p_conn = sub.add_parser("connect", help="Send LinkedIn connection request")
    p_conn.add_argument("target", help="Profile URL")
    p_conn.add_argument("--note", help="Optional connection note")
    p_conn.add_argument("--headless", action="store_true")
    p_conn.set_defaults(func=cmd_connect)

    p_app = sub.add_parser("approve", help="Approve and send pending engagement")
    p_app.add_argument("id", help="Engagement ID")
    p_app.add_argument("--approved-by", default="operator")
    p_app.set_defaults(func=cmd_approve)

    p_list = sub.add_parser("list", help="List LinkedIn engagements")
    p_list.add_argument("--status", default=None, help="Filter by status")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
