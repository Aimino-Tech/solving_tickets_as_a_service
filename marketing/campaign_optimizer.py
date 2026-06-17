"""Campaign Optimizer — generates actionable, rule-based recommendations
for improving marketing campaign performance.

All logic is rule-based with no ML or external API calls. Six recommendation
types cover platform gaps, engagement, staleness, quality, funnel balance,
and missing funnel stages.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from marketing.quality_score import (
    compute_quality_score_from_campaign,
    is_status_completed,
)

logger = logging.getLogger(__name__)

# ── Helpers shared between analyze_all and analyze_campaign ──────────────


def _now_iso() -> str:
    """Current UTC timestamp as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _get_last_activity(store: Any, campaign_id: str) -> str | None:
    """Return the most recent action timestamp for *campaign_id*, or ``None``."""
    try:
        actions = store.get_actions(campaign_id)
        timestamps = [a.get("timestamp", "") for a in actions if a.get("timestamp")]
        return max(timestamps) if timestamps else None
    except Exception:
        return None


def _compute_completed_ratio(store: Any, campaign_id: str) -> float:
    """Compute ``completed / total`` actions, returning ``0.0`` when no data."""
    try:
        actions = store.get_actions(campaign_id)
        if not actions:
            return 0.0
        completed = sum(1 for a in actions if is_status_completed(a.get("status", "")))
        return completed / len(actions)
    except Exception:
        return 0.0


def _get_unique_platforms(store: Any, campaign_id: str) -> list[str]:
    """Return sorted list of unique platform names used by a campaign."""
    try:
        actions = store.get_actions(campaign_id)
        platforms: set[str] = set()
        for a in actions:
            plat = a.get("platform", "")
            if plat:
                platforms.add(plat)
        return sorted(platforms)
    except Exception:
        return []


def _get_platform_breakdown(store: Any, campaign_id: str) -> dict[str, int]:
    """Return ``{platform: action_count}`` for a campaign."""
    result: dict[str, int] = {}
    try:
        for a in store.get_actions(campaign_id):
            plat = a.get("platform", "")
            if plat:
                result[plat] = result.get(plat, 0) + 1
    except Exception:
        pass
    return result


# ── Recommendation generators ──────────────────────────────────────────


def _recommend_platform_gap(
    store: Any,
    campaign: dict[str, Any],
) -> dict[str, Any] | None:
    """If campaign uses < 3 platforms and has > 20 total actions, suggest more."""
    cid = campaign["id"]
    platforms = _get_unique_platforms(store, cid)
    breakdown = _get_platform_breakdown(store, cid)
    total_actions = sum(breakdown.values())

    if len(platforms) >= 3 or total_actions < 20:
        return None

    # Find the dominant platform for the recommendation message
    dominant = max(breakdown, key=breakdown.get) if breakdown else "current"
    count = breakdown.get(dominant, 0)

    # Suggest a platform they're not using
    used_lower = {p.lower() for p in platforms}
    suggestions = []
    for candidate in ("Reddit", "Discord", "Hacker News", "Twitter/X", "LinkedIn", "Instagram"):
        if candidate.lower() not in used_lower:
            suggestions.append(candidate)

    suggestion_str = ", ".join(suggestions[:2])
    if suggestion_str:
        desc = (
            f"Campaign uses only {dominant} ({count} actions). "
            f"Add {suggestion_str} presence for wider reach."
        )
    else:
        desc = (
            f"Campaign uses only {len(platforms)} platform(s) with {total_actions} total actions. "
            "Expanding to additional platforms could increase reach."
        )

    return {
        "type": "platform_gap",
        "priority": "medium",
        "campaign_id": cid,
        "campaign_name": campaign.get("name", ""),
        "title": "Expand platform presence",
        "description": desc,
        "metric": f"{len(platforms)}/6 platforms",
        "impact": "~40% more reach estimated",
    }


def _recommend_low_engagement(
    store: Any,
    campaign: dict[str, Any],
) -> dict[str, Any] | None:
    """If completed ratio < 0.3, flag low engagement."""
    cid = campaign["id"]
    ratio = _compute_completed_ratio(store, cid)

    if ratio >= 0.3:
        return None

    pct = round(ratio * 100, 1)

    return {
        "type": "low_engagement",
        "priority": "high",
        "campaign_id": cid,
        "campaign_name": campaign.get("name", ""),
        "title": "Improve engagement rate",
        "description": (
            f"Engagement rate is low ({pct}%). "
            "Try shorter posts, direct questions, or A/B test headlines."
        ),
        "metric": f"{pct}% completed",
        "impact": "~2x engagement with better content hooks",
    }


