import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

TWITTER_SEARCH_QUERIES = [
    "office automation MCP server",
    "Word document generation AI",
    "Excel automation LLM",
    "PDF generation agent",
    "document processing MCP",
    "self-hosted document generation",
    "open source office tools",
    "MCP server document workflow",
    "office-oxide-mcp",
    "office oxide mcp",
]

PRODUCT_HANDLES = [
    "officeox idemcp",
    "office-oxide-mcp",
    "oxide office",
]


class TwitterMentionsPoller:
    def __init__(self, tracker=None):
        self._client = None
        self.tracker = tracker
        self._last_poll_time: float | None = None

    def _get_client(self):
        if self._client is not None:
            return self._client
        import tweepy
        self._client = tweepy.Client(
            bearer_token=os.getenv("X_BEARER_TOKEN"),
            consumer_key=os.getenv("X_API_KEY"),
            consumer_secret=os.getenv("X_API_KEY_SECRET"),
            access_token=os.getenv("X_ACCESS_TOKEN"),
            access_token_secret=os.getenv("X_ACCESS_TOKEN_SECRET"),
        )
        return self._client

    def _search_query(self, query: str, max_results: int = 20) -> list[dict[str, Any]]:
        client = self._get_client()
        response = client.search_recent_tweets(
            query=query,
            max_results=max_results,
            tweet_fields=["author_id", "created_at", "public_metrics", "referenced_tweets"],
            user_fields=["username", "name"],
            expansions=["author_id"],
        )
        mentions = []
        if not response.data:
            return mentions
        users_map = {}
        if response.includes and "users" in response.includes:
            for u in response.includes["users"]:
                users_map[u.id] = u.username
        for tweet in response.data:
            author_username = users_map.get(tweet.author_id, "unknown")
            mention = {
                "id": str(tweet.id),
                "platform": "twitter",
                "author_id": str(tweet.author_id),
                "author_handle": author_username,
                "text": tweet.text,
                "content_snippet": tweet.text[:300],
                "created_at": str(tweet.created_at) if tweet.created_at else "",
                "source_url": f"https://twitter.com/{author_username}/status/{tweet.id}",
                "metrics": {
                    "like_count": tweet.public_metrics.get("like_count", 0) if tweet.public_metrics else 0,
                    "retweet_count": tweet.public_metrics.get("retweet_count", 0) if tweet.public_metrics else 0,
                    "reply_count": tweet.public_metrics.get("reply_count", 0) if tweet.public_metrics else 0,
                } if tweet.public_metrics else {},
                "query_matched": query,
                "referenced_tweets": [
                    {"type": rt.type, "id": str(rt.id)}
                    for rt in (tweet.referenced_tweets or [])
                ],
            }
            if self.tracker:
                self.tracker.track_mention(
                    mention_id=mention["id"],
                    author_handle=author_username,
                    tweet_text=tweet.text,
                    sentiment="neutral",
                    replied=False,
                )
            mentions.append(mention)
        return mentions

    def poll_mentions(self, max_results: int = 50) -> list[dict[str, Any]]:
        results = []
        seen_ids: set[str] = set()
        for query in TWITTER_SEARCH_QUERIES:
            try:
                batch = self._search_query(query, max_results=min(max_results, 20))
                for mention in batch:
                    mid = mention["id"]
                    if mid not in seen_ids:
                        seen_ids.add(mid)
                        results.append(mention)
            except Exception as e:
                logger.warning("Twitter poll failed for query %r: %s", query, e)
        results.sort(key=lambda r: r.get("created_at", ""), reverse=True)
        self._last_poll_time = time.time()
        return results

    def poll_product_mentions(self, max_results: int = 30) -> list[dict[str, Any]]:
        results = []
        for handle in PRODUCT_HANDLES:
            try:
                client = self._get_client()
                query = f'"{handle}" -is:retweet'
                response = client.search_recent_tweets(
                    query=query,
                    max_results=max_results,
                    tweet_fields=["author_id", "created_at", "public_metrics"],
                    expansions=["author_id"],
                )
                if not response.data:
                    continue
                users_map = {}
                if response.includes and "users" in response.includes:
                    for u in response.includes["users"]:
                        users_map[u.id] = u.username
                for tweet in response.data:
                    author_username = users_map.get(tweet.author_id, "unknown")
                    results.append({
                        "id": str(tweet.id),
                        "platform": "twitter",
                        "author_id": str(tweet.author_id),
                        "author_handle": author_username,
                        "text": tweet.text,
                        "content_snippet": tweet.text[:300],
                        "created_at": str(tweet.created_at) if tweet.created_at else "",
                        "source_url": f"https://twitter.com/{author_username}/status/{tweet.id}",
                        "match_type": "direct_product_mention",
                        "query_matched": handle,
                    })
                    if self.tracker:
                        self.tracker.track_mention(
                            mention_id=str(tweet.id),
                            author_handle=author_username,
                            tweet_text=tweet.text,
                            sentiment="neutral",
                            replied=False,
                        )
            except Exception as e:
                logger.warning("Product mention poll failed for %r: %s", handle, e)
        return results

    def verify_auth(self) -> dict[str, Any]:
        try:
            client = self._get_client()
            me = client.get_me()
            if me.data:
                return {"status": "ok", "user_id": str(me.data.id), "username": me.data.username}
            return {"status": "error", "error": "Could not verify identity"}
        except Exception as e:
            return {"status": "error", "error": str(e)}


def poll_twitter_for_orchestrator(tracker=None) -> list[dict[str, Any]]:
    poller = TwitterMentionsPoller(tracker=tracker)
    mentions = poller.poll_mentions(max_results=50)
    product_mentions = poller.poll_product_mentions(max_results=30)
    all_mentions = mentions + product_mentions
    seen = set()
    unique = []
    for m in all_mentions:
        if m["id"] not in seen:
            seen.add(m["id"])
            unique.append(m)
    logger.info("Twitter poll: %d general + %d product = %d unique mentions",
                len(mentions), len(product_mentions), len(unique))
    return unique
