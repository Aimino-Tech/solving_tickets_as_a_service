#!/usr/bin/env python3
from __future__ import annotations
import argparse
import json
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.config import settings
from app.common.db import get_repository
from app.common.ai_drafting import draft_content
from app.common.models import DraftRequest
from app.platforms.twitter.api import XAPIClient


def parse_thread_file(path: str) -> list[str]:
    content = Path(path).read_text(encoding="utf-8")
    tweets = []
    current = []
    started = False
    for line in content.split("\n"):
        stripped = line.strip()
        if stripped.startswith("**Tweet") and "**" in stripped[8:]:
            if current:
                tweets.append("\n".join(current).strip())
                current = []
            started = True
            continue
        if not started:
            continue
        if stripped.startswith("#"):
            continue
        current.append(line)
    if current:
        tweets.append("\n".join(current).strip())
    return [t for t in tweets if t]


def cmd_post_thread(args: argparse.Namespace) -> None:
    tweets = parse_thread_file(args.file)
    if not tweets:
        print("No tweets found in file.", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(tweets)} tweets in thread file.")
    if args.dry_run:
        print("[DRY RUN] Would post the following thread:")
        for i, t in enumerate(tweets, 1):
            preview = t[:100].replace("\n", " ")
            print(f"  Tweet {i}/{len(tweets)}: {preview}...")
        return

    client = XAPIClient()
    prev_id = None
    for i, text in enumerate(tweets, 1):
        try:
            resp = client.client.create_tweet(
                text=text,
                in_reply_to_tweet_id=prev_id,
            )
            if resp.data:
                tweet_id = resp.data["id"]
                print(f"Tweet {i}/{len(tweets)} posted: {tweet_id}")
                prev_id = tweet_id
            else:
                print(f"Tweet {i} failed: no response data", file=sys.stderr)
                sys.exit(1)
        except Exception as e:
            print(f"Tweet {i} failed: {e}", file=sys.stderr)
            sys.exit(1)
        time.sleep(2)

    repo = get_repository()
    repo.log_engagement(
        platform="x",
        engagement_type="thread",
        content=f"Thread: {Path(args.file).name} ({len(tweets)} tweets)",
        target=prev_id,
        status="sent",
    )
    print(f"Thread of {len(tweets)} tweets posted successfully.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="x-thread", description="Post an X thread from a markdown file")
    parser.add_argument("file", help="Path to thread markdown file")
    parser.add_argument("--dry-run", action="store_true", help="Parse and preview without posting")
    parser.set_defaults(func=cmd_post_thread)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
