"""Reddit engagement adapter using PRAW."""

import os
import re
import logging

logger = logging.getLogger(__name__)

KEYWORDS = [
    "mcp", "model context protocol", "open source tool", "devtools",
    "data pipeline", "etl", "web scraper", "api integration",
    "data quality", "data migration", "data collection",
]


def _get_reddit():
    import praw
    return praw.Reddit(
        client_id=os.getenv("REDDIT_CLIENT_ID"),
        client_secret=os.getenv("REDDIT_CLIENT_SECRET"),
        password=os.getenv("REDDIT_PASSWORD"),
        user_agent=os.getenv("REDDIT_USER_AGENT", "openclaw:v1.0 (by u/openclaw_agent)"),
        username=os.getenv("REDDIT_USERNAME"),
    )


def keywords_match(text):
    text_lower = text.lower()
    for kw in KEYWORDS:
        if kw in text_lower:
            return True
    return False


def search_subreddits(subreddits="MCP+opensource+devtools", limit=25):
    reddit = _get_reddit()
    subreddit = reddit.subreddit(subreddits)
    results = []
    for submission in subreddit.hot(limit=limit):
        text = f"{submission.title} {submission.selftext}"
        results.append({
            "id": submission.id,
            "title": submission.title,
            "text": submission.selftext[:500] if submission.selftext else "",
            "url": f"https://reddit.com{submission.permalink}",
            "author": str(submission.author),
            "created_utc": submission.created_utc,
            "score": submission.score,
            "num_comments": submission.num_comments,
            "subreddit": str(submission.subreddit),
            "matched": keywords_match(text),
        })
    return results


def search_by_keywords(subreddits="all", query=None, limit=25):
    reddit = _get_reddit()
    subreddit = reddit.subreddit(subreddits)
    q = query or " OR ".join(KEYWORDS[:5])
    results = []
    for submission in subreddit.search(q, limit=limit, sort="new"):
        text = f"{submission.title} {submission.selftext}"
        results.append({
            "id": submission.id,
            "title": submission.title,
            "text": submission.selftext[:500] if submission.selftext else "",
            "url": f"https://reddit.com{submission.permalink}",
            "author": str(submission.author),
            "created_utc": submission.created_utc,
            "score": submission.score,
            "num_comments": submission.num_comments,
            "subreddit": str(submission.subreddit),
            "matched": keywords_match(text),
        })
    return results


def reply_to_submission(submission_id, reply_text):
    reddit = _get_reddit()
    submission = reddit.submission(id=submission_id)
    comment = submission.reply(reply_text)
    logger.info("Replied to Reddit submission %s with comment %s", submission_id, comment.id)
    return comment.id


def reply_to_comment(comment_id, reply_text):
    reddit = _get_reddit()
    comment = reddit.comment(id=comment_id)
    reply = comment.reply(reply_text)
    logger.info("Replied to Reddit comment %s with comment %s", comment_id, reply.id)
    return reply.id


def verify_auth():
    reddit = _get_reddit()
    user = reddit.user.me()
    logger.info("Reddit auth verified: %s", user)
    return str(user)


class RedditEngager:
    def __init__(self):
        self.reddit = _get_reddit()

    def verify(self):
        return str(self.reddit.user.me())

    def search(self, subreddits="MCP+opensource+devtools", limit=25):
        query = " OR ".join(KEYWORDS)
        return search_by_keywords(subreddits, query=query, limit=limit)

    def search_keywords(self, query=None, limit=25):
        return search_by_keywords("all", query, limit)

    def reply(self, submission_id, text):
        return reply_to_submission(submission_id, text)
