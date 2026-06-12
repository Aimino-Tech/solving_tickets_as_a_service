"""Tests for Reddit OAuth2 token management (no API calls, no auth required).

These tests validate token validation logic, expiry detection, token storage
save/load round-trips, and the behaviour of the :class:`RedditOAuthManager`
under various conditions without making any network calls.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from unittest import mock

import pytest

# Module under test
from app.platforms import reddit_auth
from app.platforms import reddit_token_storage


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════


@pytest.fixture
def temp_hermes_home(tmp_path: Path) -> Path:
    """Create a temporary HERMES_HOME directory for each test.

    The token storage module resolves ``get_hermes_home()`` internally, so
    we monkey-patch the environment variable to point at *tmp_path*.
    """
    hermes_dir = tmp_path / ".hermes"
    hermes_dir.mkdir(parents=True)
    # Patch the env var so hermes_constants.get_hermes_home() picks it up.
    with mock.patch.dict(os.environ, {"HERMES_HOME": str(hermes_dir)}):
        yield hermes_dir


@pytest.fixture
def valid_token_data() -> dict:
    """Return a token dict that is currently valid (expires 1 hour ahead)."""
    return {
        "access_token": "test_access_token_abc123",
        "refresh_token": "test_refresh_token_xyz789",
        "client_id": "test_client_id",
        "client_secret": "test_client_secret",
        "expires_at": time.time() + 3600,  # 1 hour from now
        "token_type": "bearer",
    }


@pytest.fixture
def expired_token_data() -> dict:
    """Return a token dict that expired 1 hour ago."""
    return {
        "access_token": "test_access_token_expired",
        "refresh_token": "test_refresh_token_expired",
        "client_id": "test_client_id",
        "client_secret": "test_client_secret",
        "expires_at": time.time() - 3600,  # 1 hour ago
        "token_type": "bearer",
    }


# ══════════════════════════════════════════════════════════════════════════════
# Token validation tests
# ══════════════════════════════════════════════════════════════════════════════


class TestValidateToken:
    """Tests for :func:`reddit_auth.validate_token`."""

    def test_valid_token(self, valid_token_data: dict):
        """A token that expires in 1 hour is valid."""
        assert reddit_auth.validate_token(valid_token_data) is True

    def test_expired_token(self, expired_token_data: dict):
        """A token that expired 1 hour ago is invalid."""
        assert reddit_auth.validate_token(expired_token_data) is False

    def test_empty_access_token(self, valid_token_data: dict):
        """An empty access_token means the token is invalid."""
        valid_token_data["access_token"] = ""
        assert reddit_auth.validate_token(valid_token_data) is False

    def test_missing_expires_at(self, valid_token_data: dict):
        """Missing expires_at should return False."""
        del valid_token_data["expires_at"]
        assert reddit_auth.validate_token(valid_token_data) is False

    def test_expires_at_zero(self, valid_token_data: dict):
        """expires_at of 0 means no token has been obtained."""
        valid_token_data["expires_at"] = 0
        assert reddit_auth.validate_token(valid_token_data) is False

    def test_within_buffer_window(self, valid_token_data: dict):
        """A token within 5 minutes of expiry should be treated as expired."""
        valid_token_data["expires_at"] = time.time() + 60  # 1 minute left
        assert reddit_auth.validate_token(valid_token_data) is False

    def test_exactly_at_buffer_boundary(self, valid_token_data: dict):
        """A token exactly 5 minutes from expiry is still valid (boundary)."""
        valid_token_data["expires_at"] = time.time() + 300  # exactly 5 min
        assert reddit_auth.validate_token(valid_token_data) is True

    def test_custom_buffer(self, valid_token_data: dict):
        """Custom buffer should be respected."""
        valid_token_data["expires_at"] = time.time() + 120  # 2 min left
        # With a 60-second buffer, this should be valid.
        assert reddit_auth.validate_token(valid_token_data, buffer=60) is True
        # With a 180-second buffer, this should be invalid.
        assert reddit_auth.validate_token(valid_token_data, buffer=180) is False

    def test_non_numeric_expires_at(self, valid_token_data: dict):
        """Non-numeric expires_at should be treated as invalid."""
        valid_token_data["expires_at"] = "not_a_number"
        assert reddit_auth.validate_token(valid_token_data) is False


# ══════════════════════════════════════════════════════════════════════════════
# Token storage tests
# ══════════════════════════════════════════════════════════════════════════════


class TestTokenStorage:
    """Tests for :mod:`reddit_token_storage` save/load lifecycle."""

    def test_save_and_load_roundtrip(
        self, temp_hermes_home: Path, valid_token_data: dict
    ):
        """A token saved to disk should load back identically."""
        saved = reddit_token_storage.save_token(valid_token_data, temp_hermes_home)
        assert saved is True

        loaded = reddit_token_storage.load_token(temp_hermes_home)
        assert loaded["access_token"] == valid_token_data["access_token"]
        assert loaded["refresh_token"] == valid_token_data["refresh_token"]
        assert loaded["client_id"] == valid_token_data["client_id"]
        assert loaded["expires_at"] == valid_token_data["expires_at"]
        assert loaded["token_type"] == valid_token_data["token_type"]

    def test_load_returns_blank_when_file_missing(self, temp_hermes_home: Path):
        """load_token should return a blank token when no file exists."""
        token = reddit_token_storage.load_token(temp_hermes_home)
        assert token["access_token"] == ""
        assert token["refresh_token"] == ""
        assert token["expires_at"] == 0.0

    def test_save_creates_directory(self, temp_hermes_home: Path, valid_token_data: dict):
        """save_token should create the credentials/ directory if needed."""
        nested = temp_hermes_home / "credentials"
        assert not nested.exists()
        reddit_token_storage.save_token(valid_token_data, temp_hermes_home)
        assert nested.is_dir()

    def test_token_exists(self, temp_hermes_home: Path, valid_token_data: dict):
        """token_exists returns True after a valid token is saved."""
        assert reddit_token_storage.token_exists(temp_hermes_home) is False
        reddit_token_storage.save_token(valid_token_data, temp_hermes_home)
        assert reddit_token_storage.token_exists(temp_hermes_home) is True

    def test_token_exists_empty_access_token(self, temp_hermes_home: Path):
        """token_exists returns False when access_token is empty."""
        blank = reddit_token_storage._default_token()
        reddit_token_storage.save_token(blank, temp_hermes_home)
        assert reddit_token_storage.token_exists(temp_hermes_home) is False

    def test_clear_token(self, temp_hermes_home: Path, valid_token_data: dict):
        """clear_token should delete the file and token_exists returns False."""
        reddit_token_storage.save_token(valid_token_data, temp_hermes_home)
        assert reddit_token_storage.token_exists(temp_hermes_home) is True

        cleared = reddit_token_storage.clear_token(temp_hermes_home)
        assert cleared is True
        assert reddit_token_storage.token_exists(temp_hermes_home) is False

    def test_clear_token_no_file(self, temp_hermes_home: Path):
        """clear_token should return True even if no file exists."""
        assert reddit_token_storage.clear_token(temp_hermes_home) is True

    def test_save_filters_unknown_fields(
        self, temp_hermes_home: Path, valid_token_data: dict
    ):
        """Unknown fields in the token data should be silently dropped."""
        valid_token_data["malicious_payload"] = "should_not_be_saved"
        reddit_token_storage.save_token(valid_token_data, temp_hermes_home)

        loaded = reddit_token_storage.load_token(temp_hermes_home)
        assert "malicious_payload" not in loaded

    def test_load_corrupted_json(
        self, temp_hermes_home: Path, valid_token_data: dict
    ):
        """A corrupted JSON file should return a blank token."""
        path = reddit_token_storage.get_token_path(temp_hermes_home)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{invalid json", encoding="utf-8")

        loaded = reddit_token_storage.load_token(temp_hermes_home)
        assert loaded["access_token"] == ""

    def test_load_non_dict_json(
        self, temp_hermes_home: Path, valid_token_data: dict
    ):
        """A JSON array (not dict) should return a blank token."""
        path = reddit_token_storage.get_token_path(temp_hermes_home)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('["not", "a", "dict"]', encoding="utf-8")

        loaded = reddit_token_storage.load_token(temp_hermes_home)
        assert loaded["access_token"] == ""

    def test_get_token_path_default(self):
        """get_token_path returns the expected path structure."""
        # We can't easily mock hermes_home for the fallback path, but we can
        # verify the relative component is correct.
        path = reddit_token_storage.get_token_path(Path("/fake/home"))
        assert str(path) == "/fake/home/credentials/reddit_token.json"

    def test_thread_safe_save_load(
        self, temp_hermes_home: Path, valid_token_data: dict
    ):
        """Concurrent save/load should not produce corrupted output."""
        import concurrent.futures

        def worker(iteration: int) -> bool:
            data = valid_token_data.copy()
            data["access_token"] = f"token_{iteration}"
            data["expires_at"] = time.time() + 3600
            return reddit_token_storage.save_token(data, temp_hermes_home)

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(worker, i) for i in range(20)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        assert all(results)
        # The final file should be valid JSON with all expected fields.
        loaded = reddit_token_storage.load_token(temp_hermes_home)
        assert loaded["access_token"] != ""
        assert loaded["expires_at"] > 0


# ══════════════════════════════════════════════════════════════════════════════
# RedditOAuthManager tests (no network calls)
# ══════════════════════════════════════════════════════════════════════════════


class TestRedditOAuthManager:
    """Tests for :class:`reddit_auth.RedditOAuthManager`."""

    def test_validate_token_delegates(
        self, temp_hermes_home: Path, valid_token_data: dict
    ):
        """Manager.validate_token should reflect stored token state."""
        reddit_token_storage.save_token(valid_token_data, temp_hermes_home)
        manager = reddit_auth.RedditOAuthManager(hermes_home=temp_hermes_home)
        assert manager.validate_token() is True

    def test_validate_token_no_token(self, temp_hermes_home: Path):
        """Validate token returns False when no token is stored."""
        manager = reddit_auth.RedditOAuthManager(hermes_home=temp_hermes_home)
        assert manager.validate_token() is False

    def test_ensure_token_triggers_refresh_when_expired(
        self, temp_hermes_home: Path, expired_token_data: dict
    ):
        """ensure_token should attempt refresh when token is expired."""
        reddit_token_storage.save_token(expired_token_data, temp_hermes_home)
        manager = reddit_auth.RedditOAuthManager(hermes_home=temp_hermes_home)

        with mock.patch.object(manager, "refresh_token", return_value=False) as mock_refresh:
            result = manager.ensure_token()
            mock_refresh.assert_called_once()
            assert result is False  # refresh fails -> ensure_token fails

    def test_ensure_token_skips_refresh_when_valid(
        self, temp_hermes_home: Path, valid_token_data: dict
    ):
        """ensure_token should NOT refresh when the token is valid."""
        reddit_token_storage.save_token(valid_token_data, temp_hermes_home)
        manager = reddit_auth.RedditOAuthManager(hermes_home=temp_hermes_home)

        with mock.patch.object(manager, "refresh_token") as mock_refresh:
            result = manager.ensure_token()
            mock_refresh.assert_not_called()
            assert result is True

    def test_verify_auth_returns_none_on_failure(
        self, temp_hermes_home: Path
    ):
        """verify_auth returns None when no valid token or credentials exist."""
        manager = reddit_auth.RedditOAuthManager(hermes_home=temp_hermes_home)
        # No env vars set, no token stored -> should fail gracefully.
        result = manager.verify_auth()
        assert result is None

    def test_invalidate_client(self, temp_hermes_home: Path):
        """invalidate_client should reset the cached PRAW client."""
        manager = reddit_auth.RedditOAuthManager(hermes_home=temp_hermes_home)
        manager.reddit = mock.MagicMock()  # Simulate a cached client
        assert manager.reddit is not None
        manager.invalidate_client()
        assert manager.reddit is None

    def test_refresh_token_no_credentials(self, temp_hermes_home: Path):
        """refresh_token should return False when no client credentials exist."""
        manager = reddit_auth.RedditOAuthManager(
            client_id="",
            client_secret="",
            hermes_home=temp_hermes_home,
        )
        result = manager.refresh_token()
        assert result is False


# ══════════════════════════════════════════════════════════════════════════════
# refresh_access_token function tests (no network calls)
# ══════════════════════════════════════════════════════════════════════════════


class TestRefreshAccessToken:
    """Tests for :func:`reddit_auth.refresh_access_token`."""

    def test_missing_client_id(self, temp_hermes_home: Path):
        """Should return failure when no client_id is available."""
        success, token = reddit_auth.refresh_access_token(
            client_id="",
            client_secret="test_secret",
            hermes_home=temp_hermes_home,
        )
        assert success is False

    def test_missing_client_secret(self, temp_hermes_home: Path):
        """Should return failure when no client_secret is available."""
        success, token = reddit_auth.refresh_access_token(
            client_id="test_id",
            client_secret="",
            hermes_home=temp_hermes_home,
        )
        assert success is False

    @mock.patch("app.platforms.reddit_auth.httpx.post")
    def test_successful_refresh(
        self, mock_post, temp_hermes_home: Path, valid_token_data: dict
    ):
        """A successful HTTP refresh should persist the new token."""
        # Save a token with a refresh token so the function uses refresh grant.
        reddit_token_storage.save_token(valid_token_data, temp_hermes_home)

        # Mock a successful HTTP response.
        mock_response = mock.MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "access_token": "new_access_token_456",
            "token_type": "bearer",
            "expires_in": 3600,
            "refresh_token": "new_refresh_token_000",
        }
        mock_post.return_value = mock_response

        success, token = reddit_auth.refresh_access_token(
            client_id="test_client_id",
            client_secret="test_client_secret",
            hermes_home=temp_hermes_home,
        )
        assert success is True
        assert token["access_token"] == "new_access_token_456"
        assert token["refresh_token"] == "new_refresh_token_000"
        assert token["expires_at"] > time.time()

        # Verify it was persisted.
        loaded = reddit_token_storage.load_token(temp_hermes_home)
        assert loaded["access_token"] == "new_access_token_456"

    @mock.patch("app.platforms.reddit_auth.httpx.post")
    def test_http_error(
        self, mock_post, temp_hermes_home: Path, valid_token_data: dict
    ):
        """An HTTP error should return failure and keep the old token."""
        reddit_token_storage.save_token(valid_token_data, temp_hermes_home)

        mock_response = mock.MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "401 Unauthorized",
            request=mock.MagicMock(),
            response=mock.MagicMock(status_code=401, text="Unauthorized"),
        )
        mock_post.return_value = mock_response

        success, token = reddit_auth.refresh_access_token(
            client_id="test_client_id",
            client_secret="test_client_secret",
            hermes_home=temp_hermes_home,
        )
        assert success is False
        # Original token should be preserved.
        assert token["access_token"] == valid_token_data["access_token"]

    @mock.patch("app.platforms.reddit_auth.httpx.post")
    def test_empty_access_token_in_response(
        self, mock_post, temp_hermes_home: Path, valid_token_data: dict
    ):
        """A response missing access_token should return failure."""
        reddit_token_storage.save_token(valid_token_data, temp_hermes_home)

        mock_response = mock.MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "token_type": "bearer",
            "expires_in": 3600,
            # No access_token key.
        }
        mock_post.return_value = mock_response

        success, token = reddit_auth.refresh_access_token(
            client_id="test_client_id",
            client_secret="test_client_secret",
            hermes_home=temp_hermes_home,
        )
        assert success is False

    @mock.patch("app.platforms.reddit_auth.httpx.post")
    def test_password_grant_fallback(
        self, mock_post, temp_hermes_home: Path
    ):
        """When no refresh token exists, it should fall back to password grant."""
        # Save a token with no refresh_token.
        blank = reddit_token_storage._default_token()
        reddit_token_storage.save_token(blank, temp_hermes_home)

        mock_response = mock.MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "access_token": "password_grant_token",
            "token_type": "bearer",
            "expires_in": 3600,
        }
        mock_post.return_value = mock_response

        with mock.patch.dict(
            os.environ,
            {
                "REDDIT_USERNAME": "test_user",
                "REDDIT_PASSWORD": "test_pass",
            },
        ):
            success, token = reddit_auth.refresh_access_token(
                client_id="test_client_id",
                client_secret="test_client_secret",
                hermes_home=temp_hermes_home,
            )
        assert success is True
        assert token["access_token"] == "password_grant_token"


# ══════════════════════════════════════════════════════════════════════════════
# Module-level convenience functions
# ══════════════════════════════════════════════════════════════════════════════


class TestGetRedditClient:
    """Tests for :func:`reddit_auth.get_reddit_client`."""

    def test_get_reddit_client_returns_instance(self):
        """get_reddit_client should return a praw.Reddit instance (mocked)."""
        # We mock the manager so no real API call is made.
        with mock.patch.object(
            reddit_auth, "_get_default_manager"
        ) as mock_mgr_factory:
            mock_mgr = mock.MagicMock()
            mock_mgr.get_client.return_value = mock.MagicMock(spec=praw.Reddit)
            mock_mgr_factory.return_value = mock_mgr

            client = reddit_auth.get_reddit_client()
            assert client is not None
            mock_mgr.get_client.assert_called_once()

    def test_validate_and_get_reddit_client(self):
        """get_reddit_client should be importable and callable."""
        # Just verify the import works; don't call the HTTP-dependent path.
        from app.platforms.reddit_auth import get_reddit_client
        assert callable(get_reddit_client)
