"""
OSS Linear Issue Tracker — high-level polling & dispatch.

Inspired by ``@linear/sdk``, this module provides a polling tracker for OSS
(self-hosted) STAS deployments.  It wraps the existing ``LinearClient`` with
deduplication, pipeline routing, configurable callbacks, and metrics reporting.

Usage::

    from workers.tracker.oss_tracker import OSSTracker

    tracker = OSSTracker(api_key="lin_api_...")
    result = tracker.poll()
    # PollResult(checked=5, new=2, skipped=3, errors=0)

    # With custom dispatch:
    tracker.poll_and_dispatch(
        on_issue=lambda issue, pipeline: print(f"{issue['id']} -> {pipeline}"),
    )
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from workers.linear.client import LinearClient as AsyncLinearClient
from workers.tracker.routing import classify_pipeline, register_route
from workers.tracker.state_machine import get_active_states, is_terminal

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Default TTL (seconds) for the dedup tracker.  Once an issue ID is seen it
#: is not dispatched again until this many seconds have elapsed.
DEFAULT_DEDUP_TTL: float = 300.0

#: Default number of issues to query per page.
DEFAULT_PAGE_SIZE: int = 250

#: Maximum consecutive errors before the tracker gives up on a poll cycle.
MAX_CONSECUTIVE_ERRORS: int = 5

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class PollResult:
    """Result of a single ``poll()`` cycle."""

    checked: int = 0
    """Total number of issues returned from the API."""

    new: int = 0
    """Issues that were *not* in the dedup set (potential dispatches)."""

    skipped: int = 0
    """Issues that were skipped (already tracked or terminal state)."""

    errors: int = 0
    """Errors encountered during this poll cycle."""

    elapsed_seconds: float = 0.0
    """Wall-clock time for the poll cycle."""


@dataclass
class TrackerStats:
    """Cumulative tracker statistics."""

    total_polls: int = 0
    total_checked: int = 0
    total_dispatched: int = 0
    total_errors: int = 0
    last_poll_result: PollResult | None = None
    """Most recent ``PollResult``."""


# ---------------------------------------------------------------------------
# In-memory deduplication set with TTL
# ---------------------------------------------------------------------------


class _DedupSet:
    """Simple TTL-based deduplication for issue IDs.

    Thread-safe *only* for single-threaded usage (the default for Celery beat
    tasks and standalone scripts).  Each entry expires *ttl* seconds after it
    was inserted.
    """

    __slots__ = ("_entries", "_ttl")

    def __init__(self, ttl: float = DEFAULT_DEDUP_TTL) -> None:
        self._entries: dict[str, float] = {}
        self._ttl = ttl

    def add(self, issue_id: str) -> None:
        self._entries[issue_id] = time.monotonic() + self._ttl

    def __contains__(self, issue_id: str) -> bool:
        expiry = self._entries.get(issue_id)
        if expiry is None:
            return False
        if time.monotonic() > expiry:
            del self._entries[issue_id]
            return False
        return True

    def __len__(self) -> int:
        self._evict_expired()
        return len(self._entries)

    def clear(self) -> None:
        self._entries.clear()

    def _evict_expired(self) -> None:
        now = time.monotonic()
        stale = [iid for iid, exp in self._entries.items() if now > exp]
        for iid in stale:
            del self._entries[iid]


# ---------------------------------------------------------------------------
# Callback type
# ---------------------------------------------------------------------------

#: Callback invoked when a new issue is found during ``poll_and_dispatch``.
#: Receives the raw issue dict and the resolved pipeline name.
OnIssueCallback = Callable[[dict[str, Any], str], None]

# ---------------------------------------------------------------------------
# OSS Tracker
# ---------------------------------------------------------------------------


class OSSTracker:
    """High-level OSS Linear issue tracker with dedup and dispatch.

    Parameters
    ----------
    api_key:
        Linear personal API key.  Falls back to ``LINEAR_API_KEY`` env var.
    dedup_ttl:
        Seconds before a previously-seen issue ID can be re-dispatched.
    page_size:
        Number of issues to fetch per GraphQL page.
    """

    def __init__(
        self,
        api_key: str | None = None,
        dedup_ttl: float = DEFAULT_DEDUP_TTL,
        page_size: int = DEFAULT_PAGE_SIZE,
    ) -> None:
        self._api_key = api_key or os.environ.get("LINEAR_API_KEY", "")
        if not self._api_key:
            raise ValueError(
                "LINEAR_API_KEY must be provided or set in the environment"
            )

        self._dedup_ttl = dedup_ttl
        self._page_size = page_size
        self._dedup = _DedupSet(ttl=dedup_ttl)
        self._stats = TrackerStats()
        self._consecutive_errors = 0

    # ── Properties ──────────────────────────────────────────────────────

    @property
    def stats(self) -> TrackerStats:
        """Return cumulative tracker statistics."""
        return self._stats

    @property
    def dedup_size(self) -> int:
        """Number of issue IDs currently in the dedup cache."""
        return len(self._dedup)

    # ── Public API ──────────────────────────────────────────────────────

    def poll(self) -> PollResult:
        """Poll Linear for issues in active workflow states.

        This performs a single poll cycle, returning a ``PollResult`` with
        counts.  Issues already in the dedup set are not counted as *new*.

        Returns
        -------
        PollResult with ``checked``, ``new``, ``skipped``, and ``errors``.
        """
        import asyncio

        start = time.monotonic()
        result = PollResult()

        active_states = get_active_states()
        logger.debug(
            "Polling Linear for states: %s (dedup_size=%d)",
            active_states,
            len(self._dedup),
        )

        try:
            # Build a throw-away client per poll cycle (connection pooling inside)
            client = AsyncLinearClient(
                api_key=self._api_key,
            )
            issues = asyncio.run(self._fetch(client, active_states, result))
        except Exception:
            logger.exception("Linear poll cycle failed")
            result.errors += 1
            self._consecutive_errors += 1
            if self._consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                logger.error(
                    "Too many consecutive poll errors (%d) — giving up this cycle",
                    self._consecutive_errors,
                )
            result.elapsed_seconds = time.monotonic() - start
            self._stats.last_poll_result = result
            self._stats.total_polls += 1
            self._stats.total_errors += result.errors
            return result

        # Reset consecutive errors on success
        self._consecutive_errors = 0

        # Count new vs. skipped
        for issue in issues:
            issue_id = issue["id"]
            if issue_id in self._dedup:
                result.skipped += 1
                continue

            # Also skip terminal states that might slip through
            state_name = issue.get("state", {}).get("name", "")
            if is_terminal(state_name):
                result.skipped += 1
                continue

            self._dedup.add(issue_id)
            result.new += 1

        result.checked = len(issues)
        result.elapsed_seconds = time.monotonic() - start

        self._stats.last_poll_result = result
        self._stats.total_polls += 1
        self._stats.total_checked += result.checked
        self._stats.total_errors += result.errors

        logger.info(
            "Poll cycle complete: checked=%d new=%d skipped=%d errors=%d (%.2f s)",
            result.checked,
            result.new,
            result.skipped,
            result.errors,
            result.elapsed_seconds,
        )
        return result

    def poll_and_dispatch(
        self,
        on_issue: OnIssueCallback | None = None,
    ) -> PollResult:
        """Poll and dispatch each new issue to the supplied callback.

        Parameters
        ----------
        on_issue:
            A callable ``(issue_dict, pipeline_name) -> None`` invoked for
            each new issue.  If ``None``, no dispatch occurs (just counts).

        Returns
        -------
        ``PollResult`` with the same fields as ``poll()``.
        """
        result = self.poll()

        if on_issue is None:
            return result

        # Re-fetch issues so we can pass them to the callback.
        # In production, avoid the double-fetch by inlining dispatch into poll().
        import asyncio

        try:
            client = AsyncLinearClient(api_key=self._api_key)
            raw_issues = asyncio.run(self._fetch(client, get_active_states()))
        except Exception:
            logger.exception("Re-fetch failed during dispatch")
            result.errors += 1
            return result

        dispatched = 0
        for issue in raw_issues:
            issue_id = issue["id"]
            if issue_id not in self._dedup:
                continue  # was already in dedup before → already dispatched or skipped

            label_names = _extract_labels(issue)
            pipeline = classify_pipeline(label_names)

            try:
                on_issue(issue, pipeline)
                dispatched += 1
            except Exception:
                logger.exception(
                    "Dispatch callback failed for issue %s", issue_id
                )
                result.errors += 1

        self._stats.total_dispatched += dispatched
        logger.info(
            "Dispatched %d / %d new issues",
            dispatched,
            result.new,
        )
        return result

    def mark_dispatched(self, issue_id: str) -> None:
        """Explicitly mark an issue as dispatched (add to dedup set).

        Useful when you handle dispatch externally and want to ensure the
        issue is not re-polled.
        """
        self._dedup.add(issue_id)

    def reset(self) -> None:
        """Clear all internal state (dedup cache, stats)."""
        self._dedup.clear()
        self._stats = TrackerStats()
        self._consecutive_errors = 0
        logger.info("OSSTracker state reset")

    # ── Internal helpers ────────────────────────────────────────────────

    async def _fetch(
        self,
        client: AsyncLinearClient,
        states: list[str],
        result: PollResult | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch issues from Linear, translating to dict form."""
        issues = await client.get_issues_by_state(states)

        raw: list[dict[str, Any]] = []
        for iss in issues:
            raw.append({
                "id": iss.id,
                "identifier": iss.url.rstrip("/").split("/")[-1] if iss.url else "",
                "title": iss.title,
                "description": iss.description,
                "priority": iss.priority,
                "state": {"name": iss.state_name, "type": iss.state_type},
                "team": {"key": iss.team_key},
                "labels": [lbl for lbl in iss.labels],
                "url": iss.url,
                "created_at": iss.created_at,
                "updated_at": iss.updated_at,
            })

        return raw


