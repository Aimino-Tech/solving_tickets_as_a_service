#!/usr/bin/env python3
"""CLI entry point for the Engagement Loop: Research → Draft → Engage → Track.

Usage:
    python3 -m app.orchestration.engagement.cli research [--platform reddit|hn|twitter]
    python3 -m app.orchestration.engagement.cli engage [--approval auto|manual]
    python3 -m app.orchestration.engagement.cli status
    python3 -m app.orchestration.engagement.cli verify-auth [--platform reddit|hn|twitter]
"""

import argparse
import json
import logging
import os
import sys

logger = logging.getLogger("engagement-cli")


def cmd_verify_auth(args):
    from .reddit_engage import RedditEngager
    from .hn_engage import HNEngager
    from .twitter_engage import TwitterEngager

    results = {}
    if not args.platform or args.platform == "reddit":
        try:
            r = RedditEngager()
            results["reddit"] = {"status": "ok", "user": r.verify()}
        except Exception as e:
            results["reddit"] = {"status": "error", "error": str(e)}

    if not args.platform or args.platform == "hn":
        try:
            h = HNEngager()
            auth_result = h.verify_auth()
            results["hn"] = {
                "status": "ok" if auth_result["logged_in"] else "error",
                **auth_result,
            }
        except Exception as e:
            results["hn"] = {"status": "error", "error": str(e)}

    if not args.platform or args.platform == "twitter":
        try:
            t = TwitterEngager()
            results["twitter"] = {"status": "ok", "user": t.verify()}
        except Exception as e:
            results["twitter"] = {"status": "error", "error": str(e)}

    print(json.dumps(results, indent=2))
    return results


def cmd_research(args):
    from .db import log_engagement
    from .draft import score_relevance

    all_results = []

    if not args.platform or args.platform == "reddit":
        from .reddit_engage import RedditEngager
        r = RedditEngager()
        posts = r.search(limit=args.limit)
        for post in posts:
            if post["matched"]:
                relevance = score_relevance(post["title"], "reddit")
                log_engagement("reddit", post["id"], "research", post["title"],
                               metadata={"url": post["url"], "subreddit": post["subreddit"], "score": post["score"], "author": post["author"], "relevance_score": relevance.get("score"), "relevance_label": relevance.get("label")})
                all_results.append({"platform": "reddit", "relevance": relevance, **post})
        logger.info("Reddit: found %d relevant posts", sum(1 for p in posts if p["matched"]))

    if not args.platform or args.platform == "hn":
        from .hn_engage import HNEngager
        h = HNEngager()
        stories = h.search_algolia(limit=args.limit)
        for story in stories:
            if story["matched"]:
                relevance = score_relevance(story["title"], "hn")
                log_engagement("hn", story["objectID"], "research", story["title"],
                               metadata={"url": story["url"], "points": story["points"], "author": story["author"], "relevance_score": relevance.get("score"), "relevance_label": relevance.get("label")})
                all_results.append({"platform": "hn", "relevance": relevance, **story})
        logger.info("HN: found %d relevant stories", sum(1 for s in stories if s["matched"]))

    if not args.platform or args.platform == "twitter":
        from .twitter_engage import TwitterEngager
        t = TwitterEngager()
        tweets = t.search(max_results=args.limit)
        for tweet in tweets:
            relevance = score_relevance(tweet["text"], "twitter")
            log_engagement("twitter", str(tweet["id"]), "research", tweet["text"][:200],
                           metadata={"author_id": tweet["author_id"], "relevance_score": relevance.get("score"), "relevance_label": relevance.get("label")})
            all_results.append({"platform": "twitter", "relevance": relevance, **tweet})
        logger.info("Twitter: found %d tweets", len(tweets))

    if args.output:
        with open(args.output, "w") as f:
            json.dump(all_results, f, indent=2)
    else:
        print(json.dumps(all_results, indent=2))

    print(f"\nTotal: {len(all_results)} items found")
    return all_results


