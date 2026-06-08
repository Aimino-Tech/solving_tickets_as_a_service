"""X/Twitter engagement adapter using Tweepy."""

import os
import logging

logger = logging.getLogger(__name__)


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

    def verify(self):
        me = self.client.get_me()
        if me.data:
            return {"id": me.data.id, "username": me.data.username}
        raise RuntimeError("Twitter auth verification failed")

    def search(self, query='#MCP OR #ModelContextProtocol OR "MCP server" -is:retweet', max_results=100):
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
                    "metrics": tweet.public_metrics if hasattr(tweet, 'public_metrics') else {},
                })
        return results

    def reply(self, tweet_id, text):
        response = self.client.create_tweet(
            text=text,
            in_reply_to_tweet_id=tweet_id,
        )
        if response.data:
            reply_id = response.data.id
            logger.info("Replied to tweet %s with reply %s", tweet_id, reply_id)
            return reply_id
        raise RuntimeError(f"Failed to reply to tweet {tweet_id}")

    def post_tweet(self, text):
        response = self.client.create_tweet(text=text)
        if response.data:
            return response.data.id
        raise RuntimeError("Failed to post tweet")

    def delete_tweet(self, tweet_id):
        response = self.client.delete_tweet(id=tweet_id)
        return response.data
