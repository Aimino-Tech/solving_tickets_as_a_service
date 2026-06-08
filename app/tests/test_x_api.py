import pytest
from unittest.mock import patch, MagicMock
from app.common.db import get_repository
from app.platforms.twitter.api import XAPIClient, XAPIError


def test_post_tweet_creates_pending_record(monkeypatch):
    monkeypatch.setattr("common.config.settings.auto_approve", False)
    monkeypatch.setattr("common.config.settings.x_api_key", "test")
    monkeypatch.setattr("common.config.settings.x_api_key_secret", "test")
    monkeypatch.setattr("common.config.settings.x_access_token", "test")
    monkeypatch.setattr("common.config.settings.x_access_token_secret", "test")

    client = XAPIClient()
    record = client.post_tweet("Test tweet")
    assert record.platform == "x"
    assert record.engagement_type == "post"
    assert record.status == "pending_approval"

    repo = get_repository(":memory:")
    records = repo.query(platform="x")
    assert len(records) > 0


def test_post_tweet_success(monkeypatch):
    monkeypatch.setattr("common.config.settings.auto_approve", True)
    monkeypatch.setattr("common.config.settings.x_api_key", "test")
    monkeypatch.setattr("common.config.settings.x_api_key_secret", "test")
    monkeypatch.setattr("common.config.settings.x_access_token", "test")
    monkeypatch.setattr("common.config.settings.x_access_token_secret", "test")

    mock_tweepy = MagicMock()
    mock_response = MagicMock()
    mock_response.data = {"id": "123456", "text": "Test tweet"}
    mock_tweepy.create_tweet.return_value = mock_response

    client = XAPIClient()
    client.client = mock_tweepy
    record = client.post_tweet("Test tweet")
    assert record.status == "sent"


def test_post_tweet_rate_limited(monkeypatch):
    monkeypatch.setattr("common.config.settings.auto_approve", True)
    monkeypatch.setattr("common.config.settings.x_api_key", "test")
    monkeypatch.setattr("common.config.settings.x_api_key_secret", "test")
    monkeypatch.setattr("common.config.settings.x_access_token", "test")
    monkeypatch.setattr("common.config.settings.x_access_token_secret", "test")

    from tweepy import TweepyException
    mock_tweepy = MagicMock()
    error = TweepyException("Rate limit exceeded")
    error.api_code = 429
    mock_tweepy.create_tweet.side_effect = error

    client = XAPIClient()
    client.client = mock_tweepy
    record = client.post_tweet("Test tweet")
    assert record.status == "rate_limited"
    repo = get_repository(":memory:")
    records = repo.query(platform="x")
    assert records[0].status == "rate_limited"
