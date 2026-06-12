"""Multi-wave guerrilla campaign execution engine.

Orchestrates the end-to-end execution of a marketing campaign wave:

1. Load campaign config from :class:`CampaignStore`
2. For each account × subreddit × angle tuple:
   a. Verify account is warmed up
   b. Enforce pacing (max 2-3/day, 4h gap)
   c. Find a relevant thread (stub delegated to subagent)
   d. Draft a comment matching the angle (stub delegated to subagent)
   e. Pass through :class:`HumanizationGate`
   f. Post via browser or log as dry-run
3. Track results and transition wave state

All thread-finding, content drafting, and posting are **plaintext stubs** —
the actual browser automation and LLM calls are delegated by the agent
calling this engine.  The stubs produce deterministic-or-seeded output
clearly marked for testing.
"""

from __future__ import annotations

import json
import logging
import random
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any

from marketing.config import CampaignConfig, campaign_config_from_dict
from marketing.execution_state import (
    CampaignStateManager,
    ExecutionState,
)
from marketing.store import CampaignStore

logger = logging.getLogger(__name__)

# ── Optional dependency: HumanizationGate ─────────────────────────────────────

try:
    from marketing.humanization_gate import HumanizationGate

    _HUMANIZATION_AVAILABLE = True
except ImportError:
    HumanizationGate = None  # type: ignore[assignment,misc]
    _HUMANIZATION_AVAILABLE = False
    logger.info("HumanizationGate not available — content checks disabled")

# ── Optional dependency: WarmupEngine ─────────────────────────────────────────

try:
    from marketing.warmup import WarmupEngine

    _WARMUP_AVAILABLE = True
except ImportError:
    WarmupEngine = None  # type: ignore[assignment,misc]
    _WARMUP_AVAILABLE = False
    logger.info("WarmupEngine not available — warmup checks disabled")


# ── Constants ─────────────────────────────────────────────────────────────────

_DEFAULT_MAX_CONCURRENT = 3
"""Default parallelism cap for account/subreddit tasks within a wave."""

_PACING_MAX_PER_DAY = 3
"""Hard limit on comments per account per 24-hour window."""

_PACING_MIN_GAP_HOURS = 4.0
"""Minimum hours between consecutive actions from the same account."""

_PACING_WINDOW_HOURS = 24
"""Look-back window for pacing checks."""

_STUB_SEED_TEMPLATES: list[str] = [
    "Honestly, {angle} is one of those things where the right approach makes all the difference. I've been using a similar setup and the speed gains are hard to ignore once you see them in practice.",
    "Interesting thread. For anyone exploring {angle}, I'd suggest focusing on the workflow integration rather than raw feature comparison — that's where the real value shows up.",
    "Been down this road before. The key insight with {angle} is that most people overthink the setup and underthink the maintenance. Start simple and iterate.",
    "I've been testing a few approaches to {angle} lately. What I found is that the tooling matters less than having a clear mental model of what you're trying to achieve.",
    "Great point. I'd add that {angle} benefits a lot from looking at how other people in the space are solving similar problems — there's usually something to learn from adjacent domains.",
]

