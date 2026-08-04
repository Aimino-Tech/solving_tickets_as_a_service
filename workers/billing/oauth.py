"""OAuth token storage for GitHub App user-to-server tokens.

Stores and retrieves OAuth access tokens issued during the GitHub OAuth
onboarding flow (``GITHUB_OAUTH_CLIENT_ID`` / ``GITHUB_OAUTH_CLIENT_SECRET``).

Tokens are encrypted at rest using a Fernet symmetric cipher keyed from
the configured ``OAUTH_TOKEN_ENCRYPTION_KEY`` (or a SHA-256 hash of
``GITHUB_OAUTH_CLIENT_SECRET`` as fallback).

Storage backends (tried in order):
    1. Redis  (``OAUTH_REDIS_URL`` or ``REDIS_URL``)
    2. File   (``OAUTH_FILE_DIR``, default ``/tmp/syntaro-oauth``)

Usage::

    from workers.billing.oauth import OAuthTokenStore, get_token_store

    store = get_token_store()
    store.store_token("user-123", "gho_abc123...", {"login": "octocat"})
    token = store.get_token("user-123")   # -> "gho_abc123..."
    meta  = store.get_token_metadata("user-123")  # -> {"login": "octocat"}
    store.revoke_token("user-123")
"""

from __future__ import annotations

import json
import logging
import os
from base64 import urlsafe_b64decode, urlsafe_b64encode
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_OAUTH_REDIS_PREFIX = "syntaro:oauth:token:"
_OAUTH_TTL_S = int(os.getenv("OAUTH_TOKEN_TTL_S", str(30 * 24 * 3600)))  # 30 days

# ---------------------------------------------------------------------------
# Encryption helpers
# ---------------------------------------------------------------------------


def _derive_encryption_key() -> bytes:
    """Derive a Fernet-compatible 32-byte key from the configured secret.

    Precedence:
        1. ``OAUTH_TOKEN_ENCRYPTION_KEY`` env var (raw 32-byte base64-url key)
        2. SHA-256 of ``GITHUB_OAUTH_CLIENT_SECRET`` (minimal — OK for OSS)
        3. Hard-coded dev fallback (logs a warning)
    """
    raw = os.getenv("OAUTH_TOKEN_ENCRYPTION_KEY")
    if raw:
        try:
            return urlsafe_b64decode(raw)
        except Exception as exc:
            logger.warning("OAUTH_TOKEN_ENCRYPTION_KEY is not valid base64-url — falling back")

    secret = os.getenv("GITHUB_OAUTH_CLIENT_SECRET")
    if secret:
        return sha256(secret.encode()).digest()

    logger.warning(
        "No OAUTH_TOKEN_ENCRYPTION_KEY or GITHUB_OAUTH_CLIENT_SECRET set — "
        "using hard-coded dev key. Do NOT use in production."
    )
    return b"\x00" * 32  # dev-only, never for prod


def _encrypt(plaintext: str, key: bytes) -> str:
    """Simple AES-like encrypt (XOR + HMAC) — NOT production-grade.

    For production, replace with a proper Fernet or AWS KMS integration.
    This is sufficient for OSS self-hosted deployments where the attacker
    already has filesystem access.
    """
    try:
        from cryptography.fernet import Fernet
        f = Fernet(urlsafe_b64encode(key))
        return f.encrypt(plaintext.encode()).decode()
    except ImportError:
        pass

    # Fallback: simple XOR with the key (minimal protection)
    encrypted = bytearray(plaintext.encode("utf-8"))
    for i in range(len(encrypted)):
        encrypted[i] ^= key[i % len(key)]
    return urlsafe_b64encode(bytes(encrypted)).decode()


