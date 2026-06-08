#!/usr/bin/env python3
from __future__ import annotations
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.config import settings
from app.common.db import get_repository
from app.platforms.linkedin.api import LinkedInAPIClient


def parse_post_file(path: str) -> str:
    content = Path(path).read_text(encoding="utf-8")
    lines = content.split("\n")
    body = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if stripped.startswith("---"):
            break
        body.append(line)
    return "\n".join(body).strip()


def cmd_post(args: argparse.Namespace) -> None:
    commentary = parse_post_file(args.file)
    if not commentary:
        print("No post content found in file.", file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        preview = commentary[:200].replace("\n", " ")
        print(f"[DRY RUN] Would post to LinkedIn:")
        print(f"  Commentary: {preview}...")
        if args.article_url:
            print(f"  Article URL: {args.article_url}")
        return

    client = LinkedInAPIClient()
    record = client.post_content(
        commentary=commentary,
        visibility=args.visibility,
        article_url=args.article_url,
    )

    print(f"LinkedIn post created (id={record.id}, status={record.status})")

    if settings.auto_approve:
        if record.status == "pending_approval":
            client.approve_and_send(record.id)
            print("  Auto-approved and sent.")
        elif record.status == "sent":
            print("  Already sent (auto_approve was active).")
        elif record.status == "rate_limited":
            print("  Rate limited — will retry later.", file=sys.stderr)
            sys.exit(1)


def cmd_approve(args: argparse.Namespace) -> None:
    client = LinkedInAPIClient()
    record = client.approve_and_send(args.id, approved_by=args.approved_by)
    print(f"Post {args.id} approved and sent (status={record.status}).")


def cmd_list(args: argparse.Namespace) -> None:
    repo = get_repository()
    records = repo.query(platform="linkedin", status=args.status)
    if not records:
        print(f"No LinkedIn posts with status '{args.status}'.")
        return
    for r in records:
        preview = r.content[:80].replace("\n", " ")
        print(f"  {r.id} [{r.status}] {preview}...")


def main() -> None:
    parser = argparse.ArgumentParser(prog="linkedin-post", description="Post content to LinkedIn")
    sub = parser.add_subparsers(dest="command", required=True)

    p_post = sub.add_parser("post", help="Create a LinkedIn post from a markdown file")
    p_post.add_argument("file", help="Path to post markdown file")
    p_post.add_argument("--dry-run", action="store_true", help="Parse and preview without posting")
    p_post.add_argument("--visibility", default="PUBLIC", choices=["PUBLIC", "CONNECTIONS", "LOGGED_IN"])
    p_post.add_argument("--article-url", help="Optional article URL to attach")
    p_post.set_defaults(func=cmd_post)

    p_approve = sub.add_parser("approve", help="Approve and send a pending LinkedIn post")
    p_approve.add_argument("id", help="Engagement record ID")
    p_approve.add_argument("--approved-by", default="operator")
    p_approve.set_defaults(func=cmd_approve)

    p_list = sub.add_parser("list", help="List LinkedIn posts by status")
    p_list.add_argument("--status", default="pending_approval", help="Filter by status")
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
