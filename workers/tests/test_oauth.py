"""Tests for OAuth token storage (workers/billing/oauth.py)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from workers.billing.oauth import (
    OAuthTokenStore,
    StoredOAuthToken,
    get_token_store,
    reset_token_store,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class DictRedisMock:
    """Minimal Redis mock for OAuth token storage tests."""

    def __init__(self) -> None:
        self._data: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self._data.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self._data[key] = value

    def set(self, key: str, value: str) -> None:
        self._data[key] = value

    def delete(self, key: str) -> int:
        return 1 if self._data.pop(key, None) is not None else 0

    def ping(self) -> bool:
        return True

    def scan(self, cursor: int = 0, match: str = "*", count: int = 10) -> tuple[int, list[str]]:
        matching = [k for k in self._data if match.replace("*", "") in k]
        return 0, matching

    def __getattr__(self, name: str) -> Any:
        return MagicMock()


@pytest.fixture(autouse=True)
def _reset_store() -> None:
    reset_token_store()


@pytest.fixture
def mock_redis(monkeypatch: pytest.MonkeyPatch) -> DictRedisMock:
    """Replace Redis with DictRedisMock for all tests."""
    mock = DictRedisMock()

    def _get_redis() -> DictRedisMock:
        return mock

    monkeypatch.setattr("workers.billing.oauth._get_redis", _get_redis)
    return mock


@pytest.fixture
def file_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Force file-based storage by making Redis unavailable."""
    monkeypatch.setattr("workers.billing.oauth._get_redis", lambda: None)
    monkeypatch.setenv("OAUTH_FILE_DIR", str(tmp_path))
    return tmp_path


# ---------------------------------------------------------------------------
# Tests: StoredOAuthToken data model
# ---------------------------------------------------------------------------


class TestStoredOAuthToken:
    def test_default_fields(self):
        token = StoredOAuthToken(
            github_user_id="12345",
            encrypted_token="encrypted_value",
            login="octocat",
        )
        assert token.github_user_id == "12345"
        assert token.encrypted_token == "encrypted_value"
        assert token.login == "octocat"
        assert token.avatar_url is None
        assert token.scope == "read:user user:email repo"
        assert token.created_at is not None
        assert token.expires_at is None

    def test_to_dict_roundtrip(self):
        token = StoredOAuthToken(
            github_user_id="12345",
            encrypted_token="encrypted_value",
            login="octocat",
            avatar_url="https://avatars.githubusercontent.com/u/12345",
            scope="repo",
        )
        d = token.to_dict()
        assert d["github_user_id"] == "12345"
        assert d["login"] == "octocat"

        restored = StoredOAuthToken.from_dict(d)
        assert restored.github_user_id == "12345"
        assert restored.encrypted_token == "encrypted_value"
        assert restored.login == "octocat"
        assert restored.avatar_url == "https://avatars.githubusercontent.com/u/12345"

    def test_from_dict_handles_missing_optional_keys(self):
        d = {"github_user_id": "12345", "encrypted_token": "enc", "login": "octocat"}
        token = StoredOAuthToken.from_dict(d)
        assert token.avatar_url is None
        assert token.scope == "read:user user:email repo"


# ---------------------------------------------------------------------------
# Tests: OAuthTokenStore with Redis backend
# ---------------------------------------------------------------------------


