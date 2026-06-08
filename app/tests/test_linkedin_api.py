import pytest
from unittest.mock import patch, MagicMock
from app.common.db import get_repository
from app.platforms.linkedin.api import LinkedInAPIClient, LinkedInAPIError


def test_post_content_creates_pending_record(monkeypatch):
    monkeypatch.setattr("common.config.settings.auto_approve", False)
    monkeypatch.setattr("common.config.settings.linkedin_access_token", "test-token")
    monkeypatch.setattr("common.config.settings.linkedin_user_urn", "urn:li:person:test")

    client = LinkedInAPIClient(access_token="test-token")
    record = client.post_content(commentary="Test post")
    assert record.platform == "linkedin"
    assert record.engagement_type == "post"
    assert record.status == "pending_approval"

    repo = get_repository(":memory:")
    records = repo.query(platform="linkedin")
    assert len(records) > 0


def test_approve_and_send_success(monkeypatch):
    monkeypatch.setattr("common.config.settings.auto_approve", True)
    monkeypatch.setattr("common.config.settings.linkedin_access_token", "test-token")
    monkeypatch.setattr("common.config.settings.linkedin_user_urn", "urn:li:person:test")

    mock_resp = MagicMock()
    mock_resp.status_code = 201
    mock_resp.text = ""

    with patch("httpx.post", return_value=mock_resp):
        client = LinkedInAPIClient(access_token="test-token")
        record = client.post_content(commentary="Test post")
        assert record.status == "sent"


def test_approve_and_send_rate_limited(monkeypatch):
    monkeypatch.setattr("common.config.settings.auto_approve", True)
    monkeypatch.setattr("common.config.settings.linkedin_access_token", "test-token")
    monkeypatch.setattr("common.config.settings.linkedin_user_urn", "urn:li:person:test")

    mock_resp = MagicMock()
    mock_resp.status_code = 429
    mock_resp.headers = {"Retry-After": "60"}
    mock_resp.text = ""

    with patch("httpx.post", return_value=mock_resp):
        client = LinkedInAPIClient(access_token="test-token")
        record = client.post_content(commentary="Test post")
        assert record.status == "rate_limited"


def test_approve_and_send_api_error(monkeypatch):
    monkeypatch.setattr("common.config.settings.auto_approve", True)
    monkeypatch.setattr("common.config.settings.linkedin_access_token", "test-token")
    monkeypatch.setattr("common.config.settings.linkedin_user_urn", "urn:li:person:test")

    mock_resp = MagicMock()
    mock_resp.status_code = 401
    mock_resp.text = "Unauthorized"

    with patch("httpx.post", return_value=mock_resp):
        client = LinkedInAPIClient(access_token="test-token")
        with pytest.raises(LinkedInAPIError):
            client.post_content(commentary="Test post")