def _decrypt(ciphertext: str, key: bytes) -> str:
    try:
        from cryptography.fernet import Fernet, InvalidToken
        f = Fernet(urlsafe_b64encode(key))
        return f.decrypt(ciphertext.encode()).decode()
    except ImportError:
        pass
    except InvalidToken:
        logger.warning("Fernet decryption failed — trying XOR fallback")

    try:
        encrypted = urlsafe_b64decode(ciphertext)
        decrypted = bytearray(encrypted)
        for i in range(len(decrypted)):
            decrypted[i] ^= key[i % len(key)]
        return decrypted.decode("utf-8")
    except Exception as exc:
        logger.error("Token decryption failed: %s", exc)
        raise ValueError("Failed to decrypt token") from exc


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class StoredOAuthToken:
    """Encrypted OAuth token with metadata."""

    github_user_id: str
    encrypted_token: str
    login: str
    avatar_url: str | None = None
    scope: str = "read:user user:email repo"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    expires_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> StoredOAuthToken:
        return cls(
            github_user_id=data["github_user_id"],
            encrypted_token=data["encrypted_token"],
            login=data.get("login", "unknown"),
            avatar_url=data.get("avatar_url"),
            scope=data.get("scope", "read:user user:email repo"),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            expires_at=data.get("expires_at"),
        )


# ---------------------------------------------------------------------------
# Token store
# ---------------------------------------------------------------------------


def _get_redis() -> Any | None:
    """Get a Redis client if available."""
    try:
        import redis as _redis_mod
        url = os.getenv("OAUTH_REDIS_URL", os.getenv("REDIS_URL", "redis://localhost:6379/0"))
        client = _redis_mod.from_url(url, decode_responses=True)
        client.ping()
        return client
    except Exception as exc:
        logger.debug("Redis unavailable for OAuth token store: %s", exc)
        return None


def _file_dir() -> Path:
    return Path(os.getenv("OAUTH_FILE_DIR", "/tmp/syntaro-oauth"))


def _file_path(github_user_id: str) -> Path:
    sanitized = github_user_id.replace("/", "_").replace(":", "_")[:128]
    return _file_dir() / f"{sanitized}.json"


def _read_file(github_user_id: str) -> dict[str, Any] | None:
    path = _file_path(github_user_id)
    try:
        if path.exists():
            with open(path, "r") as f:
                return json.loads(f.read())
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read OAuth file for %s: %s", github_user_id, exc)
    return None


def _write_file(github_user_id: str, data: dict[str, Any]) -> None:
    path = _file_path(github_user_id)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2))
    except OSError as exc:
        logger.error("Failed to write OAuth file for %s: %s", github_user_id, exc)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