class TestOAuthTokenStoreRedis:
    def test_store_and_retrieve_token(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        store.store_token(
            "12345",
            "gho_test_access_token",
            {"login": "octocat", "avatar_url": "https://avatars.githubusercontent.com/u/12345"},
        )

        token = store.get_token("12345")
        assert token == "gho_test_access_token"

    def test_get_token_metadata(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        store.store_token(
            "12345",
            "gho_test_token",
            {"login": "octocat", "scope": "repo"},
        )

        meta = store.get_token_metadata("12345")
        assert meta is not None
        assert meta["login"] == "octocat"
        assert meta["scope"] == "repo"
        assert "encrypted_token" not in meta

    def test_revoke_token(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        store.store_token("12345", "gho_test_token", {"login": "octocat"})
        assert store.get_token("12345") is not None

        result = store.revoke_token("12345")
        assert result is True
        assert store.get_token("12345") is None

    def test_get_nonexistent_token(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        assert store.get_token("nonexistent") is None
        assert store.get_token_metadata("nonexistent") is None

    def test_list_users(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        store.store_token("1", "token1", {"login": "user1"})
        store.store_token("2", "token2", {"login": "user2"})

        users = store.list_users()
        logins = {u["login"] for u in users}
        assert "user1" in logins
        assert "user2" in logins
        # Tokens should not be in list output
        for u in users:
            assert "encrypted_token" not in u

    def test_roundtrip_preserves_all_metadata(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        store.store_token(
            "42",
            "gho_secret_token_123",
            {
                "login": "testuser",
                "avatar_url": "https://avatars.githubusercontent.com/u/42",
                "scope": "repo,user",
            },
        )

        meta = store.get_token_metadata("42")
        assert meta is not None
        assert meta["login"] == "testuser"
        assert meta["avatar_url"] == "https://avatars.githubusercontent.com/u/42"
        assert meta["scope"] == "repo,user"

        raw = store.get_token("42")
        assert raw == "gho_secret_token_123"


# ---------------------------------------------------------------------------
# Tests: OAuthTokenStore with file backend
# ---------------------------------------------------------------------------


class TestOAuthTokenStoreFile:
    def test_store_and_retrieve_file(self, file_store: Path):
        store = OAuthTokenStore()
        store.store_token(
            "12345",
            "gho_file_token",
            {"login": "fileuser"},
        )

        token = store.get_token("12345")
        assert token == "gho_file_token"

    def test_token_persists_across_store_instances(self, file_store: Path):
        store1 = OAuthTokenStore()
        store1.store_token("12345", "gho_persistent", {"login": "persistuser"})

        # Create a new store instance (same encryption key from env)
        store2 = OAuthTokenStore()
        token = store2.get_token("12345")
        assert token == "gho_persistent"

    def test_revoke_file_token(self, file_store: Path):
        store = OAuthTokenStore()
        store.store_token("12345", "gho_revoke_me", {"login": "revokeuser"})
        assert store.get_token("12345") is not None

        result = store.revoke_token("12345")
        assert result is True
        assert store.get_token("12345") is None

    def test_file_persistence_encrypted(self, file_store: Path):
        store = OAuthTokenStore()
        store.store_token("12345", "gho_plaintext", {"login": "secrecy"})

        # The file should contain the encrypted token, not the raw token
        file_path = file_store / "12345.json"
        assert file_path.exists()
        raw_data = json.loads(file_path.read_text())
        assert raw_data["encrypted_token"] != "gho_plaintext"
        assert raw_data["login"] == "secrecy"


# ---------------------------------------------------------------------------
# Tests: Edge cases and error handling
# ---------------------------------------------------------------------------


class TestOAuthTokenStoreEdgeCases:
    def test_store_token_with_empty_metadata(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        store.store_token("12345", "gho_token")
        assert store.get_token("12345") == "gho_token"
        meta = store.get_token_metadata("12345")
        assert meta is not None
        assert meta["login"] == "unknown"

    def test_double_store_overwrites(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        store.store_token("12345", "token_v1", {"login": "user_v1"})
        store.store_token("12345", "token_v2", {"login": "user_v2"})

        assert store.get_token("12345") == "token_v2"
        meta = store.get_token_metadata("12345")
        assert meta is not None
        assert meta["login"] == "user_v2"

    def test_revoke_nonexistent_user(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        result = store.revoke_token("does_not_exist")
        assert result is False

    def test_list_users_empty(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        assert store.list_users() == []

    def test_get_token_corrupted_data_returns_none(self, mock_redis: DictRedisMock):
        """If the stored data is corrupted, get_token should return None."""
        mock_redis._data["stas:oauth:token:corrupted"] = "not valid json"

        store = OAuthTokenStore()
        token = store.get_token("corrupted")
        assert token is None

    def test_multiple_users_isolation(self, mock_redis: DictRedisMock):
        store = OAuthTokenStore()
        store.store_token("user_a", "token_a", {"login": "alice"})
        store.store_token("user_b", "token_b", {"login": "bob"})

        assert store.get_token("user_a") == "token_a"
        assert store.get_token("user_b") == "token_b"
        assert store.get_token_metadata("user_a")["login"] == "alice"
        assert store.get_token_metadata("user_b")["login"] == "bob"

        store.revoke_token("user_a")
        assert store.get_token("user_a") is None
        assert store.get_token("user_b") == "token_b"

    def test_singleton_consistency(self, mock_redis: DictRedisMock):
        store1 = get_token_store()
        store2 = get_token_store()
        assert store1 is store2


# ---------------------------------------------------------------------------
# Tests: Encryption roundtrip with known key
# ---------------------------------------------------------------------------


class TestEncryption:
    def test_encrypt_decrypt_roundtrip(self, monkeypatch: pytest.MonkeyPatch):
        """With a fixed encryption key, encrypt and decrypt should roundtrip."""
        from base64 import urlsafe_b64encode

        fixed_key = b"\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10" * 2  # 32 bytes
        monkeypatch.setenv("OAUTH_TOKEN_ENCRYPTION_KEY", urlsafe_b64encode(fixed_key).decode())

        reset_token_store()
        store = get_token_store()

        store.store_token("enc_test", "gho_encrypt_me", {"login": "enctest"})
        assert store.get_token("enc_test") == "gho_encrypt_me"
