from __future__ import annotations
import tweepy
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.config import settings
from app.common.models import EngagementRecord
from app.common.db import get_repository
from app.common.rate_limiter import x_limiter, RateLimitExceeded


class XAPIError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        super().__init__(f"X API error {status_code}: {message}")


class XAPIClient:
    def __init__(self) -> None:
        self.client = tweepy.Client(
            bearer_token=settings.x_bearer_token or None,
            consumer_key=settings.x_api_key,
            consumer_secret=settings.x_api_key_secret,
            access_token=settings.x_access_token,
            access_token_secret=settings.x_access_token_secret,
        )

    def post_tweet(self, text: str) -> EngagementRecord:
        limiter = x_limiter()
        limiter.check()

        record = EngagementRecord(
            platform="x",
            engagement_type="post",
            content=text,
            status="pending_approval",
        )
        repo = get_repository()
        repo.log_engagement(record)

        if not settings.auto_approve:
            return record

        try:
            response = self.client.create_tweet(text=text)
            if response.data:
                tweet_id = response.data["id"]
                record.mark_sent()
                record.metadata["tweet_id"] = tweet_id
                repo.update_status(record.id, "sent")
            else:
                error_msg = "No tweet data in response"
                record.mark_failed(error_msg)
                repo.update_status(record.id, "failed", error=error_msg)
                raise XAPIError(0, error_msg)
        except tweepy.TweepyException as e:
            status_code = getattr(e, "api_code", 0) or getattr(e, "response", None) and e.response.status_code
            error_msg = str(e)
            if status_code == 429:
                record.mark_rate_limited(60)
                repo.update_status(record.id, "rate_limited", error=error_msg)
            else:
                record.mark_failed(error_msg)
                repo.update_status(record.id, "failed", error=error_msg)
                raise XAPIError(status_code or 0, error_msg) from e

        return record

    def reply_to_tweet(self, tweet_id: str, text: str) -> EngagementRecord:
        record = EngagementRecord(
            platform="x",
            engagement_type="reply",
            content=text,
            target=tweet_id,
            status="pending_approval",
        )
        repo = get_repository()
        repo.log_engagement(record)

        if not settings.auto_approve:
            return record

        try:
            response = self.client.create_tweet(text=text, in_reply_to_tweet_id=tweet_id)
            if response.data:
                record.mark_sent()
                record.metadata["tweet_id"] = response.data["id"]
                repo.update_status(record.id, "sent")
        except tweepy.TweepyException as e:
            error_msg = str(e)
            record.mark_failed(error_msg)
            repo.update_status(record.id, "failed", error=error_msg)
            raise XAPIError(getattr(e, "api_code", 0), error_msg) from e

        return record

    def approve_and_send(self, record_id: str, approved_by: str = "operator") -> EngagementRecord:
        repo = get_repository()
        records = repo.query(platform="x", status="pending_approval")
        target = next((r for r in records if r.id == record_id), None)
        if not target:
            raise ValueError(f"No pending engagement found: {record_id}")

        try:
            response = self.client.create_tweet(text=target.content)
            if response.data:
                repo.update_status(record_id, "sent", approved_by=approved_by)
                target.status = "sent"
                target.metadata["tweet_id"] = response.data["id"]
        except tweepy.TweepyException as e:
            error_msg = str(e)
            repo.update_status(record_id, "failed", error=error_msg, approved_by=approved_by)
            raise XAPIError(getattr(e, "api_code", 0), error_msg) from e

        return target
