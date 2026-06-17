"""Quality Score Calculator for marketing campaigns.

Port of the Google Apps Script ``getQualityScore()`` formula to pure Python.

Provides a weighted quality score (0–100) based on execution rate, platform
coverage, action volume, and marketplace publication status, plus utility
functions for typo-tolerant status parsing and grade conversion.
"""

from __future__ import annotations

import json
from typing import Any

# ── Status pattern matching (typo-tolerant) ───────────────────────────────

STATUS_COMPLETED_PATTERNS = ["replied", "repled", "posted", "completed", "done"]
"""Substring patterns that indicate a completed action (including known typo)."""

STATUS_PENDING_PATTERNS = ["pending", "planned", "draft"]
"""Substring patterns that indicate a pending/planned action."""


def is_status_completed(status: str) -> bool:
    """Return ``True`` if *status* matches any completed pattern (case-insensitive).

    Handles the known sheet-data typo ``"repled"`` in addition to
    ``"replied"``, ``"posted"``, ``"completed"``, and ``"done"``.
    """
    lower = status.lower()
    return any(p in lower for p in STATUS_COMPLETED_PATTERNS)


def is_status_pending(status: str) -> bool:
    """Return ``True`` if *status* matches any pending pattern (case-insensitive)."""
    lower = status.lower()
    return any(p in lower for p in STATUS_PENDING_PATTERNS)


# ── Core scoring formula ──────────────────────────────────────────────────


def compute_quality_score(
    execution_rate: float,
    platform_coverage: int,
    total_actions: int,
    marketplace_published: bool,
) -> int:
    """Compute the 0–100 quality score for a campaign.

    The score is a weighted combination of five factors:

    +-----------------------------------+----------+-----------+
    | Factor                            | Weight   | Max       |
    +-----------------------------------+----------+-----------+
    | Execution rate (0.0–1.0)          | ×30      | 30        |
    | Platform coverage (0–6)           | ×20      | 20        |
    | Total actions                     | ×25      | 25        |
    | Baseline                          | —        | 15        |
    | Marketplace published             | —        | 10        |
    +-----------------------------------+----------+-----------+

    Parameters
    ----------
    execution_rate:
        Fraction of planned actions completed, in the range ``[0.0, 1.0]``.
    platform_coverage:
        Number of distinct active platforms, typically ``[0, 6]``.
    total_actions:
        Total number of actions recorded for the campaign.
    marketplace_published:
        Whether the product has been published on the marketplace.

    Returns
    -------
    int
        Quality score clamped to ``[0, 100]``.
    """
    score = (
        (execution_rate * 30)
        + ((platform_coverage / 6) * 20)
        + (min(total_actions / 100, 1) * 25)
        + 15
        + (10 if marketplace_published else 0)
    )
    return min(round(score), 100)


def grade_from_score(score: int) -> str:
    """Convert a numeric quality score to an A–F letter grade.

    +-------+----------+
    | Range | Grade    |
    +-------+----------+
    | 90–100| A        |
    | 80–89 | B        |
    | 70–79 | C        |
    | 60–69 | D        |
    | 0–59  | F        |
    +-------+----------+
    """
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


# ── CampaignStore-backed scorer ──────────────────────────────────────────


def compute_quality_score_from_campaign(
    store: Any,
    campaign_id: str,
) -> int:
    """Compute the quality score for a campaign stored in *store*.

    Reads the campaign record and its actions from *store*, derives the
    four formula inputs, and delegates to :func:`compute_quality_score`.

    Parameters
    ----------
    store:
        A ``CampaignStore`` (or compatible duck-typed object) with
        ``get_campaign(campaign_id)`` and
        ``get_actions(campaign_id) -> list[dict]`` methods.
    campaign_id:
        The campaign identifier.

    Returns
    -------
    int
        Quality score clamped to ``[0, 100]``.
    """
    campaign = store.get_campaign(campaign_id)
    if campaign is None:
        return 15  # baseline only — no campaign data

    actions = store.get_actions(campaign_id)
    total_actions = len(actions)

    # Execution rate: completed actions / total
    if total_actions > 0:
        completed = sum(1 for a in actions if is_status_completed(a.get("status", "")))
        execution_rate = completed / total_actions
    else:
        execution_rate = 0.0

    # Platform coverage: unique platform names
    platforms = {a.get("platform", "") for a in actions if a.get("platform")}
    platform_coverage = len(platforms)

    # Marketplace published: from campaign config_json
    marketplace_published = False
    config_json = campaign.get("config_json", "{}")
    if isinstance(config_json, str):
        try:
            config = json.loads(config_json)
        except (json.JSONDecodeError, TypeError):
            config = {}
    elif isinstance(config_json, dict):
        config = config_json
    else:
        config = {}

    marketplace_published = bool(config.get("marketplace_published", False))

    return compute_quality_score(
        execution_rate=execution_rate,
        platform_coverage=platform_coverage,
        total_actions=total_actions,
        marketplace_published=marketplace_published,
    )