# ---------------------------------------------------------------------------
# Module-level helpers (standalone usage)
# ---------------------------------------------------------------------------


def poll_issues(
    api_key: str | None = None,
    dedup_ttl: float = DEFAULT_DEDUP_TTL,
) -> PollResult:
    """One-shot poll convenience function.

    Creates a temporary ``OSSTracker``, runs a single poll cycle, and returns
    the result.  The tracker is discarded after the call.

    Example::

        result = poll_issues()
        print(f"Found {result.new} new issues")
    """
    tracker = OSSTracker(api_key=api_key, dedup_ttl=dedup_ttl)
    return tracker.poll()


def poll_and_dispatch(
    on_issue: OnIssueCallback | None = None,
    api_key: str | None = None,
    dedup_ttl: float = DEFAULT_DEDUP_TTL,
) -> PollResult:
    """One-shot poll-and-dispatch convenience function.

    Example::

        def handle(issue, pipeline):
            print(f"Issue {issue['id']} → {pipeline}")

        result = poll_and_dispatch(on_issue=handle)
    """
    tracker = OSSTracker(api_key=api_key, dedup_ttl=dedup_ttl)
    return tracker.poll_and_dispatch(on_issue=on_issue)


# ---------------------------------------------------------------------------
# Internal utilities
# ---------------------------------------------------------------------------


def _extract_labels(issue: dict[str, Any]) -> list[str]:
    """Extract label names from an issue dict, regardless of shape.

    Handles both the nested ``{"nodes": [{"name": ...}]}`` form returned by
    the GraphQL API and a flat ``list[str]`` form.
    """
    raw = issue.get("labels")
    if isinstance(raw, list):
        return [str(lbl) for lbl in raw]
    if isinstance(raw, dict):
        nodes = raw.get("nodes", [])
        return [n["name"] for n in nodes if isinstance(n, dict)]
    return []
