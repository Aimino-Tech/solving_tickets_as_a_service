"""X/Twitter engagement adapter using Tweepy."""

import os
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

logger = logging.getLogger(__name__)

TWITTER_SEARCH_QUERIES = [
    'office-oxide-mcp OR "office oxide mcp" OR oxide-mcp',
    '"document automation" MCP OR "MCP server" document',
    '"Word document" agent OR "Excel" agent LLM',
    '"PDF generation" agent OR "self-hosted" document',
    'npx office-oxide-mcp',
    '"docx" MCP OR "xlsx" MCP OR "pdf" MCP server',
]

TWITTER_KEYWORD_FILTERS = [
    "office", "document", "word", "excel", "pdf", "spreadsheet",
    "invoice", "report generation", "template", "docx", "xlsx",
    "MCP server", "agent automation", "document processing",
]

REPLY_TEMPLATES = {
    "interested": "Thanks for your interest! office-oxide-mcp is open source (MIT). "
                  "Quick start: `npx office-oxide-mcp`. Happy to help if you have questions!",
    "comparison": "Great question! office-oxide-mcp focuses on agent-native document processing "
                  "via MCP tools. Unlike cloud APIs, it's fully self-hosted and sub-50ms latency. "
                  "Happy to share benchmarks if you're evaluating options.",
    "problem": "That's exactly what office-oxide-mcp was built for! It handles {format} documents "
               "through MCP tools your agent can discover naturally. Self-hosted, Rust-powered, "
               "sub-50ms. Want me to point you to docs for your specific use case?",
}


def _get_client():
    import tweepy
    return tweepy.Client(
        bearer_token=os.getenv("X_BEARER_TOKEN"),
        consumer_key=os.getenv("X_API_KEY"),
        consumer_secret=os.getenv("X_API_KEY_SECRET"),
        access_token=os.getenv("X_ACCESS_TOKEN"),
        access_token_secret=os.getenv("X_ACCESS_TOKEN_SECRET"),
    )


