"""Weekly review generator — structured campaign reports with trend analysis.

Produces valid Markdown suitable for delivery via ``send_message`` or
digest.  Relies on ``CampaignStore`` for metrics/actions and
``WarmupEngine`` for account warmup status — both are stdlib-only.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from marketing.store import CampaignStore
from marketing.warmup import WarmupEngine

logger = logging.getLogger(__name__)

_WEEK_SECONDS = 7 * 24 * 3600
_DAY_SECONDS = 24 * 3600


class WeeklyReview:
    """Generates structured weekly marketing reports with trend analysis.

    Usage::

        store = CampaignStore()
        review = WeeklyReview(store)

        report_md = review.generate_weekly_report("abc123")
        targets = review.compare_to_targets("abc123")
        tips = review.recommend_optimizations("abc123")
    """

    def __init__(self, store: CampaignStore) -> None:
        self._store = store
        self._warmup = WarmupEngine()

    # ── public interface ──────────────────────────────────────────────────

    def generate_weekly_report(self, campaign_id: str) -> str:
        """Build a formatted Markdown report for *campaign_id*.

        Sections:
        - Campaign overview (name, status, active period, platforms)
        - Action summary (total, by platform, by type — last 7 days)
        - Metric trends (deltas over 7d, 30d, all-time)
        - Account warmup status (all tracked accounts, phases, readiness)
        - Pending actions count
        - Speed comparison vs campaign schedule targets
        """
        campaign = self._store.get_campaign(campaign_id)
        if campaign is None:
            return f"*Error:* Campaign `{campaign_id}` not found."

        config = self._load_config(campaign)
        now = datetime.now(timezone.utc)
        week_ago = (now - timedelta(days=7)).isoformat()

        overview = self._build_overview(campaign, config)
        action_summary = self._action_summary(campaign_id, week_ago)
        metric_trends = self._metric_trends(campaign_id, now)
        warmup_status = self._warmup_status()
        pending = self._pending_count(campaign_id)
        speed = self._speed_comparison(campaign_id, config, week_ago)

        lines: list[str] = []

        # ── header ─────────────────────────────────────────────────────
        lines.append(f"# Weekly Report — {overview['name']}")
        lines.append("")
        lines.append(f"*Generated:* {now.strftime('%Y-%m-%d %H:%M UTC')}")
        lines.append(f"*Campaign ID:* `{campaign_id}`")
        lines.append("")
        lines.append("---")
        lines.append("")

        # ── campaign overview ──────────────────────────────────────────
        lines.append("## Campaign Overview")
        lines.append("")
        lines.append(f"- **Name:** {overview['name']}")
        lines.append(f"- **Product:** {overview['product']}")
        lines.append(f"- **Status:** {overview['status']}")
        lines.append(f"- **Active Period:** {overview['active_period']}")
        lines.append(f"- **Platforms:** {overview['platforms']}")
        lines.append("")

        lines.append("---")
        lines.append("")

        # ── action summary ─────────────────────────────────────────────
        lines.append("## Action Summary (Last 7 Days)")
        lines.append("")
        lines.append(f"**Total actions:** {action_summary['total']}")
        lines.append("")

        if action_summary.get("by_platform"):
            lines.append("### By Platform")
            lines.append("")
            lines.append("| Platform | Count |")
            lines.append("|----------|-------|")
            for plat, count in sorted(action_summary["by_platform"].items()):
                lines.append(f"| {plat} | {count} |")
            lines.append("")

        if action_summary.get("by_type"):
            lines.append("### By Type")
            lines.append("")
            lines.append("| Type | Count |")
            lines.append("|------|-------|")
            for atype, count in sorted(action_summary["by_type"].items()):
                lines.append(f"| {atype} | {count} |")
            lines.append("")

        lines.append("---")
        lines.append("")

        # ── metric trends ──────────────────────────────────────────────
        lines.append("## Metric Trends")
        lines.append("")

        if metric_trends:
            lines.append("| Metric | 7d Delta | 30d Delta | All-Time |")
            lines.append("|--------|----------|-----------|----------|")
            for row in metric_trends:
                lines.append(
                    f"| {row['metric']} "
                    f"| {row['delta_7d']} "
                    f"| {row['delta_30d']} "
                    f"| {row['all_time']} |"
                )
            lines.append("")
        else:
            lines.append("*No metric snapshots recorded yet.*")
            lines.append("")

        lines.append("---")
        lines.append("")

        # ── account warmup status ──────────────────────────────────────
        lines.append("## Account Warmup Status")
        lines.append("")

        if warmup_status:
            lines.append("| Account | Phase | Days In | Ready |")
            lines.append("|---------|-------|---------|-------|")
            for acct in warmup_status:
                days_total = acct.get("phase_days_total", 0)
                days_str = (
                    f"{acct['days_in_phase']}/{days_total}"
                    if days_total > 0
                    else f"{acct['days_in_phase']}/∞"
                )
                lines.append(
                    f"| {acct['account_name']} "
                    f"| {acct['phase_name']} "
                    f"| {days_str} "
                    f"| {'✅' if acct['is_ready'] else '❌'} |"
                )
            lines.append("")
        else:
            lines.append("*No accounts in warmup.*")
            lines.append("")

        lines.append("---")
        lines.append("")

        # ── pending actions ────────────────────────────────────────────
        lines.append("## Pending Actions")
        lines.append("")
        lines.append(f"**Pending:** {pending}")
        lines.append("")

        lines.append("---")
        lines.append("")

        # ── speed vs target ────────────────────────────────────────────
        lines.append("## Speed vs Target")
        lines.append("")
        lines.append(
            f"**Daily target:** {speed.get('daily_target', 'N/A')} actions/day"
        )
        lines.append(f"**Actions this week:** {speed.get('actions_this_week', 0)}")
        lines.append(f"**Average per day:** {speed.get('avg_per_day', 0):.1f}")
        lines.append(
            f"**On track?** {'✅ Yes' if speed.get('on_track') else '❌ No'}"
        )
        if not speed.get("on_track"):
            lines.append(f"**Gap:** {speed.get('gap', 0)} actions behind target")
        lines.append("")

        return "\n".join(lines)

    def compare_to_targets(self, campaign_id: str) -> dict[str, Any]:
        """Compare actual metric values to campaign config targets.

        Reads the optional ``targets`` dict from the campaign's config JSON.
        Known target keys: ``github_stars_target``, ``npm_downloads_target``,
        ``x_mentions_target``.

        Returns::

            {
                "GitHub Stars": {"target": 100, "actual": 42, "met": False},
                "npm Downloads": {"target": 5000, "actual": 6234, "met": True},
            }

        If no targets are configured or no metrics exist, a message key is
        returned instead.
        """
        campaign = self._store.get_campaign(campaign_id)
        if campaign is None:
            return {"error": f"Campaign `{campaign_id}` not found."}

        config = self._load_config(campaign)
        targets: dict[str, Any] = config.get("targets", {})
        if not targets:
            return {"message": "No targets configured for this campaign."}

        metrics = self._store.get_metrics(campaign_id)
        if not metrics:
            return {
                "message": "No metrics recorded yet — run "
                "``collect_all()`` first.",
            }

        latest = metrics[0]  # sorted DESC by collected_at

        # Map target config keys to metric column names and display labels
        target_map: list[tuple[str, str, str]] = [
            ("github_stars_target", "github_stars", "GitHub Stars"),
            ("npm_downloads_target", "npm_downloads", "npm Downloads"),
            ("x_mentions_target", "x_mentions", "X Mentions"),
        ]

        result: dict[str, Any] = {}
        for target_key, metric_col, label in target_map:
            target_val = targets.get(target_key)
            if target_val is None:
                continue
            try:
                actual = int(latest.get(metric_col, 0))
            except (ValueError, TypeError):
                actual = 0
            result[label] = {
                "target": int(target_val),
                "actual": actual,
                "met": actual >= int(target_val),
            }

        if not result:
            return {
                "message": "No recognised target keys found in campaign "
                "configuration. Expected keys: ``github_stars_target``, "
                "``npm_downloads_target``, ``x_mentions_target``.",
            }

        return result

    def recommend_optimizations(self, campaign_id: str) -> list[str]:
        """Analyse campaign data and return actionable recommendations.

        Checks four dimensions:

        1. **Underperforming platforms** — platforms with action counts
           below 30 % of the expected weekly volume.
        2. **Best-performing accounts** — accounts with highest karma
           (engagement proxy).
        3. **Metric growth rate changes** — decreases or stalls in
           GitHub stars / npm downloads.
        4. **Warmup pacing** — accounts approaching or at their daily
           warmup action limit.

        Returns a list of human-readable Markdown recommendation strings.
        """
        recommendations: list[str] = []
        campaign = self._store.get_campaign(campaign_id)
        if campaign is None:
            return [f"Campaign `{campaign_id}` not found."]

        config = self._load_config(campaign)
        now = datetime.now(timezone.utc)
        week_ago = (now - timedelta(days=7)).isoformat()

        # ── 1. Underperforming platforms ───────────────────────────────
        actions = self._store.get_actions(campaign_id, since=week_ago)
        platform_counts: dict[str, int] = {}
        for action in actions:
            plat = action.get("platform", "unknown")
            platform_counts[plat] = platform_counts.get(plat, 0) + 1

        configured_platforms: list[str] = config.get("platforms", [])
        if configured_platforms:
            daily_target = config.get("schedule", {}).get("daily_target", 3)
            expected_weekly = daily_target * 7
            for plat in configured_platforms:
                count = platform_counts.get(plat, 0)
                threshold = max(1, int(expected_weekly * 0.3))
                if count < threshold:
                    recommendations.append(
                        f"⚡ Platform **{plat}** is underperforming "
                        f"({count} actions this week vs ~{expected_weekly} "
                        f"target). Consider increasing posting frequency or "
                        f"reassessing content strategy."
                    )

        # ── 2. Best-performing accounts (highest karma) ────────────────
        accounts = self._store.list_accounts()
        if accounts:
            platform_set = {p.lower() for p in configured_platforms} if configured_platforms else set()
            scored = sorted(
                [
                    (a.get("karma", 0), a.get("name", "unknown"), a.get("platform", ""))
                    for a in accounts
                    if not platform_set or a.get("platform", "").lower() in platform_set
                ],
                reverse=True,
            )
            # Filter out zero-karma accounts
            scored = [(k, n, p) for k, n, p in scored if k > 0]
            if scored:
                top_karma, top_name, top_platform = scored[0]
                recommendations.append(
                    f"⭐ Top performer: **{top_name}** ({top_platform}, "
                    f"karma: {top_karma}). Review and replicate this "
                    f"account's content strategy."
                )
                if len(scored) > 1:
                    runner_karma, runner_name, runner_platform = scored[1]
                    recommendations.append(
                        f"👍 Runner-up: **{runner_name}** ({runner_platform}, "
                        f"karma: {runner_karma}). Consider cross-pollinating "
                        f"content approaches between top accounts."
                    )

        # ── 3. Metric growth rate changes ──────────────────────────────
        metrics = self._store.get_metrics(campaign_id)
        if len(metrics) >= 2:
            latest = metrics[0]
            prev = metrics[1]  # second-most-recent snapshot
            for col, label in [
                ("github_stars", "GitHub Stars"),
                ("npm_downloads", "npm Downloads"),
            ]:
                prev_val = prev.get(col, 0)
                latest_val = latest.get(col, 0)
                if prev_val > 0:
                    growth = latest_val - prev_val
                    if growth < 0:
                        recommendations.append(
                            f"📉 **{label}** decreased by {abs(growth)} "
                            f"since the last snapshot. Investigate cause."
                        )
                    elif growth == 0:
                        recommendations.append(
                            f"📊 **{label}** is flat since the last "
                            f"snapshot. Consider new outreach tactics."
                        )

        # ── 4. Warmup pacing limits ───────────────────────────────────
        warmup_accounts = self._warmup.list_accounts()
        if warmup_accounts:
            for acct in warmup_accounts:
                if acct.get("is_ready"):
                    continue
                actions_today = acct.get("actions_today", 0)
                try:
                    phase_info = self._warmup.get_current_phase(
                        acct["account_name"]
                    )
                    daily_max = phase_info.get("daily_actions_max", 0)
                    if daily_max > 0 and actions_today >= daily_max:
                        recommendations.append(
                            f"⏱ Account **{acct['account_name']}** hit "
                            f"its daily warmup limit "
                            f"({actions_today}/{daily_max}). Pause further "
                            f"actions until tomorrow."
                        )
                except (KeyError, ValueError):
                    # Account not yet tracked in warmup engine
                    pass

        if not recommendations:
            recommendations.append(
                "✅ No optimisation opportunities detected. Campaign is "
                "operating within expected parameters."
            )

        return recommendations

    # ── internal report builders ──────────────────────────────────────────

    @staticmethod
    def _load_config(campaign: dict[str, Any]) -> dict[str, Any]:
        """Parse the ``config_json`` field of a campaign row."""
        try:
            return dict(json.loads(campaign.get("config_json", "{}")))
        except (json.JSONDecodeError, TypeError, ValueError):
            return {}

    @staticmethod
    def _build_overview(
        campaign: dict[str, Any], config: dict[str, Any]
    ) -> dict[str, str]:
        """Extract overview fields from campaign + config."""
        name: str = campaign.get("name", "Unnamed")
        status: str = campaign.get("status", "unknown")
        product: str = config.get("product", "")
        platforms: str = ", ".join(config.get("platforms", [])) or "none"

        schedule = config.get("schedule", {})
        start: str = (
            schedule.get("start_date")
            or campaign.get("start_date")
            or "?"
        )
        end: str = (
            schedule.get("end_date")
            or campaign.get("end_date")
            or "ongoing"
        )

        return {
            "name": name,
            "status": status,
            "product": product,
            "platforms": platforms,
            "active_period": f"{start} → {end}",
        }

    def _action_summary(
        self, campaign_id: str, since: str
    ) -> dict[str, Any]:
        """Aggregate actions by platform and type within a time window."""
        actions = self._store.get_actions(campaign_id, since=since)
        total = len(actions)
        by_platform: dict[str, int] = {}
        by_type: dict[str, int] = {}

        for a in actions:
            plat = a.get("platform", "unknown")
            by_platform[plat] = by_platform.get(plat, 0) + 1
            atype = a.get("action_type", "unknown")
            by_type[atype] = by_type.get(atype, 0) + 1

        return {
            "total": total,
            "by_platform": by_platform,
            "by_type": by_type,
        }

    def _metric_trends(
        self, campaign_id: str, now: datetime
    ) -> list[dict[str, Any]]:
        """Compute deltas per metric column over 7d, 30d, and all-time.

        Returns a list suitable for table rendering::

            [
                {"metric": "GitHub Stars", "delta_7d": "+5",
                 "delta_30d": "+23", "all_time": "142"},
                ...
            ]
        """
        metrics = self._store.get_metrics(campaign_id)
        if not metrics:
            return []

        # Sort chronologically (oldest first) for window arithmetic
        all_chrono = sorted(
            metrics, key=lambda m: m.get("collected_at", "")
        )
        latest = all_chrono[-1]

        metric_columns: list[tuple[str, str]] = [
            ("github_stars", "GitHub Stars"),
            ("npm_downloads", "npm Downloads"),
            ("x_mentions", "X Mentions"),
        ]

        def _window_delta(
            col: str, cutoff: datetime
        ) -> str:
            """Compute *latest* - *oldest-in-window* for *col*.

            Returns a signed integer string (e.g. ``"+5"``, ``"-3"``,
            ``"0"``) or a fallback message.
            """
            cutoff_iso = cutoff.isoformat()
            window = [
                m
                for m in all_chrono
                if m.get("collected_at", "") >= cutoff_iso
            ]
            if len(window) < 2:
                return "0"
            earliest = window[0]
            delta = int(latest.get(col, 0)) - int(earliest.get(col, 0))
            if delta >= 0:
                return f"+{delta}"
            return str(delta)

        rows: list[dict[str, Any]] = []
        for col_key, label in metric_columns:
            delta_7d = _window_delta(col_key, now - timedelta(days=7))
            delta_30d = _window_delta(col_key, now - timedelta(days=30))
            all_time = str(latest.get(col_key, 0))
            rows.append({
                "metric": label,
                "delta_7d": delta_7d,
                "delta_30d": delta_30d,
                "all_time": all_time,
            })

        return rows

    def _warmup_status(self) -> list[dict[str, Any]]:
        """Return warmup account list from the engine."""
        return self._warmup.list_accounts()

    def _pending_count(self, campaign_id: str) -> int:
        """Count actions whose status is ``"pending"``."""
        actions = self._store.get_actions(campaign_id)
        return sum(1 for a in actions if a.get("status") == "pending")

    def _speed_comparison(
        self,
        campaign_id: str,
        config: dict[str, Any],
        week_ago: str,
    ) -> dict[str, Any]:
        """Compare weekly action volume against the configured daily target."""
        schedule = config.get("schedule", {})
        daily_target = int(schedule.get("daily_target", 3))

        actions = self._store.get_actions(campaign_id, since=week_ago)
        actions_this_week = len(actions)
        avg_per_day = actions_this_week / 7.0
        on_track = avg_per_day >= daily_target
        gap = max(0, daily_target * 7 - actions_this_week)

        return {
            "daily_target": daily_target,
            "actions_this_week": actions_this_week,
            "avg_per_day": round(avg_per_day, 1),
            "on_track": on_track,
            "gap": gap,
        }
