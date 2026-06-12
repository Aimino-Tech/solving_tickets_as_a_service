"""Reddit OAuth2 authentication manager with automatic token refresh.

Provides a :class:`RedditOAuthManager` that wraps PRAW's ``read-only`` and
``script`` (password) flows with OAuth2 refresh-token lifecycle management.

Typical usage::

    from app.platforms.reddit_auth import get_reddit_client

    reddit = get_reddit_client()
    me = reddit.user.me()          # auto-refreshes if token is stale
    print(f"Authenticated as {me}")

The manager persists tokens via :mod:`.reddit_token_storage` and refreshes
them through Reddit's OAuth2 token endpoint when the ``expires_at`` timestamp
indicates the token is expired or within 5 minutes of expiry.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

import httpx
import praw

from app.platforms.reddit_token_storage import (
    load_token,
    save_token,
    token_exists,
)

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────

REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token"

# Refresh the token when fewer than this many seconds remain before expiry.
REFRESH_BUFFER_SECONDS = 300  # 5 minutes

# ── Module-level env var fallbacks ───────────────────────────────────────────

_DEFAULT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID", "")
_DEFAULT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET", "")
_DEFAULT_USER_AGENT = os.getenv(
    "REDDIT_USER_AGENT", "hermes-agent/1.0 (by u/hermes_agent)"
)
_DEFAULT_USERNAME = os.getenv("REDDIT_USERNAME", "")
_DEFAULT_PASSWORD = os.getenv("REDDIT_PASSWORD", "")


# ══════════════════════════════════════════════════════════════════════════════
# Public helpers
# ══════════════════════════════════════════════════════════════════════════════


def validate_token(token_data: dict, buffer: int = REFRESH_BUFFER_SECONDS) -> bool:
    """Check whether the stored access token is still usable.

    A token is valid when:

    * ``access_token`` is a non-empty string.
    * ``expires_at`` is a number (seconds since epoch) that is at least
      *buffer* seconds in the future.

    Args:
        token_data: A token dict (see :data:`TOKEN_FIELDS`).
        buffer: Grace period in seconds before actual expiry.
            Defaults to :data:`REFRESH_BUFFER_SECONDS` (5 minutes).

    Returns:
        ``True`` if the token is present and not about to expire.
    """
    access_token = token_data.get("access_token", "")
    if not access_token:
        return False

    expires_at = token_data.get("expires_at", 0.0)
    if not isinstance(expires_at, (int, float)) or expires_at <= 0:
        return False

    remaining = expires_at - time.time()
    return remaining > buffer


def _now_utc() -> datetime:
    """Return the current UTC datetime."""
    return datetime.now(timezone.utc)


# ══════════════════════════════════════════════════════════════════════════════
# OAuth2 token refresh (direct HTTP)
# ══════════════════════════════════════════════════════════════════════════════


def refresh_access_token(
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    refresh_token: Optional[str] = None,
    hermes_home: Optional[Path] = None,
) -> Tuple[bool, dict]:
    """Refresh the Reddit access token via the OAuth2 token endpoint.

    Uses the stored refresh token (or falls back to password grant) to obtain
    a new access token.  On success the updated token is persisted to disk and
    returned.

    Args:
        client_id: Reddit OAuth2 client ID.  Falls back to ``REDDIT_CLIENT_ID``
            env var.
        client_secret: Reddit OAuth2 client secret.  Falls back to
            ``REDDIT_CLIENT_SECRET`` env var.
        refresh_token: Optional refresh token.  When ``None`` (the default),
            the stored token file is consulted first, and if that is also empty,
            a password-grant refresh is attempted using ``REDDIT_USERNAME`` /
            ``REDDIT_PASSWORD``.
        hermes_home: Override Hermes home for token storage.

    Returns:
        ``(success, token_data)`` tuple.  *success* is ``True`` when the
        token was refreshed and persisted.  *token_data* is the updated dict
        (or the original on failure).
    """
    cid = client_id or _DEFAULT_CLIENT_ID
    secret = client_secret or _DEFAULT_CLIENT_SECRET

    if not cid or not secret:
        logger.error(
            "Reddit OAuth refresh failed: REDDIT_CLIENT_ID and "
            "REDDIT_CLIENT_SECRET must be set"
        )
        return False, load_token(hermes_home)

    stored = load_token(hermes_home)
    rt = refresh_token or stored.get("refresh_token", "")

    auth = httpx.BasicAuth(username=cid, password=secret)
    data: dict = {"grant_type": "refresh_token", "refresh_token": rt}

    # Fall back to password grant if no refresh token is available.
    if not rt:
        username = _DEFAULT_USERNAME
        password = _DEFAULT_PASSWORD
        if not username or not password:
            logger.error(
                "Reddit OAuth refresh failed: no refresh token available "
                "and REDDIT_USERNAME / REDDIT_PASSWORD are not set"
            )
            return False, stored
        data = {"grant_type": "password", "username": username, "password": password}
        logger.info("No refresh token — using password grant for initial token")

    try:
        resp = httpx.post(
            REDDIT_TOKEN_URL,
            auth=auth,
            data=data,
            headers={"User-Agent": _DEFAULT_USER_AGENT},
            timeout=30,
        )
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Reddit token refresh returned HTTP %s: %s",
            exc.response.status_code,
            exc.response.text[:500],
        )
        return False, stored
    except (httpx.RequestError, ValueError) as exc:
        logger.warning("Reddit token refresh request failed: %s", exc)
        return False, stored
    except Exception as exc:
        logger.warning("Reddit token refresh unexpected error: %s", exc)
        return False, stored

    # Parse the response.
    access_token = body.get("access_token", "")
    if not access_token:
        logger.warning(
            "Reddit token response missing access_token: %s", str(body)[:300]
        )
        return False, stored

    new_token = stored.copy()
    new_token["access_token"] = access_token
    new_token["token_type"] = body.get("token_type", "bearer")

    # Reddit returns expires_in in seconds; compute absolute expiry.
    expires_in = body.get("expires_in", 3600)
    new_token["expires_at"] = time.time() + expires_in

    # Capture refresh token if returned (Reddit may return the same one).
    if "refresh_token" in body and body["refresh_token"]:
        new_token["refresh_token"] = body["refresh_token"]
    elif not new_token.get("refresh_token"):
        # Password grants do not return a refresh token — store a sentinel.
        new_token["refresh_token"] = ""

    new_token["client_id"] = cid
    new_token["client_secret"] = secret

    saved = save_token(new_token, hermes_home)
    if saved:
        logger.info(
            "Reddit access token refreshed — expires in %ss (%s)",
            expires_in,
            _now_utc().isoformat(),
        )
    else:
        logger.warning("Token refreshed but could not persist to disk")

    return True, new_token


# ══════════════════════════════════════════════════════════════════════════════
# RedditOAuthManager
# ══════════════════════════════════════════════════════════════════════════════


class RedditOAuthManager:
    """Manages a Reddit OAuth2 session with automatic token refresh.

    Wraps a :class:`praw.Reddit` instance and ensures the access token is
    always valid before API calls are made.

    Args:
        client_id: Reddit OAuth2 client ID.  Falls back to ``REDDIT_CLIENT_ID``
            env var.
        client_secret: Reddit OAuth2 client secret.  Falls back to
            ``REDDIT_CLIENT_SECRET`` env var.
        user_agent: Reddit API user-agent string.  Falls back to
            ``REDDIT_USER_AGENT`` env var or a sensible default.
        username: Reddit account username (for password grant fallback).
        password: Reddit account password (for password grant fallback).
        hermes_home: Override Hermes home for token storage.

    Attributes:
        reddit: The :class:`praw.Reddit` instance (re-created on refresh).
    """

    def __init__(
        self,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        user_agent: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        hermes_home: Optional[Path] = None,
    ):
        self._client_id = client_id or _DEFAULT_CLIENT_ID
        self._client_secret = client_secret or _DEFAULT_CLIENT_SECRET
        self._user_agent = user_agent or _DEFAULT_USER_AGENT
        self._username = username or _DEFAULT_USERNAME
        self._password = password or _DEFAULT_PASSWORD
        self._hermes_home = hermes_home

        self.reddit: Optional[praw.Reddit] = None

    # ── Token management ──────────────────────────────────────────────────

    def validate_token(self) -> bool:
        """Check whether the current access token is still valid.

        Returns:
            ``True`` if the token is present and not within 5 minutes of
            expiry.
        """
        token_data = load_token(self._hermes_home)
        return validate_token(token_data)

    def refresh_token(self) -> bool:
        """Force a token refresh from the OAuth2 endpoint.

        Returns:
            ``True`` on success.
        """
        success, token_data = refresh_access_token(
            client_id=self._client_id,
            client_secret=self._client_secret,
            hermes_home=self._hermes_home,
        )
        return success

    def ensure_token(self) -> bool:
        """Ensure a valid access token is available, refreshing if needed.

        If the token is expired or missing, attempts a refresh.  Returns
        ``True`` if a valid token is available after the attempt.
        """
        if self.validate_token():
            return True
        logger.info("Reddit token expired or missing — attempting refresh")
        return self.refresh_token()

    # ── PRAW client creation ──────────────────────────────────────────────

    def _build_praw_client(self) -> praw.Reddit:
        """Build a PRAW ``Reddit`` instance using the current token.

        This is a **read-only** (OAuth2 bearer-token) client.  It does NOT
        use username/password authentication, which reduces the risk of
        credential exposure and works with refresh-token flows.

        When no stored access token exists yet, falls back to the traditional
        ``script``-type (password) authentication, which will create a new
        session token internally.
        """
        token_data = load_token(self._hermes_home)
        access_token = token_data.get("access_token", "")

        if access_token:
            # Use the OAuth2 bearer token directly (read-only authorizer).
            return praw.Reddit(
                client_id=self._client_id,
                client_secret=self._client_secret,
                user_agent=self._user_agent,
                access_token=access_token,
            )

        # Fall back to script-type (password) auth for the initial handshake.
        logger.info("No stored access token — using password auth for initial PRAW client")
        return praw.Reddit(
            client_id=self._client_id,
            client_secret=self._client_secret,
            user_agent=self._user_agent,
            username=self._username,
            password=self._password,
        )

    # ── Public entry points ───────────────────────────────────────────────

    def get_client(self) -> praw.Reddit:
        """Return a PRAW :class:`praw.Reddit` instance with valid auth.

        If the stored access token is expired or close to expiry, it is
        refreshed transparently before creating the PRAW client.

        The client is cached in ``self.reddit`` and re-created only when a
        refresh occurs.

        Returns:
            An authenticated :class:`praw.Reddit` instance.
        """
        if self.reddit is not None and self.validate_token():
            return self.reddit

        # Refresh if needed.
        self.ensure_token()
        self.reddit = self._build_praw_client()
        return self.reddit

    def verify_auth(self) -> Optional[str]:
        """Verify that the current credentials work by calling the Reddit API.

        Returns:
            The authenticated username as a string, or ``None`` on failure.
        """
        try:
            client = self.get_client()
            user = client.user.me()
            username = str(user)
            logger.info("Reddit OAuth verified: authenticated as %s", username)
            return username
        except Exception as exc:
            logger.warning("Reddit OAuth verification failed: %s", exc)
            return None

    def invalidate_client(self) -> None:
        """Force a fresh PRAW client on the next :meth:`get_client` call.

        Useful after a manual token refresh or when PRAW reports an auth
        error during an API call.
        """
        self.reddit = None


# ══════════════════════════════════════════════════════════════════════════════
# Module-level convenience functions
# ══════════════════════════════════════════════════════════════════════════════

_default_manager: Optional[RedditOAuthManager] = None


def _get_default_manager() -> RedditOAuthManager:
    """Return or create the module-level default :class:`RedditOAuthManager`.

    Uses module-level env var defaults so that callers do not need to
    configure credentials manually.
    """
    global _default_manager
    if _default_manager is None:
        _default_manager = RedditOAuthManager()
    return _default_manager


def get_reddit_client() -> praw.Reddit:
    """Return an authenticated PRAW :class:`praw.Reddit` instance.

    Uses the module-level default :class:`RedditOAuthManager`, which reads
    credentials from environment variables (``REDDIT_CLIENT_ID``,
    ``REDDIT_CLIENT_SECRET``, ``REDDIT_USERNAME``, ``REDDIT_PASSWORD``).

    The token is auto-refreshed transparently when expired.

    Returns:
        A ready-to-use :class:`praw.Reddit` instance.

    Example::

        from app.platforms.reddit_auth import get_reddit_client

        reddit = get_reddit_client()
        for post in reddit.subreddit("all").hot(limit=5):
            print(post.title)
    """
    return _get_default_manager().get_client()
