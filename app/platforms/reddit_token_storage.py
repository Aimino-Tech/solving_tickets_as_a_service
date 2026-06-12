"""Thread-safe Reddit OAuth2 token persistence under HERMES_HOME/credentials/.

Stores and loads tokens as JSON files in the Hermes credential pool.
File format (reddit_token.json)::

    {
        "access_token": "...",
        "refresh_token": "...",
        "client_id": "...",
        "client_secret": "...",
        "expires_at": 1700000000.0,
        "token_type": "bearer"
    }

Thread safety is guaranteed via a per-process ``threading.Lock`` so that
concurrent refresh calls (e.g. from multiple PRAW clients or engagement
workers) do not corrupt the file.

.. todo::
    Encrypted storage using ``cryptography.fernet`` — the token file currently
    stores the ``client_secret`` in plaintext.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Default token file path relative to HERMES_HOME.
TOKEN_RELATIVE_PATH = "credentials/reddit_token.json"

# Per-process lock for thread-safe file I/O.
_file_lock = threading.Lock()

# ── Schemas ──────────────────────────────────────────────────────────────────

TOKEN_FIELDS = (
    "access_token",
    "refresh_token",
    "client_id",
    "client_secret",
    "expires_at",
    "token_type",
)


def _default_token() -> dict:
    """Return a blank token dict with all expected keys."""
    return {
        "access_token": "",
        "refresh_token": "",
        "client_id": "",
        "client_secret": "",
        "expires_at": 0.0,
        "token_type": "bearer",
    }


# ── Path resolution ──────────────────────────────────────────────────────────


def _get_hermes_home() -> Path:
    """Import and return the Hermes home directory.

    Delayed import avoids circular dependency at module-load time.
    """
    from hermes_constants import get_hermes_home

    return get_hermes_home()


def get_token_path(hermes_home: Optional[Path] = None) -> Path:
    """Return the absolute path to the Reddit token file.

    Args:
        hermes_home: Override for the Hermes home directory.  When ``None``
            (the default), resolves via ``hermes_constants.get_hermes_home()``.

    Returns:
        Absolute ``Path`` to the token JSON file.
    """
    home = hermes_home or _get_hermes_home()
    return home / TOKEN_RELATIVE_PATH


# ── Save / Load ──────────────────────────────────────────────────────────────


def save_token(
    token_data: dict,
    hermes_home: Optional[Path] = None,
) -> bool:
    """Persist *token_data* to disk as JSON.

    Only recognised fields (see :data:`TOKEN_FIELDS`) are written; unknown
    keys are silently dropped so that a corrupted or stale file never carries
    unexpected payloads.

    Args:
        token_data: Dict with at minimum ``access_token`` and ``expires_at``.
        hermes_home: Override Hermes home (see :func:`get_token_path`).

    Returns:
        ``True`` on success, ``False`` on I/O error (logged as warning).
    """
    path = get_token_path(hermes_home)
    safe = _default_token()
    safe.update((k, token_data[k]) for k in TOKEN_FIELDS if k in token_data)

    with _file_lock:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(safe, indent=2, sort_keys=True),
                encoding="utf-8",
            )
            logger.debug("Reddit token saved to %s", path)
            return True
        except OSError as exc:
            logger.warning("Failed to save Reddit token to %s: %s", path, exc)
            return False


def load_token(
    hermes_home: Optional[Path] = None,
) -> dict:
    """Load the Reddit token from disk.

    Args:
        hermes_home: Override Hermes home (see :func:`get_token_path`).

    Returns:
        A dict with all :data:`TOKEN_FIELDS` present.  If the file does not
        exist or is unparseable, returns a blank token (``access_token=""``).
    """
    path = get_token_path(hermes_home)
    with _file_lock:
        try:
            if not path.is_file():
                logger.debug("Reddit token file not found at %s", path)
                return _default_token()
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
            if not isinstance(data, dict):
                logger.warning("Reddit token file %s is not a dict; resetting", path)
                return _default_token()
            safe = _default_token()
            safe.update((k, data[k]) for k in TOKEN_FIELDS if k in data)
            return safe
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning(
                "Failed to load Reddit token from %s: %s; returning blank", path, exc
            )
            return _default_token()


def token_exists(hermes_home: Optional[Path] = None) -> bool:
    """Return ``True`` if a token file exists on disk and has an access token.

    Args:
        hermes_home: Override Hermes home (see :func:`get_token_path`).
    """
    data = load_token(hermes_home)
    return bool(data.get("access_token"))


def clear_token(hermes_home: Optional[Path] = None) -> bool:
    """Delete the token file from disk.

    Args:
        hermes_home: Override Hermes home (see :func:`get_token_path`).

    Returns:
        ``True`` if the file was deleted or did not exist; ``False`` on error.
    """
    path = get_token_path(hermes_home)
    with _file_lock:
        try:
            if path.is_file():
                path.unlink()
                logger.info("Reddit token file deleted: %s", path)
            return True
        except OSError as exc:
            logger.warning("Failed to delete Reddit token file %s: %s", path, exc)
            return False