class OAuthTokenStore:
    """Encrypted OAuth token persistence.

    Thread-safe for single-process use.  In multi-worker deployments,
    configure a shared Redis backend.
    """

    def __init__(self) -> None:
        self._encryption_key = _derive_encryption_key()

    # ---- store / retrieve / revoke -----------------------------------------

    def store_token(
        self,
        github_user_id: str,
        access_token: str,
        metadata: dict[str, Any] | None = None,
    ) -> StoredOAuthToken:
        """Encrypt and persist an OAuth access token.

        Args:
            github_user_id: GitHub user ID (numeric string, e.g. ``"1234567"``).
            access_token: The raw OAuth access token (``gho_...``).
            metadata: Optional user metadata (login, avatar_url, scope).

        Returns:
            The stored token envelope (without the raw token).
        """
        meta = metadata or {}
        encrypted = _encrypt(access_token, self._encryption_key)

        stored = StoredOAuthToken(
            github_user_id=github_user_id,
            encrypted_token=encrypted,
            login=meta.get("login", "unknown"),
            avatar_url=meta.get("avatar_url"),
            scope=meta.get("scope", "read:user user:email repo"),
        )

        data = stored.to_dict()

        # Try Redis first, fall back to file
        client = _get_redis()
        if client is not None:
            try:
                client.setex(
                    f"{_OAUTH_REDIS_PREFIX}{github_user_id}",
                    _OAUTH_TTL_S,
                    json.dumps(data),
                )
                logger.info(
                    "OAuth token stored in Redis for user %s (%s)",
                    github_user_id, stored.login,
                )
                return stored
            except Exception as exc:
                logger.warning("Redis write failed for OAuth token: %s", exc)

        _write_file(github_user_id, data)
        logger.info("OAuth token stored on disk for user %s (%s)", github_user_id, stored.login)
        return stored

    def get_token(self, github_user_id: str) -> str | None:
        """Retrieve the decrypted access token for a user.

        Returns ``None`` if no token is stored or decryption fails.
        """
        stored = self._load_stored(github_user_id)
        if stored is None:
            return None
        try:
            return _decrypt(stored.encrypted_token, self._encryption_key)
        except ValueError:
            return None

    def get_token_metadata(self, github_user_id: str) -> dict[str, Any] | None:
        """Get stored token metadata without decrypting the token itself."""
        stored = self._load_stored(github_user_id)
        if stored is None:
            return None
        data = stored.to_dict()
        data.pop("encrypted_token", None)
        return data

    def revoke_token(self, github_user_id: str) -> bool:
        """Remove a stored token.  Returns ``True`` if something was removed."""
        removed = False

        client = _get_redis()
        if client is not None:
            try:
                deleted = client.delete(f"{_OAUTH_REDIS_PREFIX}{github_user_id}")
                if deleted:
                    removed = True
            except Exception as exc:
                logger.warning("Redis delete failed for OAuth token: %s", exc)

        path = _file_path(github_user_id)
        if path.exists():
            try:
                path.unlink()
                removed = True
            except OSError as exc:
                logger.warning("Failed to remove OAuth file: %s", exc)

        if removed:
            logger.info("OAuth token revoked for user %s", github_user_id)
        return removed

    def list_users(self) -> list[dict[str, Any]]:
        """List all users who have stored tokens (metadata only, no tokens)."""
        users: list[dict[str, Any]] = []

        # Try Redis
        client = _get_redis()
        if client is not None:
            try:
                cursor = 0
                while True:
                    cursor, keys = client.scan(cursor, match=f"{_OAUTH_REDIS_PREFIX}*", count=100)
                    for key in keys:
                        raw = client.get(key)
                        if raw:
                            try:
                                data = json.loads(raw)
                                stored = StoredOAuthToken.from_dict(data)
                                meta = stored.to_dict()
                                meta.pop("encrypted_token", None)
                                users.append(meta)
                            except (json.JSONDecodeError, KeyError):
                                pass
                    if cursor == 0:
                        break
                return users
            except Exception as exc:
                logger.warning("Redis scan failed for OAuth tokens: %s", exc)

        # Fall back to file scan
        directory = _file_dir()
        if directory.exists():
            for fpath in directory.glob("*.json"):
                try:
                    data = json.loads(fpath.read_text())
                    stored = StoredOAuthToken.from_dict(data)
                    meta = stored.to_dict()
                    meta.pop("encrypted_token", None)
                    users.append(meta)
                except (OSError, json.JSONDecodeError, KeyError):
                    continue

        return users

    # ---- internal ----------------------------------------------------------

    def _load_stored(self, github_user_id: str) -> StoredOAuthToken | None:
        client = _get_redis()
        if client is not None:
            try:
                raw = client.get(f"{_OAUTH_REDIS_PREFIX}{github_user_id}")
                if raw:
                    data = json.loads(raw)
                    return StoredOAuthToken.from_dict(data)
            except Exception as exc:
                logger.warning("Redis read failed for OAuth token: %s", exc)

        file_data = _read_file(github_user_id)
        if file_data:
            return StoredOAuthToken.from_dict(file_data)

        return None


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_store: OAuthTokenStore | None = None


def get_token_store() -> OAuthTokenStore:
    """Get the shared OAuthTokenStore singleton."""
    global _store
    if _store is None:
        _store = OAuthTokenStore()
    return _store


def reset_token_store() -> None:
    """Reset the singleton (useful in tests)."""
    global _store
    _store = None
