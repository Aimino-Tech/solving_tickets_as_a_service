"""Campaign planner and recommendation engine.

Analyzes historical campaign metrics from ``CampaignStore`` to recommend
optimal angles, platforms, schedules, and full campaign configurations.

All statistical computations use stdlib only (``statistics``, ``math``,
``collections``, ``datetime``). No external dependencies, no ML models.
"""

from __future__ import annotations

import json
import logging
import math
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

try:
    from marketing.store import CampaignStore
except ImportError:
    CampaignStore = None  # type: ignore[misc,assignment]

logger = logging.getLogger(__name__)

# ── Default recommendations (used when no historical data exists) ─────────

_DEFAULT_ANGLES: list[dict[str, Any]] = [
    {"angle": "problem_solution", "rationale": "Default — demonstrate need", "priority": 1},
    {"angle": "comparison", "rationale": "Position vs alternatives", "priority": 2},
    {"angle": "educational", "rationale": "Build authority with tutorials", "priority": 3},
]

_DEFAULT_PLATFORMS: list[dict[str, Any]] = [
    {
        "platform": "reddit",
        "rationale": "Highest organic engagement for tech audiences",
        "priority": 1,
    },
    {
        "platform": "x",
        "rationale": "Real-time discussion and network effects",
        "priority": 2,
    },
    {
        "platform": "hn",
        "rationale": "Targeted developer audience for Show HN",
        "priority": 3,
    },
]

_DEFAULT_SCHEDULE: dict[str, Any] = {
    "best_days": ["Tuesday", "Wednesday", "Thursday"],
    "best_hours_utc": [14, 15, 16, 17],
    "max_daily_per_account": 3,
    "min_gap_hours": 4,
}

_EMPTY_ANALYSIS: dict[str, Any] = {
    "angles": {},
    "platforms": {},
    "accounts": {},
    "overall": {
        "total_campaigns": 0,
        "total_actions": 0,
        "note": "No historical campaign data available.",
    },
}


# ── Angle metadata for contextual recommendations ─────────────────────────

_ANGLE_METADATA: dict[str, dict[str, Any]] = {
    "problem_solution": {
        "name": "Problem-Solution",
        "description": "Frame the product as a solution to a specific pain point",
        "best_for": "Launch announcements, feature introductions",
    },
    "comparison": {
        "name": "Comparison",
        "description": "Position against existing alternatives",
        "best_for": "Competitive positioning, migration guides",
    },
    "educational": {
        "name": "Educational",
        "description": "Build authority with tutorials and how-tos",
        "best_for": "Developer docs, video demos, blog posts",
    },
    "social_proof": {
        "name": "Social Proof",
        "description": "Highlight adoption, testimonials, or case studies",
        "best_for": "Mid-campaign momentum, trust building",
    },
    "storytelling": {
        "name": "Storytelling",
        "description": "Share origin story or founder narrative",
        "best_for": "Brand building, personal connection",
    },
    "data_driven": {
        "name": "Data-Driven",
        "description": "Share benchmarks, performance data, or research",
        "best_for": "Technical audiences, credibility building",
    },
}

# ── Platform metadata ─────────────────────────────────────────────────────