def _recommend_stale_campaign(
    store: Any,
    campaign: dict[str, Any],
) -> dict[str, Any] | None:
    """If no activity in 14+ days, flag as stale."""
    cid = campaign["id"]
    last = _get_last_activity(store, cid)

    if not last:
        return None

    try:
        last_dt = datetime.fromisoformat(last)
    except (ValueError, TypeError):
        return None

    days_inactive = (datetime.now(timezone.utc) - last_dt).days
    if days_inactive < 14:
        return None

    return {
        "type": "stale_campaign",
        "priority": "medium",
        "campaign_id": cid,
        "campaign_name": campaign.get("name", ""),
        "title": "Campaign is stale",
        "description": (
            f"Campaign has been inactive for {days_inactive} days. "
            "Consider refresh or archive."
        ),
        "metric": f"{days_inactive}d inactive",
        "impact": "Re-activation could recover momentum",
    }


def _recommend_low_quality(
    store: Any,
    campaign: dict[str, Any],
    score: int,
) -> dict[str, Any] | None:
    """If quality score < 50, flag it."""
    if score >= 50:
        return None

    cid = campaign["id"]
    return {
        "type": "low_quality",
        "priority": "high",
        "campaign_id": cid,
        "campaign_name": campaign.get("name", ""),
        "title": "Quality score needs improvement",
        "description": (
            f"Quality score is low ({score}). "
            "Focus on execution rate and platform coverage."
        ),
        "metric": f"Score: {score}/100",
        "impact": "Raising to 70+ improves visibility",
    }


def _recommend_funnel_imbalance(
    store: Any,
    campaign: dict[str, Any],
) -> dict[str, Any] | None:
    """If awareness >> all other stages combined, flag top-heavy funnel."""
    cid = campaign["id"]

    try:
        events = store.get_funnel_events(cid)
    except Exception:
        return None

    stage_counts: dict[str, int] = {}
    for ev in events:
        stage = ev.get("event_type", "awareness")
        stage_counts[stage] = stage_counts.get(stage, 0) + 1

    awareness = stage_counts.get("awareness", 0)
    other_total = sum(
        v for k, v in stage_counts.items() if k != "awareness"
    )

    if awareness <= 3 * other_total:
        return None

    return {
        "type": "funnel_imbalance",
        "priority": "low",
        "campaign_id": cid,
        "campaign_name": campaign.get("name", ""),
        "title": "Top-heavy funnel",
        "description": (
            "Awareness dominates the funnel. "
            "Work on conversion tactics to move users down the funnel."
        ),
        "metric": f"{awareness} awareness vs {other_total} others",
        "impact": "Balancing funnel could increase conversions",
    }


def _recommend_missing_funnel_stages(
    store: Any,
    campaign: dict[str, Any],
) -> dict[str, Any] | None:
    """If only 1-2 funnel stages have events, suggest animating to next."""
    cid = campaign["id"]

    try:
        events = store.get_funnel_events(cid)
    except Exception:
        return None

    stage_counts: dict[str, int] = {}
    for ev in events:
        stage = ev.get("event_type", "awareness")
        stage_counts[stage] = stage_counts.get(stage, 0) + 1

    active_stages = {k for k, v in stage_counts.items() if v > 0}
    if len(active_stages) >= 3:
        return None

    funnel_order = [
        "awareness", "engagement", "interest",
        "consideration", "conversion", "retention",
    ]
    # Find the last active stage and suggest the next one
    last_active = "awareness"
    for stage in funnel_order:
        if stage in active_stages:
            last_active = stage

    next_idx = funnel_order.index(last_active) + 1
    next_stage = funnel_order[next_idx] if next_idx < len(funnel_order) else "retention"

    return {
        "type": "missing_funnel_stages",
        "priority": "medium",
        "campaign_id": cid,
        "campaign_name": campaign.get("name", ""),
        "title": "Funnel stages missing",
        "description": (
            f"Only {len(active_stages)} funnel stage(s) active. "
            f"Animate from {last_active} to {next_stage}."
        ),
        "metric": f"{len(active_stages)}/6 stages",
        "impact": "Completing the funnel increases conversion potential",
    }


