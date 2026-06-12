"""Marketing dashboard -- CLI panels for campaign status, account health,
metric trends, and pending actions.

Pure stdlib (shutil, datetime, collections, json).  No external dependencies.
All output via ``print()`` to stdout -- compatible with CLI and TUI.
ASCII only (standard Unicode block characters for bars and sparklines).
All datetime handling in UTC.
"""

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any

# Graceful imports -- dashboard works even if store/warmup modules are absent.
try:
    from marketing.store import CampaignStore
except ImportError:
    CampaignStore = None  # type: ignore[assignment,misc]

try:
    from marketing.warmup import WarmupEngine
except ImportError:
    WarmupEngine = None  # type: ignore[assignment,misc]

# ── Character constants ────────────────────────────────────────────────────

# Sparkline characters (8 levels, U+2581 - U+2588)
_SPARK_CHARS = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588"

# Progress bar characters
_FILLED = "\u2588"   # █ -- completed / done
_PARTIAL = "\u2593"  # ▓ -- current / in-progress
_EMPTY = "\u2591"    # ░ -- pending / remaining


# ── Rendering helpers ──────────────────────────────────────────────────────


def _term_width() -> int:
    """Return terminal width in columns, falling back to 80."""
    try:
        return shutil.get_terminal_size().columns
    except Exception:
        return 80


def _progress_bar(
    completed: int,
    current: int,
    total: int,
    width: int = 10,
) -> str:
    """Render a three-level progress bar.

    ``_FILLED`` for completed units, ``_PARTIAL`` for the current unit,
    ``_EMPTY`` for pending units.  The bar is scaled to *width* characters.
    """
    if total <= 0:
        return _EMPTY * width
    scale = width / total
    filled_w = int(completed * scale)
    partial_w = max(1, int(current * scale)) if current > 0 else 0
    # Clamp so the bar never exceeds *width*
    if filled_w + partial_w > width:
        partial_w = width - filled_w
    empty_w = width - filled_w - partial_w
    return _FILLED * filled_w + _PARTIAL * partial_w + _EMPTY * max(0, empty_w)


def _simple_bar(ratio: float, width: int = 10) -> str:
    """Render a two-level bar from a ratio between 0.0 and 1.0."""
    ratio = max(0.0, min(1.0, ratio))
    filled = int(ratio * width)
    return _FILLED * filled + _EMPTY * (width - filled)


def _sparkline(values: list[int], width: int = 10) -> str:
    """Render a sparkline from integer values using block characters.

    Values are sampled down to at most *width* points (evenly spaced)
    and mapped to 8 intensity levels.
    """
    if not values:
        return ""
    if len(values) > width:
        step = len(values) / width
        sampled = [values[int(i * step)] for i in range(width)]
    else:
        sampled = list(values)
    if len(sampled) == 1:
        return _SPARK_CHARS[4]
    lo, hi = min(sampled), max(sampled)
    if lo == hi:
        return _SPARK_CHARS[4] * len(sampled)
    result: list[str] = []
    for v in sampled:
        idx = int((v - lo) / (hi - lo) * 7)
        result.append(_SPARK_CHARS[max(0, min(7, idx))])
    return "".join(result)


