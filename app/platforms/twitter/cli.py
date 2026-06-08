#!/usr/bin/env python3
from __future__ import annotations
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.config import settings
from app.common.db import get_repository
from app.common.ai_drafting import draft_content
from app.common.models import DraftRequest
from app.platforms.twitter.api import XAPIClient


def cmd_tweet(args: argparse.Namespace) -> None:
    client = XAPIClient()
    if args.draft:
        draft = draft_content(DraftRequest(
            platform="x",
            topic=args.text,
            engagement_type="post",
        ))
        text = draft.content
        print(f"[Draft] {text}\n")
    else:
        text = args.text

    record = client.post_tweet(text)
    print(f"Tweet logged: {record.id} (status: {record.status})")

    if record.status == "pending_approval":
        print(f"Pending approval. Run: python -m app.platforms.twitter.cli approve {record.id}")
    elif record.status == "sent":
        print(f"Tweet posted successfully.")


def cmd_reply(args: argparse.Namespace) -> None:
    client = XAPIClient()
    if args.draft:
        draft = draft_content(DraftRequest(
            platform="x",
            topic=args.text,
            engagement_type="reply",
            target=args.tweet_id,
        ))
        text = draft.content
        print(f"[Draft] {text}\n")
    else:
        text = args.text

    record = client.reply_to_tweet(args.tweet_id, text)
    print(f"Reply logged: {record.id} (status: {record.status})")


def cmd_approve(args: argparse.Namespace) -> None:
    client = XAPIClient()
    record = client.approve_and_send(args.id, approved_by=args.approved_by or "operator")
    print(f"Engagement {record.id}: status={record.status}")


def cmd_list(args: argparse.Namespace) -> None:
    repo = get_repository()
    records = repo.query(
        platform="x",
        status=args.status,
        limit=args.limit,
    )
    for r in records:
        print(f"{r.id[:8]} | {r.engagement_type:20s} | {r.status:20s} | {r.created_at[:19]}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="x-engage", description="X/Twitter engagement automation")
    sub = parser.add_subparsers(dest="command", required=True)

    p_tweet = sub.add_parser("tweet", help="Post a tweet")
    p_tweet.add_argument("text", help="Tweet text or topic (with --draft)")
    p_tweet.add_argument("--draft", action="store_true", help="AI-draft the content")
    p_tweet.set_defaults(func=cmd_tweet)

    p_reply = sub.add_parser("reply", help="Reply to a tweet")
    p_reply.add_argument("tweet_id", help="Tweet ID to reply to")
    p_reply.add_argument("text", help="Reply text or topic (with --draft)")
    p_reply.add_argument("--draft", action="store_true", help="AI-draft the content")
    p_reply.set_defaults(func=cmd_reply)

    p_app = sub.add_parser("approve", help="Approve and send pending engagement")
    p_app.add_argument("id", help="Engagement ID")
    p_app.add_argument("--approved-by", default="operator")
    p_app.set_defaults(func=cmd_approve)

    p_list = sub.add_parser("list", help="List X engagements")
    p_list.add_argument("--status", default=None, help="Filter by status")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