# ── CampaignOptimizer class ────────────────────────────────────────────


class CampaignOptimizer:
    """Generates actionable recommendations from campaign analytics.

    Six rule-based recommendation types:
        1. Platform Gap        — < 3 platforms but > 20 actions
        2. Low Engagement      — completed ratio < 30%
        3. Stale Campaign      — inactive for 14+ days
        4. Quality Score Low   — score < 50
        5. Funnel Imbalance    — awareness >> all others combined
        6. Missing Funnel Stages — only 1-2 stages with events
    """

    RECOMMENDERS = [
        _recommend_platform_gap,
        _recommend_low_engagement,
        _recommend_stale_campaign,
        _recommend_low_quality,
        _recommend_funnel_imbalance,
        _recommend_missing_funnel_stages,
    ]

    # Low-quality check needs the quality score pre-computed, so it's handled
    # separately inside analyze_all / analyze_campaign.

    @staticmethod
    def analyze_all(store: Any) -> dict[str, Any]:
        """Analyze all campaigns and generate recommendations.

        Returns a dict with keys:
            - ``recommendations``: list of recommendation dicts
            - ``summary``: dict with count breakdown (high/medium/low/total)
            - ``generated_at``: ISO-8601 timestamp
        """
        try:
            campaigns = store.list_campaigns()
        except Exception as exc:
            logger.warning("CampaignOptimizer: failed to list campaigns: %s", exc)
            return {
                "recommendations": [],
                "summary": {"high": 0, "medium": 0, "low": 0, "total": 0},
                "generated_at": _now_iso(),
            }

        recommendations: list[dict[str, Any]] = []
        for c in campaigns:
            recs = CampaignOptimizer._analyze_single(store, c)
            recommendations.extend(recs)

        summary = CampaignOptimizer._build_summary(recommendations)

        return {
            "recommendations": recommendations,
            "summary": summary,
            "generated_at": _now_iso(),
        }

    @staticmethod
    def analyze_campaign(store: Any, campaign_id: str) -> dict[str, Any]:
        """Generate recommendations for a single campaign.

        Returns the same shape as :meth:`analyze_all`.
        """
        try:
            campaign = store.get_campaign(campaign_id)
        except Exception as exc:
            logger.warning(
                "CampaignOptimizer: failed to get campaign %s: %s",
                campaign_id,
                exc,
            )
            return {
                "recommendations": [],
                "summary": {"high": 0, "medium": 0, "low": 0, "total": 0},
                "generated_at": _now_iso(),
            }

        if campaign is None:
            logger.warning(
                "CampaignOptimizer: campaign %s not found", campaign_id
            )
            return {
                "recommendations": [],
                "summary": {"high": 0, "medium": 0, "low": 0, "total": 0},
                "generated_at": _now_iso(),
            }

        recommendations = CampaignOptimizer._analyze_single(store, campaign)
        summary = CampaignOptimizer._build_summary(recommendations)

        return {
            "recommendations": recommendations,
            "summary": summary,
            "generated_at": _now_iso(),
        }

    # ── internal helpers ────────────────────────────────────────────────

    @staticmethod
    def _analyze_single(
        store: Any,
        campaign: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Run all recommenders against one campaign and return non-``None`` results."""
        cid = campaign["id"]
        results: list[dict[str, Any]] = []

        # Compute quality score once for reuse
        try:
            quality_score = compute_quality_score_from_campaign(store, cid)
        except Exception:
            quality_score = 15

        for recommender in CampaignOptimizer.RECOMMENDERS:
            try:
                if recommender is _recommend_low_quality:
                    rec = recommender(store, campaign, quality_score)
                else:
                    rec = recommender(store, campaign)
                if rec is not None:
                    results.append(rec)
            except Exception as exc:
                logger.debug(
                    "Recommender %s failed for %s: %s",
                    getattr(recommender, "__name__", "?"),
                    cid,
                    exc,
                )

        return results

    @staticmethod
    def _build_summary(
        recommendations: list[dict[str, Any]],
    ) -> dict[str, int]:
        """Count recommendations by priority level."""
        high = sum(1 for r in recommendations if r.get("priority") == "high")
        medium = sum(1 for r in recommendations if r.get("priority") == "medium")
        low = sum(1 for r in recommendations if r.get("priority") == "low")

        return {
            "high": high,
            "medium": medium,
            "low": low,
            "total": len(recommendations),
        }
