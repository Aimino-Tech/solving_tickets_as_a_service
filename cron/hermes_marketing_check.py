#!/usr/bin/env python3
"""Hourly marketing check: reads the reddit-campaign sheet, decides what needs doing.

Modes
-----
- No flags:        hourly working-hours check (original behaviour)
- ``--daily-digest``: generate a daily campaign digest from the CampaignStore +
  WarmupEngine
- ``--sheet-sync``:   bidirectional Google Sheet ↔ SQLite sync
- Both flags:      sync first, then print digest
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from google.auth.transport.requests import Request as AuthRequest
from google.oauth2.service_account import Credentials

# ── Sheet column indices (reddit-campaign, 0-indexed) ──
COL_CONTENT_ID = 0  # ContentID (ODW###)
COL_ACTION_TYPE = 1  # ActionType (reply comment / post)
COL_PLATFORM = 2  # Platform
COL_PLATFORM_URL = 3  # PlatformURL
COL_TACTIC = 4  # GuerillaTactic
COL_CONTENT = 5  # Content (the comment text)
COL_SCHEDULE = 6  # Schedule
COL_LAST_UPDATE = 7  # Last_Update
COL_APPROVAL = 8  # Approval (✅ Approved / ⏳ Awaiting Thread / ✏️ Needs Edit)
COL_STATUS = 9  # Status (📋 planned / ⏳ pending / ✅ Repled / ReadyForBrowser)
COL_PROFILE = 10  # Chrome_Profile
COL_AGENT_NOTES = 11  # Agent's Notes
COL_HUMAN_NOTES = 12  # Human's Notes

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

logger = logging.getLogger(__name__)


def get_args():
    p = argparse.ArgumentParser()
    p.add_argument("--sheet-id", default=SHEET_ID)
    p.add_argument("--sheet-tab", default="reddit-campaign")
    p.add_argument("--hermes-endpoint", default=None, help="(Unused — accepted for cron-script backward compat)")
    p.add_argument("--daily-digest", action="store_true", help="Print daily campaign digest")
    p.add_argument("--sheet-sync", action="store_true", help="Run bidirectional sheet ↔ DB sync")
    p.add_argument("--compute", action="store_true", help="Compute campaign performance for all active campaigns")
    return p.parse_args()


def get_sheet_data(sheet_id, sheet_tab):
    """Read sheet via Google Sheets REST API — more reliable than gspread."""
    creds = Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
    auth_req = AuthRequest()
    creds.refresh(auth_req)
    headers = {"Authorization": f"Bearer {creds.token}"}

    # Get all data
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{sheet_tab}!A:M"
    req = Request(url, headers=headers)
    resp = urlopen(req, timeout=30)
    data = json.loads(resp.read())
    rows = data.get("values", [])
    if not rows:
        return [], None
    return rows[1:], rows[0]  # data rows, headers


# ═══════════════════════════════════════════════════════════════════════════════
#  Daily Digest
# ═══════════════════════════════════════════════════════════════════════════════


def _run_daily_digest(args: argparse.Namespace) -> str | None:
    """Generate and print a daily campaign digest.

    Returns ``None`` on success, an error string on failure.
    """
    try:
        from marketing.store import CampaignStore
        from marketing.warmup import WarmupEngine
    except ImportError as exc:
        return f"ERROR: Cannot import marketing modules — {exc}"

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        store = CampaignStore()
        warmup = WarmupEngine()
    except Exception as exc:
        return f"ERROR: Failed to initialise data stores — {exc}"

    lines: list[str] = []
    lines.append(f"╔═══ 📅 Daily Marketing Digest — {today} ═══╗")
    lines.append("")

    # ── 1. Campaign overview ──────────────────────────────────────────────
    campaigns = store.list_campaigns()
    lines.append(f"📁 Campaigns ({len(campaigns)} total):")
    for camp in campaigns:
        status_icon = {"active": "🟢", "draft": "⚪", "paused": "🟡", "completed": "✅"}.get(
            camp.get("status", ""), "❓"
        )
        actions = store.get_actions(camp["id"])
        lines.append(
            f"   {status_icon} {camp.get('name', 'unnamed')} "
            f"[{camp.get('id', '?')}] "
            f"({camp.get('status', '?')}) — {len(actions)} actions"
        )
    lines.append("")

    # ── 2. Today's completed actions ───────────────────────────────────────
    today_start = f"{today}T00:00:00"
    today_actions: list[dict[str, Any]] = []
    for camp in campaigns:
        today_actions.extend(
            store.get_actions(camp["id"], since=today_start)
        )

    lines.append(
        f"✅ Actions today ({len(today_actions)}):"
    )
    if today_actions:
        comp_actions = [
            a for a in today_actions
            if a.get("status") in ("completed", "posted", "replied")
        ]
        lines.append(f"   Completed: {len(comp_actions)}")
        for a in comp_actions:
            preview = (a.get("content_preview") or "")[:60]
            lines.append(
                f"     • [{a.get('platform', '?')}] "
                f"{a.get('action_type', '?')} "
                f"{f'— {preview}...' if preview else ''}"
            )
        pending_today = [
            a for a in today_actions
            if a.get("status") in ("pending", "planned")
        ]
        if pending_today:
            lines.append(f"   Still pending today: {len(pending_today)}")
            for a in pending_today:
                lines.append(
                    f"     • {a.get('action_type', '?')} "
                    f"on {a.get('platform', '?')} "
                    f"({a.get('profile_name', 'unassigned')})"
                )
    else:
        lines.append("   No actions recorded today.")
    lines.append("")

    # ── 3. Pending items by profile ────────────────────────────────────────
    all_pending: list[dict[str, Any]] = []
    for camp in campaigns:
        pending_actions = [
            a for a in store.get_actions(camp["id"])
            if a.get("status") in ("pending", "planned")
        ]
        all_pending.extend(pending_actions)

    profiles: dict[str, int] = {}
    for a in all_pending:
        p = a.get("profile_name") or "unassigned"
        profiles[p] = profiles.get(p, 0) + 1

    lines.append(f"📋 Pending by profile ({len(all_pending)} total):")
    if profiles:
        for pname, count in sorted(profiles.items(), key=lambda x: -x[1]):
            lines.append(f"   {pname}: {count} items")
    else:
        lines.append("   No pending items.")
    lines.append("")

    # ── 4. Account warmup status ──────────────────────────────────────────
    try:
        accounts = warmup.list_accounts()
        lines.append(f"🔥 Account warmup ({len(accounts)} tracked):")
        for acct in accounts:
            ready_mark = "✅" if acct.get("is_ready") else "🔄"
            phase_name = acct.get("phase_name", "?")
            days_in = acct.get("days_in_phase", 0)
            days_total = acct.get("phase_days_total", 0)
            lines.append(
                f"   {ready_mark} {acct.get('account_name', '?')}: "
                f"phase {acct.get('current_phase', 0)}"
                f" ({phase_name}) "
                f"— day {days_in}/{days_total}"
            )
        if not accounts:
            lines.append("   No accounts tracked yet.")
    except Exception as exc:
        lines.append(f"   ⚠️ Warmup status unavailable: {exc}")
    lines.append("")

    # ── 5. Campaign metric snapshot ────────────────────────────────────────
    try:
        lines.append("📊 Latest metrics:")
        for camp in campaigns:
            metrics = store.get_metrics(camp["id"])
            if metrics:
                m = metrics[0]  # most recent snapshot
                lines.append(
                    f"   {camp.get('name', '?')}: "
                    f"⭐ {m.get('github_stars', 0)} stars "
                    f"| 📦 {m.get('npm_downloads', 0)} downloads "
                    f"| 🐦 {m.get('x_mentions', 0)} mentions"
                )
            else:
                lines.append(f"   {camp.get('name', '?')}: no metrics yet.")
    except Exception as exc:
        lines.append(f"   ⚠️ Metrics unavailable: {exc}")
    lines.append("")

    lines.append("╚" + "═" * (len(today) + 26) + "╝")

    print("\n".join(lines))
    return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Sheet Sync
# ═══════════════════════════════════════════════════════════════════════════════


def _run_sheet_sync(args: argparse.Namespace) -> str | None:
    """Run bidirectional sheet ↔ DB sync.

    Returns ``None`` on success, an error string on failure.
    """
    try:
        from marketing.sheet_sync import SheetSync
        from marketing.store import CampaignStore
    except ImportError as exc:
        return f"ERROR: Cannot import marketing.sheet_sync — {exc}"

    try:
        store = CampaignStore()
        syncer = SheetSync(sheet_id=args.sheet_id, store=store)
        result = syncer.sync_bidirectional(sheet_tab=args.sheet_tab)
    except Exception as exc:
        return f"ERROR: Sheet sync failed — {exc}"

    pull = result.get("pull", {})
    push = result.get("push", {})

    print(f"🔄 Sheet sync complete:")
    print(f"   Pull: {pull.get('read', 0)} rows read"
          f" | {pull.get('updated', 0)} updated"
          f" | {pull.get('inserted', 0)} inserted")
    print(f"   Push: {push.get('pushed', 0)} rows pushed"
          f" | {push.get('updated', 0)} updated"
          f" | {push.get('new', 0)} new")
    print(f"   Status: {result.get('status', '?')}")
    return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Compute Mode
# ═══════════════════════════════════════════════════════════════════════════════


def _run_compute() -> dict:
    """Compute campaign performance for all active campaigns using ROIAnalyticsEngine.

    Returns a dict with summary stats and per-campaign results.
    """
    try:
        from marketing.roi_arch import ROIAnalyticsEngine
        from marketing.store import CampaignStore
    except ImportError as exc:
        return {"action": "compute", "error": f"Cannot import marketing modules — {exc}"}

    try:
        store = CampaignStore()
        engine = ROIAnalyticsEngine()
    except Exception as exc:
        return {"action": "compute", "error": f"Failed to initialise data stores — {exc}"}

    campaigns = store.list_campaigns(status="active")
    results: list[dict] = []

    for campaign in campaigns:
        campaign_id = campaign["id"]
        try:
            perf = engine.compute_campaign_performance(campaign_id, store)
            if perf:
                results.append({
                    "campaign_id": campaign_id,
                    "campaign_name": campaign.get("name", campaign_id),
                    "status": "completed",
                    "quality_score": perf.get("quality_score", 0),
                    "total_signals": perf.get("total_signals", 0),
                    "engagement_rate": perf.get("engagement_rate", 0.0),
                })
            else:
                results.append({
                    "campaign_id": campaign_id,
                    "status": "skipped",
                    "reason": "empty data",
                })
        except Exception as e:
            results.append({
                "campaign_id": campaign_id,
                "status": "error",
                "error": str(e),
            })

    summary = {
        "total": len(campaigns),
        "completed": sum(1 for r in results if r["status"] == "completed"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "errors": sum(1 for r in results if r["status"] == "error"),
    }

    return {"summary": summary, "results": results, "action": "compute"}


# ═══════════════════════════════════════════════════════════════════════════════
#  Hourly Check
# ═══════════════════════════════════════════════════════════════════════════════


def _run_hourly_check(args: argparse.Namespace) -> str | None:
    """Default hourly working-hours check — reads sheet, prints summary.

    Returns ``None`` on success, an error string on failure.
    """
    try:
        rows, headers = get_sheet_data(args.sheet_id, args.sheet_tab)
    except Exception as exc:
        return f"ERROR: Failed to read sheet data — {exc}"

    if not rows:
        print("No data rows found in reddit-campaign.")
        return None

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Categorize items by status
    planned = [r for r in rows if len(r) > COL_STATUS and "planned" in r[COL_STATUS]]
    pending = [r for r in rows if len(r) > COL_STATUS and "pending" in r[COL_STATUS]]
    ready = [r for r in rows if len(r) > COL_STATUS and "ReadyForBrowser" in r[COL_STATUS]]
    replied = [r for r in rows if len(r) > COL_STATUS and ("Repled" in r[COL_STATUS] or "Posted" in r[COL_STATUS])]

    print(f"📊 Sheet scan ({today}):")
    print(f"   📋 planned: {len(planned)}")
    print(f"   ⏳ pending (needs thread): {len(pending)}")
    print(f"   🖥️  ReadyForBrowser: {len(ready)}")
    print(f"   ✅ already posted: {len(replied)}")

    # Count by profile
    profiles: dict[str, int] = {}
    for r in planned + ready:
        p = r[COL_PROFILE].strip() if len(r) > COL_PROFILE and r[COL_PROFILE].strip() else "unassigned"
        profiles[p] = profiles.get(p, 0) + 1

    print("\n📋 Pending by profile:")
    for p, c in sorted(profiles.items(), key=lambda x: -x[1]):
        print(f"   {p}: {c} items")

    # Check planned items that have URLs (ready to post)
    has_url = [r for r in planned if len(r) > COL_PLATFORM_URL and r[COL_PLATFORM_URL].strip().startswith("http")]
    no_url = [r for r in planned if len(r) > COL_PLATFORM_URL and not r[COL_PLATFORM_URL].strip().startswith("http")]

    print(f"\n   📋 planned WITH URLs (ready to post): {len(has_url)}")
    print(f"   📋 planned WITHOUT URLs (need threads): {len(no_url)}")
    print(f"   ⏳ pending items (need threads): {len(pending)}")

    if has_url:
        print(f"\n🔍 Next actionable: {has_url[0][COL_CONTENT_ID]} on {has_url[0][COL_PROFILE]}")
        print(f"   URL: {has_url[0][COL_PLATFORM_URL][:80]}")

    # Summary for Hermes cron prompt
    summary = (
        f"Daily check: {len(planned)} planned / {len(pending)} pending / {len(ready)} ReadyForBrowser / {len(replied)} posted\n"
        f"Ready to post now: {len(has_url)} items with verified URLs\n"
        f"Need threads found: {len(no_url) + len(pending)} items"
    )
    print(f"\n{summary}")
    return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Cron-job logging wrapper
# ═══════════════════════════════════════════════════════════════════════════════


def _run_with_cron_logging(
    func: Callable[..., str | None],
    args: tuple[Any, ...],
    *,
    job_name: str,
    job_type: str,
    store: Any,
    platform: str | None = None,
) -> str | None:
    """Wrap a function call with ``cron_job_log`` start / completion logging.

    Returns the wrapped function's return value.
    """
    started_at = datetime.now(timezone.utc).isoformat()
    log_id = store.insert_cron_job_log(
        job_name=job_name,
        job_type=job_type,
        status="running",
        platform=platform,
        started_at=started_at,
    )
    try:
        result = func(*args)
        completed_at = datetime.now(timezone.utc).isoformat()
        duration_ms = _compute_duration_ms(started_at, completed_at)
        store.update_cron_job_log(
            log_id,
            status="completed",
            completed_at=completed_at,
            duration_ms=duration_ms,
            result_summary=str(result)[:500] if result else None,
        )
        return result
    except Exception as exc:
        completed_at = datetime.now(timezone.utc).isoformat()
        duration_ms = _compute_duration_ms(started_at, completed_at)
        store.update_cron_job_log(
            log_id,
            status="failed",
            completed_at=completed_at,
            duration_ms=duration_ms,
            error_message=str(exc)[:1000],
        )
        raise


def _compute_duration_ms(start_iso: str, end_iso: str) -> int:
    """Compute milliseconds between two ISO-8601 timestamps."""
    delta = datetime.fromisoformat(end_iso) - datetime.fromisoformat(start_iso)
    return int(delta.total_seconds() * 1000)


# ═══════════════════════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════════════════════


def main():
    args = get_args()

    try:
        from marketing.store import CampaignStore
    except ImportError as exc:
        print(f"ERROR: Cannot import CampaignStore — {exc}", file=sys.stderr)
        sys.exit(1)

    store = CampaignStore()

    # ── Compute mode ───────────────────────────────────────────────────────
    if args.compute:
        result = _run_compute()
        print(json.dumps(result, indent=2, default=str))
        return

    # ── Sheet-sync mode ────────────────────────────────────────────────────
    if args.sheet_sync:
        err = _run_with_cron_logging(
            _run_sheet_sync, (args,),
            job_name="sheet-sync", job_type="sync", store=store,
        )
        if err:
            print(err, file=sys.stderr)
            sys.exit(1)
        # If daily-digest is also requested, continue to digest below.
        if not args.daily_digest:
            return

    # ── Daily-digest mode ─────────────────────────────────────────────────
    if args.daily_digest:
        err = _run_with_cron_logging(
            _run_daily_digest, (args,),
            job_name="daily-digest", job_type="digest", store=store,
        )
        if err:
            print(err, file=sys.stderr)
            sys.exit(1)
        return  # digest is standalone

    # ── Default: hourly working-hours check ────────────────────────────────
    err = _run_with_cron_logging(
        _run_hourly_check, (args,),
        job_name="hourly-check", job_type="monitor", store=store,
    )
    if err:
        print(err, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