class TwitterEngager:
    def __init__(self):
        self.client = _get_client()
        self._mentions_cache: list[dict[str, Any]] = []
        self._last_mention_id: str | None = None

    def verify(self):
        me = self.client.get_me()
        if me.data:
            return {"id": me.data.id, "username": me.data.username}
        raise RuntimeError("Twitter auth verification failed")

    def get_mentions(self, since_id: str = None, max_results: int = 50) -> list[dict[str, Any]]:
        me = self.client.get_me()
        if not me.data:
            logger.error("Cannot get mentions: auth verification failed")
            return []
        user_id = me.data.id
        try:
            response = self.client.get_users_mentions(
                id=user_id,
                since_id=since_id,
                max_results=min(max_results, 100),
                tweet_fields=["author_id", "created_at", "public_metrics", "conversation_id"],
                expansions=["referenced_tweets.id", "in_reply_to_user_id"],
            )
        except Exception as e:
            logger.error("Failed to fetch mentions: %s", e)
            return []
        results = []
        if response.data:
            for tweet in response.data:
                mention = {
                    "id": tweet.id,
                    "text": tweet.text,
                    "author_id": tweet.author_id,
                    "created_at": str(tweet.created_at) if tweet.created_at else None,
                    "conversation_id": getattr(tweet, "conversation_id", None),
                    "metrics": tweet.public_metrics if hasattr(tweet, "public_metrics") else {},
                    "type": "mention",
                }
                results.append(mention)
                self._last_mention_id = tweet.id
        self._mentions_cache = results
        return results

    def search_relevant(self, queries: list[str] = None, max_results: int = 50) -> list[dict[str, Any]]:
        queries = queries or TWITTER_SEARCH_QUERIES
        seen_ids = set()
        all_results = []
        for query in queries:
            try:
                response = self.client.search_recent_tweets(
                    query=query,
                    max_results=min(max_results, 100),
                    tweet_fields=["author_id", "created_at", "public_metrics", "conversation_id"],
                )
                if response.data:
                    for tweet in response.data:
                        if tweet.id not in seen_ids:
                            seen_ids.add(tweet.id)
                            all_results.append({
                                "id": tweet.id,
                                "text": tweet.text,
                                "author_id": tweet.author_id,
                                "created_at": str(tweet.created_at) if tweet.created_at else None,
                                "conversation_id": getattr(tweet, "conversation_id", None),
                                "metrics": tweet.public_metrics if hasattr(tweet, "public_metrics") else {},
                                "query": query,
                                "type": "search",
                            })
            except Exception as e:
                logger.warning("Search query failed: %s — %s", query[:50], e)
        return all_results

    def search(self, query: str = '#MCP OR #ModelContextProtocol OR "MCP server" -is:retweet', max_results: int = 100):
        response = self.client.search_recent_tweets(
            query=query,
            max_results=min(max_results, 100),
            tweet_fields=["author_id", "created_at", "public_metrics"],
        )
        results = []
        if response.data:
            for tweet in response.data:
                results.append({
                    "id": tweet.id,
                    "text": tweet.text,
                    "author_id": tweet.author_id,
                    "created_at": str(tweet.created_at) if tweet.created_at else None,
                    "metrics": tweet.public_metrics if hasattr(tweet, "public_metrics") else {},
                })
        return results

    def reply(self, tweet_id: str, text: str):
        response = self.client.create_tweet(
            text=text,
            in_reply_to_tweet_id=tweet_id,
        )
        if response.data:
            reply_id = response.data.id
            logger.info("Replied to tweet %s with reply %s", tweet_id, reply_id)
            return reply_id
        raise RuntimeError(f"Failed to reply to tweet {tweet_id}")

    def reply_with_tracking(self, tweet_id: str, text: str, tracker=None) -> dict[str, Any]:
        result = {"tweet_id": tweet_id, "reply_id": None, "success": False, "error": None}
        try:
            reply_id = self.reply(tweet_id, text)
            result["reply_id"] = reply_id
            result["success"] = True
            if tracker:
                tracker.track_engagement(
                    platform="x", action="reply",
                    target_url=f"https://x.com/i/status/{tweet_id}",
                    content_preview=text[:200], status="sent",
                )
        except Exception as e:
            result["error"] = str(e)
            logger.error("Failed to reply to tweet %s: %s", tweet_id, e)
        return result

    def post_tweet(self, text: str):
        response = self.client.create_tweet(text=text)
        if response.data:
            return response.data.id
        raise RuntimeError("Failed to post tweet")

    def post_tweet_with_tracking(self, text: str, tracker=None) -> dict[str, Any]:
        result = {"tweet_id": None, "success": False, "error": None}
        try:
            tweet_id = self.post_tweet(text)
            result["tweet_id"] = tweet_id
            result["success"] = True
            if tracker:
                tracker.track_tweet(tweet_id, text, action="post", status="sent")
        except Exception as e:
            result["error"] = str(e)
            logger.error("Failed to post tweet: %s", e)
        return result

    def delete_tweet(self, tweet_id: str):
        response = self.client.delete_tweet(id=tweet_id)
        return response.data

    def like_tweet(self, tweet_id: str):
        me = self.client.get_me()
        if me.data:
            self.client.like(tweet_id=tweet_id, user_id=me.data.id)

    def retweet(self, tweet_id: str):
        me = self.client.get_me()
        if me.data:
            self.client.retweet(tweet_id=tweet_id, user_id=me.data.id)

    def get_user_timeline(self, user_id: str, max_results: int = 10) -> list[dict[str, Any]]:
        try:
            response = self.client.get_users_tweets(
                id=user_id,
                max_results=min(max_results, 100),
                tweet_fields=["created_at", "public_metrics"],
            )
            results = []
            if response.data:
                for tweet in response.data:
                    results.append({
                        "id": tweet.id,
                        "text": tweet.text,
                        "created_at": str(tweet.created_at) if tweet.created_at else None,
                        "metrics": tweet.public_metrics if hasattr(tweet, "public_metrics") else {},
                    })
            return results
        except Exception as e:
            logger.error("Failed to get user timeline for %s: %s", user_id, e)
            return []

    def get_conversation(self, conversation_id: str, max_results: int = 50) -> list[dict[str, Any]]:
        try:
            query = f"conversation_id:{conversation_id}"
            response = self.client.search_recent_tweets(
                query=query,
                max_results=min(max_results, 100),
                tweet_fields=["author_id", "created_at", "in_reply_to_user_id", "public_metrics"],
            )
            results = []
            if response.data:
                for tweet in response.data:
                    results.append({
                        "id": tweet.id,
                        "text": tweet.text,
                        "author_id": tweet.author_id,
                        "created_at": str(tweet.created_at) if tweet.created_at else None,
                        "metrics": tweet.public_metrics if hasattr(tweet, "public_metrics") else {},
                    })
            return results
        except Exception as e:
            logger.error("Failed to get conversation %s: %s", conversation_id, e)
            return []

    def poll_for_mentions(self, since_id: str = None) -> dict[str, Any]:
        mentions = self.get_mentions(since_id=since_id)
        search_results = self.search_relevant()
        all_tweets = mentions + search_results
        return {
            "mentions": mentions,
            "search_results": search_results,
            "total": len(all_tweets),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "last_mention_id": self._last_mention_id,
        }