def _fmt(n: int) -> str:
    """Format a number with k/m suffix for readability."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}m"
    if n >= 1_000:
        return f"{n / 1_000:.1f}k"
    return str(n)


def _truncate(text: str, maxlen: int) -> str:
    """Truncate *text* to *maxlen* chars, appending ``~`` if trimmed."""
    if len(text) <= maxlen:
        return text
    return text[: maxlen - 1] + "~"


def _now_utc() -> datetime:
    """Return the current UTC datetime with timezone info."""
    return datetime.now(timezone.utc)


# ── Dashboard class ────────────────────────────────────────────────────────


class Dashboard:
    """CLI dashboard for marketing campaign status, account health,
    metric trends, and pending actions.

    All output goes to ``print()`` (stdout).  Designed for compatibility
    with both the classic CLI and the Ink-based TUI.

    Usage::

        store = CampaignStore()
        warmup = WarmupEngine()
        dashboard = Dashboard(store=store, warmup=warmup)
        dashboard.show_full_dashboard()
    """

    def __init__(
        self,
        store: "CampaignStore | None" = None,
        warmup: "WarmupEngine | None" = None,
    ) -> None:
        """Initialize the dashboard.

        Args:
            store: CampaignStore instance for reading campaign/action/metric
                data.  If ``None``, panels that need data will show empty
                messages.
            warmup: Optional WarmupEngine for account warmup phase info.
        """
        self._store = store
        self._warmup = warmup
        self._width = _term_width()

    # ── Internal helpers ──────────────────────────────────────────────────

    def _header(self, title: str) -> None:
        """Print a section header with a horizontal rule underneath."""
        sep = "\u2500" * len(title)
        print(f"\n{title}")
        print(sep)

    def _parse_config(self, campaign: dict[str, Any]) -> dict[str, Any]:
        """Safely parse the config_json field of a campaign."""
        try:
            return json.loads(campaign.get("config_json", "{}"))
        except (json.JSONDecodeError, TypeError):
            return {}

    # ── Panel: Campaigns ──────────────────────────────────────────────────

    def show_campaigns(
        self,
        status: str | None = None,
        limit: int = 10,
    ) -> None:
        """Print campaign list with status bars, action counts, wave progress.

        Each line shows: ``#N  name  ████░░░░  N/N actions  Wave X/Y``

        Args:
            status: Optional status filter (e.g. ``"active"``).
            limit: Maximum number of campaigns to display.
        """
        if not self._store:
            self._header("Campaigns")
            print("No campaigns found.")
            return

        campaigns = self._store.list_campaigns(status=status)
        label = f" ({status})" if status else ""
        self._header(f"Campaigns{label}")

        if not campaigns:
            print("No campaigns found.")
            return

        # Bar width: terminal width minus fixed columns (name, actions, waves)
        bar_width = max(10, self._width - 60)

        for i, c in enumerate(campaigns[:limit]):
            name = _truncate(c.get("name", "unnamed"), 18)
            cid = c.get("id", "")

            # Gather action stats
            actions = self._store.get_actions(cid)
            total_actions = len(actions)
            completed_actions = sum(
                1 for a in actions
                if a.get("status") in ("completed", "done")
            )

            # Wave info from campaign config
            cfg = self._parse_config(c)
            wave_total = cfg.get("total_waves") or cfg.get("waves_total")
            wave_done = cfg.get("current_wave") or cfg.get("waves_completed")
            waves_list = cfg.get("waves")

            # Fallback: count waves from list structure
            if wave_total is None and isinstance(waves_list, list) and waves_list:
                wave_total = len(waves_list)
                wave_done = sum(
                    1 for w in waves_list
                    if isinstance(w, dict) and w.get("status") == "completed"
                )

            # Render bar and wave label
            if wave_total and wave_total > 0:
                bar = _progress_bar(
                    completed=wave_done or 0,
                    current=1 if (wave_done or 0) < wave_total else 0,
                    total=wave_total,
                    width=bar_width,
                )
                wave_str = f"Wave {(wave_done or 0)}/{wave_total}"
            else:
                # Fallback: use action completion ratio
                ratio = (
                    completed_actions / total_actions
                    if total_actions > 0
                    else 0.0
                )
                bar = _simple_bar(ratio, bar_width)
                wave_str = c.get("status", "unknown").capitalize()

            actions_str = f"{completed_actions}/{total_actions} actions"
            print(
                f"#{i + 1:<3} {name:<18} {bar}  {actions_str:<16} {wave_str}"
            )

    # ── Panel: Accounts ───────────────────────────────────────────────────

    def show_accounts(
        self,
        status: str | None = None,
    ) -> None:
        """Print account warmup progress with phase bars.

        Each line shows: ``name  █████▓░░░░  N/10  status``

        Uses WarmupEngine data when available; falls back to CampaignStore
        account records.
        """
        accounts: list[dict[str, Any]] = []

        # Prefer WarmupEngine (richer phase data)
        if self._warmup:
            for wa in self._warmup.list_accounts():
                name = wa.get("account_name", "unknown")
                phase = wa.get("current_phase", 0)
                phase_name = wa.get("phase_name", "Unknown")
                is_ready = wa.get("is_ready", False)
                accounts.append({
                    "name": name,
                    "phase": phase,
                    "phase_name": phase_name,
                    "status": "ready" if is_ready else "active",
                })

        # Fallback to CampaignStore accounts table
        if not accounts and self._store:
            for sa in self._store.list_accounts():
                name = sa.get("name", "unknown")
                phase_str = sa.get("warmup_phase", "")
                phase = 0
                if phase_str:
                    try:
                        phase = int(phase_str)
                    except (ValueError, TypeError):
                        pass
                accounts.append({
                    "name": name,
                    "phase": phase,
                    "phase_name": phase_str or "Unknown",
                    "status": sa.get("status", "active"),
                })

        # Optional filter
        if status:
            accounts = [a for a in accounts if a["status"] == status]

        self._header(f"Accounts ({len(accounts)})")

        if not accounts:
            print("No accounts registered.")
            return

        bar_w = 10
        name_w = min(
            max((len(a["name"]) for a in accounts), default=12),
            22,
        )

        for acc in accounts:
            name = _truncate(acc["name"], name_w)
            bar = _progress_bar(
                completed=acc["phase"],
                current=1,
                total=10,
                width=bar_w,
            )
            phase_label = f"{acc['phase']}/10"
            print(
                f"  {name:<{name_w}}  {bar}  {phase_label}  {acc['status']}"
            )

    # ── Panel: Metrics ────────────────────────────────────────────────────

    def show_metrics(
        self,
        campaign_id: str | None = None,
        days: int = 30,
    ) -> None:
        """Print metric trends as ASCII sparklines with deltas.

        For each tracked metric (github_stars, npm_downloads) shows the
        current value, a sparkline of the trend, and the delta over the
        period.

        Args:
            campaign_id: Show metrics for a specific campaign.  If ``None``,
                metrics are shown for all campaigns.
            days: Number of days to look back.
        """
        if not self._store:
            self._header("Metrics")
            print("No metrics collected yet.")
            return

        # Resolve campaigns to display
        if campaign_id:
            c = self._store.get_campaign(campaign_id)
            campaigns = [c] if c else []
        else:
            campaigns = self._store.list_campaigns()

        if not campaigns:
            self._header("Metrics")
            print("No metrics collected yet.")
            return

        since = (_now_utc() - timedelta(days=days)).isoformat()

        for c in campaigns:
            cid = c.get("id", "")
            name = c.get("name", "unnamed")
            metrics = list(reversed(self._store.get_metrics(cid, since=since)))

            self._header(f"Metrics \u2014 {name} (last {days}d)")

            if not metrics:
                print("No metrics collected yet.")
                continue

            # Metric definitions: (display label, DB column)
            spark_width = min(10, max(4, self._width - 50))

            for label, key in [
                ("GitHub Stars", "github_stars"),
                ("npm Downloads", "npm_downloads"),
            ]:
                values = [m.get(key, 0) for m in metrics]
                current = values[-1]
                delta = values[-1] - values[0] if len(values) > 1 else 0
                spark = _sparkline(values, width=spark_width)
                delta_str = f"+{delta}" if delta >= 0 else str(delta)
                print(
                    f"  {label + ':':<16} {_fmt(current):>6}  "
                    f"{spark}  {delta_str} in {days}d"
                )

    # ── Panel: Pending ────────────────────────────────────────────────────

    def show_pending(
        self,
        platform: str | None = None,
    ) -> None:
        """Print queued/pending actions grouped by platform.

        Groups actions by platform, then lists action-type breakdowns.

        Args:
            platform: Optional platform filter (e.g. ``"reddit"``).
        """
        if not self._store:
            self._header("Pending Actions")
            print("No pending actions.")
            return

        # Collect all pending actions across every campaign
        all_pending: list[dict[str, Any]] = []
        for c in self._store.list_campaigns():
            for a in self._store.get_actions(c.get("id", "")):
                if a.get("status") == "pending":
                    all_pending.append(a)

        # Optional filter
        if platform:
            all_pending = [
                a for a in all_pending
                if a.get("platform", "").lower() == platform.lower()
            ]

        total = len(all_pending)
        self._header(f"Pending Actions ({total})")

        if not all_pending:
            print("No pending actions.")
            return

        # Group by platform -> action_type -> count
        by_platform: dict[str, dict[str, int]] = defaultdict(
            lambda: defaultdict(int)
        )
        for a in all_pending:
            plat = a.get("platform", "unknown")
            atype = a.get("action_type", "unknown")
            by_platform[plat][atype] += 1

        for plat in sorted(by_platform):
            types = by_platform[plat]
            cnt = sum(types.values())
            parts = [f"{c} {t}" for t, c in sorted(types.items())]

            # Flag HN posts as needing warm accounts
            needs_warm = plat.lower() == "hn" and any(
                t.lower() in ("show hn", "post") for t in types
            )
            suffix = " (requires warm accounts)" if needs_warm else ""
            print(f"  {plat} ({cnt}):  {', '.join(parts)}{suffix}")

    # ── Panel: Daily Report ───────────────────────────────────────────────

    def show_daily_report(self) -> None:
        """Print today's summary.

        Shows actions completed today, pending actions, account warmup
        phase advances, and metric deltas since yesterday.
        """
        now = _now_utc()
        today_start = now.replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        today_str = today_start.strftime("%Y-%m-%d")
        yesterday_start = today_start - timedelta(days=1)

        self._header(f"Daily Report \u2014 {today_str}")

        if not self._store:
            print("  No data available.")
            return

        # ── Actions ───────────────────────────────────────────────────
        completed = 0
        pending = 0
        for c in self._store.list_campaigns():
            for a in self._store.get_actions(c.get("id", "")):
                st = a.get("status", "")
                if st in ("completed", "done"):
                    completed += 1
                elif st == "pending":
                    pending += 1

        print(f"  Actions:    {completed} completed, {pending} pending")

        # ── Account warmup advances ───────────────────────────────────
        advances = 0
        if self._warmup:
            for acc in self._warmup.list_accounts():
                # An advance today = current phase > 0 and days_in_phase == 0
                # (phase_start was reset today by tick_daily / advance_phase)
                if (
                    acc.get("days_in_phase", 0) == 0
                    and acc.get("current_phase", 0) > 0
                ):
                    advances += 1
        print(f"  Accounts:   {advances} warmup phases advanced")

        # ── Metric deltas ─────────────────────────────────────────────
        campaigns = self._store.list_campaigns()
        if not campaigns:
            print("  Stars:      No data")
            print("  Downloads:  No data")
            return

        cid = campaigns[0].get("id", "")
        metrics = self._store.get_metrics(
            cid, since=yesterday_start.isoformat()
        )

        if not metrics:
            print("  Stars:      No data")
            print("  Downloads:  No data")
            return

        metrics = list(reversed(metrics))

        # Split metrics at today_start boundary to compute daily deltas
        star_before = 0
        star_after = 0
        dl_before = 0
        dl_after = 0
        today_boundary = today_start.isoformat()

        for m in metrics:
            ts = m.get("collected_at", "")
            if ts < today_boundary:
                star_before = m.get("github_stars", 0)
                dl_before = m.get("npm_downloads", 0)
            else:
                star_after = m.get("github_stars", 0)
                dl_after = m.get("npm_downloads", 0)

        # Current totals are the latest values (from whichever side)
        star_total = star_after or star_before
        dl_total = dl_after or dl_before

        star_delta = star_after - star_before if star_after else 0
        dl_delta = dl_after - dl_before if dl_after else 0

        s_str = f"+{star_delta}" if star_delta >= 0 else str(star_delta)
        d_str = f"+{dl_delta}" if dl_delta >= 0 else str(dl_delta)

        print(f"  Stars:      {s_str} today (total: {_fmt(star_total)})")
        print(f"  Downloads:  {d_str} today (total: {_fmt(dl_total)})")

    # ── Full dashboard ────────────────────────────────────────────────────

    def show_full_dashboard(
        self,
        campaign_id: str | None = None,
    ) -> None:
        """Show all dashboard panels sequentially.

        Calls ``show_campaigns()``, ``show_accounts()``,
        ``show_metrics()``, ``show_pending()``, and ``show_daily_report()``
        in order.  Runs synchronously with no animation.

        Args:
            campaign_id: Optional campaign ID to scope metrics to.
        """
        self.show_campaigns()
        self.show_accounts()
        self.show_metrics(campaign_id=campaign_id)
        self.show_pending()
        self.show_daily_report()
