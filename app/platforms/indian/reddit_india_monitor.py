import json
import os
import sys
from pathlib import Path
from typing import Optional

import praw

REDDIT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID", "")
REDDIT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET", "")
REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT", "openclaw-india-engagement/1.0")
REDDIT_USERNAME = os.getenv("REDDIT_USERNAME", "")
REDDIT_PASSWORD = os.getenv("REDDIT_PASSWORD", "")

TARGET_SUBREDDIT = "developersIndia"
KEYWORDS = ["mcp", "opensource", "openclaw", "fossunited", "modelcontextprotocol"]


def _reddit() -> praw.Reddit:
    return praw.Reddit(
        client_id=REDDIT_CLIENT_ID,
        client_secret=REDDIT_CLIENT_SECRET,
        user_agent=REDDIT_USER_AGENT,
        username=REDDIT_USERNAME,
        password=REDDIT_PASSWORD,
    )


def _log_engagement(platform: str, action: str, status: str, metadata: dict = None):
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
        from indian_engagement_logger import log_event
        log_event(platform=platform, action=action, status=status, metadata=metadata or {})
    except Exception as e:
        print(f"[WARN] Engag. log failed: {e}", file=sys.stderr)


def monitor_subreddit(query: str = None, limit: int = 25, sort: str = "hot") -> list[dict]:
    reddit = _reddit()
    subreddit = reddit.subreddit(TARGET_SUBREDDIT)
    sort_methods = {"hot": subreddit.hot, "new": subreddit.new, "top": subreddit.top, "rising": subreddit.rising}
    posts = sort_methods.get(sort, subreddit.hot)(limit=limit)
    results = []
    for post in posts:
        if query is None or query.lower() in (post.title + " " + (post.selftext or "")).lower():
            results.append({
                "id": post.id,
                "title": post.title,
                "url": f"https://reddit.com{post.permalink}",
                "score": post.score,
                "num_comments": post.num_comments,
                "created_utc": post.created_utc,
                "author": str(post.author),
                "selftext_preview": (post.selftext or "")[:500],
            })
    return results


def search_subreddit(query: str, limit: int = 25, sort: str = "relevance") -> list[dict]:
    reddit = _reddit()
    subreddit = reddit.subreddit(TARGET_SUBREDDIT)
    sort_methods = {"relevance": "relevance", "new": "new", "top": "top", "comments": "comments"}
    for post in subreddit.search(query, sort=sort_methods.get(sort, "relevance"), limit=limit):
        yield {
            "id": post.id,
            "title": post.title,
            "url": f"https://reddit.com{post.permalink}",
            "score": post.score,
            "num_comments": post.num_comments,
            "created_utc": post.created_utc,
            "author": str(post.author),
            "selftext_preview": (post.selftext or "")[:500],
        }


def reply_to_post(post_url_or_id: str, reply_text: str) -> Optional[str]:
    reddit = _reddit()
    try:
        submission = reddit.submission(url=post_url_or_id)
    except Exception:
        try:
            submission = reddit.submission(id=post_url_or_id)
        except Exception as e:
            print(f"Error fetching submission: {e}", file=sys.stderr)
            return None
    comment = submission.reply(reply_text)
    if comment:
        _log_engagement("reddit_india", "reply_to_post", "success",
                        {"post_id": submission.id, "comment_id": comment.id})
        return comment.id
    return None


def reply_to_comment(comment_id: str, reply_text: str) -> Optional[str]:
    reddit = _reddit()
    comment = reddit.comment(comment_id)
    reply = comment.reply(reply_text)
    if reply:
        _log_engagement("reddit_india", "reply_to_comment", "success",
                        {"comment_id": comment_id, "reply_id": reply.id})
        return reply.id
    return None


def get_ama_schedule() -> list[dict]:
    reddit = _reddit()
    subreddit = reddit.subreddit(TARGET_SUBREDDIT)
    posts = subreddit.search("AMA", sort="new", limit=10)
    results = []
    for post in posts:
        is_ama = "ama" in post.title.lower() or post.link_flair_text and "ama" in post.link_flair_text.lower()
        if is_ama:
            results.append({
                "id": post.id,
                "title": post.title,
                "url": f"https://reddit.com{post.permalink}",
                "author": str(post.author),
                "created_utc": post.created_utc,
                "num_comments": post.num_comments,
                "score": post.score,
            })
    return results


def browse_hot(limit: int = 25) -> list[dict]:
    return monitor_subreddit(limit=limit, sort="hot")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Reddit r/developersIndia engagement monitor")
    sub = parser.add_subparsers(dest="command", required=True)

    p_monitor = sub.add_parser("monitor", help="Monitor subreddit for keyword mentions")
    p_monitor.add_argument("--query")
    p_monitor.add_argument("--limit", type=int, default=25)
    p_monitor.add_argument("--sort", choices=["hot", "new", "top", "rising"], default="hot")

    p_search = sub.add_parser("search", help="Search subreddit")
    p_search.add_argument("query")
    p_search.add_argument("--limit", type=int, default=25)
    p_search.add_argument("--sort", choices=["relevance", "new", "top", "comments"], default="relevance")

    p_reply_post = sub.add_parser("reply-post", help="Reply to a post")
    p_reply_post.add_argument("--post", required=True)
    p_reply_post.add_argument("--text", required=True)

    p_reply_comment = sub.add_parser("reply-comment", help="Reply to a comment")
    p_reply_comment.add_argument("--comment-id", required=True)
    p_reply_comment.add_argument("--text", required=True)

    p_browse = sub.add_parser("browse", help="Browse hot posts")
    p_browse.add_argument("--limit", type=int, default=25)

    p_amas = sub.add_parser("amas", help="Check for AMA posts")

    args = parser.parse_args()

    if args.command == "monitor":
        results = monitor_subreddit(query=args.query, limit=args.limit, sort=args.sort)
        print(json.dumps(results, indent=2))
    elif args.command == "search":
        results = list(search_subreddit(args.query, limit=args.limit, sort=args.sort))
        print(json.dumps(results, indent=2))
    elif args.command == "reply-post":
        cid = reply_to_post(args.post, args.text)
        print(json.dumps({"comment_id": cid}))
    elif args.command == "reply-comment":
        rid = reply_to_comment(args.comment_id, args.text)
        print(json.dumps({"reply_id": rid}))
    elif args.command == "browse":
        posts = browse_hot(limit=args.limit)
        print(json.dumps(posts, indent=2))
    elif args.command == "amas":
        amas = get_ama_schedule()
        print(json.dumps(amas, indent=2))