_PLATFORM_METADATA: dict[str, dict[str, Any]] = {
    "reddit": {
        "name": "Reddit",
        "content_types": ["text post", "link post", "comment"],
        "peak_hours_utc": [14, 15, 16, 17, 18],
        "best_days": ["Tuesday", "Wednesday", "Thursday"],
    },
    "x": {
        "name": "X / Twitter",
        "content_types": ["tweet", "thread", "reply"],
        "peak_hours_utc": [12, 13, 14, 15, 16, 17],
        "best_days": ["Monday", "Tuesday", "Wednesday", "Thursday"],
    },
    "hn": {
        "name": "Hacker News",
        "content_types": ["story submission", "comment"],
        "peak_hours_utc": [9, 10, 11, 14, 15, 16],
        "best_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
    "discord": {
        "name": "Discord",
        "content_types": ["message", "announcement", "reply"],
        "peak_hours_utc": [15, 16, 17, 18, 19, 20],
        "best_days": ["Tuesday", "Wednesday", "Thursday"],
    },
    "linkedin": {
        "name": "LinkedIn",
        "content_types": ["post", "article", "comment"],
        "peak_hours_utc": [8, 9, 10, 11, 12, 17, 18],
        "best_days": ["Tuesday", "Wednesday", "Thursday"],
    },
    "slack": {
        "name": "Slack",
        "content_types": ["message", "reply"],
        "peak_hours_utc": [14, 15, 16, 17, 18],
        "best_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
}


# ── CampaignPlanner ───────────────────────────────────────────────────────


class CampaignPlanner:
    """Analyze historical campaign data and produce actionable recommendations.

    Usage::

        store = CampaignStore()
        planner = CampaignPlanner(store)

        analysis = planner.analyze_past_campaigns()
        angles = planner.recommend_angles({"product": "OpenTalk2HTML"})
        platforms = planner.recommend_platforms()
        schedule = planner.recommend_schedule()
        config = planner.generate_campaign_config({
            "angles": angles,
            "platforms": platforms,
            "schedule": schedule,
        })
        full = planner.generate_full_plan({"product": "OpenTalk2HTML"})
    """

    def __init__(self, store: CampaignStore) -> None:
        """Initialize the planner with a campaign data store.

        Args:
            store: A ``CampaignStore`` instance for querying historical data.
        """
        self._store = store

    # ── Public API ────────────────────────────────────────────────────────

    def analyze_past_campaigns(
        self, since_date: str | None = None
    ) -> dict[str, Any]:
        """Analyze historical campaign data and return structured metrics.

        Aggregates actions per campaign, then breaks down performance by
        angle, platform, and account.

        Args:
            since_date: Optional ISO-8601 date string to filter actions
                after a specific point in time.

        Returns:
            A dict with ``angles``, ``platforms``, ``accounts``, and
            ``overall`` keys containing aggregated metrics.  If no campaigns
            exist, returns a placeholder dict with an explanatory note.
        """
        campaigns = self._store.list_campaigns()
        if not campaigns:
            return dict(_EMPTY_ANALYSIS)

        # ── Collect all actions across all campaigns ─────────────────────
        all_actions: list[dict[str, Any]] = []
        for c in campaigns:
            cid: str = c["id"]
            try:
                actions = self._store.get_actions(cid, since=since_date)
            except Exception as exc:
                logger.warning("Failed to fetch actions for %s: %s", cid, exc)
                continue
            # Tag each action with its campaign name for per-campaign grouping
            for a in actions:
                a["_campaign_name"] = c.get("name", cid)
            all_actions.extend(actions)

        if not all_actions:
            return {
                "angles": {},
                "platforms": {},
                "accounts": {},
                "overall": {
                    "total_campaigns": len(campaigns),
                    "total_actions": 0,
                    "note": "No actions recorded yet.",
                },
            }

        # ── Per-campaign aggregation ─────────────────────────────────────
        campaigns_data: dict[str, dict[str, Any]] = {}
        for a in all_actions:
            cname = a.get("_campaign_name", "unknown")
            if cname not in campaigns_data:
                campaigns_data[cname] = {
                    "campaign_name": cname,
                    "total_actions": 0,
                    "by_platform": defaultdict(int),
                    "by_angle": defaultdict(int),
                    "by_account": defaultdict(int),
                }
            cd = campaigns_data[cname]
            cd["total_actions"] += 1
            cd["by_platform"][a.get("platform", "unknown")] += 1
            # Angle is optionally embedded in the action as a tag or derived
            # from the action_type / content_preview heuristic.
            angle = self._derive_angle(a)
            cd["by_angle"][angle] += 1
            profile = a.get("profile_name") or "unknown"
            cd["by_account"][profile] += 1

        # ── Angle performance ────────────────────────────────────────────
        angle_data: dict[str, dict[str, Any]] = {}
        for a in all_actions:
            angle = self._derive_angle(a)
            if angle not in angle_data:
                angle_data[angle] = {
                    "angle": angle,
                    "total_actions": 0,
                    "scored_actions": 0,
                    "score_sum": 0.0,
                    "scores": [],
                }
            ad = angle_data[angle]
            ad["total_actions"] += 1
            score = a.get("score")
            if score is not None:
                try:
                    s = float(score)
                    ad["scored_actions"] += 1
                    ad["score_sum"] += s
                    ad["scores"].append(s)
                except (ValueError, TypeError):
                    pass

        angles_result: dict[str, Any] = {}
        for angle, ad in angle_data.items():
            total = ad["total_actions"]
            scored = ad["scored_actions"]
            success_rate = scored / total if total > 0 else 0.0
            score_per_action = (
                statistics.mean(ad["scores"]) if ad["scores"] else 0.0
            )
            score_std = (
                statistics.stdev(ad["scores"])
                if len(ad["scores"]) >= 2
                else 0.0
            )
            angles_result[angle] = {
                "total_actions": total,
                "scored_actions": scored,
                "success_rate": round(success_rate, 4),
                "score_per_action_avg": round(score_per_action, 4),
                "score_std": round(score_std, 4),
                "score_summary": self._score_summary(ad["scores"]),
            }

        # ── Platform performance ─────────────────────────────────────────
        platform_data: dict[str, dict[str, Any]] = {}
        for a in all_actions:
            plat = a.get("platform", "unknown")
            if plat not in platform_data:
                platform_data[plat] = {
                    "platform": plat,
                    "total_actions": 0,
                    "scores": [],
                }
            pd = platform_data[plat]
            pd["total_actions"] += 1
            score = a.get("score")
            if score is not None:
                try:
                    pd["scores"].append(float(score))
                except (ValueError, TypeError):
                    pass

        platforms_result: dict[str, Any] = {}
        for plat, pd in platform_data.items():
            total = pd["total_actions"]
            scores = pd["scores"]
            platforms_result[plat] = {
                "total_actions": total,
                "action_count": total,
                "avg_score": round(statistics.mean(scores), 4) if scores else 0.0,
                "score_count": len(scores),
                "score_summary": self._score_summary(scores),
            }

        # ── Account performance ──────────────────────────────────────────
        account_data: dict[str, dict[str, Any]] = {}
        for a in all_actions:
            profile = a.get("profile_name") or "unknown"
            if profile not in account_data:
                account_data[profile] = {
                    "profile_name": profile,
                    "total_actions": 0,
                    "scores": [],
                }
            ad_acc = account_data[profile]
            ad_acc["total_actions"] += 1
            score = a.get("score")
            if score is not None:
                try:
                    ad_acc["scores"].append(float(score))
                except (ValueError, TypeError):
                    pass

        accounts_result: dict[str, Any] = {}
        for profile, ad_acc in account_data.items():
            total = ad_acc["total_actions"]
            scores = ad_acc["scores"]
            accounts_result[profile] = {
                "profile_name": profile,
                "total_actions": total,
                "total_actions_by_account": total,
                "avg_score": round(statistics.mean(scores), 4) if scores else 0.0,
                "score_count": len(scores),
            }

        # ── Overall summary ──────────────────────────────────────────────
        all_scores = [
            float(a["score"])
            for a in all_actions
            if a.get("score") is not None
        ]
        overall: dict[str, Any] = {
            "total_campaigns": len(campaigns),
            "total_actions": len(all_actions),
            "total_platforms": len(platforms_result),
            "total_angles": len(angles_result),
            "total_accounts_used": len(accounts_result),
        }
        if all_scores:
            overall["avg_score"] = round(statistics.mean(all_scores), 4)
            overall["median_score"] = round(statistics.median(all_scores), 4)
            overall["min_score"] = round(min(all_scores), 4)
            overall["max_score"] = round(max(all_scores), 4)
            overall["score_std"] = (
                round(statistics.stdev(all_scores), 4)
                if len(all_scores) >= 2
                else 0.0
            )

        # ── Per-campaign breakdown (summary) ────────────────────────────
        per_campaign: list[dict[str, Any]] = []
        for cname, cd in campaigns_data.items():
            per_campaign.append({
                "campaign_name": cname,
                "total_actions": cd["total_actions"],
                "by_platform": dict(cd["by_platform"]),
                "by_angle": dict(cd["by_angle"]),
                "by_account": dict(cd["by_account"]),
            })
        overall["per_campaign"] = per_campaign

        return {
            "angles": angles_result,
            "platforms": platforms_result,
            "accounts": accounts_result,
            "overall": overall,
        }

    def recommend_angles(
        self, campaign_brief: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        """Recommend top-3 content angles based on historical performance.

        Args:
            campaign_brief: Optional dict with campaign context (e.g.
                ``product``, ``repo``, ``target_audience``).  Used to tailor
                angle descriptions when history exists.

        Returns:
            A list of dicts (max 3), each with ``angle``, ``rationale``,
            and ``priority``.  Falls back to generic defaults when no
            historical data is available.
        """
        analysis = self.analyze_past_campaigns()
        angle_metrics = analysis.get("angles", {})

        if not angle_metrics:
            return list(_DEFAULT_ANGLES)

        # Build a scored list: weighted = avg_score * 0.7 + normalized_actions * 0.3
        max_actions = max(
            (am["total_actions"] for am in angle_metrics.values()), default=1
        )

        scored: list[tuple[float, str, dict[str, Any]]] = []
        for angle_name, am in angle_metrics.items():
            avg_score = am.get("score_per_action_avg", 0.0)
            action_count = am.get("total_actions", 0)
            normalized_actions = action_count / max_actions if max_actions > 0 else 0.0
            weighted = avg_score * 0.7 + normalized_actions * 0.3
            scored.append((weighted, angle_name, am))

        scored.sort(key=lambda x: x[0], reverse=True)

        top_three = scored[:3]
        brief_product = (
            (campaign_brief or {}).get("product")
            or (campaign_brief or {}).get("repo")
            or ""
        )

        results: list[dict[str, Any]] = []
        for rank, (weight, angle_name, am) in enumerate(top_three, start=1):
            meta = _ANGLE_METADATA.get(angle_name, {})
            rationale_parts: list[str] = []

            # Reference actual data
            if am["total_actions"] > 0:
                rationale_parts.append(
                    f"avg score {am['score_per_action_avg']:.2f} "
                    f"across {am['total_actions']} actions"
                )
            if am["success_rate"] > 0:
                rationale_parts.append(
                    f"success rate {am['success_rate'] * 100:.0f}%"
                )

            meta_desc = meta.get("description", "")
            context = (
                f" for {brief_product}" if brief_product else ""
            )

            if rationale_parts:
                rationale = (
                    f"Historical top performer{context} — "
                    + ", ".join(rationale_parts)
                    + "."
                )
            else:
                rationale = (
                    f"Consistent performer{context} — "
                    f"{meta_desc.lower() or 'proven engagement'}."
                )

            if meta.get("best_for"):
                rationale += f" Best for: {meta['best_for']}."

            results.append({
                "angle": angle_name,
                "rationale": rationale,
                "priority": rank,
                "score": round(weight, 4),
                "historical_avg_score": round(am["score_per_action_avg"], 4),
                "historical_actions": am["total_actions"],
            })

        return results

    def recommend_platforms(
        self, campaign_brief: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        """Recommend platform prioritization based on historical performance.

        Scores each platform by ``avg_score * 0.6 + action_count * 0.4``
        (normalized) and returns a ranked list with tailored rationale.

        Args:
            campaign_brief: Optional dict for contextual targeting hints.

        Returns:
            Ranked list of platform recommendations, each with ``platform``,
            ``rationale``, ``priority``, and optional ``content_types``.
            Falls back to defaults when no historical data is available.
        """
        analysis = self.analyze_past_campaigns()
        platform_metrics = analysis.get("platforms", {})

        if not platform_metrics:
            return list(_DEFAULT_PLATFORMS)

        max_actions = max(
            (pm["total_actions"] for pm in platform_metrics.values()), default=1
        )

        scored: list[tuple[float, str, dict[str, Any]]] = []
        for plat_name, pm in platform_metrics.items():
            avg_score = pm.get("avg_score", 0.0)
            action_count = pm.get("total_actions", 0)
            normalized = action_count / max_actions if max_actions > 0 else 0.0
            weighted = avg_score * 0.6 + normalized * 0.4
            scored.append((weighted, plat_name, pm))

        scored.sort(key=lambda x: x[0], reverse=True)

        brief_product = (
            (campaign_brief or {}).get("product")
            or (campaign_brief or {}).get("repo")
            or ""
        )

        results: list[dict[str, Any]] = []
        for rank, (weight, plat_name, pm) in enumerate(scored, start=1):
            meta = _PLATFORM_METADATA.get(plat_name, {})
            ctx = f" for {brief_product}" if brief_product else ""
            rationale = (
                f"Historical top performer{ctx} — "
                f"avg score {pm['avg_score']:.2f}, "
                f"{pm['total_actions']} actions."
            )

            content_types = meta.get("content_types", [])
            if content_types:
                rationale += (
                    f" Recommended content: {', '.join(content_types)}."
                )

            results.append({
                "platform": plat_name,
                "rationale": rationale,
                "priority": rank,
                "score": round(weight, 4),
                "historical_avg_score": round(pm.get("avg_score", 0.0), 4),
                "historical_actions": pm.get("total_actions", 0),
                "content_types": content_types,
            })

        return results

    def recommend_schedule(
        self, campaign_brief: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Recommend optimal posting schedule based on historical timing.

        Analyzes action scores by hour-of-day and day-of-week when
        timestamps are available.  Uses integer hour clusters (UTC) and
        day-of-week names.

        Args:
            campaign_brief: Optional dict (unused in computation, reserved
                for future context).

        Returns:
            A dict with ``best_days``, ``best_hours_utc``,
            ``max_daily_per_account``, and ``min_gap_hours``.
            Falls back to defaults when no timestamp data is available.
        """
        # Gather all actions with timestamps and scores
        campaigns = self._store.list_campaigns()
        if not campaigns:
            return dict(_DEFAULT_SCHEDULE)

        all_actions: list[dict[str, Any]] = []
        for c in campaigns:
            try:
                all_actions.extend(self._store.get_actions(c["id"]))
            except Exception as exc:
                logger.warning(
                    "Failed to fetch actions for schedule analysis (%s): %s",
                    c["id"],
                    exc,
                )

        if not all_actions:
            return dict(_DEFAULT_SCHEDULE)

        # ── Aggregate by hour-of-day and day-of-week ─────────────────────
        hour_data: dict[int, list[float]] = defaultdict(list)
        day_data: dict[str, list[float]] = defaultdict(list)

        for a in all_actions:
            ts = a.get("timestamp")
            if not ts:
                continue
            try:
                dt = datetime.fromisoformat(ts)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                continue

            hour = dt.hour
            day_name = dt.strftime("%A")  # e.g. "Monday"

            score = a.get("score")
            if score is not None:
                try:
                    s = float(score)
                    hour_data[hour].append(s)
                    day_data[day_name].append(s)
                except (ValueError, TypeError):
                    hour_data[hour].append(0.0)
                    day_data[day_name].append(0.0)
            else:
                hour_data[hour].append(0.0)
                day_data[day_name].append(0.0)

        # ── Rank hours by mean score (fallback to count if all scores are 0) ─
        hour_scores: list[tuple[float, int]] = []
        for hour, scores in hour_data.items():
            mean_score = statistics.mean(scores) if scores else 0.0
            # Use action count as tiebreaker
            hour_scores.append((mean_score, hour))
        hour_scores.sort(key=lambda x: (x[0], x[1]), reverse=True)

        # Take top hours that are above the mean, then pad to at least 4
        all_means = [s for s, _ in hour_scores]
        overall_mean = statistics.mean(all_means) if all_means else 0.0

        best_hours: list[int] = []
        seen: set[int] = set()
        for s, h in hour_scores:
            if s > overall_mean:
                best_hours.append(h)
                seen.add(h)

        # Pad with next-best hours until we have at least 4
        if len(best_hours) < 4:
            for _, h in hour_scores:
                if h not in seen:
                    best_hours.append(h)
                    seen.add(h)
                if len(best_hours) >= 4:
                    break

        best_hours = sorted(best_hours[:6])

        # ── Rank days by mean score ──────────────────────────────────────
        day_scores: list[tuple[float, str]] = []
        _DAY_ORDER = [
            "Monday", "Tuesday", "Wednesday", "Thursday",
            "Friday", "Saturday", "Sunday",
        ]
        for day in _DAY_ORDER:
            scores = day_data.get(day, [])
            if not scores:
                # No data for this day — skip or assign neutral score
                day_scores.append((0.0, day))
            else:
                day_scores.append((statistics.mean(scores), day))
        day_scores.sort(key=lambda x: (x[0], _DAY_ORDER.index(x[1])), reverse=True)

        day_overall_mean = statistics.mean(
            [s for s, _ in day_scores if s > 0] or [0]
        )
        best_days = [
            d for s, d in day_scores
            if s > day_overall_mean and s > 0
        ]
        if not best_days:
            # Fall back to top 3 by score
            best_days = [d for _, d in day_scores[:3]]
        best_days = best_days[:5]  # cap at 5

        return {
            "best_days": best_days,
            "best_hours_utc": best_hours,
            "max_daily_per_account": _DEFAULT_SCHEDULE["max_daily_per_account"],
            "min_gap_hours": _DEFAULT_SCHEDULE["min_gap_hours"],
            "analysis_note": (
                f"Derived from {len(all_actions)} historical actions."
            ),
        }

    def generate_campaign_config(
        self, recommendations: dict[str, Any]
    ) -> dict[str, Any]:
        """Produce a full campaign config dict from recommendation outputs.

        The output schema matches the structure used in
        ``marketing/config.py`` / ``marketing/campaigns/``.

        Args:
            recommendations: Dict with keys ``angles``, ``platforms``,
                ``schedule``, and optionally ``campaign_brief``.

        Returns:
            A campaign config dict with ``name``, ``platform``,
            ``activity``, ``content``, ``monitoring``, and ``schedule``
            sections.
        """
        angles: list[dict[str, Any]] = recommendations.get("angles", _DEFAULT_ANGLES)
        platforms: list[dict[str, Any]] = recommendations.get(
            "platforms", _DEFAULT_PLATFORMS
        )
        schedule: dict[str, Any] = recommendations.get(
            "schedule", _DEFAULT_SCHEDULE
        )
        brief: dict[str, Any] = recommendations.get("campaign_brief", {})

        product: str = brief.get("product", "")
        repo: str = brief.get("repo", "")
        target_audience: str = brief.get("target_audience", "")

        # Pick the top platform
        top_platform = platforms[0]["platform"] if platforms else "reddit"
        platform_meta = _PLATFORM_METADATA.get(top_platform, {})

        # Extract angle names
        angle_names = [a["angle"] for a in angles]

        # Build content types from platform metadata + top angle
        content_types: list[str] = list(
            platform_meta.get("content_types", ["text post", "comment"])
        )

        # Determine tone
        tone = "professional"
        if any(a["angle"] in ("storytelling", "social_proof") for a in angles):
            tone = "conversational"
        elif any(a["angle"] == "educational" for a in angles):
            tone = "informative"

        # Build the config
        config: dict[str, Any] = {
            "name": brief.get("name", f"{product or 'Campaign'} — {top_platform}"),
            "platform": top_platform,
            "activity": {
                "waves": [
                    {
                        "day": day_offset + 1,
                        "subreddits": brief.get("subreddits", []),
                        "angles": angle_names,
                        "targets": max(
                            1, schedule.get("max_daily_per_account", 3)
                        ),
                    }
                    for day_offset in range(min(3, len(schedule.get("best_days", ["Tuesday", "Wednesday", "Thursday"]))))
                ],
                "engagement": {
                    "reply_within_hours": 24,
                    "max_replies_per_account": 5,
                },
            },
            "content": {
                "tone": tone,
                "types": content_types,
            },
            "monitoring": {
                "check_interval_minutes": 120,
                "notify_on": ["low_engagement", "high_engagement", "error"],
            },
            "schedule": {
                "timezone": "UTC",
                "best_hours": schedule.get("best_hours_utc", [14, 15, 16, 17]),
                "best_days": schedule.get("best_days", ["Tuesday", "Wednesday", "Thursday"]),
            },
        }

        if product:
            config["product"] = product
        if repo:
            config["repo"] = repo
        if target_audience:
            config["target_audience"] = target_audience

        return config

    def generate_full_plan(
        self, campaign_brief: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Convenience method: analyze → recommend → generate in one call.

        Runs the full pipeline and returns angles, platforms, schedule,
        config, and a plain-text analysis summary.

        Args:
            campaign_brief: Optional campaign context dict (e.g.
                ``product``, ``repo``, ``target_audience``,
                ``subreddits``).

        Returns:
            A dict with keys ``angles``, ``platforms``, ``schedule``,
            ``config``, and ``analysis_summary``.
        """
        brief = campaign_brief or {}

        analysis = self.analyze_past_campaigns()
        angles = self.recommend_angles(brief)
        platforms = self.recommend_platforms(brief)
        schedule = self.recommend_schedule(brief)

        recommendations: dict[str, Any] = {
            "angles": angles,
            "platforms": platforms,
            "schedule": schedule,
            "campaign_brief": brief,
        }
        config = self.generate_campaign_config(recommendations)

        summary = self._build_analysis_summary(analysis, angles, platforms, schedule)

        return {
            "angles": angles,
            "platforms": platforms,
            "schedule": schedule,
            "config": config,
            "analysis_summary": summary,
        }

    # ── Internal helpers ──────────────────────────────────────────────────

    @staticmethod
    def _derive_angle(action: dict[str, Any]) -> str:
        """Derive a content-angle label from an action record.

        Tries, in order:

        1. An explicit ``angle`` key in the action dict.
        2. The ``action_type`` key (e.g. ``"comment"`` → ``"engagement"``
           unless it matches a known angle).
        3. A heuristic on ``content_preview`` looking for known angle
           keywords.
        4. Falls back to ``"uncategorized"``.
        """
        explicit = action.get("angle")
        if explicit and isinstance(explicit, str) and explicit.strip():
            return explicit.strip().lower()

        action_type = action.get("action_type", "").lower()

        # Map known action types to angles
        type_to_angle: dict[str, str] = {
            "problem_solution": "problem_solution",
            "comparison": "comparison",
            "educational": "educational",
            "tutorial": "educational",
            "howto": "educational",
            "social_proof": "social_proof",
            "testimonial": "social_proof",
            "storytelling": "storytelling",
            "story": "storytelling",
            "data_driven": "data_driven",
            "benchmark": "data_driven",
            "show_hn": "problem_solution",
            "launch": "problem_solution",
        }
        if action_type in type_to_angle:
            return type_to_angle[action_type]

        # Heuristic: scan content_preview for keywords
        preview = (action.get("content_preview") or "").lower()
        keyword_to_angle: list[tuple[list[str], str]] = [
            (["tutorial", "how to", "guide", "learn", "step by step"], "educational"),
            (["compare", "vs ", "alternative", "migration", "switch from"], "comparison"),
            (["case study", "testimonial", "customer", "adopted", "used by"], "social_proof"),
            (["story", "journey", "started", "built", "origin"], "storytelling"),
            (["benchmark", "performance", "metrics", "data", "measured", "latency"], "data_driven"),
            (["solves", "problem", "pain", "frustrated", "annoyed"], "problem_solution"),
        ]
        for keywords, angle in keyword_to_angle:
            if any(kw in preview for kw in keywords):
                return angle

        return "uncategorized"

    @staticmethod
    def _score_summary(scores: list[float]) -> dict[str, Any]:
        """Produce a statistical summary for a list of scores."""
        if not scores:
            return {"count": 0, "mean": 0.0, "min": 0.0, "max": 0.0}
        return {
            "count": len(scores),
            "mean": round(statistics.mean(scores), 4),
            "median": round(statistics.median(scores), 4),
            "min": round(min(scores), 4),
            "max": round(max(scores), 4),
            "stdev": (
                round(statistics.stdev(scores), 4)
                if len(scores) >= 2
                else 0.0
            ),
        }

    @staticmethod
    def _build_analysis_summary(
        analysis: dict[str, Any],
        angles: list[dict[str, Any]],
        platforms: list[dict[str, Any]],
        schedule: dict[str, Any],
    ) -> str:
        """Build a human-readable summary of the analysis results."""
        overall = analysis.get("overall", {})
        parts: list[str] = []

        if not overall.get("total_actions"):
            return (
                "No historical campaign data was found. "
                "Recommendations are based on generic best practices."
            )

        parts.append(
            f"Analysis based on {overall['total_actions']} actions "
            f"across {overall['total_campaigns']} campaign(s)."
        )

        # Top angle
        if angles:
            top = angles[0]
            parts.append(
                f"Top angle: **{top['angle']}** "
                f"(score {top['historical_avg_score']:.2f}, "
                f"{top['historical_actions']} actions)."
            )

        # Top platform
        if platforms:
            top = platforms[0]
            parts.append(
                f"Top platform: **{top['platform']}** "
                f"(score {top['historical_avg_score']:.2f}, "
                f"{top['historical_actions']} actions)."
            )

        # Schedule
        days = schedule.get("best_days", [])
        hours = schedule.get("best_hours_utc", [])
        if days and hours:
            parts.append(
                f"Best posting: {', '.join(days)} "
                f"at {', '.join(f'{h}:00 UTC' for h in hours[:3])}."
            )

        return " ".join(parts)