def cmd_engage(args):
    from .db import get_pending_engagements, update_engagement_status, log_lead
    from .draft import draft_reply

    is_manual = args.approval == "manual"

    engagements = get_pending_engagements()
    if engagements.empty:
        print("No pending engagements to process.")
        return

    if is_manual:
        print(f"Manual approval mode — showing {len(engagements)} pending engagements for review:\n")
        for _, row in engagements.iterrows():
            post_content = f"{row.get('content', '')}"
            reply = draft_reply(post_content, row["platform"])
            print(f"[{row['platform']}] {row['external_id']}")
            print(f"  Source: {post_content[:200]}")
            print(f"  Draft: {reply}\n")
        print("Use `--approval auto` to automatically post.")
        return

    print(f"Processing {len(engagements)} pending engagements...")
    for _, row in engagements.iterrows():
        post_content = f"{row.get('content', '')}"
        if not post_content:
            continue

        reply = draft_reply(post_content, row["platform"])

        if args.dry_run:
            print(f"\n[{row['platform']}] {row['external_id']}")
            print(f"  Draft: {reply}")
            continue

        try:
            if row["platform"] == "reddit":
                from .reddit_engage import reply_to_submission
                reply_id = reply_to_submission(row["external_id"], reply)
            elif row["platform"] == "hn":
                from .hn_engage import HNEngager
                h = HNEngager()
                reply_id = h.reply_to_story(int(row["external_id"]), reply)
            elif row["platform"] == "twitter":
                from .twitter_engage import TwitterEngager
                t = TwitterEngager()
                reply_id = t.reply(row["external_id"], reply)
            else:
                logger.warning("Unknown platform: %s", row["platform"])
                continue

            update_engagement_status(row["id"], "posted")
            print(f"  [{row['platform']}] Posted: {reply_id}")

            metadata = row.get("metadata") or {}
            if isinstance(metadata, str):
                import json
                try:
                    metadata = json.loads(metadata)
                except json.JSONDecodeError:
                    metadata = {}
            author = metadata.get("author") or metadata.get("author_id") or metadata.get("username")
            if author:
                log_lead(row["platform"], str(author), row["id"], score=50, notes=f"Engaged via {row['action']}")
        except Exception as e:
            update_engagement_status(row["id"], "failed")
            logger.error("Failed to engage on %s/%s: %s", row["platform"], row["external_id"], e)


def cmd_status(args):
    from .db import get_recent_engagements

    engagements = get_recent_engagements(limit=args.limit)
    if engagements.empty:
        print("No engagements yet.")
        return

    print(f"{'ID':<40} {'Platform':<10} {'Status':<10} {'Action':<10} {'Created':<22}")
    print("-" * 100)
    for _, row in engagements.iterrows():
        print(f"{row['id']:<40} {row['platform']:<10} {row['status']:<10} {row['action']:<10} {str(row['created_at']):<22}")


def cmd_init_db(args):
    from .db import get_connection
    con = get_connection()
    tables = con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main'").fetchall()
    con.close()
    print(f"DuckDB initialized at: {os.getenv('OPENCLAW_MARKETING_DB', 'openclaw_marketing.duckdb')}")
    print("Tables:", [t[0] for t in tables])


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(description="OpenClaw Engagement Loop")
    parser.add_argument("--db", help="DuckDB path (default: OPENCLAW_MARKETING_DB env or openclaw_marketing.duckdb)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_research = sub.add_parser("research", help="Search platforms for relevant content")
    p_research.add_argument("--platform", choices=["reddit", "hn", "twitter"], help="Filter by platform")
    p_research.add_argument("--limit", type=int, default=25, help="Results per platform")
    p_research.add_argument("--output", help="Save results to JSON file")

    p_engage = sub.add_parser("engage", help="Process pending engagements (draft + reply)")
    p_engage.add_argument("--dry-run", action="store_true", help="Draft only, don't post")
    p_engage.add_argument("--approval", choices=["auto", "manual"], default="auto")

    p_status = sub.add_parser("status", help="Show recent engagements")
    p_status.add_argument("--limit", type=int, default=20)

    p_verify = sub.add_parser("verify-auth", help="Verify platform authentication")
    p_verify.add_argument("--platform", choices=["reddit", "hn", "twitter"], help="Filter by platform")

    p_init = sub.add_parser("init-db", help="Initialize DuckDB schema")

    args = parser.parse_args()

    if args.db:
        os.environ["OPENCLAW_MARKETING_DB"] = args.db

    if args.command == "research":
        cmd_research(args)
    elif args.command == "engage":
        cmd_engage(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "verify-auth":
        cmd_verify_auth(args)
    elif args.command == "init-db":
        cmd_init_db(args)


if __name__ == "__main__":
    main()