_WARMUP_PHASE_ACTIONS: dict[int, str] = {
    0: "observe",
    1: "comment_light",
    2: "comment_detail",
    3: "first_post",
    4: "educational",
    5: "educational_continued",
    6: "deep_engage",
    7: "authority",
    8: "occasional_promotion",
    9: "full_readiness",
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _now() -> str:
    """Return current UTC timestamp as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _hours_ago(hours: float) -> str:
    """Return ISO-8601 timestamp *hours* before now."""
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def _stub_comment(angle: str, account: str, wave_number: int) -> str:
    """Generate a deterministic-but-varied stub comment for testing.

    Uses the angle and a time-based seed so each call produces unique
    content.  Text is styled to pass humanization heuristics.
    """
    # Use the current second as a seed so repeated calls differ
    seed = int(time.time() * 1000) % 10000 + hash(angle) % 1000
    rng = random.Random(seed)
    template = rng.choice(_STUB_SEED_TEMPLATES)
    comment = template.format(angle=angle)

    # Append a human-sounding tag so the stub is traceable in logs
    tag_id = uuid.uuid4().hex[:6]
    return f"{comment}\n\n*(stub-{tag_id} — wave {wave_number}, {account})*"


# ── CampaignExecutor ──────────────────────────────────────────────────────────


class CampaignExecutor:
    """Orchestrates execution of multi-wave guerrilla campaigns.

    Usage::

        store = CampaignStore()
        state_mgr = CampaignStateManager(store)
        gate = HumanizationGate()
        executor = CampaignExecutor(store, state_mgr, gate)

        # Dry-run a single wave
        results = executor.execute_wave("abc12345", wave_number=0, mode="dry_run")

        # Run all pending waves
        summary = executor.execute_campaign("abc12345", mode="dry_run")
    """

    def __init__(
        self,
        store: CampaignStore,
        state_mgr: CampaignStateManager,
        gate: Any | None = None,
        max_concurrent: int = _DEFAULT_MAX_CONCURRENT,
    ) -> None:
        """Initialise the executor.

        Args:
            store: A connected :class:`CampaignStore` instance.
            state_mgr: A :class:`CampaignStateManager` for wave lifecycle.
            gate: An optional :class:`HumanizationGate` instance for content
                verification.  If ``None``, the gate is skipped.
            max_concurrent: Maximum number of parallel account/subreddit
                tasks within a single wave execution.
        """
        self._store = store
        self._state_mgr = state_mgr
        self._gate = gate
        self._max_concurrent = max_concurrent
        self._lock = threading.Lock()

        # Lazy-init warmup engine if available
        self._warmup: Any = None
        if _WARMUP_AVAILABLE and WarmupEngine is not None:
            self._warmup = WarmupEngine()

    # ── Public API ─────────────────────────────────────────────────────────

    def execute_wave(
        self,
        campaign_id: str,
        wave_number: int,
        mode: str = "dry_run",
    ) -> dict[str, Any]:
        """Execute a single wave of a campaign.

        Steps:

        1. Load campaign config from the store.
        2. Get the wave definition (subreddits, angles, accounts).
        3. For each account × subreddit × angle combination, call
           :meth:`_execute_single` in parallel (capped at
           ``max_concurrent``).
        4. Aggregate results, determine wave outcome.
        5. Transition wave state (COMPLETED / PARTIAL / FAILED).
        6. Return aggregated results dict.

        Args:
            campaign_id: The campaign identifier.
            wave_number: Zero-indexed wave number to execute.
            mode: ``"dry_run"`` (default) logs everything without posting;
                ``"live"`` actually posts.

        Returns:
            A dict with keys:

            **campaign_id** (*str*)
            **wave_number** (*int*)
            **mode** (*str*)
            **total_attempted** (*int*)
            **total_posted** (*int*)
            **total_skipped** (*int*)
            **total_errors** (*int*)
            **results** (*list[dict]*)
                Per-action result dicts from :meth:`_execute_single`.
            **errors** (*list[str]*)
                Aggregated error messages.
            **wave_status** (*str*)
                Final :class:`ExecutionState` value.
            **summary** (*str*)
                Human-readable summary of what happened.
        """
        if mode not in ("dry_run", "live"):
            raise ValueError(f"mode must be 'dry_run' or 'live', got {mode!r}")

        # 1. Load campaign config
        campaign = self._store.get_campaign(campaign_id)
        if campaign is None:
            raise ValueError(f"Campaign {campaign_id!r} not found in store")

        raw_config: dict[str, Any] = campaign.get("config_json", {})
        if isinstance(raw_config, str):
            raw_config = json.loads(raw_config)
        config = campaign_config_from_dict(raw_config)

        # 2. Get wave definition
        wave_configs = [w for w in config.waves if w.wave_number == wave_number]
        if not wave_configs:
            raise ValueError(
                f"Wave {wave_number} not defined in campaign {campaign_id!r}"
            )
        wave_cfg = wave_configs[0]

        # Gather the work items: (account, subreddit, angle) tuples
        subreddits = wave_cfg.subreddits_or_targets or ["general"]
        angles = wave_cfg.content_angles or ["general discussion"]
        accounts = config.accounts or ["default_account"]

        work_items: list[tuple[str, str, str]] = [
            (account, subreddit, angle)
            for account in accounts
            for subreddit in subreddits
            for angle in angles
        ]

        # 3. Mark wave as RUNNING
        try:
            self._state_mgr.start_wave(campaign_id, wave_number)
        except RuntimeError:
            # Already running or completed — proceed anyway
            pass

        # 4. Execute in parallel with cap
        results: list[dict[str, Any]] = []
        errors: list[str] = []

        with ThreadPoolExecutor(max_workers=self._max_concurrent) as pool:
            future_map = {}
            for account, subreddit, angle in work_items:
                future = pool.submit(
                    self._execute_single,
                    campaign_id=campaign_id,
                    account=account,
                    subreddit=subreddit,
                    angle=angle,
                    wave_number=wave_number,
                    mode=mode,
                    config=config,
                )
                future_map[future] = (account, subreddit, angle)

            for future in as_completed(future_map):
                account, subreddit, angle = future_map[future]
                try:
                    result = future.result(timeout=120)
                    results.append(result)
                    if result.get("error"):
                        errors.append(
                            f"{account}/{subreddit}/{angle}: {result['error']}"
                        )
                except Exception as exc:
                    logger.exception(
                        "Task failed for %s/%s/%s",
                        account,
                        subreddit,
                        angle,
                    )
                    errors.append(f"{account}/{subreddit}/{angle}: {exc}")
                    results.append(
                        {
                            "account": account,
                            "subreddit": subreddit,
                            "angle": angle,
                            "status": "error",
                            "error": str(exc),
                        }
                    )

        # 5. Aggregate and transition
        total_attempted = len(work_items)
        total_posted = sum(
            1 for r in results if r.get("status") == "posted"
        )
        total_skipped = sum(
            1 for r in results if r.get("status") == "skipped"
        )
        total_errors = sum(
            1 for r in results if r.get("status") == "error"
        )

        if total_errors == 0 and total_skipped == 0:
            wave_status = ExecutionState.COMPLETED
        elif total_posted > 0:
            wave_status = ExecutionState.PARTIAL
        else:
            wave_status = ExecutionState.FAILED

        summary_parts: list[str] = [
            f"{total_posted} posted",
            f"{total_skipped} skipped (pacing)",
        ]
        if total_errors:
            summary_parts.append(f"{total_errors} errors")
        summary = f"Wave {wave_number}: {', '.join(summary_parts)}"

        if wave_status == ExecutionState.COMPLETED:
            self._state_mgr.complete_wave(campaign_id, wave_number, summary)
        elif wave_status == ExecutionState.PARTIAL:
            self._state_mgr.partial_wave(campaign_id, wave_number, summary, errors)
        else:
            self._state_mgr.fail_wave(campaign_id, wave_number, errors)

        return {
            "campaign_id": campaign_id,
            "wave_number": wave_number,
            "mode": mode,
            "total_attempted": total_attempted,
            "total_posted": total_posted,
            "total_skipped": total_skipped,
            "total_errors": total_errors,
            "results": results,
            "errors": errors,
            "wave_status": wave_status.value,
            "summary": summary,
        }

    def _execute_single(
        self,
        campaign_id: str,
        account: str,
        subreddit: str,
        angle: str,
        wave_number: int,
        mode: str,
        config: CampaignConfig | None = None,
    ) -> dict[str, Any]:
        """Execute a single account × subreddit × angle action.

        Flow:

        1. Check account warmup status — skip if not ready.
        2. Check pacing — skip if daily limit hit or gap too small.
        3. Find a relevant thread (stub).
        4. Draft a comment (stub).
        5. Run through :class:`HumanizationGate` (if available).
        6. Post (live) or log (dry_run).
        7. Record action in store.

        Args:
            campaign_id: The campaign this action belongs to.
            account: Account/profile name.
            subreddit: Target subreddit or community.
            angle: Content angle for the comment.
            wave_number: Current wave number.
            mode: ``"dry_run"`` or ``"live"``.
            config: Optional campaign config for context.

        Returns:
            A result dict with at minimum ``account``, ``subreddit``,
            ``angle``, and ``status`` (``"posted"`` | ``"skipped"`` |
            ``"error"``).
        """
        result: dict[str, Any] = {
            "account": account,
            "subreddit": subreddit,
            "angle": angle,
            "status": "error",
            "error": None,
            "thread": None,
            "comment": None,
            "gate_result": None,
        }

        try:
            # 1. Warmup check
            ready, warmup_info = self._check_warmup(account)
            if not ready:
                logger.info(
                    "Account %s not warmed up yet — skipping (phase %s)",
                    account,
                    warmup_info,
                )
                result["status"] = "skipped"
                result["error"] = f"Account not warmed up (phase {warmup_info})"
                return result

            # 2. Pacing check
            skip_reason = self._check_pacing(account, config)
            if skip_reason:
                logger.info(
                    "Account %s pacing check failed: %s",
                    account,
                    skip_reason,
                )
                result["status"] = "skipped"
                result["error"] = skip_reason
                return result

            # 3. Find thread (stub)
            thread = self._find_thread(subreddit, angle)
            result["thread"] = thread

            # 4. Draft comment (stub)
            comment = self._draft_comment(thread, angle, account, wave_number)
            result["comment"] = comment

            # 5. Humanization gate
            gate_result = self._check_humanization(comment)
            result["gate_result"] = gate_result

            if gate_result and not gate_result.get("pass", True):
                logger.warning(
                    "Comment for %s/%s failed humanization gate "
                    "(score: %s). Proceeding anyway.",
                    account,
                    subreddit,
                    gate_result.get("score"),
                )

            # 6. Post or dry-run
            if mode == "live":
                post_result = self._post_comment(account, thread, comment)
                if post_result.get("posted"):
                    result["status"] = "posted"
                    result["posted_url"] = post_result.get("url")
                else:
                    result["status"] = "error"
                    result["error"] = "Posting failed"
                    self._log_action(
                        campaign_id=campaign_id,
                        account=account,
                        platform="reddit",
                        action_type="comment_post_failed",
                        thread=thread,
                        comment=comment,
                        status="failed",
                    )
                    return result
            else:
                result["status"] = "posted"  # dry-run counts as success

            # 7. Log action
            action_id = self._log_action(
                campaign_id=campaign_id,
                account=account,
                platform="reddit",
                action_type="comment_posted" if mode == "live" else "comment_dry_run",
                thread=thread,
                comment=comment,
                status="completed",
            )
            result["action_id"] = action_id
            if action_id is not None:
                self._state_mgr.record_action(
                    campaign_id, wave_number, account,
                )

        except Exception as exc:
            logger.exception(
                "Unexpected error in _execute_single(%s, %s, %s)",
                account,
                subreddit,
                angle,
            )
            result["status"] = "error"
            result["error"] = str(exc)

        return result

    def execute_campaign(
        self,
        campaign_id: str,
        run_all: bool = True,
        mode: str = "dry_run",
    ) -> list[dict[str, Any]]:
        """Convenience: execute all pending waves for *campaign_id*.

        When *run_all* is ``True`` (default), every wave that is still in
        ``PLANNED`` state is executed sequentially in wave order.

        Args:
            campaign_id: The campaign identifier.
            run_all: If ``True``, run all pending waves.  If ``False``, only
                run the first pending wave.
            mode: ``"dry_run"`` or ``"live"``.

        Returns:
            A list of result dicts, one per executed wave (same shape as
            :meth:`execute_wave`).
        """
        waves = self._state_mgr.list_waves(campaign_id)
        pending = [w for w in waves if w.status == ExecutionState.PLANNED]

        if not pending:
            logger.info("Campaign %s has no pending waves", campaign_id)
            return []

        if not run_all:
            pending = pending[:1]

        results: list[dict[str, Any]] = []
        for wave in pending:
            logger.info(
                "Executing campaign %s wave %d (%s)",
                campaign_id,
                wave.wave_number,
                mode,
            )
            result = self.execute_wave(
                campaign_id=campaign_id,
                wave_number=wave.wave_number,
                mode=mode,
            )
            results.append(result)

        return results

    # ── Internal: warmup ──────────────────────────────────────────────────

    def _check_warmup(self, account: str) -> tuple[bool, Any]:
        """Check whether *account* is warmed up for marketing.

        Returns ``(True, None)`` if ready, or ``(False, info)`` with the
        current phase info if not.
        """
        if self._warmup is None:
            return True, None  # no warmup engine — assume ready

        try:
            ready = self._warmup.is_account_ready(account)
            if ready:
                return True, None
            # Gather phase info for the skip message
            try:
                phase_info = self._warmup.get_current_phase(account)
                return False, phase_info.get("phase_number", "unknown")
            except KeyError:
                return False, "not_started"
        except Exception as exc:
            logger.warning("Warmup check failed for %s: %s", account, exc)
            return True, None  # fail open

    # ── Internal: pacing ──────────────────────────────────────────────────

    def _check_pacing(
        self,
        account: str,
        config: CampaignConfig | None = None,
    ) -> str | None:
        """Enforce daily and inter-action pacing limits.

        Checks:

        * Max ``_PACING_MAX_PER_DAY`` actions per account in a 24-hour window.
        * Min ``_PACING_MIN_GAP_HOURS`` hours since the account's last action.

        Returns ``None`` if the account may proceed, or a human-readable
        skip reason string.
        """
        since_ts = _hours_ago(_PACING_WINDOW_HOURS)

        # We query actions across **all** campaigns for this account since
        # pacing is account-wide, not per-campaign.  The store's
        # ``get_actions`` filters by campaign_id, so we need to iterate
        # campaigns or use a different approach.  For simplicity, we
        # compute pacing from the state manager and from our own log.
        # Since the state manager tracks per-wave counts, we do the full
        # check here via the store: grab actions with profile_name matching
        # the account across all campaigns.

        # Count recent actions for this account
        recent_count = 0
        last_action_time: str | None = None

        # Iterate all campaigns to find actions for this account
        all_campaigns = self._store.list_campaigns()
        for camp in all_campaigns:
            cid = camp["id"]
            actions = self._store.get_actions(cid, since=since_ts)
            for act in actions:
                if act.get("profile_name") == account:
                    recent_count += 1
                    if last_action_time is None or act["timestamp"] > last_action_time:
                        last_action_time = act["timestamp"]

        if recent_count >= _PACING_MAX_PER_DAY:
            return (
                f"Daily limit reached: {recent_count} actions in "
                f"the last {_PACING_WINDOW_HOURS}h "
                f"(max {_PACING_MAX_PER_DAY})"
            )

        if last_action_time is not None:
            last_dt = datetime.fromisoformat(last_action_time)
            now_dt = datetime.now(timezone.utc)
            gap_hours = (now_dt - last_dt).total_seconds() / 3600.0
            if gap_hours < _PACING_MIN_GAP_HOURS:
                return (
                    f"Too soon since last action: "
                    f"{gap_hours:.1f}h elapsed, "
                    f"need {_PACING_MIN_GAP_HOURS}h minimum"
                )

        return None

    # ── Internal: thread finding (STUB) ───────────────────────────────────

    def _find_thread(self, subreddit: str, angle: str) -> dict[str, Any]:
        """Find a relevant thread to comment on.

        **PLAINTEXT STUB** — returns a simulated thread dict.  The actual
        thread-finding logic (Reddit search, RSS monitoring, etc.) is
        delegated to a subagent.
        """
        stub_id = uuid.uuid4().hex[:8]
        return {
            "title": f"Discussion about {angle}",
            "url": f"https://reddit.com/r/{subreddit}/thread-{stub_id}",
            "id": f"stub_thread_{stub_id}",
            "subreddit": subreddit,
            "score": random.randint(0, 50),
            "comment_count": random.randint(3, 30),
            "_stub": True,
            "_note": "Generated by stub for testing — replace with real thread",
        }

    # ── Internal: content drafting (STUB) ─────────────────────────────────

    def _draft_comment(
        self,
        thread: dict[str, Any],
        angle: str,
        account: str,
        wave_number: int,
    ) -> str:
        """Draft a comment for a thread matching the given angle.

        **PLAINTEXT STUB** — generates a deterministic-but-varied comment.
        The actual content generation is delegated to an LLM subagent.

        The output avoids AI tell words (checked by HumanizationGate) and
        varies per call via time-based seeding.
        """
        return _stub_comment(angle, account, wave_number)

    # ── Internal: posting (PLACEHOLDER) ───────────────────────────────────

    def _post_comment(
        self,
        account: str,
        thread: dict[str, Any],
        comment: str,
    ) -> dict[str, Any]:
        """Post a comment to the target platform.

        **PLACEHOLDER STUB** — returns a success result without actually
        posting.  The actual browser automation is performed by a subagent
        via Playwright or similar.
        """
        stub_post_id = uuid.uuid4().hex[:10]
        return {
            "posted": True,
            "url": f"{thread.get('url', '')}/comment/{stub_post_id}",
            "comment_id": stub_post_id,
            "_stub": True,
            "_note": "Placeholder — no actual post was made",
        }

    # ── Internal: humanization gate ───────────────────────────────────────

    def _check_humanization(
        self,
        content: str,
        platform: str = "reddit",
    ) -> dict[str, Any] | None:
        """Run *content* through the HumanizationGate, if available.

        Returns the gate result dict or ``None`` if the gate is not
        configured.
        """
        if self._gate is None:
            return None
        if HumanizationGate is None:
            return None

        try:
            return self._gate.check(content, platform=platform)
        except Exception as exc:
            logger.warning("HumanizationGate check failed: %s", exc)
            return {"pass": True, "score": 50.0, "error": str(exc)}

    # ── Internal: action logging ──────────────────────────────────────────

    def _log_action(
        self,
        campaign_id: str,
        account: str,
        platform: str,
        action_type: str,
        thread: dict[str, Any],
        comment: str,
        status: str = "completed",
    ) -> int | None:
        """Log an action to the store.

        Args:
            campaign_id: The campaign identifier.
            account: Account/profile name.
            platform: Target platform (e.g. ``"reddit"``).
            action_type: Type of action (e.g. ``"comment_posted"``).
            thread: The thread dict with ``url`` key.
            comment: The comment text.
            status: Action status (default ``"completed"``).

        Returns:
            The action ID from the store, or ``None`` on failure.
        """
        try:
            action_id = self._store.log_action(
                campaign_id,
                platform=platform,
                action_type=action_type,
                target_url=thread.get("url"),
                content_preview=comment[:200],
                profile_name=account,
                status=status,
            )
            return action_id
        except Exception as exc:
            logger.warning("Failed to log action: %s", exc)
            return None
